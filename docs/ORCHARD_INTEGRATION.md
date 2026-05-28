# Orchard integration — from FROST signature to mainnet spend

The path from a rerandomized FROST signature (produced by `FrostCoordinator::run_ceremony`) to a real Orchard shielded transaction broadcast over `lightwalletd`. This is the next chunk; the current treasury crate stops at "produces a signature valid under the randomized verifying key."

## The hand-shake

A FROST-RedPallas ceremony produces a `CeremonyOutput` carrying:

1. A `Signature` over the message we asked it to sign.
2. A `RandomizedParams` whose `randomized_verifying_key()` is the value that an Orchard spend description publishes as `rk`.

For each Orchard spend in a payout batch, the on-chain spend description needs:

- `rk` = the randomized verifying key derived during the ceremony.
- `spend_auth_sig` = the FROST `Signature` we computed.
- The signature must be over the **Orchard SIGHASH of the bundle that includes our `rk`**.

The non-obvious constraint: we can't sign first and construct the bundle second. The SIGHASH depends on the bundle contents (including `rk`), and the signature must be over that SIGHASH. So the build order is:

1. Construct the bundle structure with our `rk` values but placeholder signatures.
2. Compute the SIGHASH.
3. Run the FROST ceremony with the SIGHASH as the message.
4. Splice the resulting `Signature` into the bundle as `spend_auth_sig`.

## The `librustzcash` surface

Relevant crates (versions illustrative; pin against `librustzcash` head):

```toml
orchard = "0.10"
zcash_primitives = "0.18"
zcash_protocol = "0.4"
zcash_client_backend = "0.16"
zcash_keys = "0.4"
```

What each gives us:

- `orchard::builder::Builder` — constructs an Orchard bundle. Per-spend you supply a `SpendInfo` that includes the spend-auth randomizer. The builder produces an unauthorised bundle.
- `orchard::bundle::Bundle::commitment` / `binding_signing_key` — produce the components needed for sighashing.
- `zcash_primitives::transaction::TransactionData` — wraps the Orchard bundle + (optional) Sapling and transparent components.
- `zcash_primitives::transaction::sighash::*` — sighash computation. For Orchard the relevant sighash type is the v5 transaction sighash with `SIGHASH_ALL`.
- `zcash_client_backend` — higher-level wallet operations, including note selection from the treasury's view of its UTXOs.

## Step-by-step build path (next chunk)

### 1. Add deps

```toml
[dependencies]
orchard = "0.10"
zcash_primitives = "0.18"
zcash_protocol = "0.4"
zcash_client_backend = "0.16"
zcash_keys = "0.4"
tonic = "0.11"
prost = "0.12"
tokio = { version = "1", features = ["full"] }
```

### 2. Treasury wallet view

Add a `TreasuryWallet` struct that knows:

- The FROST group's spend authority verifying key (the `pubkey_package.verifying_key()` from `FrostCoordinator`).
- Treasury UTXOs (Orchard notes received into the group account). For Chunk 1 of this, source them by syncing a light-client against a fresh treasury UA; later, use `zcash_client_backend` for proper note management.
- A single Orchard account index, conventionally `0`.

```rust
pub struct TreasuryWallet {
    pub group_vk: GroupVerifyingKey,
    pub notes: Vec<OrchardNote>,
    pub account: AccountId,
}
```

### 3. Per-payout pipeline

For each `PayoutRecipient` in a `PayoutBatch`:

1. **Select notes** to spend that cover `amount_zatoshi + fee`. Reuse existing change handling from `zcash_client_backend`.
2. **Generate spend-auth randomizers** — one per spend. These become inputs to FROST's `RandomizedParams`.
3. **Add spends + outputs** to an `orchard::builder::Builder`. The recipient output uses the rider's UA Orchard receiver.
4. Produce an unauthorised bundle (`builder.build(rng)`).

### 4. SIGHASH the bundle

Use `zcash_primitives::transaction::sighash::v5_signature_hash` (or current equivalent) with `SIGHASH_ALL`. For each Orchard spend, you get the message bytes the FROST signature must cover.

### 5. FROST sign

For each spend's SIGHASH:

```rust
let mut refs: Vec<&mut Signer> = signers.iter_mut().take(threshold).collect();
let output = coordinator.run_ceremony(&mut refs, &spend_sighash)?;
```

