# Pedalshield — Handoff for Grok

_Onboarding doc for Grok as the next build engineer. Read this top to bottom
before touching anything. It assumes no prior context, then points at the
deeper docs. Last updated: 2026-06-13._

## What you're taking over

**Pedalshield** — a privacy-first "ride-to-earn" app. A cyclist tracks a real
bike ride; the phone verifies it **entirely on-device** (the GPS route never
leaves the device); an **autonomous backend pays out shielded ZEC on Zcash
mainnet** sized by distance, with **no human in the loop**. Submission:
**ZecHub Hackathon 2026, Games track, deadline July 15 2026.** Repo:
`github.com/intelligrip/Pedalshield`.

The core loop is **already proven on mainnet** (real txids in `README.md`).
You are not building from zero — you are scaling a working system and finishing
the game loop.

### The two theses you must not break
1. **Privacy:** the route/motion/sensor data never leaves the phone. Unit
   tests enforce that the claim payload contains no `lat`/`lon`/`accel`/etc.
   Don't add anything that uploads route data.
2. **Autonomy:** payouts are fully autonomous — **no manual-operator
   fallback** as the product. Samuel is firm on this. The accrual/settlement
   work below is still autonomous; don't reframe it as an operator.

### Working with Samuel
Terse, fast, drives with "go" / single words, pastes errors verbatim, wants
forward momentum over deliberation. **He builds and runs; you edit.** The
sandbox you (the AI) run in cannot execute his `cargo`/Metro/device or hit the
network, and cannot delete files in the repo mount. Loop: **you edit files →
Samuel builds/runs → pastes output.** No giant heredocs, no `#` inline comments
in pasted zsh commands.

---

## Environment & paths

- Repo: **`~/Pedalshield`** on Samuel's Mac. Shell alias **`$PEDAL`** points
  there (in `~/.zshrc`; a fresh terminal needs `source ~/.zshrc`).
- Rust workspace: `$PEDAL/zcash-service`. Build: `cargo build --release`;
  binaries in `target/release/`.
- Treasury keys: `$PEDAL/zcash-service/treasury-keys/treasury_spending_key.bin`
  (raw 32 bytes, gitignored) + `treasury_seed.txt` (also on paper).
- Lightwalletd: **`https://zec.rocks:443`** (NOT `mainnet.lightwalletd.com:9067`
  — flaky).
- Mac LAN IP for phone↔backend: **192.168.0.62**; Metro last on **:8083**;
  backend on **:8787**.

---

## Consensus / dependency reality (don't fight it)

- **NU6.2** is the live network rule (consensus branch id `0x5437f330`,
  activated block 3,364,600) after the June 2026 Orchard counterfeiting fix.
  A tx stamped with the wrong branch id is rejected. Only `zcash_protocol
  >= 0.9` knows NU6_2, so the whole zcash stack is pinned in
  `crates/pedalshield-treasury/Cargo.toml` (orchard 0.14, zcash_primitives
  0.28, zcash_protocol 0.9, …). `transparent` and `sapling` are pinned
  **exactly** to what `zcash_primitives 0.28` links or types won't unify.
- **Do NOT** reintroduce `zcash_client_backend` / `zcash_client_sqlite` — their
  published graph is broken; the spend path is hand-rolled on purpose.
