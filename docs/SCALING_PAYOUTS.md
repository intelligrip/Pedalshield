# Pedalshield — Scaling the Payout Pipeline

_How the autonomous payout loop survives millions of private rides without
draining the treasury. Written 2026-06-13. Honest framing rules from
`HANDOFF.md` apply: say what this does and what it doesn't._

## The thesis in one line

At scale, **the enemy is the per-ride on-chain action, not the per-tx
overhead.** Batching many riders into one transaction fixes throughput but
**does not** lower the treasury's cost per rider. Only **accrual + threshold
settlement** does. Build both; lead with accrual.

---

## Why the current loop breaks

Today every accepted claim fires its own Orchard spend (`POST /claim` →
build → prove → sign → broadcast). Three walls appear well before a million
rides:

1. **Throughput wall (mempool serialization).** A spend consumes the
   treasury note and produces a change note. The next spend needs that change
   note _confirmed_ — ~75 s/block. One real chain of spends ⇒ **~1 payout per
   block ≈ ~1,150/day.** A million rides/day needs ~870× that.

2. **Contention wall (same-block double-select).** Run spends concurrently to
   beat serialization and two of them select the same note in the same block:
   one tx is rejected, its proving work is burned. This is already a tracked
   roadmap risk ("mempool-aware note reservation").

3. **Treasury wall (the expensive one).** ZIP-317 charges a **5,000-zat
   marginal fee per logical action (0.00005 ZEC), minimum 2 actions.** Each
   rider you pay is one Orchard output = one action = **≥5,000 zats of fee,
   paid by the treasury.** Compare to the payout schedule (0.0002 ZEC/km):

   | Ride | Payout | On-chain fee | Fee as % of payout |
   |---|---|---|---|
   | 0.25 km | 0.00005 ZEC | 0.00005 ZEC | **100%** (fee = payout) |
   | 1 km | 0.0002 ZEC | 0.00005 ZEC | **25%** |
   | 5 km | 0.001 ZEC | 0.00005 ZEC | 5% |

   Paying every short ride individually, the treasury spends a quarter to all
   of every reward shipping coins. At a million small rides/day that is the
   runway, gone.

**Key fact that drives the whole design:** batching N riders into one tx
**does not** reduce the per-rider fee. An Orchard tx paying N recipients needs
~N actions, so its fee is ~N × 5,000 zats — the per-rider 5,000-zat floor is
unchanged. Batching wins back _throughput and contention_; it does **not**
win back _runway_. Runway only improves if a rider's many rides settle in
**one** action instead of one action each.

---

## The design: accrue off-chain, settle on a threshold, batch the settlement

Three layers, each fixing one wall.

### 1. Accrual ledger (fixes the treasury wall)

Rides no longer pay on-chain. Each accepted claim credits a **per-account
pending balance** in the ledger (the value the verifier already computed —
`verifiedKm × rate`, capped). No spend, no fee, no note touched.

