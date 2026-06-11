# Pedalshield — Engineering Handoff

_Last updated: 2026-06-08. Read this top to bottom before touching anything._

You are taking over an in-flight build: **Pedalshield**, a privacy-first
"ride-to-earn" app. Riders verify a bike ride **entirely on-device** (the GPS
route never leaves the phone) and receive an **autonomous shielded Zcash
payout** sized by distance. Submission: **ZecHub Hackathon 2026, Games track,
deadline July 15 2026.** Repo: `github.com/intelligrip/Pedalshield`.

The user is **Samuel Newman**. Working style: terse, fast, drives with "go" /
single words, pastes errors verbatim, wants forward momentum not deliberation.
He cares **deeply** about the privacy thesis ("better than Strava, or people
get robbed of their data") and **insists on fully autonomous payouts with no
manual-operator fallback**. Do not propose a manual operator as the product.

---

## TL;DR — where we are

- **The core works on mainnet.** A hand-rolled, autonomous Orchard spend —
  build → prove → SIGHASH → sign → broadcast — is proven end-to-end, and the
  backend fires it automatically when a ride claim arrives. No operator.
- **The decision this session:** ship the *tight* thing first — real rides →
  autonomous payouts, demo-ready. Territory-claiming ("INTVL-style") is a
  deferred stretch (see bottom).
- **Current blocker:** the new mobile dev-client build installs but shows a
  **blank screen** after connecting to Metro. That is the immediate next task.

---

## Environment & paths

- Repo lives at **`~/Pedalshield`** (host). It was moved here from a protected
  `~/Library/Application Support/...` path that the file mount refuses. The
  shell alias **`$PEDAL` now points to `$HOME/Pedalshield`** (appended to
  `~/.zshrc`).
- Rust workspace: `$PEDAL/zcash-service`. Build with `cargo build --release`;
  binaries land in `target/release/`.
- Treasury keys: `$PEDAL/zcash-service/treasury-keys/treasury_spending_key.bin`
  (raw 32 bytes, gitignored) and `treasury_seed.txt`. Seed also on paper.
- Lightwalletd: **`https://zec.rocks:443`**. Do NOT use
  `mainnet.lightwalletd.com:9067` (flaky).
- Mac LAN IP (for phone↔backend): **192.168.0.62**. Metro was last on **:8083**.

**How the AI works here:** you can read/edit files directly in the mounted
`~/Pedalshield`. But `cargo`, Metro, EAS, and the device all run on Samuel's
Mac — the AI sandbox cannot run his cargo/network/device and cannot delete
files in the mount. The loop is: **AI edits → Samuel builds/runs → pastes
output.** Don't paste giant heredocs (zsh mangles them; also `#` inline
comments break — `INTERACTIVE_COMMENTS` is off). Edit files directly instead.

---

## CRITICAL: Ironwood — Orchard pool is being phased out (added Jun 11)

Following the Orchard counterfeiting bug, the ecosystem (ZODL + Tachyon, Valar
Group, Zcash Foundation, Shielded Labs) proposed **Ironwood**, a successor
shielded pool, targeting **late-July 2026 activation**. At activation, Orchard
closes to **new deposits and intra-pool transfers**; funds exit only through a
turnstile into Ironwood.

What this means for us:

- **Treasury→rider payouts are Orchard→Orchard internal transfers — they stop
  working at Ironwood activation.** The entire hand-rolled spend path
  (`tree.rs` / `scanner.rs` / `spender.rs`, orchard 0.14 builder) must be
  rebuilt against Ironwood crates once they ship. Post-hackathon work.
- **The hackathon window survives**: submit Jul 5, deadline Jul 15, activation
  late July. NU6.2 stays the live consensus rules until then.
- **Mitigation: record demo footage as early as possible** (now scheduled
  Jun 13–14 in TIMELINE.md). A recorded demo + mainnet txids is the proof if
  activation slips earlier or judges test post-activation.
- Existing UAs stay valid — ZEC sent to pre-Ironwood Orchard receivers
  auto-lands in the new pool. No address rotation for riders or treasury.
