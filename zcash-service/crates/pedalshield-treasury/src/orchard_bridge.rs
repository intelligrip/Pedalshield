//! Bridge between FROST signatures and Orchard transactions.
//!
//! Wires `FrostCoordinator`'s two-stage ceremony API into the shape an
//! Orchard payout transaction needs:
//!
//!   1. `plan_payout` runs FROST round 1 and returns a `PayoutPlan`
//!      exposing the `rk` (randomized verifying key) the Orchard spend
//!      description will publish.
//!   2. The caller uses `rk` to build an unauthorised
//!      `orchard::Bundle`, then computes its v5 SIGHASH.
//!   3. `finalize_payout` finishes the ceremony with that SIGHASH as
//!      the signed message - producing a `Signature` valid under `rk`.
//!   4. The caller splices that signature into the bundle as
//!      `spend_auth_sig`, adds the binding signature, finalises the
//!      `TransactionData`, and broadcasts via `lightwalletd`.
//!
//! ## Status
//!
//! The pure-FROST seam (stages 1 + 3) is real and tested today. The
//! orchard / zcash_primitives / tonic calls (stages 2 + 4) are stubbed
//! with `unimplemented!()` and explicit `// TODO: orchard` comments.
//! Filling them in needs the deps + several cargo-iteration rounds:
//! the orchard builder API assumes single-key spend auth signing by
//! default, so wiring our pre-derived FROST randomizer + externally-
//! supplied signature into the bundle needs care.
//!
//! See `docs/ORCHARD_INTEGRATION.md` for the full integration plan.

use crate::error::{PedalshieldError, Result};
use crate::frost_coordinator::{
    CeremonyOutput, FrostCoordinator, PendingCeremony, Signer, VerifyingKey,
};
use crate::types::{PayoutRecipient, Zatoshi};

// ----------------------------------------------------------------------
// Data model
// ----------------------------------------------------------------------

/// A note owned by the FROST treasury that can be spent in a payout.
/// Placeholder until the `orchard` dep lands - then becomes a wrapper
/// around `orchard::Note` + the merkle path + anchor needed to spend it.
#[derive(Debug, Clone)]
pub struct TreasuryNote {
    pub note_id: String,
    pub value_zatoshi: Zatoshi,
    // TODO: orchard - real fields:
    //   pub note: orchard::Note,
    //   pub merkle_path: orchard::tree::MerklePath,
    //   pub anchor: orchard::Anchor,
}

/// A planned payout. FROST round 1 has run, `rk` is known. The caller
/// uses `rk` to construct the Orchard bundle, computes its SIGHASH,
/// and passes everything back to `finalize_payout`.
pub struct PayoutPlan {
    /// Ceremony state to feed back into `finalize_payout`.
    pub pending: PendingCeremony,
    /// Randomized verifying key. Goes into the Orchard spend
    /// description as `rk`.
    pub rk: VerifyingKey,
    /// Recipients in the planned payout.
    pub recipients: Vec<PayoutRecipient>,
    /// Notes the treasury will spend to fund the payout.
    pub spent_notes: Vec<TreasuryNote>,
    /// ZIP-317 conventional fee for the transaction.
    pub fee_zatoshi: Zatoshi,
}

impl PayoutPlan {
    /// Total amount being paid to riders, in zatoshi.
    pub fn total_payout_zatoshi(&self) -> Zatoshi {
        self.recipients.iter().map(|r| r.amount_zatoshi).sum()
    }

    /// Total value of treasury notes being spent, in zatoshi.
    pub fn total_input_zatoshi(&self) -> Zatoshi {
        self.spent_notes.iter().map(|n| n.value_zatoshi).sum()
    }
}

// ----------------------------------------------------------------------
// FROST seam - real, tested today
// ----------------------------------------------------------------------

