# Pedalshield — Build Handoff (for Grok)

_Last updated: 2026-06-18. Read this before you build or edit anything._

You're taking over an in-flight feature branch. **Pedalshield** is a privacy-first
bike-to-earn app: riders verify a ride **entirely on-device** (the GPS route
never leaves the phone) and an **autonomous backend pays real shielded ZEC on
Zcash mainnet** — no operator in the loop. Repo: `github.com/intelligrip/Pedalshield`.
Working trunk branch: **`sdk-upgrade`** (treat it as main; no PRs needed).

Owner is **Samuel Newman** — terse, drives with single words ("go"), pastes
errors verbatim, wants momentum. Two hard lines: **never propose a manual-operator
payout as the product**, and **never break "route stays on device."**

---

## Your immediate job: build the backend

A feature just landed (commit `80de261`) that added a community leaderboard,
rider handles, and an exposed reward rate. The mobile side is type-checked and
its 39 tests pass. **The Rust backend has NOT been compiled since those changes** —
the sandbox that wrote them has no Rust toolchain. That's the task: compile it,
fix anything that doesn't, run it.

```bash
cd ~/Pedalshield/zcash-service
cargo build --bin backend -p pedalshield-treasury
```

(Fresh terminal? `source ~/.zshrc` first so `$PEDAL` resolves to `~/Pedalshield`.)

If it errors, paste the compiler output to Samuel and fix in
`crates/pedalshield-treasury/src/bin/backend.rs`. The changes below are the only
new surface area, so any build break is almost certainly in one of them.

---

## What changed in the backend (verify these compile)

All in `crates/pedalshield-treasury/src/bin/backend.rs`.

1. **New `handles` table** — appended to the `SCHEMA` const. Rider-chosen display
   name keyed by `recipient_ua` (`recipient_ua TEXT PRIMARY KEY, handle TEXT,
   updated_at INTEGER`). Created idempotently alongside `claims`.

2. **`POST /handle/:ua`** → `set_handle_handler`. Body `{"handle": "..."}`.
   Validates the UA, trims, rejects empty / >24 chars / control chars, upserts.
   Returns `{recipient_ua, handle}`. Public route (same trust model as the rest
   of the accrual API for the demo).

3. **`GET /leaderboard?window=all|week&limit=N`** → `leaderboard_handler`.
   - `window=all` (default): ranks by `balances.lifetime_zat DESC`.
   - `window=week`: sums `accruals.amount_zat` where `created_at >= now-7d`,
     grouped by recipient, `DESC`.
   - Resolves handles in a second pass. **Never returns a full UA** — only a
     rider handle (if set) and a shortened `short_ua` (`u1abcdef…wxyz`, via the
     new `short_ua()` helper). `limit` clamps to 1..200, default 50.
   - Returns `{window, entries: [{rank, handle, short_ua, zatoshi, rides_count}]}`.

4. **`TreasuryInfo` gained `zat_per_km` and `max_payout_zat`** (populated from
   `state.zat_per_km` / `state.max_payout_zat`) so the app can show the live
   reward rate. `GET /treasury/info` now carries the rate.

Both new routes are registered on the **public** router (not the `admin` bearer-
gated one). `Query`, `params!`, and `OptionalExtension` were already imported.
UAs are ASCII (bech32m), so the byte-slicing in `short_ua` is safe.

**Smoke test after it runs** (backend binds `0.0.0.0:8787`):

```bash
curl -s localhost:8787/treasury/info | grep -o '"zat_per_km":[0-9]*'
curl -s 'localhost:8787/leaderboard?window=all&limit=10'
curl -s 'localhost:8787/leaderboard?window=week&limit=10'
curl -s -X POST localhost:8787/handle/u1<your-test-ua> \
  -H 'content-type: application/json' -d '{"handle":"dawnrider"}'
```

Leaderboard rows only appear in **accrual mode** (balances/accruals get
populated by `POST /claim` when `PEDALSHIELD_ACCRUAL=1`). All-time reads
`balances`; week reads `accruals`.

---

## What changed in mobile (already builds; context only)

