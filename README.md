# Pedalshield

**Ride private. Earn shielded.**

[![Track](https://img.shields.io/badge/track-Games-D946EF)](https://zechub.wiki/hackathon)
[![License](https://img.shields.io/badge/license-MIT-22D3A1)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-34%20passing-22D3A1)](mobile/src)
[![Mainnet](https://img.shields.io/badge/mainnet-required-FBBF24)](https://zechub.wiki/hackathon)
[![Hackathon](https://img.shields.io/badge/ZecHub%20Hackathon-2026-A855F7)](https://github.com/ZecHub/zechub/tree/main/Hackathon/2026)

A privacy-first, mobile bike-to-earn game built on Zcash. Cyclists track real-world rides, the phone verifies them locally — **your route never leaves the device** — and shielded ZEC drops into your in-app vault from a FROST-secured community treasury.

> Submission for the **ZecHub Hackathon 2026 — Games track**.

---

## TL;DR for judges (3 sentences)

Pedalshield is a move-to-earn cycling app that pays real shielded ZEC from a FROST-multisig treasury for verified rides, while **proving in code** that no route, motion, or sensor data ever leaves the rider's phone. The on-device verifier classifies bike rides vs car rides vs GPS spoofs vs walks with a transparent layered anti-cheat model we name honestly. The repo ships a fully tested verification engine, a Zcash light-client wallet bridge (Mock + native modules), a working FROST 2-of-3 threshold-signing ceremony in Rust, and a React Native + Expo app demoing the full loop.

## Try it in 60 seconds

```bash
# Replace YOUR/REPO with the actual GitHub path.
git clone https://github.com/YOUR/REPO.git pedalshield
cd pedalshield/mobile
node --test \
  src/verification/__tests__/*.test.ts \
  src/wallet/__tests__/*.test.ts \
  src/ride/__tests__/*.test.ts
# expected: tests 34 / pass 34 / fail 0 / ~400 ms
```

Then watch the FROST ceremony produce a real signature:

```bash
cd ../zcash-service
cargo run --bin treasury_demo
```

Then the full app:

```bash
cd ../mobile
npm install
npx expo start
```

## Why Pedalshield

Move-to-earn fitness apps either farm your data (Strava) or collapse under tokenomics ponzis (StepN). Pedalshield is neither. Your routes are never uploaded. Rewards are real ZEC from a finite community treasury — we never mint anything. And by construction, **your legs always out-earn your wallet**: effort dominates the payout formula, and bike upgrades cap at a +15% accelerator that cannot out-pace pedaling.

## How it works

```
[Phone] sensor fusion + integrity score
        |
        |  minimal claim payload (no geo, no motion)
        v
[Backend] verification + claim ledger + anomaly checks
        |
        |  batched payouts
        v
[FROST 2-of-3] threshold-signed shielded transaction
        |
        v
[Zcash mainnet] Orchard payout -> rider's shielded address
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full Mermaid diagram, data flow, privacy guarantees, and the layered anti-cheat model (named honestly, including what it doesn't catch).

## Repo tour

```
Pedalshield/
  README.md                  - this file
  LICENSE                    - MIT
  SUBMISSION.md              - PR text + judges' quick start
  docs/
    ARCHITECTURE.md          - Mermaid diagram, data flow, privacy guarantees
    DEMO_SCRIPT.md           - 2-5 min video walkthrough
    ROADMAP.md               - post-hackathon priorities

  mobile/                    - React Native + Expo app
    App.tsx                  - entry point; boots MockWallet + Navigation
    app.json                 - Expo config + iOS / Android permissions
    package.json
    src/
      app/
        theme.ts             - design tokens (dark, Zcash-magenta accent)
        Navigation.tsx       - bottom tab navigator
      components/            - Button, Card, ScreenContainer, Stat
      lib/format.ts          - km / ZEC / duration formatters
      screens/
        HomeScreen.tsx       - vault balance + streak + ride CTA
        RideTrackerScreen.tsx- start/stop loop + live stats + PostRide
        PrivacyDashboardScreen.tsx - the anti-Strava manifesto
      ride/
        rideSession.ts       - state machine (tested)
        syntheticSensorSource.ts - demo sample pump for simulator
      verification/          - on-device ride verifier
        rideVerifier.ts      - orchestrator + toClaimPayload (privacy seam)
        sensorFusion.ts      - feature extraction (Haversine, cadence FFT-lite)
        integrityScore.ts    - transparent weighted rubric + hard fails
        constants.ts         - tunable thresholds
        types.ts             - domain types
        __tests__/           - 15 tests incl. privacy assertion
      wallet/                - Zcash wallet layer
        types.ts             - Balance, Address, Transaction (bigint zatoshi)
        walletInterface.ts   - the Wallet contract
        mockWallet.ts        - in-memory impl for simulator / Node tests
        nativeWallet.ts      - RN bridge to native SDKs
        walletManager.ts     - tiny set/get singleton
        __tests__/           - 10 tests
    native/
      android/               - PedalshieldWalletModule.kt + Package
      ios/                   - PedalshieldWallet.swift + .m bridge
      README.md              - install steps + BigInt convention

  zcash-service/             - Rust workspace (FROST treasury)
    README.md
    Cargo.toml
    crates/pedalshield-treasury/
      Cargo.toml
      src/
        lib.rs               - public surface
        types.rs             - Claim, PayoutBatch, reward formula
        error.rs             - PedalshieldError
        ledger.rs            - ClaimLedger trait + InMemoryLedger
        anomaly.rs           - cross-ride rate / speed / score caps
        frost_coordinator.rs - FROST 2-of-3 ceremony (frost-ed25519)
        bin/treasury_demo.rs - cargo run end-to-end demo
      tests/
        ceremony_e2e.rs      - full pipeline integration test
```

## Verifiable claims — where the receipts live

| What we claim | Where the receipt is |
|---|---|
| "Your route never leaves the phone" | `mobile/src/verification/__tests__/rideVerifier.test.ts` - JSON.stringify assertions on `ClaimPayload` reject `"lat"`, `"lon"`, `"accel"`, `"gyro"`, `"barometer"`, `"pedometer"`, `"pressure"` substrings, and assert the payload has *exactly* 8 minimal keys. |
| "Real anti-cheat against car / walk / spoof" | Same file - 4 ride scenarios (legit bike, car, GPS spoof, walk) classified correctly with deterministic fixtures. |
| "Effort dominates earning" | `zcash-service/.../types.rs::compute_reward_zatoshi` - `verified_km` is the only linear, uncapped term. Unit-tested. |
| "Upgrades cannot out-earn pedaling" | `mobile/src/verification/constants.ts` + reward formula - the `upgrade` multiplier caps at 1.15. Documented in `docs/ARCHITECTURE.md`. |
| "FROST 2-of-3 threshold-signed payouts" | `zcash-service/.../frost_coordinator.rs` + `tests/ceremony_e2e.rs` - real `frost-ed25519` ceremony, aggregated signature verifies against group key. `cargo run --bin treasury_demo` prints it. |
| "Layered, honest anti-cheat" | `docs/ARCHITECTURE.md` - the "what catches what / what it doesn't catch" table. |
| "Mainnet-required architecture" | `docs/ARCHITECTURE.md` data flow + `zcash-service/README.md` Chunk-4 roadmap to Orchard tx construction. |
| "Real Zcash SDK integration path" | `mobile/native/android/PedalshieldWalletModule.kt` + `mobile/native/ios/PedalshieldWallet.swift` - RN bridge skeletons wired to `cash.z.ecc.android.sdk` and `ZcashLightClientKit`. Every uncertain SDK call carries `// TODO: SDK` for the integration pass. |

## What ships today vs what's deferred

| | Status |
|---|---|
| On-device ride verification engine | shipped + 15 tests |
| Sensor fusion + integrity score + privacy seam | shipped |
| Zcash wallet interface (Mock + Native bridge) | shipped + 10 tests |
| Android Kotlin + iOS Swift native modules | shipped (RN plumbing real; SDK calls flagged) |
| FROST 2-of-3 ceremony (Rust, real signatures) | shipped + integration tests |
| Claim ledger + anomaly detection | shipped |
| Mobile app shell + Home + Ride + Privacy screens | shipped + 9 ride-session tests |
| Synthetic sensor source for simulator demo | shipped |
| --- | --- |
| Orchard transaction construction (FROST-RedPallas swap) | Chunk 5 - ZIP-312 finalisation tracked |
| `lightwalletd` gRPC client (tonic) | Chunk 5 |
| Onboarding / Garage / Streak Vault / Leaderboard screens | Chunk 5 |
| ZK proof of honest verification (route-privacy, Tier 2) | post-hackathon roadmap |

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the post-hackathon plan.

## Demo

[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — the 2-5 minute video walkthrough with shot list. Video URL will land in [`SUBMISSION.md`](SUBMISSION.md) before the July 15 deadline.

## Tech stack (verified live)

- **Mobile:** React Native + Expo (SDK 50, development builds for native modules).
- **Zcash light client:** `Electric-Coin-Company/zcash-android-wallet-sdk` (Android), `ZcashLightClientKit` (iOS), backed by `lightwalletd`.
- **Core protocol crates:** the `librustzcash` workspace.
- **Threshold signing:** `ZcashFoundation/frost` — stable + feature-complete. FROST v3 (cheater detection) finalising in 2026 per ZF.
- **Treasury authorisation for shielded spends:** following ZIP-312 (FROST for Zcash).

No APIs are referenced from memory; every uncertain crate / SDK call is annotated and verified at integration time.

## Hackathon target

| Field | Value |
|---|---|
| Track | Games |
| Submission folder | `github.com/ZecHub/zechub/tree/main/Hackathon/2026/Pedalshield` |
| Mainnet payout | required (hackathon rule #1) — demo video will show a real Orchard shielded payout |
| Deadline | July 15, 2026 (UTC) |

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

Built for the [ZecHub Hackathon 2026](https://zechub.wiki/hackathon). Uses Electric Coin Company's mobile SDKs, the `librustzcash` workspace, and the Zcash Foundation's FROST crates. Thanks to the ZecHub community.
