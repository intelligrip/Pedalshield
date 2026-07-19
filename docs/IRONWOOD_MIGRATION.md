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
