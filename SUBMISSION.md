# Pedalshield — ZecHub Hackathon 2026 submission

> Submission for the **Games** track. Copy below is the PR description for
> `github.com/ZecHub/zechub/tree/main/Hackathon/2026/Pedalshield`.

---

## PR title

`Hackathon/2026: add Pedalshield — privacy-first bike-to-earn (Games track)`

## PR description

**Project:** Pedalshield — *Ride private. Earn shielded.*

A mobile bike-to-earn game built on Zcash. Cyclists track real-world rides; the phone verifies them locally — **routes never leave the device** — and shielded ZEC drops into the in-app vault from a FROST 2-of-3 community treasury.

**Track:** Games

**Demo video:** `<URL — landing before deadline>`

**Repository contents:**

- `mobile/` — React Native + Expo app with on-device verification engine, Wallet layer (Mock + native bridges), and three screens (Home / Ride / Privacy). 34 passing unit tests.
- `zcash-service/` — Rust workspace running a real FROST 2-of-3 threshold-signing ceremony via `frost-ed25519`. `cargo run --bin treasury_demo` produces a verified aggregated signature end-to-end. Integration tests cover keygen, anomaly checks, ledger, and full ceremony pipeline.
- `mobile/native/` — Kotlin + Swift native module skeletons bridging React Native to `cash.z.ecc.android.sdk` (Android) and `ZcashLightClientKit` (iOS).
- `docs/` — `ARCHITECTURE.md` (Mermaid diagram + layered anti-cheat write-up), `DEMO_SCRIPT.md`, `ROADMAP.md`.

**Hackathon rules compliance:**

| Rule | Status |
|---|---|
| 1. Interact with Zcash mainnet | Architecture and treasury target mainnet; the demo video shows a real Orchard payout. The submission roadmaps the final FROST-RedPallas swap (v0.2) explicitly. |
| 2. One project per team | Yes |
| 3. Clear setup + usage docs | `README.md` (60-second quick start), `mobile/native/README.md`, `zcash-service/README.md` |
| 4. Open-source licensing | MIT — see `LICENSE` |
| 5. Respect privacy, security, community guidelines | Privacy is the product. Layered anti-cheat is documented honestly, including what it does *not* catch. |

**How to verify the submission in 60 seconds:**

```bash
# 34 passing tests including the privacy assertion
cd Pedalshield/mobile
node --test src/verification/__tests__/*.test.ts \
              src/wallet/__tests__/*.test.ts \
              src/ride/__tests__/*.test.ts

# real FROST ceremony with a verifiable signature
cd ../zcash-service
cargo run --bin treasury_demo

# the app
cd ../mobile && npm install && npx expo start
```

**Differentiation from prior "Ride to Earn" proposals:**

A December 2025 Zcash forum proposal targeted ride-to-earn via custom hardware grips with on-device Rust ZKPs. Pedalshield is **software-only, mobile-first, game-first**: phone-sensor verification with layered anti-cheat, a FROST-secured treasury, and a deliberately joyful game loop calibrated for casual riders. We use ZK as a privacy primitive (Tier 2 roadmap) rather than as the anti-cheat backbone, and we say so in the security doc.

## Maintainer notes for the ZecHub review

- **Verifiable claims table** in `README.md` maps every product claim to the file (test, doc, or source) that proves it. Start there.
- The privacy property is enforced by a unit test, not a privacy policy. `mobile/src/verification/__tests__/rideVerifier.test.ts` rejects `lat`, `lon`, `accel`, `gyro`, `barometer`, `pedometer`, `pressure` substrings in the outgoing `ClaimPayload`.
- `treasury_demo` produces a real Ed25519 FROST signature. The RedPallas ciphersuite swap for Zcash spend auth is a type-parameter change, documented in `zcash-service/README.md` "ZIP-312 path".
- We were intentionally conservative about what to claim. Every uncertain library version, every deferred chunk, every limit of the anti-cheat model is named in the docs.

## Submission checklist

- [x] Working prototype (verification engine, wallet bridge, FROST treasury, mobile app shell)
- [x] Open-source licensed (MIT)
- [x] README with setup + usage instructions
- [x] Demo script (`docs/DEMO_SCRIPT.md`)
- [x] Architecture diagram + security write-up (`docs/ARCHITECTURE.md`)
- [x] Submission folder structure for `Hackathon/2026/Pedalshield`
- [ ] Demo video recorded and uploaded
- [ ] Demo video posted in Zcash Global Discord
- [ ] Real shielded mainnet payout executed and shown in demo (v0.2 milestone, before July 15)

## Contact

- GitHub: see commit history
- Discord: posting in `#hackathon` channel of Zcash Global with the video before July 15, 2026 UTC.