- **Ironwood** (Orchard's successor pool) activates **~late July 2026**. At
  activation Orchard closes to new deposits + intra-pool transfers, so
  **treasury→rider Orchard payouts stop working** and the spend path must be
  rebuilt against Ironwood crates. The hackathon window (submit Jul 5, deadline
  Jul 15) survives; record demo footage early. Keep new code **pool-agnostic**
  so only the bundle builder swaps later.

---

## What already works (proven, don't rebuild)

- **Hand-rolled autonomous Orchard spend** in `src/spend/` (`tree.rs`,
  `scanner.rs`, `spender.rs`): seed the commitment tree from lightwalletd
  `GetTreeState` → scan to tip → select largest unspent note → build v5 tx
  (ZIP-317 `FeeRule::standard()`) → broadcast. Mainnet-proven.
  `spender::pay(endpoint, sk, recipient_ua, amount_zat, birthday, broadcast)`
  → `SpendResult { txid_hex, broadcast: Option<(i32,String)> }`.
- **Backend** `src/bin/backend.rs` (axum + sqlite): `POST /claim` validates +
  inserts and (auto-payout default ON) spawns `run_payout` in the background,
  ACKs `"paying"`. `run_payout` reserves `pending→paying` (double-pay guard),
  pays behind a `tokio::Mutex` payout lock, marks `paid`+txid or reverts.
- **On-device verifier** (`mobile/src/verification/`): integrity score, hard
  fails (teleport >90 km/h, avg >65 km/h, no motion). 34 passing JS tests + the
  Rust suite.
- Treasury holds **~0.0096 ZEC** across a few notes (each test burns the
  ~0.0001 ZEC ZIP-317 fee). Don't ask Samuel to fund more until needed.

Known proven limitation: spent-detection only sees **mined** nullifiers, so two
payouts in the same ~1–2 min block could select the same note. The serialize
lock stops concurrent races, not the mempool race. Real fix = mempool-aware
note reservation (the accrual settlement reservation is a step toward this).

---

## NEW THIS SESSION — the payout-scaling work (your starting point)

The product needs to reach **millions of private rides** without draining the
finite treasury. The blocker is economic, not just throughput: ZIP-317 charges
**5,000 zats per logical action**, so paying every short ride individually can
cost up to 100% of the reward in fees. The fix is **accrue off-chain, settle on
a threshold, batch the settlement**. Full reasoning + numbers:
**`docs/SCALING_PAYOUTS.md`** (read this first).

### Code landed this session (uncommitted — see git status below)

1. **`src/accrual.rs`** (NEW, registered in `lib.rs`) — the accrual ledger as
   pure rusqlite + bookkeeping, no network, **8 unit tests**. Functions:
   `ensure_schema`, `accrue` (idempotent on `claim_id`), `pending`,
   `due_for_settlement(floor, limit)`, and a balance-level reservation guard
   `begin_settling` / `mark_settled` / `revert_settling` (the per-balance twin
   of the proven `begin_paying` per-claim guard). Default floor
   `DEFAULT_FLOOR_ZAT = 1_000_000` (0.01 ZEC) → ~0.5% fee overhead. Tables:
   `balances`, append-only `accruals` (reconstructability), `settlements`.

2. **`src/bin/backend.rs`** (MODIFIED) — opt-in accrual path, default OFF so the
   proven per-claim path is byte-identical when disabled:
   - `open_db` also runs `accrual::ensure_schema`.
   - `AppState` gains `accrual_mode` + `payout_floor_zat`.
   - `post_claim`: in accrual mode, credits the off-chain balance and ACKs
     `"accrued"` (no spend, no fee), instead of spawning a per-ride payout.
   - `settle_one` / `run_settlement_sweep`: reuse `spender::pay` under the
     existing `payout_lock`; reserve→pay→mark/revert per recipient.
   - Routes `POST /settle` (sweep now) and `POST /withdraw/:ua` (settle one
     rider below floor); a background sweep task runs every
     `PEDAL_SETTLE_INTERVAL_SECS` when accrual mode is on.
   - New env: `PEDAL_ACCRUAL=1`, `PEDAL_FLOOR_ZAT`, `PEDAL_SETTLE_INTERVAL_SECS`.

3. **`Cargo.toml`** (MODIFIED) — added tokio `"time"` feature (the sweep uses
   `tokio::time::interval`).

### >>> IMMEDIATE NEXT TASK: build + verify the accrual path

Samuel hasn't compiled this yet. First loop:

```bash
cd $PEDAL/zcash-service
cargo test -p pedalshield-treasury accrual     # offline, no network — the 8 tests
cargo build --release --bin backend            # full build
```

If it builds, exercise it:
```bash
PEDAL_ACCRUAL=1 PEDAL_FLOOR_ZAT=1000000 PEDAL_SETTLE_INTERVAL_SECS=300 \
  cargo run --release --bin backend
# POST /claim a few times → balances accrue, no tx
# cross 0.01 ZEC → background sweep (or POST /settle) fires one real Orchard spend
# POST /withdraw/<ua> settles a rider on demand
```

**Watch points when it compiles:**
- The `time` feature is the most likely first error if anything (it may also be
  pulled transitively by tonic — if cargo complains, that line is why it's there).
- In accrual mode the `claims` table rows stay `pending` forever (real
  accounting moved to `accruals`/`settlements`), so `/healthz` pending count is
  misleading in that mode — cosmetic, clean up if it bugs Samuel.
- No DB mutex is held across an `.await` (verified by hand); preserve that if
  you edit the settlement path.

---

## Where to take it next (priority order)

1. **Verify the accrual build** (above), then decide if accrual mode becomes
   default for the scale story or stays opt-in for the hackathon demo.
2. **Mobile `PayoutCard`** — teach it the `"accrued"` ACK: show an accruing
   balance + "next payout at 0.01 ZEC" instead of waiting for a per-ride txid.
   (`mobile/src/components/PayoutCard.tsx`, `src/lib/api.ts`.)
3. **RedPallas FROST swap** — the gating crypto work. Replace `frost-ed25519`
   with `frost-redpallas` (ZIP-312) so the FROST 2-of-3 can actually authorize
   mainnet Orchard spends. This unblocks the treasury-steward recruitment in
   `docs/MINER_SCALE_PLAN.md` and is the real "no single hot key" story.
4. **Batched multi-output settler** — today `run_settlement_sweep` does one
   `spender::pay` per recipient. Swap the per-recipient loop for one Orchard tx
   with N outputs (the `due_for_settlement` limit is the batch size). This is
   the throughput + privacy win.
5. **Durability** — `balances` is becoming a source of truth for owed funds;
   move to Postgres + replicated append-only `accruals` log before production.
6. **Ironwood migration** — rebuild the spend path against Ironwood crates when
   they ship; keep the settler pool-agnostic so only `src/spend/` changes.

(The original hackathon-critical mobile "blank screen" task from `HANDOFF.md`
may already be resolved — confirm current device state with Samuel before
assuming. If a real ride → autonomous payout on-device hasn't been filmed yet,
that demo is still the #1 hackathon deliverable, ahead of scaling work.)

---

## The strategy docs you now own

- **`docs/SCALING_PAYOUTS.md`** — why batching alone doesn't fix runway, why
  accrual + threshold settlement does, the numbers at 1M rides/day, and the
  step-by-step wiring guide.
- **`docs/MINER_SCALE_PLAN.md`** — recruiting crypto miners into four roles
  (infra/node operators, treasury stewards/FROST signers, capital/liquidity,
  rider-growth) to scale the network. The two technical gates (P0–P1) depend on
  the same RedPallas FROST swap as item 3 above — infra and recruitment
  converge on one blocker. Note the load-bearing legal caveat on the capital
  role (needs securities counsel before it ships).
- **`docs/ROADMAP.md`**, **`docs/ARCHITECTURE.md`**, **`HANDOFF.md`** — the
  pre-existing context (game loop, privacy model, the mainnet spend internals).

---

## Git state at handoff

Uncommitted (this session's work — review, then commit):
```
 M zcash-service/crates/pedalshield-treasury/Cargo.toml          (tokio "time")
 M zcash-service/crates/pedalshield-treasury/src/bin/backend.rs  (accrual wiring)
 M zcash-service/crates/pedalshield-treasury/src/lib.rs          (pub mod accrual)
?? docs/MINER_SCALE_PLAN.md
?? docs/SCALING_PAYOUTS.md
?? zcash-service/crates/pedalshield-treasury/src/accrual.rs
```
Last commit: `5e5ce46` (post-ride stats report). Suggested commit once the
accrual build is green: _"accrual ledger + threshold settlement (opt-in,
PEDAL_ACCRUAL): scale payouts to millions of rides; +scaling & miner docs."_

## Gotchas carried forward

- Fresh terminal → `source ~/.zshrc` for `$PEDAL`.
- No `#` inline comments / no big heredocs in pasted zsh commands.
- Pin `transparent`/`sapling` exactly; wrong consensus branch id = rejected tx.
- Don't soften "no manual operator"; don't break "route stays on device."
- The AI sandbox can't run cargo/Metro/device or delete repo files — edit, then
  hand the build to Samuel.
- Every novel cryptographic surface gets honest framing of what it does and
  doesn't solve. Effort (km pedaled) always dominates earning. Never mint.