- Autonomy is preserved: this is still no-human-in-the-loop. What changes is
  _settlement cadence_, not operator involvement. (Per `HANDOFF.md`: do not
  reintroduce a manual operator — accrual doesn't.)
- Effort still dominates: the credited amount is unchanged; we only defer when
  coins move.

### 2. Threshold settlement (turns runway from a tax into a rounding error)

A rider's pending balance settles on-chain only when it crosses a **payout
floor `F`**, or on explicit rider-initiated withdraw. Pick `F` so the fixed
5,000-zat fee is negligible:

| Floor `F` | Fee overhead (5,000 zats / F) |
|---|---|
| 0.001 ZEC | 5% |
| 0.005 ZEC (current per-ride cap) | 1% |
| **0.01 ZEC** | **0.5%** ← recommended default |

At `F = 0.01 ZEC` and 0.0002 ZEC/km, a rider accrues ~50 km before settling —
roughly 10 days at 5 km/day. The treasury's fee bleed drops from up to 100%
to **≤0.5%.** That is the runway fix.

### 3. Batched settlement tx + note reservation (fixes throughput & contention)

When balances cross `F`, a **settler** drains all due riders in a window into
**one Orchard tx with up to N outputs**, and:

- **Reserves treasury notes atomically** in the ledger (a note can be in at
  most one in-flight batch) — kills same-block double-select.
- **Pre-splits the treasury into a working set of K notes** (fan-out tx) so K
  settlement batches can run in parallel on disjoint notes instead of
  serializing on a single change note.
- **Tracks in-flight nullifiers** so an unconfirmed change note is never
  re-selected (the roadmap's "mempool-aware reservation," now load-bearing).

**Does this close the throughput gap?** With `F = 0.01 ZEC`, 1M riders at
5 km/day each settle ~every 10 days ⇒ ~100k settlements/day. Batch N = 100/tx
⇒ **~1,000 settlement txs/day**, under the ~1,150 blocks/day ceiling even
_without_ parallel notes. Add a working set of K notes and there is comfortable
headroom. The throughput wall is gone.

---

## Numbers at a million rides/day

Assume 1M rides/day, avg 5 km, schedule 0.0002 ZEC/km.

| Metric | Per-ride spend (today) | Accrual + threshold batch |
|---|---|---|
| On-chain txs/day | up to 1,000,000 | ~1,000 |
| Logical actions/day | ~1,000,000 | ~100,000 |
| Fee paid by treasury/day | ~50 ZEC | ~5 ZEC |
| Fee as % of rewards | up to ~25–100% | **~0.5%** |
| Hits block-rate ceiling? | yes, by ~870× | no |

(Reward outflow itself is ~1,000 ZEC/day in this scenario; the win is killing
the fee tax and the serialization ceiling, not the rewards — those are the
product.)

---

## Privacy: this is a net gain, with one honest caveat

- **Better recipient/timing privacy.** Fewer, larger batches mean a settlement
  tx mixes many riders' amounts and recipients in the Orchard pool, and breaks
  the 1:1 ride→payout timing correlation that per-ride spends leak. This is the
  property `ARCHITECTURE.md` already wanted from batching.
- **No new route/sensor exposure.** Accrual touches only the existing
  pseudonymous account balance — the privacy seam (no geo, no motion) is
  untouched; the unit tests that enforce it still hold.
- **Honest caveat — a new liability surface.** A pending balance is "treasury
  owes rider, off-chain." If the ledger is lost, riders lose unsettled
  earnings. Mitigations: the pending balance is **reconstructable by replaying
  the append-only claim log**, the ledger must be durable + replicated (this is
  also the Postgres argument), and we cap maximum pending exposure per account.
  State this in the security doc; don't paper over it.

---

## Forward-compat: Ironwood

Orchard closes to new deposits / intra-pool transfers at Ironwood activation
(~late July 2026, tracked in `HANDOFF.md`). Keep the settler **pool-agnostic**:
the accrual ledger, threshold logic, batching, and note-reservation are
pool-independent; only the bundle builder in `spend/` swaps Orchard → Ironwood.
Accrual actually _helps the migration_ — fewer in-flight on-chain notes to
drain through the one-way exit.

---

## Build order (smallest load-bearing change first)

1. **Accrual ledger** — add a `pending_balance` per account; `POST /claim`
   credits instead of paying. Biggest runway win, smallest diff. (sqlite is
   fine to prototype; Postgres when the ledger becomes the source of truth.)
2. **Threshold trigger** — settle when `pending ≥ F` or on `/withdraw`. Ship
   `F` as config (default 0.01 ZEC).
3. **Batched settler** — one tx, many outputs; drains all due riders in a
   window. Reuses the existing build→prove→sign→broadcast path with N outputs.
4. **Note reservation + working-set fan-out** — atomic note reservation in the
   ledger; pre-split treasury into K notes; in-flight nullifier tracking.
5. **Durability** — Postgres + replicated append-only claim log so pending
   balances are never the single point of loss.

Each step is independently shippable and independently testable. Step 1 alone
removes the treasury wall; steps 3–4 remove the throughput and contention walls.

---

## What this does NOT solve

- **Sybil / fake-ride economics at scale.** Cheaper, batched payouts make the
  anti-cheat _more_ important, not less — accrual just changes when money
  moves, not whether a ride was real. The layered anti-cheat + attestation +
  trust ramp still carry that load.
- **The off-chain liability** above — real, mitigated, not eliminated.
- **ZK distance proofs** (Tier 2) are orthogonal and still roadmap.

---

## Step 1 scaffold — what's already in the tree

`crates/pedalshield-treasury/src/accrual.rs` (registered in `lib.rs`) ships
the accrual ledger as pure rusqlite + bookkeeping — no network, fully
unit-tested. Run it offline:

```bash
cd zcash-service
cargo test -p pedalshield-treasury accrual
```

It gives you: `ensure_schema`, `accrue` (idempotent on `claim_id`),
`pending`, `due_for_settlement(floor, limit)`, and a balance-level
reservation guard `begin_settling` / `mark_settled` / `revert_settling` that
mirrors the proven per-claim `begin_paying` double-pay guard. Default floor
`DEFAULT_FLOOR_ZAT = 1_000_000` (0.01 ZEC).

### Wiring it into `backend.rs` (opt-in, proven path untouched)

1. **Schema.** After `open_db` runs `SCHEMA`, also call
   `pedalshield_treasury::accrual::ensure_schema(&conn)?`.

2. **AppState.** Add two fields, both defaulting to the current behaviour:
   ```rust
   accrual_mode: bool,        // env PEDAL_ACCRUAL=1; default false
   payout_floor_zat: u64,     // env PEDAL_FLOOR_ZAT; default 1_000_000
   ```

3. **`post_claim`.** Replace the auto-payout `tokio::spawn` block with a
   branch — accrue instead of paying per ride when enabled:
   ```rust
   if state.accrual_mode {
       let amount = compute_payout(row.distance_meters, state.zat_per_km, state.max_payout_zat);
       let conn = state.db.lock().unwrap();
       pedalshield_treasury::accrual::accrue(&conn, &id, &row.recipient_ua, amount, now)
           .map_err(|e| AppError::Internal(format!("accrue: {e}")))?;
       // ACK "accrued" — no spend, no fee, no note touched.
   } else if state.auto_payout {
       /* existing proven per-claim payout spawn, unchanged */
   }
   ```

4. **Settlement sweep.** A periodic task (or a `POST /settle` admin trigger)
   that, per the design above, pays each due balance and is **forward-compatible
   with batching** — today one `spender::pay` per recipient, later one tx with
   many outputs:
   ```rust
   for d in accrual::due_for_settlement(&conn, state.payout_floor_zat, 100)? {
       let Some(amt) = accrual::begin_settling(&conn, &d.recipient_ua, now)? else { continue };
       match spender::pay(&state.lightwalletd, &sk, &d.recipient_ua, amt,
                          state.birthday, true).await {
           Ok(r) if matches!(r.broadcast, Some((0, _))) =>
               accrual::mark_settled(&conn, &d.recipient_ua, amt, &r.txid_hex, now)?,
           _ => accrual::revert_settling(&conn, &d.recipient_ua, now)?,
       }
   }
   ```
   Reuse the existing `payout_lock` around the spend so concurrent sweeps
   never select the same note. (The `due_for_settlement` `limit` is the future
   batch's recipient count — when the batched builder lands, swap the per-loop
   `pay` for one multi-output tx.)

5. **`/withdraw`.** Let a rider settle below the floor on demand: same as one
   sweep iteration scoped to their `recipient_ua`.

Net effect once enabled: claims ACK instantly with no on-chain action, and the
treasury settles each rider once per ~0.01 ZEC accrued instead of once per
ride — the runway fix, with the proven autonomous spend path reused verbatim
for the actual settlement.

---

_Sources for the fee mechanics: [ZIP-317](https://zips.z.cash/zip-0317)
(5,000-zat marginal fee per logical action, 2-action grace)._
