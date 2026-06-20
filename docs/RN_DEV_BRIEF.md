# Pedalshield — React Native developer brief

_Scope: ~10–25 focused hours to take the iOS app from "builds + installs" to "polished, reliable, and paying real shielded ZEC to real riders." The hard backend (autonomous Orchard mainnet payouts, deployed + secured) is already done and proven. This is app-side work._

## Context / what already works
- **Stack:** Expo SDK 56, React Native 0.85, React 19, TypeScript. App in `mobile/`. Just upgraded from SDK 50 → 56 (to meet Apple's iOS 26 SDK rule); the jump introduced the runtime bugs below.
- **Backend (done, do not rebuild):** `https://api.pedalshield.app` — axum/Rust on a DigitalOcean droplet, funded treasury, autonomous shielded Orchard payouts proven on mainnet (real txids). Admin endpoints are token-gated. App-facing endpoints: `POST /claim`, `GET /claims/:id` (poll status), `GET /balance/:ua`, `GET /healthz`, `GET /treasury/info`.
- **On-device verification works:** the integrity scorer + sensor fusion run (`mobile/src/verification/`). Privacy property is unit-tested (no lat/lon/accel leaves the device in `ClaimPayload`).
- **Builds + ships:** `eas build --platform ios --profile production` produces an App-Store-accepted `.ipa` (uploaded via Transporter). Apple org account in place.

## P0 — make "earn shielded ZEC" real — DONE (non-custodial)
**Resolved.** Riders now receive real shielded ZEC. Instead of building a custodial in-app wallet, Pedalshield is **non-custodial: bring your own wallet.** The rider connects a Zcash wallet they already control (Zashi/Zodl) by entering its Unified Address; verified rides pay real ZEC straight to it.
- `mobile/src/wallet/connectedWallet.ts` — validates the UA (network/charset/length/mock guard), persists it across restarts (`@react-native-async-storage/async-storage`, in-memory fallback), pub/sub for the UI. Unit-tested (`src/wallet/__tests__/connectedWallet.test.ts`).
- `mobile/src/components/ConnectWalletCard.tsx` — connect / change / disconnect UI; replaces the old `u1mock…` vault card on the Home screen.
- `config.getRecipientUA()/setRecipientUA()` now delegate here; the stored UA is submitted as the `recipient_ua` on every `POST /claim`.
- **Build step the dev must run once:** `cd mobile && npx expo install @react-native-async-storage/async-storage` (already in `package.json` at `2.2.0`), then rebuild the dev client / EAS build so the native module links. Until linked, persistence silently falls back to in-memory (works for a session, forgets on restart).
- Acceptance (met in code; verify on device): connect a real UA → it persists across app restarts → a verified ride's payout lands in that external wallet, and Home shows lifetime ZEC earned for it.

### P0b — in-app wallet (optional, deferred)
A native in-app wallet (`mobile/src/wallet/nativeWallet.ts`, RN bridge to `ZcashLightClientKit` / `cash.z.ecc.android.sdk`, skeletons in `mobile/native/`) so the app itself holds a shielded balance is now a **convenience enhancement, not a blocker** — riders already earn real ZEC via the connected wallet above.

## P1 — fix the SDK-56 runtime bugs (from real device testing)
1. **GPS distance flakiness — largely addressed in code (verify on device).** Reworked `mobile/src/ride/realSensorSource.ts` around a pure, unit-tested acquisition state machine `mobile/src/ride/gpsGate.ts`: distance no longer counts until GPS truly **locks** (fixes zero-distance cold starts), noisy fixes are dropped without losing the lock, and a rich status (acquiring / locked / weak / lost / precise-off / denied) drives a loud, actionable banner on the ride screen — Precise-Location-off and permission-denied now deep-link to Settings instead of silently recording nothing. Screen is held awake while riding (`expo-keep-awake`) so foreground tracking doesn't die when the display sleeps. **Remaining (true background):** pocket/locked tracking still needs `expo-task-manager` + `Location.startLocationUpdatesAsync` + the iOS `UIBackgroundModes: location` declaration — deliberately deferred (don't declare the background mode until it's actually implemented, or App Review flags it).
2. **Ride not always saving / submitting.** Some finished rides never reach the backend (no `POST /claim` logged) and aren't saved locally. Trace ride-finish → `ClaimPayload` → `POST /claim` (`mobile/src/lib/api.ts`, `PayoutCard.tsx`); fix the break so every completed ride is persisted and submitted.
3. **Privacy screen won't scroll.** ScrollView/layout regression under RN 0.85. Fix the scroll container.

### Tracking-experience upgrades shipped (verify on device)
- **Pause / resume + auto-pause.** `RideSession` has `pause()`/`resume()` (paused time excluded from the clock + avg speed; samples dropped while paused). Auto-pause/resume runs from instantaneous GPS speed in `realSensorSource` via the tested `autoPause.ts` detector (manual pause always wins). UI has a Pause/Resume button + a "Ride paused" banner.
- **Hold-to-finish.** Stopping (which triggers verification + submission) now requires a ~1.2s hold, so an accidental tap can't end a ride.
- **Eyes-free cues.** `cues.ts` fires haptics on start / pause / resume / finish and on every whole mile/km split (`splitTracker.ts`, tested), with optional spoken splits (`setVoiceCues(true)`). New deps: `expo-haptics`, `expo-speech` (install in the rebuild step).

## P2 — the ride-report + history feature (founder-requested)
- ✅ **mph / km toggle — DONE.** User-overridable unit preference (`src/lib/units.ts`: `setUnitPreference`/`useUnits`, persisted via AsyncStorage, defaults to locale). A segmented mi/km/Auto control on the Home screen updates the whole app live; splits compute per-mile for US riders (`computeRideStats(raw, splitLenKm)`, tested).
- ✅ **Last-ride report — DONE (display).** `RideStatsCard` shows distance, moving/stopped time, avg/max speed, elevation gain, and per-unit split bars with the fastest split starred — all computed on-device.
- **Still open — persistence.** Rides are in-memory only (the "no memory of ride" gap): bank every finished ride to disk (`expo-sqlite` or AsyncStorage) — date, distance, time, speeds, elevation, integrity, ZEC earned, txid — so history survives restarts.
- **Still open — Year-to-date cumulative miles** on the home screen (needs the persistence above).

## P3 — polish for launch
- Onboarding / first-run explainer (privacy framing: "your route never leaves your phone").
- Honest empty + error states (no funds, claim pending, low integrity → "review").
- Battery-safe background behavior sanity check on a real ride.
- New app icon already in `mobile/assets/icon.png`.

## Honest-claims rules (must hold in all copy/UX)
Payouts are small (~0.0002 ZEC/km, capped). Privacy is the product, not yield. ZK route proofs are roadmap, not live. Anti-cheat is layered, not perfect. No token.

## Build / test
- `cd mobile && eas build --platform ios --profile production` → `.ipa`; upload via Transporter (or `eas submit`).
- Dev loop: `npx expo start` with a dev client for fast iteration.
- The repo is on branch `sdk-upgrade` (the SDK-56 work). Merge to `main` once stable.

## Definition of done
A reliable iOS build where a real person rides, the route never leaves their phone, on-device verification scores it, and **real shielded ZEC lands in their real wallet** — with the ride banked, YTD miles shown, and no crashes or zero-distance rides.