- `mobile/src/lib/units.ts` **(new)** — region-aware units. Detects the device
  region from `Intl` locale, falls back to native locale modules. **Miles in the
  US (and US territories), km everywhere else.** Exports `formatDistance`,
  `formatSpeed`, `DISTANCE_UNIT`, `SPEED_UNIT`, `formatRate(zatPerKm)`. All
  distance/speed displays (ride tracker, ride report, share card) now route
  through it. Internals stay metric; this is display-only.
- `mobile/src/screens/LeaderboardScreen.tsx` **(new)** — "Leaders" tab.
  All-time / This-week toggle, medals for top 3, your row highlighted, inline
  handle editor. Registered in `src/app/Navigation.tsx`.
- `mobile/src/screens/HomeScreen.tsx` — new **LIFETIME REWARDS** card (total ZEC
  + ride count) and a live **EARN RATE** line (`formatRate`, fed by
  `/treasury/info`, falls back to `DEFAULT_ZAT_PER_KM`).
- `mobile/src/components/PayoutCard.tsx` — accrued view now shows a two-column
  **pending vs lifetime-earned** balance box instead of dim inline text.
- `mobile/src/lib/api.ts` — added `getTreasuryInfo`, `getLeaderboard`,
  `setHandle`, and their types.
- `mobile/src/lib/config.ts` — added `DEFAULT_ZAT_PER_KM = 20000` fallback.

Verify mobile yourself anytime: `cd ~/Pedalshield/mobile && npm test` (39 tests)
and `npm run typecheck`. Note: `tsc` reports **two pre-existing** `TS2367`
errors in `PayoutCard.tsx` (lines ~262/269) that predate this work — Expo's
bundler strips types, so they don't block the build. Don't be alarmed by them.

---

## Build environment & gotchas (carried forward)

- Rust workspace: `$PEDAL/zcash-service`. Release binaries → `target/release/`.
- **Pinned, mutually-compatible Zcash stack** (NU6.2, branch id `0x5437f330`) in
  `crates/pedalshield-treasury/Cargo.toml`: `orchard 0.14`, `zcash_primitives
  0.28`, `zcash_protocol 0.9`, etc. `transparent`/`sapling` are pinned **exactly**
  or signing types won't unify. **Do not** reintroduce `zcash_client_backend` /
  `zcash_client_sqlite` — the spend path is hand-rolled on purpose.
- Backend env knobs (no rebuild): `PEDALSHIELD_LIGHTWALLETD` (use
  `https://zec.rocks:443`, not the flaky default), `PEDALSHIELD_BIRTHDAY`
  (3361149), `PEDALSHIELD_ZAT_PER_KM` (793 = carbon-pegged $0.006/mile at ZEC ~$470; re-peg via deploy/repeg_carbon_rate.sh),
  `PEDALSHIELD_MAX_PAYOUT_ZAT` (500000), `PEDALSHIELD_AUTO_PAYOUT` (on),
  `PEDALSHIELD_ACCRUAL`, `TREASURY_SPENDING_KEY_FILE`, `PEDALSHIELD_TREASURY_UA`,
  `PEDALSHIELD_DB`, `PEDALSHIELD_PORT` (8787).
- The AI sandbox **cannot write inside `.git`** or delete files in the mounted
  repo — Samuel runs `git`/`cargo`/Metro/device himself and pastes output. Don't
  paste big heredocs (zsh mangles them; `#` inline comments break). Edit files
  directly.
- **Ironwood** (Orchard successor) activates ~late July 2026; treasury→rider
  Orchard transfers stop working then and the spend path must be rebuilt against
  Ironwood crates. Post-hackathon. The hackathon window (submit Jul 5, deadline
  Jul 15) survives on NU6.2.

---

## After the build is green

1. Run the backend in accrual mode, log a couple of claims with different UAs +
   handles, confirm both leaderboard windows rank them and the app's Leaders tab
   renders.
2. Confirm Home shows the EARN RATE in the right unit (miles on a US device).
3. Commit on `sdk-upgrade` and push. (`rm -f .git/index.lock` first if a stale
   lock blocks the commit — the sandbox sometimes leaves one.)

Honest-claims rule, held throughout: payouts are small and capped, privacy is
the product (not yield), anti-cheat is layered not perfect, no token. Name every
limit out loud — that's the point.
