# Ironwood (NU6.3) migration + node-independence plan

_Written July 11, 2026. Owner: Sam. Status: Phase 1 in progress._

## The clock

| What | Value |
| --- | --- |
| NU6.3 (Ironwood) mainnet activation | **block 3,428,143 ≈ July 28, 2026, 8AM EST** |
| New consensus branch ID | `0x37A5165B` (current NU6.2: `0x5437f330`) |
| zcashd end-of-life halt | July 18, 2026 (does not affect us — we run librustzcash + lightwalletd) |
| Anchor crate release | `zcash_protocol 0.10.0`, published to crates.io July 9, 2026 |

**Failure mode if we do nothing:** at activation height, transactions built
with NU6.2 branch ID are rejected by the network — autonomous payouts stop,
during hackathon judging. **The fix ships early safely**: the v5 builder
selects the branch ID from the target height, so an upgraded backend pays
correctly both before and after activation.

## Phase 1 — re-pin + redeploy (deadline: July 24, buffer before the 28th)

1. **Discover the NU6.3 crate family** (Mac):
   ```bash
   cd ~/Pedalshield/zcash-service
   for c in orchard zcash_primitives zcash_address zcash_keys zcash_protocol \
            sapling-crypto zcash_transparent incrementalmerkletree; do
     cargo search $c --limit 1; done
   ```
   Paste the output to Claude → exact Cargo.toml pins get written.
2. **Bump the whole family together** in `crates/pedalshield-treasury/Cargo.toml`
   (`zcash_protocol = "0.10"` is the anchor; orchard/primitives/keys move in
   lockstep; the `=`-pinned `sapling-crypto` / `zcash_transparent` must match
   what the new `zcash_primitives` resolves).
3. **Build + fix API churn + test** (Mac): `cargo build --release && cargo test`.
4. **Verify branch awareness**: `cargo run --bin treasury_ping` — should still
   print `0x5437f330` pre-activation (branch is height-selected; that's correct).
5. **Reconcile droplet git** (one-time debt): commit Mac's `zcash-service`
   changes, push; on droplet `git stash && git pull origin main`, then
   `git stash show -p` — confirm nothing in the stash is missing from the
   pulled tree before dropping it.
6. **Deploy**: rebuild on droplet, restart, dry-run:
   `cargo run --release --bin treasury_wallet -- send --dry-run ...`
7. **Do one real test ride + payout** before July 28, and one after
   activation on the 28th. Both txids go in the README receipts table.

## Phase 2 — own node: Zakura (after July 28 + judging)

Why: removes the zec.rocks single point of failure; latency drops; we become
our own infrastructure (MINER_SCALE_PLAN Role 1, eating our own dogfood).

- Zakura v1.0.0 (Valar Group / Project Tachyon): Zebra-derived, full sync
  ~4h20m (5× faster than Zebra), pruned snapshot ready in ~2 min, zcashd RPC
  compatibility mode, NU6.3-ready from day one.
- Plan: separate droplet (≥4 GB RAM, ~100 GB disk to be safe) → run Zakura
  (pruned) → run lightwalletd against it → smoke-test with `treasury_ping`
  pointed at it → flip `PEDALSHIELD_LIGHTWALLETD` to the new endpoint,
  keeping `https://zec.rocks:443` documented as manual fallback.
- Never migrate the node and the crates in the same week. One variable at a time.

## Rollback

Phase 1: droplet keeps the previous binary at
`target/release/backend` — copy it aside pre-deploy
(`cp target/release/backend ~/backend-nu62-backup`); systemd `ExecStart` can
point back at it in seconds. Note: after activation height, the old binary
CANNOT pay — rollback only helps before the 28th.

## Sources

- Activation height + branch ID: Sean Bowe announcement (July 2026);
  Zebra 6.0.0 release notes (ZF).
- zcashd EOL July 18: ECC announcement.
- Zakura: Valar Group / Project Tachyon release, Zcash forum thread
  "Zebra, Zakura, and the road through NU6.3".

---

# Postmortem — activation day (July 29, 2026)

**Outcome:** payouts broke at activation and were restored the same day.
First post-fork payout:
[`fbf4e134…d16ed8`](https://mainnet.zcashexplorer.app/transactions/fbf4e134cd74b635c598d869f1cafffd902f649fac44cfb6ef534e8e01d16ed8)
— a **v6 cross-pool migration spend**, autonomous, no operator.

## What actually happened

1. **The deploy never landed (self-inflicted, ~4h of the outage).** The
   Phase-1 block was run on July 11 but `git pull` aborted with
   *"Committer identity unknown"* — root had no git identity on the
   droplet. Every later step in the same block ran against unchanged
   source, and `cargo` "succeeded" in 0.3s by relinking the old binary.
   Nobody checked. At activation the treasury was still NU6.2 code.
2. **The real protocol change (would have hit us regardless).**
   Re-pinning to `zcash_protocol 0.10` fixed the branch id but the first
   claim then failed with `OrchardRecipient(CrossAddressDisabled)`.
   Post-Ironwood, legacy `orchard_v3` bundles are built with
   cross-address transfers DISABLED — every output must be
   wallet-controlled change. **You can no longer pay a third party from
   the legacy Orchard pool.**
3. **The fix (spender.rs).** Supplying an `ironwood_anchor` alone is not
   enough — `add_orchard_output` always targets the legacy builder. The
   working shape of a migration spend is:
   - `add_orchard_spend` — treasury notes stay in legacy Orchard;
   - `add_ironwood_output` — the RIDER's payment (Ironwood permits
     ordinary recipients);
   - `add_orchard_change_output` — change stays in the LEGACY pool, which
     keeps our existing scanner able to see the treasury balance.

## Lessons (both cheap, both would have prevented the outage)

- **Verify deploys landed.** `git log --oneline -1` immediately after
  every pull, and treat a sub-second `cargo build` as a red flag, not a
  win. Added to the Phase-1 checklist above.
- **Set a git identity on every server** that will ever pull.
- (Adjacent, same week) **OTA bundles ≠ build env.** `eas update`
  publishes from the local machine, where `eas.json` build-time env vars
  do NOT apply — a dev backend URL shipped to riders that way. Defaults
  must fail safe toward production.

## Still open

- **Ironwood-pool scanning.** The treasury can spend legacy notes and pay
  Ironwood outputs, but cannot yet see notes paid INTO the Ironwood pool.
  Required before the treasury is ever topped up with Ironwood funds, and
  before change is allowed to land there.
- **~8 claims** queued during the outage need replay via `/approve`.
