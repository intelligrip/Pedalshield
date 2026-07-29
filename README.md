# Pedalshield

**Ride private. Earn shielded.**

[![Track](https://img.shields.io/badge/track-Games-D946EF)](https://zechub.wiki/hackathon)
[![License](https://img.shields.io/badge/license-MIT-22D3A1)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-34%20passing-22D3A1)](mobile/src)
[![Mainnet](https://img.shields.io/badge/mainnet-payouts%20proven-22D3A1)](#proof-not-promises--mainnet-receipts)
[![Hackathon](https://img.shields.io/badge/ZecHub%20Hackathon-2026-A855F7)](https://github.com/ZecHub/zechub/tree/main/Hackathon/2026)

A privacy-first, mobile bike-to-earn app built on Zcash. Cyclists track
real-world rides, the phone verifies them entirely locally — **your route
never leaves the device** — and an **autonomous backend pays out shielded
ZEC on mainnet**. No manual operator. No route database. Nothing to leak.

> Submission for the **ZecHub Hackathon 2026 — Games track**.

---

## TL;DR for judges (3 sentences)

Pedalshield pays real shielded ZEC for verified bike rides via a
**hand-rolled, fully autonomous Orchard spend pipeline that is already proven
on Zcash mainnet** (real txids below), while proving in code that no route,
motion, or sensor data ever leaves the rider's phone. The on-device verifier
classifies bike rides vs car rides vs GPS spoofs vs walks with a transparent,
layered anti-cheat model we name honestly. The whole loop — ride → on-device
verification → claim → autonomous shielded payout — runs with no human in the
loop, on the NU6.2-current network rules.

## Proof, not promises — mainnet receipts

| Claim | Receipt |
| --- | --- |
| **Paid through the Ironwood (NU6.3) hard fork — on activation day** (July 29, 2026) | txid [`fbf4e134…d16ed8`](https://mainnet.zcashexplorer.app/transactions/fbf4e134cd74b635c598d869f1cafffd902f649fac44cfb6ef534e8e01d16ed8) — **v6 transaction, cross-pool migration spend**: legacy Orchard note spent, rider paid an Ironwood note, change retained in the legacy pool. 1.55 mi verified on-device, no human in the loop. |
| **Real outdoor ride → on-device verification → autonomous shielded payout to a rider's own wallet** (June 11, 2026) | txid [`2a849aca…b264ab`](https://mainnet.zcashexplorer.app/transactions/2a849aca04f9b9661ec826c22db97edfb988a22fc7ce7432a651abbc08b264ab) — 492 m ride, verified on-device, paid with no human in the loop |
| Autonomous shielded Orchard payout, no operator | txid [`f1a3bacc…c10ba6`](https://mainnet.zcashexplorer.app/transactions/f1a3bacc582e156069b108afa61711a7dbae9ceff84c8d0c5b8f5fca15c10ba6) — fired automatically by `POST /claim` |
| Repeatable (not a one-off) | txid [`ef0e2a57…060587`](https://mainnet.zcashexplorer.app/transactions/ef0e2a577f3f16e50cfd20c2b03dd1c14344f63d21ae34e6e4989c05c0060587) |
| First autonomous spend, anchor verified byte-identical to `GetTreeState` | txid `6da9298a…272f5b74`, mined block 3,368,791 |
| Current with **two consensus upgrades in one summer** | NU6.2 emergency fix (June) re-pinned within days; **NU6.3 / Ironwood (July 29)** re-pinned to `zcash_protocol 0.10` + `orchard 0.15` and migrated to Ironwood-pool outputs the same day it activated. `cargo run --bin treasury_ping` prints the live branch id (now `0x37a5165b`). |

## Try it in 60 seconds

```bash
git clone https://github.com/intelligrip/Pedalshield.git pedalshield
cd pedalshield/mobile
npm test   # public test suite (runs against the open verification interface + stub)
# expected: pass / fail 0
```

> Note: the public repo ships the **open** verification interface (contract,
> privacy-boundary claim builder, geo helpers) plus a stub. The proprietary
> anti-cheat engine is **not** in this repo (see "Open vs. proprietary" below),
> so `npm test` exercises the contract and privacy guarantees, not the secret
> scoring rubric.

Then verify the backend speaks current consensus:

```bash
cd ../zcash-service
cargo run --bin treasury_ping
```

Then the full app:

```bash
cd ../mobile
npm install
npx expo start
```

## Why Pedalshield

Move-to-earn fitness apps either farm your data (Strava) or collapse under
tokenomics ponzis (StepN). Pedalshield is neither. Your routes are never
uploaded — not encrypted-and-uploaded, **never uploaded**. Rewards are real
ZEC from a finite treasury — we never mint anything, and payouts are small
and capped by design (pegged to the EPA social cost of carbon, ~$190/tonne: ~$0.09/mile for ~1 lb avoided CO2, per-ride cap): privacy is the
product, not yield.

## How it works

```
[Phone] sensor fusion + on-device integrity score
        |
        |  minimal claim payload (no geo, no motion - unit-test enforced)
        v
[Backend] claim ledger + payout computation (axum + sqlite)
        |
        |  autonomous: build -> prove -> SIGHASH -> sign -> broadcast
        v
[Zcash mainnet] hand-rolled Orchard shielded spend -> rider's UA
```

The spend pipeline is hand-rolled against the core `librustzcash` crates
(no wallet SDK): it seeds an Orchard commitment tree from lightwalletd's
`GetTreeState` frontier, scans to tip rediscovering notes + nullifiers,
selects an unspent note, and drives the v5 `TransactionBuilder` with ZIP-317
fees. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/ORCHARD_INTEGRATION.md`](docs/ORCHARD_INTEGRATION.md).

## Verifiable claims — where the receipts live

| What we claim | Where the receipt is |
| --- | --- |
| "Your route never leaves the phone" | `mobile/src/verification/__tests__/engine.public.test.ts` (open) — JSON assertions reject `"lat"`, `"lon"`, `"accel"`, `"gyro"`, `"barometer"`, `"pedometer"`, `"pressure"` in `ClaimPayload`, and pin its exact minimal key set. The payload builder (`verification/claim.ts`) is open so this is independently verifiable. |
| "Real anti-cheat against car / walk / spoof" | Verified by the proprietary engine's own deterministic scenario suite (legit bike, car, GPS spoof, walk). That engine is **closed source** (see "Open vs. proprietary"), so the rubric isn't published — but the open stub proves the contract a fork would have to satisfy. |
| "Autonomous mainnet payouts" | `zcash-service/.../src/spend/` (`tree.rs`, `scanner.rs`, `spender.rs`) + `bin/backend.rs` (`run_payout`), plus the mainnet txids above. |
| "NU6.2-current" | `crates/pedalshield-treasury/Cargo.toml` pins (`zcash_protocol 0.9` et al.) + `treasury_ping`. |
| "No manual operator" | `POST /claim` fires the payout in the background and ACKs `"paying"`; `/approve` exists only as a diagnostic retry. |
| "Layered, honest anti-cheat" | `docs/ARCHITECTURE.md` — the "what catches what / what it doesn't catch" table. |

## What ships today vs what's deferred

| | Status |
| --- | --- |
| On-device ride verification — open interface + stub (MIT) | shipped |
| On-device anti-cheat engine (scoring rubric, thresholds, sensor fusion) | shipped — **proprietary, not in this repo** |
| Privacy seam / claim payload (open, unit-test enforced) | shipped |
| **Autonomous Orchard spend pipeline (mainnet-proven)** | **shipped** — tree seeding, scanning, note selection, v5 builder, broadcast |
| Backend: claims API + autonomous payout + double-pay guard | shipped |
| Zcash wallet interface (Mock + native bridge) | shipped + 10 tests |
| Mobile app: ride tracking, payout card with real txid + explorer link | shipped + 9 tests |
| CLI tooling (`treasury_wallet` sync/send/dry-run, `treasury_ping`) | shipped |
| --- | --- |
| FROST 2-of-3 treasury (Ed25519 ceremony works in `frost_coordinator.rs`; **does not sign mainnet payouts yet** — RedPallas/ZIP-312 swap is roadmap) | demo + roadmap |
| Mempool-aware note reservation (kills same-block double-select window) | roadmap |
| Ironwood pool migration (Orchard successor, ~late July 2026) | roadmap — tracked |
| ZK proof of verified distance (trustless claims, Tier 2) | post-hackathon roadmap |

We say what we can't do yet out loud. The anti-cheat is layered, not
perfect; FROST does not yet authorize Orchard spends; ZK route proofs are
the roadmap, not the present.

## Open vs. proprietary

Pedalshield is open-core. The client, the privacy contract, and everything you
need to verify our privacy claims are **MIT open source**. The anti-cheat
engine — the part that's actually hard and is the moat — is **proprietary and
excluded from this repo**.

| Open source (MIT) | Proprietary (not in this repo) |
| --- | --- |
| App, UI, ride state machine, wallet integration | Scoring rubric + all tuned thresholds |
| `verification/` interface: `types.ts`, `claim.ts` (privacy seam), `geo.ts`, `engine.ts` resolver, `stub.ts` | Feature extraction / sensor fusion |
| Privacy guarantees + tests | Fraud-detection model + labeled real-vs-fake ride dataset (future) |

How the split works in code: the app calls `verifyRide` from
`mobile/src/verification/engine.ts`, which loads the proprietary engine from
`mobile/src/verification-private/` at runtime **if present**, and otherwise
falls back to the open stub (which never marks a ride verified). The private
directory is `.gitignore`d, so a clone or fork builds, runs, and passes the
public tests against the contract — but does not receive the engine that
decides whether a ride is real. Why open-core: privacy claims must be auditable
to be trusted, but publishing the anti-cheat rulebook would just hand it to the
people trying to fake rides. See `mobile/src/verification-private/README.md`.

## Repo tour

```
Pedalshield/
  README.md                  - this file
  SUBMISSION.md              - PR text + judges' quick start
  docs/                      - architecture, demo script, roadmap, plans
  deploy/                    - VPS deploy kit (systemd + Caddy)

  mobile/                    - React Native + Expo app (SDK 50, dev builds)
    src/verification/        - OPEN interface: types, claim payload (privacy
                               seam), geo helpers, engine resolver + stub (MIT)
    src/verification-private/ - PROPRIETARY anti-cheat engine (git-ignored,
                               NOT in the public repo; resolved at runtime)
    src/wallet/              - Wallet contract, Mock + native bridge
    src/ride/                - ride state machine + real GPS/motion source
    src/components/PayoutCard.tsx - claim -> poll -> real txid + explorer link

  zcash-service/             - Rust workspace
    crates/pedalshield-treasury/
      src/spend/             - hand-rolled Orchard spend (tree/scanner/spender)
      src/bin/backend.rs     - axum backend, autonomous payouts
      src/bin/treasury_wallet.rs - sync/send/dry-run CLI
      src/frost_coordinator.rs   - FROST 2-of-3 ceremony (roadmap path)
```

## Demo

[`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — the 2–5 minute video
walkthrough. Video URL lands in [`SUBMISSION.md`](SUBMISSION.md) before the
July 15 deadline: real outdoor ride → on-device verification → autonomous
shielded payout → txid in the explorer.

## Tech stack (verified live)

- **Mobile:** React Native + Expo SDK 50, `expo-location` + `expo-sensors`.
- **Spend pipeline:** `orchard 0.14`, `zcash_primitives 0.28`,
  `zcash_protocol 0.9` (NU6.2), hand-rolled against lightwalletd gRPC
  (`tonic`) at `zec.rocks:443`. No wallet SDK dependency.
- **Backend:** axum + sqlite, env-configured, deployable via `deploy/`.
- **Threshold signing (roadmap):** `ZcashFoundation/frost`, following
  ZIP-312 for RedPallas.

## Hackathon target

| Field | Value |
| --- | --- |
| Track | Games |
| Submission folder | `github.com/ZecHub/zechub/tree/main/Hackathon/2026/Pedalshield` |
| Mainnet payout | required (hackathon rule #1) — **already proven; see receipts above** |
| Deadline | July 15, 2026 (UTC) |

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

Built for the [ZecHub Hackathon 2026](https://zechub.wiki/hackathon). Uses
the `librustzcash` workspace, lightwalletd, and the Zcash Foundation's FROST
crates. Thanks to the ZecHub community — and to the engineers who shipped
NU6.2 in days.