/// Stage 1: lock in the FROST randomizer and report `rk` so the caller
/// can build an Orchard bundle around it.
///
/// In production this runs on the treasury coordinator after a payout
/// batch has been assembled and signers are available.
pub fn plan_payout(
    coordinator: &FrostCoordinator,
    signers: &mut [&mut Signer],
    spent_notes: Vec<TreasuryNote>,
    recipients: Vec<PayoutRecipient>,
    fee_zatoshi: Zatoshi,
) -> Result<PayoutPlan> {
    // Sanity-check that the spends cover the recipients + fee. This is
    // a treasury-side guard; the chain enforces the same property via
    // value-balance checks in the Orchard bundle.
    let recipients_total: Zatoshi = recipients.iter().map(|r| r.amount_zatoshi).sum();
    let inputs_total: Zatoshi = spent_notes.iter().map(|n| n.value_zatoshi).sum();
    let needed = recipients_total.saturating_add(fee_zatoshi);
    if inputs_total < needed {
        return Err(PedalshieldError::InsufficientTreasury {
            requested: needed,
            available: inputs_total,
        });
    }

    let pending = coordinator.round1_and_derive_rk(signers)?;
    let rk = pending.randomized_verifying_key().clone();

    Ok(PayoutPlan {
        pending,
        rk,
        recipients,
        spent_notes,
        fee_zatoshi,
    })
}

/// Stage 2: with the Orchard bundle built and its SIGHASH computed,
/// finish the FROST ceremony. Returns the threshold-signed signature
/// that goes into the bundle's spend description as `spend_auth_sig`.
pub fn finalize_payout(
    coordinator: &FrostCoordinator,
    signers: &mut [&mut Signer],
    plan: PayoutPlan,
    bundle_sighash: &[u8; 32],
) -> Result<CeremonyOutput> {
    coordinator.finish_ceremony(signers, plan.pending, bundle_sighash)
}

// ----------------------------------------------------------------------
// Orchard / lightwalletd stubs - real wiring is the next chunk
// ----------------------------------------------------------------------

/// Build an unauthorised Orchard bundle for a `PayoutPlan`. The
/// returned bundle's spend descriptions publish `plan.rk`, and the
/// returned `[u8; 32]` is the bundle's v5 SIGHASH - the message the
/// FROST ceremony will sign.
///
/// ### TODO: orchard
///   1. Construct `orchard::builder::Builder` with `BundleType::DEFAULT`
///      (or `Transactional` with explicit flags) and the treasury
///      account's anchor.
///   2. For each note in `plan.spent_notes`, call
///      `builder.add_spend(treasury_fvk, note, merkle_path)?` and
///      override the spend-auth randomizer so the emitted `rk` matches
///      `plan.rk`. The default builder generates a fresh randomizer per
///      spend; injecting our pre-derived one needs either a lower-level
///      builder method or a callback-style randomizer source.
///   3. For each recipient: `builder.add_output(ovk, ua, value, memo)`.
///   4. `let unauth = builder.build(rng)?;`
///   5. Wrap in `zcash_primitives::transaction::TransactionData::v5(...)`
///      and compute the v5 SIGHASH (see
///      `zcash_primitives::transaction::sighash::v5_signature_hash`).

#[cfg(not(feature = "orchard-integration"))]
pub fn build_unauthorised_bundle(
    _plan: &PayoutPlan,
) -> Result<(UnauthorisedBundle, [u8; 32])> {
    unimplemented!(
        "v0.3: enable the `orchard-integration` cargo feature to build \
         with the real orchard / zcash_primitives deps. The default \
         build leaves this stubbed so `cargo test` stays green."
    )
}