- Treasury migration is trivial (~0.0096 ZEC through the turnstile).
- Submission writeup: frame as a strength — re-pinned to NU6.2 within days of
  the emergency fork, Ironwood migration planned.

## CRITICAL: the Nu6.2 dependency generation

On **2026-06-01** a counterfeiting bug in the Orchard circuit was patched and
the network shipped an emergency upgrade **NU6.2** (consensus branch id
`0x5437f330`, mainnet activation block **3,364,600**). Transactions must be
stamped with this branch id or they're rejected ("incorrect consensus branch
id"). Only `zcash_protocol >= 0.9` knows Nu6_2, so the **entire zcash stack was
bumped**. Pinned, mutually-compatible versions in
`crates/pedalshield-treasury/Cargo.toml`:

```
orchard               = "0.14"
zcash_primitives      = "0.28"
zcash_protocol        = "0.9"
zcash_address         = "0.12"
zcash_keys            = { version = "0.14", features = ["orchard"] }
zip32                 = "0.2"
incrementalmerkletree = { version = "0.8", features = ["legacy-api"] }  # 0.8.2
transparent           = { package = "zcash_transparent", version = "=0.8.0" }
sapling               = { package = "sapling-crypto", version = "=0.7.0", features = ["test-dependencies"] }
```

`transparent` and `sapling` are pinned **exactly** to what `zcash_primitives
0.28` links, or the `TransparentSigningSet` / prover types won't unify across
duplicate crate versions. `sapling`'s `test-dependencies` feature is only there
for its **mock provers** (we have zero Sapling components; the mocks satisfy the
builder's generic bounds and are never called). **Do not** reintroduce
`zcash_client_backend` / `zcash_client_sqlite` — their published graph is broken;
the whole spend path is hand-rolled.

---

## The hand-rolled autonomous spend (works, proven on mainnet)

Files in `crates/pedalshield-treasury/src/spend/`:

- **`tree.rs`** — `OrchardTree` wraps a frontier `CommitmentTree` + per-marked
  `IncrementalWitness`. `from_tree_state(hex)` seeds the tree from
  lightwalletd's `GetTreeState.orchardTree` blob (parsed via
  `zcash_primitives::merkle_tree::read_commitment_tree`; `next_position` from
  `tree.size()`). Seeding from the real frontier is what makes positions and
  the witness anchor match consensus.
- **`scanner.rs`** — `process_block` appends every cmx, marks IVK-decrypted
  notes, **stores the decrypted `orchard::Note` in `FoundNote`**, and collects
  **every on-chain nullifier** in `ScanProgress.all_nullifiers` (used for
  spent-detection).
- **`spender.rs`** — `pay(endpoint, sk, recipient_ua, amount_zat, birthday,
  broadcast)`: seed → scan to tip → **select the largest UNSPENT note**
  (nullifier not in `all_nullifiers`) → build a v5 tx with
  `zcash_primitives::transaction::builder::Builder` (mock Sapling provers,
  empty `TransparentSigningSet`, recipient + change-to-internal-address
  outputs, ZIP-317 `FeeRule::standard()`) → broadcast via `SendTransaction`.
  Returns `SpendResult`.

`proto/service.proto` gained `GetTreeState`/`TreeState` (and `SendTransaction`
was already there).

**Proven on mainnet:**
- Treasury UA: `u19r0gg89utgp9kcqtdasfyfc6nds5sc6tgzny2sgvrsuyw3z97kkg45h87gufsamfhmyxfykg6amlk3lp0ynlc9wgxx60v9gdsuap0zk9`
- First autonomous self-transfer txid `6da9298a…272f5b74`, mined block
  **3,368,791**, anchor verified byte-identical to `GetTreeState`.
- Two further backend payouts succeeded (`f1a3bacc…`, `ef0e2a57…`), all
  self-sends to the treasury UA for testing.
- Treasury now holds **~0.0096 ZEC** spread across a few notes (each test burns
  the ~0.0001 ZEC ZIP-317 fee). Don't ask Samuel to fund more until needed.