**Critical:** the randomizer used inside `run_ceremony` must match the randomizer used to derive the `rk` we placed in the bundle. There are two ways to bind these:

- **Option A — coordinator drives the randomizer.** Lift the randomizer out of `RandomizedParams::new` and use the same one to derive `rk` for the bundle *and* to construct `RandomizedParams` for the ceremony. Cleanest, requires exposing the randomizer.
- **Option B — pre-derive `rk` from the ceremony output.** Run the ceremony first with a placeholder SIGHASH, capture `randomized_verifying_key()`, then build the bundle with that `rk`, then re-compute SIGHASH, then re-run the ceremony with the real SIGHASH but the same randomizer. Two ceremonies per spend — wasteful.

Use Option A. This will require a small refactor in `frost_coordinator.rs` to accept a caller-supplied randomizer (or to return the chosen randomizer for reuse).

### 6. Splice signatures into the bundle

Each Orchard spend in the unauthorised bundle has a `spend_auth_sig` placeholder. Replace it with the corresponding FROST `Signature`. The `orchard` crate exposes a way to apply spend auth signatures to an in-progress bundle (`InProgress<Unauthorized, _>` -> `InProgress<PartiallyAuthorized, _>` -> ... -> `Authorized`).

### 7. Binding signature

Orchard bundles also carry a single *binding signature* over all action commitments. This is signed by the treasury's binding signing key (deterministic from the bundle), not by FROST — Orchard's binding signature is single-key by design.

### 8. Finalise the transaction

Wrap the authorized Orchard bundle in a `TransactionData`, finalise, serialise.

### 9. Broadcast via `lightwalletd`

```rust
let mut client = CompactTxStreamerClient::connect(LIGHTWALLETD_URL).await?;
let raw_tx = RawTransaction { data: serialised_tx, height: 0 };
let result = client.send_transaction(raw_tx).await?;
```

The `lightwalletd` proto is published; tonic generates the client. Pin to a `lightwalletd` instance you trust (or run your own).

### 10. Confirm

Poll `get_transaction(txid)` until it appears in a block. Update `ledger.mark_paid(claim_ids, batch_id, &txid_hex)`.

## Refactors to `frost_coordinator.rs` for Step 5 Option A

The current `run_ceremony` derives `RandomizedParams` internally. To support binding to a pre-derived `rk`, add an overload:

```rust
pub fn run_ceremony_with_randomizer(
    &self,
    signers: &mut [&mut Signer],
    message: &[u8],
    randomizer_params: RandomizedParams,
) -> Result<CeremonyOutput>
```

Keep the existing `run_ceremony` as a convenience that generates a fresh `RandomizedParams`. The Orchard pipeline calls the explicit version.

## Open questions to resolve at integration

- Exact constructor name on `RandomizedParams` (`new(vk, rng)` vs `from_signing_commitments(...)`). The flow described uses the verifying-key form; some v2.2 builds expose only the commitments-derived form.
- Whether `orchard::builder::Builder` accepts a pre-computed `rk` directly or requires a signing callback. The callback pattern is cleaner for FROST integration — check the latest `orchard` crate docs.
- Treasury note management: where treasury UTXOs come from, change handling, single-account assumption.
- DKG vs trusted-dealer for the production treasury. Trusted dealer is the simplest path for the hackathon submission; DKG can be a v1.0 milestone.

## Why this is the bottleneck

FROST gives us threshold signing. Orchard gives us shielded transactions. This chunk is the **adapter** that makes a FROST signature meet the Orchard bundle's strict shape requirements — particularly the binding between the randomizer the ceremony used and the `rk` value that gets published on-chain.

Once the hand-shake works for one payout, batched payouts work the same way: one randomizer + one ceremony per spend in the bundle, then a single binding signature, then broadcast.

## How to test before mainnet

1. Build a regtest harness around a local Zcash node + local `lightwalletd`.
2. Fund a regtest treasury UA, run a payout to a synthetic rider UA, confirm the txid lands.
3. Run the same flow against Zcash testnet (note: the hackathon requires mainnet for the final submission, but testnet is fine for the iteration loop).
4. For the demo, perform a single small mainnet payout (e.g. 0.0001 ZEC per rider × N riders). The block-explorer screenshot becomes the "rule #1 satisfied" receipt in the demo video.