#[cfg(feature = "orchard-integration")]
pub fn build_unauthorised_bundle(
    plan: &PayoutPlan,
) -> Result<(UnauthorisedBundle, [u8; 32])> {
    // Imports live inside the function so the non-feature build
    // doesn't need orchard / zcash_primitives at all. The mere fact
    // that these `use` statements resolve is the first iteration
    // milestone - confirms the version pins in Cargo.toml are sane.
    //
    // VERIFY: every name below against orchard 0.10 + zcash_primitives
    // 0.18 docs. The orchard crate's API has shifted between minor
    // versions; adapt as cargo points out the actual names.
    use orchard::{
        builder::{Builder, BundleType},
        Anchor,
    };

    // VERIFY: BundleType in 0.10 - candidates include
    //   BundleType::DEFAULT
    //   BundleType::Transactional { bundle_required, flags }
    //   BundleType::Coinbase
    let bundle_type: BundleType = BundleType::DEFAULT;

    // VERIFY: anchor constructor name. Candidates:
    //   Anchor::empty_tree()  <- most likely on 0.10
    //   Anchor::EMPTY_ROOT
    let anchor: Anchor = Anchor::empty_tree();

    // v0.3b: first real Builder construction. The compiler will tell us
    // whether `Builder::new` takes (bundle_type, anchor) in that order,
    // whether it's infallible (Builder) or fallible (Result<Builder, _>),
    // and whether either arg needs a wrapping type.
    //
    // VERIFY: arg order + return type against orchard 0.10 source.
    // Common variants:
    //   Builder::new(bundle_type, anchor) -> Builder
    //   Builder::new(anchor, bundle_type) -> Builder
    //   Builder::new(...) -> Result<Builder, BuildError>
    let _builder: Builder = Builder::new(bundle_type, anchor);

    // Suppress unused-variable lint on `plan` until the next round adds
    // spends + outputs.
    let _ = plan;

    // Next iteration (v0.3c): add_spend with randomizer injection so the
    // emitted `rk` matches `plan.rk`. The default Builder picks per-spend
    // randomizers internally; we'll need either a custom RNG seeded to
    // produce our randomizer, or a lower-level builder entry that accepts
    // an externally-supplied randomizer.
    //
    // Open questions still to resolve at spend-add time:
    //   - FullViewingKey for a FROST treasury (standard FVK derivation
    //     assumes a single SpendingKey).
    //   - SpendInfo construction from our `TreasuryNote` placeholder
    //     type (becomes a real `orchard::Note` + merkle path).
    unimplemented!(
        "v0.3b: Builder::new wired. Next round wires add_spend / \
         add_output / build / sighash. See VERIFY notes above and \
         docs/ORCHARD_INTEGRATION.md."
    )
}

/// Splice the FROST signature into the bundle's spend description as
/// `spend_auth_sig`, add the (single-key) binding signature, and
/// freeze into a final transaction.
///
/// ### TODO: orchard
///   1. Apply the FROST `Signature` via the orchard builder's spend-auth
///      sig injection path. The orchard crate typically does this with
///      `SpendAuthorizingKey::sign`; for FROST we provide a pre-built
///      signature instead, which may require a `prove_and_sign_with`
///      variant or a manual `apply_signatures` call.
///   2. Add the **binding signature** - single-key, deterministic over
///      the bundle's value commitments. The treasury holds the binding
///      signing key (NOT threshold-managed - it's not a security
///      assumption, just protocol mechanics).
///   3. `tx_data.freeze()?` -> `zcash_primitives::transaction::Transaction`.
pub fn finalise_transaction(
    _bundle: UnauthorisedBundle,
    _signature: &crate::frost_coordinator::Signature,
) -> Result<FinalTransaction> {
    unimplemented!(
        "v0.3: orchard apply_spend_auth_sig + binding_sig + freeze. \
         See docs/ORCHARD_INTEGRATION.md."
    )
}

/// Broadcast a finalised transaction via `lightwalletd`. Returns the
/// `txid` (Zcash mainnet transaction hash).
///
/// ### TODO: tonic + lightwalletd proto codegen
///   1. Compile the `service.proto` from `zcash/lightwalletd` via a
///      `build.rs` with `tonic-build`.
///   2. Connect: `CompactTxStreamerClient::connect(host).await?`.
///   3. `client.send_transaction(RawTransaction { data, height: 0 }).await?`.
///   4. Poll `get_transaction(txid)` until it appears in a block.
pub async fn broadcast(
    _tx: &FinalTransaction,
    _lightwalletd_host: &str,
) -> Result<Txid> {
    unimplemented!(
        "v0.3: tonic-based lightwalletd client. See \
         docs/ORCHARD_INTEGRATION.md."
    )
}