CLI for manual testing — `treasury_wallet`:
`sync --seed --from <h> [--to 0=tip]` (rescans, verifies anchor),
`send --to <UA> [--amount-zec X] [--dry-run]` (dry-run builds+proves+signs
without broadcast). `treasury_ping` prints `consensus_branch_id`.

---

## Backend autonomous payout (works)

`crates/pedalshield-treasury/src/bin/backend.rs` — axum + sqlite.

- `POST /claim` validates + inserts, and if `auto_payout` (default ON) **spawns
  the payout in the background** and ACKs `"paying"`. Poll `GET /claims/{id}`
  for the txid.
- `run_payout` (shared core): atomically reserves `pending → paying`
  (double-pay guard), loads the hot key, runs `spender::pay(..., broadcast=true)`
  **behind a `tokio::Mutex` payout lock** (serializes payouts), then
  `paid` + txid on success or reverts to `pending` on any failure.
- `POST /claims/{id}/approve` = manual trigger of the same `run_payout` (kept
  for diagnostics/retries).
- Rate: `compute_payout = distance_m * PEDALSHIELD_ZAT_PER_KM / 1000`, capped.
  Defaults: **0.0002 ZEC/km (~0.00032 ZEC/mile), 0.005 ZEC/ride cap.**
- Env knobs (no rebuild): `PEDALSHIELD_LIGHTWALLETD`, `PEDALSHIELD_BIRTHDAY`
  (3361149), `PEDALSHIELD_ZAT_PER_KM` (20000), `PEDALSHIELD_MAX_PAYOUT_ZAT`
  (500000), `PEDALSHIELD_AUTO_PAYOUT` (on), `TREASURY_SPENDING_KEY_FILE`,
  `PEDALSHIELD_TREASURY_UA`, `PEDALSHIELD_DB`, `PEDALSHIELD_PORT` (8787, binds
  0.0.0.0).

**Known limitation (flagged, not yet fixed):** spent-detection only sees
*mined* nullifiers, so two payouts inside the same ~1–2 min block window could
select the same note before the first's change is on-chain. The serialize lock
prevents *concurrent* races but not the mempool race. For demos, space claims a
couple minutes apart. Real fix: mempool-aware / local note reservation.

The `/admin` HTML console still says "manual payout" — cosmetic, update later.

---

## Mobile (the current battleground)

