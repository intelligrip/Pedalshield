# Pedalshield — roadmap

What's shipped in this hackathon submission, and what comes next.

## Shipped (v0.1 — ZecHub Hackathon 2026 submission)

- On-device ride verification engine (TypeScript, 15 tests).
- Zcash wallet layer: `Wallet` interface + `MockWallet` (10 tests) + `NativeWallet` RN bridge + Kotlin / Swift native module skeletons.
- FROST 2-of-3 threshold-signing ceremony in Rust using `frost-ed25519` (real signatures, integration-tested), claim ledger, anomaly detection.
- React Native + Expo app shell with Home, Ride, and Privacy screens. Synthetic sensor source for simulator demos.
- 34 passing unit + integration tests (Node) plus the Rust integration suite (awaits `cargo check` / `cargo test` locally).

## v0.2 — Mainnet payout end-to-end

Goal: replace the synthetic txid in `PostRideScreen` with a real Orchard shielded transaction landing on Zcash mainnet.

- **Orchard transaction construction.** Build an unsigned Orchard bundle via `zcash_client_backend` / `zcash_primitives`, compute the spend-auth sighash, feed it to the FROST coordinator, splice the threshold signature back into the bundle.
- **FROST-RedPallas swap.** Replace `frost-ed25519` with `frost-redpallas` (ZF, ZIP-312). Same coordinator code; only the ciphersuite type parameter changes.
- **`lightwalletd` gRPC client.** Thin tonic-based client to submit the transaction and follow confirmation.
- **Backend claim API.** Axum HTTP endpoint to accept `ClaimPayload` from the mobile app, run server-side anomaly checks, write to ledger.
- **Persistent ledger.** Swap `InMemoryLedger` for a `SqliteLedger` (same trait, `rusqlite`-backed).

Acceptance: `treasury_demo` builds + broadcasts a real Orchard transaction to mainnet that any block explorer can show.

## v0.3 — Device sensors + onboarding

- **Real sensor source.** Replace `SyntheticSensorSource` with hooks over `expo-location` (GPS, background mode), `expo-sensors` (Accelerometer / Gyroscope / Barometer), and `expo-sensors` Pedometer. Permission flow + background task setup.
- **Device attestation.** Wire Play Integrity (Android) + App Attest + DeviceCheck (iOS). Treasury rejects claims with missing or replayed attestation.
- **Onboarding flow.** Welcome → privacy promise → seed phrase generate / restore (`expo-secure-store` for the seed) → permissions → wallet bootstrap.
- **Secure seed storage.** Store the BIP-39 seed under iOS Keychain / Android Keystore via `expo-secure-store`.

## v0.4 — The rest of the game loop

- **Streak Vault** screen — full transaction history, streak visualisation, withdraw-to-external-address flow.
- **Garage** — bike upgrade catalogue, ZEC spend back to treasury, cosmetic skins and capped earn multipliers.
- **Ghost Leaderboard** — pseudonymous weekly leaderboard; stretch: a ZK rank proof so the server doesn't learn exact distances.
- **Private Pelotons** — small anonymous team rides with a pooled shared bounty.
- **Seasonal events** — themed competitive seasons with treasury-funded prizes.

## v0.5 — Zero-knowledge route privacy (Tier 2)

The technical centrepiece deferred from the hackathon. Replace the soft contract ("we don't upload your route") with a hard one ("we mathematically cannot read your route").

- **Circuit.** A Halo2 or arkworks circuit that proves:
  - "I performed a ride whose sensor commitments produce a verified distance ≥ X km when run through the canonical Pedalshield verifier, with integrity score ≥ Y."
  - Public inputs: the distance bucket, the integrity-score bucket, a commitment to the sensor data.
  - Private inputs: the sensor stream itself.
- **Prover** runs on the phone (WASM or native Rust via UniFFI). Target: <30 s for a typical ride.
- **Server** verifies the proof; the claim becomes proof-of-honest-computation rather than a trusted assertion.

Honest framing in the security doc: ZK proves the computation was honest, not that the sensor inputs were real. Sensor authenticity still rests on the layered anti-cheat (attestation, anomaly detection, trust ramp).

## v1.0 — Public launch

- Google Play / Apple TestFlight builds, then production.
- Treasury bootstrapping ceremony with named community stewards as FROST signers; DKG over a public ceremony rather than trusted dealer.
- Public dashboard for treasury balance, total km verified, total ZEC paid out, signer rotation history.
- Translations.

## Out of scope, intentionally

- A separate game token. ZEC is the only currency. We never mint.
- Heart-rate / biometric integration. Adds privacy surface, doesn't strengthen the loop.
- Multi-sport. Cycling-specific verification is what makes the anti-cheat defensible.
- NFT bikes. The Garage is in-game cosmetics + capped multipliers; no transferability, no speculation.

## How decisions get made post-hackathon

Same rule as during the build: every novel cryptographic surface gets honest framing of what it solves and what it doesn't, every uncertain SDK call carries a verifiable receipt, and effort (km pedaled) always dominates earning over money (ZEC spent on upgrades). Anything that erodes those constraints is a no.
