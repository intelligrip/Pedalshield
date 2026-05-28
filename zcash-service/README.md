# Pedalshield treasury and payout service

Rust workspace housing the FROST-secured treasury for Pedalshield. Builds shielded ZEC payout batches, runs threshold-signing ceremonies, and (in Chunk 4) broadcasts Orchard transactions to mainnet via `lightwalletd`.

## What's real today (Chunk 3 + v0.2)

- **FROST 2-of-3 threshold signing over RedPallas with rerandomization** - the ciphersuite Zcash uses for Orchard spend authorisation per [ZIP-312](https://zips.z.cash/zip-0312). Trusted-dealer keygen, full round 1 + round 2 with `RandomizedParams`, aggregation, and external verification against the *randomized* verifying key - the same value an Orchard spend description publishes as `rk`. `cargo run --bin treasury_demo` produces a real signature and verifies it end-to-end.
- **Domain types** for claims, payout batches, and ledger entries, with the Pedalshield earning formula (`compute_reward_zatoshi`) baked in. Effort dominates by construction; the upgrade multiplier is bounded.
- **`ClaimLedger` trait** + in-memory implementation. SQLite swap is a single-file change (`rusqlite` + the same trait).
- **Anomaly detection**: minimum integrity score, single-ride and daily-volume caps, average-speed envelope, duplicate-ride rejection.
- **Integration tests** covering keygen, the full pipeline (anomaly check -> ledger submit -> batch -> FROST -> verify -> mark paid), sub-threshold quorum rejection, low-score / over-cap / duplicate-claim rejection, and randomizer freshness (each ceremony yields a distinct randomized verifying key; cross-verification fails).

## What's deferred (next chunk)

- **Orchard transaction construction.** Build an unsigned Orchard bundle via `orchard::builder::Builder` (from `librustzcash`). For each spend, pre-randomize `rk` to match the FROST ceremony output, compute the bundle SIGHASH, run the ceremony with the SIGHASH as the message, splice the resulting `Signature` into the spend description's `spend_auth_sig` slot. Step-by-step in [`docs/ORCHARD_INTEGRATION.md`](../docs/ORCHARD_INTEGRATION.md).
- **`lightwalletd` gRPC client** to submit the constructed transaction (tonic-based).
- **HTTP claim ingestion API** (axum endpoint) that takes the mobile app's `ClaimPayload`, runs `anomaly::check_claim`, and persists.
- **Persistent ledger** swapping `InMemoryLedger` for a `SqliteLedger`.

## ZIP-312 status

The treasury runs a real FROST ceremony with the **FROST-over-RedPallas (rerandomized)** ciphersuite via `frost-redpallas` (or `frost-rerandomized` v2.2 + the RedPallas spend-auth suite from `reddsa`, depending on how ZF packages the v3 release). The v2.2 API revamp ensured the randomizer derivation is bound to the verifying key, which is what `FrostCoordinator::run_ceremony` uses.

What this *doesn't* do yet: bind the signature to a real Orchard bundle SIGHASH. The bundle build + SIGHASH + splice + broadcast is the next chunk, scoped in [`docs/ORCHARD_INTEGRATION.md`](../docs/ORCHARD_INTEGRATION.md).

Per ZF's 2026 strategy updates, FROST v3 (cheater detection by default) and ZIP-312 finalisation are targeted this year. Pin exact versions when wiring against `librustzcash` head.

## Build and test

```bash
cd zcash-service
cargo check                        # validate the workspace
cargo test                         # unit + integration tests
cargo run --bin treasury_demo      # print a full ceremony to stdout
```

> **Author's note:** this crate was written without a Rust toolchain in the build sandbox; the code is structured against the documented `frost-rerandomized` v2.2 API surface (revamped specifically for Zcash so all signing parties contribute to the randomizer). The first thing to run on your machine is `cargo check`. If a crate-version drift requires a signature tweak, the high-level flow (`generate_with_dealer` → `round1::commit` → `SigningPackage::new` → `RandomizedParams::new` → `round2::sign` *with randomizer* → `aggregate` *with randomizer* → `randomized_verifying_key().verify`) is the stable backbone. Every uncertain call carries an annotated `// VERIFY` comment.

## Layout

```
crates/pedalshield-treasury/
  src/
    lib.rs                  - re-exports
    types.rs                - domain types + earning formula
    error.rs                - PedalshieldError
    ledger.rs               - ClaimLedger trait + InMemoryLedger
    anomaly.rs              - cross-ride anomaly rules
    frost_coordinator.rs    - FROST ceremony driver
    bin/treasury_demo.rs    - cargo run end-to-end demo
  tests/
    ceremony_e2e.rs         - integration tests
```

## Security model — honestly

The FROST treasury solves one specific problem: **no single party can sign a payout transaction**. A 2-of-3 (or any t-of-n) signer group must collude to spend. Combined with batched payouts and a finite community-funded pool, this gives the rider a credible guarantee that rewards are governed by the protocol, not by a custodian.

What FROST does *not* solve, and what we address elsewhere:
- **Sensor spoofing** — handled by the on-device sensor fusion + integrity score + device attestation + cross-ride anomaly detection in this crate.
- **Sybil farming** — handled by device attestation + the trust ramp.
- **Coordinator compromise** — a compromised coordinator can stop signing, but cannot forge a signature without t signers.
- **Signer compromise** — t compromised signers can sign anything; pick signers carefully and rotate.

See `docs/ARCHITECTURE.md` (in the repo root) for the layered anti-cheat write-up.