`mobile/` — React Native + Expo SDK 50, dev-client built via EAS. iOS device is
registered (`eas device:create` done). Real-GPS-only now (synthetic/demo route
removed at Samuel's request).

New/changed files:
- `src/lib/config.ts` — `BACKEND_URL = 'http://192.168.0.62:8787'`,
  `EXPLORER_TX_BASE`, session-scoped recipient-UA holder.
- `src/lib/api.ts` — `submitClaim`, `getClaim`, `pollClaim`.
- `src/components/PayoutCard.tsx` — paste Zashi UA → submit claim → poll →
  show real txid + explorer link. Replaced the old fake "FROST queued" card.
- `src/ride/realSensorSource.ts` — GPS (`expo-location`) + accelerometer
  (`expo-sensors`), **lazy-imported** (so the module is import-safe on any
  build), and **drops fixes with accuracy > 30 m** to avoid the verifier's
  `TELEPORT` hard-fail from GPS jumps.
- `src/screens/RideTrackerScreen.tsx` — uses `RealSensorSource` only.
- `src/types/react-native-shim.d.ts` — added `TextInput`, `ActivityIndicator`,
  `Linking`, and `expo-location` / `expo-sensors` ambient declarations.
- `app.json` — `icon: ./assets/icon.png` (the chosen mark: a Zcash **circled-Z**
  on a gold privacy shield with a road bike — gold = Zcash, shield = privacy,
  bike = activity), splash image, Android adaptiveIcon, and iOS
  `NSLocalNetworkUsageDescription` + `NSAppTransportSecurity.NSAllowsLocalNetworking`
  (lets the phone hit the Mac's LAN http backend).
- Deps added: `expo-location ~16.5.5`, `expo-sensors ~12.9.1` (both installed,
  in `package.json`). Backend Cargo got tokio `"sync"` feature.
- Leftover `mobile/assets/icon_*.png` preview files should be removed
  (`rm -f icon_*.png` keeps `icon.png`); the AI sandbox couldn't delete them.

**Verifier** (`src/verification/`): `verifyRide` → integrity score vs
`DEFAULT_VERIFY_THRESHOLD 0.65` / `REJECT 0.40`. Hard fails: >90 km/h between
samples (teleport), avg >65 km/h, no motion samples. Payout only on `verified`
(`review` pays scaled). A genuine outdoor ride clears 0.65; the accuracy gate
in `realSensorSource` is there so GPS noise doesn't teleport-reject it.

### >>> IMMEDIATE NEXT TASK: the blank screen

Newest EAS dev-client build is installed. App opens to the dev-client launcher;
after connecting to Metro (port **8083**, `exp://192.168.0.62:8083`) it shows a
**blank screen**. Confirmed NOT the cause: entry is `App.tsx` via `AppEntry.js`
(no Expo Router — that earlier log was a red herring), and
`expo-location`/`expo-sensors` are installed so bundling can resolve them.

What we still need to determine (ask Samuel / get the **Metro terminal
output**):
1. Did Metro print `iOS Bundling complete`, `Bundling failed`, or nothing?
   - nothing → he's likely connecting via the **iOS Camera QR** (misroutes to a
     blank Safari/Expo Go). Fix: open the **Pedalshield app**, use **Enter URL
     manually** → `exp://192.168.0.62:8083`, not the system camera.
   - failed → the log names the broken module/line.
   - complete but blank → runtime issue.
2. Strong runtime suspect: `App.tsx` gates the whole UI on a `ready` flag set by
   `MockWallet.init().then(startSync).then(() => setReady(true))` **with no
   `.catch`**. If `init`/`startSync` rejects on device, `ready` stays false and
   you're stuck on the dark "booting shielded wallet…" screen (can read as
   blank). **Suggested fix:** add a `.catch` that logs and still flips `ready`
   true (or shows the error), so a wallet-boot hiccup can't dead-end the app.

Once the app loads: Start ride → allow location → move outdoors → Stop →
verified → paste a real Zashi UA → autonomous payout → real txid. Backend +
Metro both running on the Mac, phone on same WiFi.

---

## Remaining roadmap (priority order)

1. **Unblock the blank screen**, then prove **real ride → autonomous payout on
   device**.
2. **Demo assets:** 2–3 min video of the claim→payout flow, README/writeup,
   architecture diagram. The narrative: "autonomous, hand-rolled, Nu6.2-current
   shielded payouts, route never leaves the phone."
3. **Hardening (optional, not blockers):** mempool-aware note reservation;
   wire the existing `anomaly` module (daily cap / km-window) into `run_payout`;
   fix the `/admin` "manual payout" copy.
4. **Stretch — territory claiming ("INTVL-style"), only if core is locked.**
   Must be privacy-preserving or it destroys the thesis: **alias** keypair
   (pseudonymous, unlinked from the payout UA), **coarse ~1 km cells** submitted
   instead of the route, **on-device validation** (existing verifier + device
   attestation) as the trust model, payouts unlinkable from the public board.
   True trustless (ZK proof of coverage) is a v2/research item, not for July 15.

## Gotchas carried forward

- Fresh terminal → `$PEDAL` empty → `source ~/.zshrc`.
- No `#` inline comments and no big heredocs in pasted commands (zsh).
- Pin `transparent`/`sapling` exactly; wrong consensus branch id = rejected tx.
- iOS dev client: device must be registered before the build; connect via the
  dev-client **manual URL**, not the system camera.
- Don't soften the "no manual operator" framing; don't break "route stays on
  device."
- Check `git status` — some late mobile/icon/verifier edits may be uncommitted;
  repo last known pushed at `db3eb8d` plus subsequent backend/mobile commits.