// ----------------------------------------------------------------------
// Placeholder types - replace with real `orchard` / `zcash_primitives`
// types when the deps are wired up.
// ----------------------------------------------------------------------

/// Placeholder for `orchard::Bundle<InProgress<Unauthorized, Unproven>, Amount>`.
pub struct UnauthorisedBundle;

/// Placeholder for `zcash_primitives::transaction::Transaction`.
pub struct FinalTransaction;

/// Placeholder for `zcash_primitives::transaction::TxId`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Txid(pub [u8; 32]);

impl Txid {
    pub fn as_hex(&self) -> String {
        hex::encode(self.0)
    }
}

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_signers_and_coordinator() -> (Vec<Signer>, FrostCoordinator) {
        FrostCoordinator::generate_with_dealer(2, 3)
            .expect("trusted-dealer keygen")
    }

    #[test]
    fn plan_then_finalize_with_simulated_sighash() {
        // This exercises the FROST seam end-to-end with a placeholder
        // for the orchard SIGHASH. When the orchard crate lands, the
        // placeholder `[0x42; 32]` becomes the real v5 SIGHASH of the
        // bundle built around `plan.rk`.
        let (mut signers, coordinator) = make_signers_and_coordinator();
        let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();

        let plan = plan_payout(
            &coordinator,
            &mut refs,
            vec![TreasuryNote {
                note_id: "test-note-1".into(),
                value_zatoshi: 200_000,
            }],
            vec![PayoutRecipient {
                rider_ua: "u1mockrider".into(),
                amount_zatoshi: 100_000,
                claim_ids: vec![1],
            }],
            10_000,
        )
        .expect("plan should succeed when inputs cover outputs + fee");

        // Sanity on the plan
        assert_eq!(plan.total_payout_zatoshi(), 100_000);
        assert_eq!(plan.total_input_zatoshi(), 200_000);

        // The `rk` is stable across the plan/finalize boundary.
        let rk_before = plan.rk.clone();

        let simulated_sighash: [u8; 32] = [0x42; 32];
        let output = finalize_payout(
            &coordinator,
            &mut refs,
            plan,
            &simulated_sighash,
        )
        .expect("finalize should succeed with matching seed");

        assert_eq!(
            &rk_before,
            output.randomizer_params.randomized_verifying_key(),
            "rk must be stable from plan to finalize",
        );
        assert!(
            coordinator.verify(&simulated_sighash, &output).is_ok(),
            "signature must verify under the RVK that the bundle's `rk` publishes",
        );
    }

    #[test]
    fn plan_rejects_insufficient_inputs() {
        let (mut signers, coordinator) = make_signers_and_coordinator();
        let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();

        // Note: `expect_err` would require PayoutPlan: Debug, which
        // would cascade into the (non-Debug) frost-rerandomized types.
        // Match on the Result directly instead.
        let result = plan_payout(
            &coordinator,
            &mut refs,
            vec![TreasuryNote {
                note_id: "tiny".into(),
                value_zatoshi: 50_000,
            }],
            vec![PayoutRecipient {
                rider_ua: "u1mockrider".into(),
                amount_zatoshi: 100_000,
                claim_ids: vec![1],
            }],
            10_000,
        );

        assert!(
            matches!(result, Err(PedalshieldError::InsufficientTreasury { .. })),
            "must reject when inputs < outputs + fee",
        );
    }

    #[test]
    fn txid_hex_roundtrip() {
        let id = Txid([0xde; 32]);
        let hex = id.as_hex();
        assert_eq!(hex.len(), 64);
        assert!(hex.starts_with("dede"));
    }
}
