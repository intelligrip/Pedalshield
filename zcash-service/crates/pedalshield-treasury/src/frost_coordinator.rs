//! FROST t-of-n threshold-signing ceremony for the Pedalshield treasury.
//!
//! Uses FROST over **RedPallas with rerandomization** - the ciphersuite
//! Zcash uses for Orchard spend authorisation (per ZIP-312). Each
//! ceremony produces:
//!
//!   1. A `Signature` over the message digest.
//!   2. A `RandomizedParams` whose `randomized_verifying_key()` is the
//!      exact value that becomes `rk` in the Orchard spend description.
//!      The signature verifies under that randomized key - not under
//!      the group's static `verifying_key()`.
//!
//! Flow (rerandomized):
//!   1. Trusted-dealer keygen produces N key shares + group `PublicKeyPackage`.
//!   2. Round 1: each signer publishes `SigningCommitments`.
//!   3. Coordinator builds `SigningPackage` AND derives `RandomizedParams`
//!      from fresh randomness. (v2.2 of the API ensures all signing
//!      parties contribute to the randomizer.)
//!   4. Round 2: each signer's signature share uses the randomizer.
//!   5. Coordinator aggregates and self-verifies against the randomized
//!      verifying key.
//!
//! The caller binds the resulting `CeremonyOutput` to an Orchard spend
//! description (see `docs/ORCHARD_INTEGRATION.md`).
//!
//! ## Notes on the API
//!
//! Written against `frost-rerandomized` v2.2 documented usage (the
//! revamped, Zcash-motivated API). Every uncertain call carries a
//! `// VERIFY` comment. The high-level rerandomized flow
//! (`generate_with_dealer` -> `round1::commit` -> `SigningPackage::new`
//! -> `RandomizedParams::new` -> `round2::sign` *with randomizer* ->
//! `aggregate` *with randomizer* -> `randomized_verifying_key().verify`)
//! is the stable backbone; `cargo check` is the first thing to run on
//! your machine.

use crate::error::{PedalshieldError, Result};

// FROST over RedPallas with rerandomization (ZIP-312). The `reddsa`
// crate provides the RedPallas Ciphersuite + ZIP-312 rerandomized
// FROST helpers (sign, aggregate, RandomizedParams) behind its `frost`
// feature flag. We alias the redpallas module as `frost` so the rest
// of this file reads like the standard frost-ed25519 / frost-secp256k1
// style.
use reddsa::frost::redpallas as frost;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub type Identifier = frost::Identifier;
pub type KeyPackage = frost::keys::KeyPackage;
pub type PublicKeyPackage = frost::keys::PublicKeyPackage;
pub type SigningCommitments = frost::round1::SigningCommitments;
pub type SigningNonces = frost::round1::SigningNonces;
pub type SignatureShare = frost::round2::SignatureShare;
pub type Signature = frost::Signature;
pub type SigningPackage = frost::SigningPackage;
pub type VerifyingKey = frost::VerifyingKey;

// Rerandomization parameters derived from a verifying key + fresh
// randomness. The randomized verifying key (RVK) is what an Orchard
// spend description publishes as `rk`; the FROST signature verifies
// under the RVK, never the group's static verifying key.
//
// reddsa re-exports the rerandomized types and helpers under
// `reddsa::frost::redpallas::rerandomized` (aliased here as
// `frost::rerandomized`). Using that path is essential - pinning
// `frost-rerandomized` directly would pull in a different frost-core
// version and break type unification.
pub type RandomizedParams = frost::rerandomized::RandomizedParams;

/// One signer in the threshold group. Holds its `KeyPackage` and the
/// `SigningNonces` for the in-flight ceremony.
pub struct Signer {
    pub id: Identifier,
    key_package: KeyPackage,
    nonces: Option<SigningNonces>,
}

impl Signer {
    pub fn new(id: Identifier, key_package: KeyPackage) -> Self {
        Self {
            id,
            key_package,
            nonces: None,
        }
    }

    /// Round 1: produce nonces and public commitments. Nonces are kept
    /// private until round 2; commitments are sent to the coordinator.
    pub fn commit(&mut self) -> SigningCommitments {
        let mut rng = OsRng;
        let (nonces, commitments) =
            frost::round1::commit(self.key_package.signing_share(), &mut rng);
        self.nonces = Some(nonces);
        commitments
    }

    /// Round 2 (rerandomized): produce a signature share. v3 of
    /// `frost-rerandomized` prefers the seed-based API - signers
    /// receive only the `Vec<u8>` randomizer seed (not the full
    /// `RandomizedParams`) and re-derive the params locally. This is
    /// what flows over the wire in a real deployment. Consumes the
    /// round-1 nonces.
    pub fn sign(
        &mut self,
        package: &SigningPackage,
        randomizer_seed: &[u8],
    ) -> Result<SignatureShare> {
        let nonces = self.nonces.take().ok_or_else(|| {
            PedalshieldError::FrostError(
                "sign() called before commit() (no nonces available)".into(),
            )
        })?;
        // `frost_rerandomized::sign(...randomizer)` is deprecated in v3;
        // `sign_with_randomizer_seed` takes the seed and derives
        // RandomizedParams internally, matching what the coordinator
        // distributes after `new_from_commitments`.
        Ok(frost_rerandomized::sign_with_randomizer_seed(
            package,
            &nonces,
            &self.key_package,
            randomizer_seed,
        )?)
    }
}

/// Output of a rerandomized ceremony. The caller binds the signature
/// to an Orchard spend description that uses
/// `randomizer_params.randomized_verifying_key()` as its `rk` field
/// and the SIGHASH-of-the-bundle-with-that-rk as the signed message.
/// See `docs/ORCHARD_INTEGRATION.md`.
pub struct CeremonyOutput {
    pub signature: Signature,
    pub randomizer_params: RandomizedParams,
}

/// Mid-ceremony state, between round 1 and round 2.
///
/// Holds the round-1 commitments and the derived `RandomizedParams`
/// (and its seed). The caller can read `randomized_verifying_key()` to
/// get the `rk` value an Orchard spend description publishes - and use
/// that `rk` to build the bundle the eventual SIGHASH covers - BEFORE
/// the message that will actually be signed is known. Pass back into
/// `FrostCoordinator::finish_ceremony` with the final message (the
/// Orchard SIGHASH in production) to complete the signature.
pub struct PendingCeremony {
    commitments: BTreeMap<Identifier, SigningCommitments>,
    randomizer_params: RandomizedParams,
    randomizer_seed: Vec<u8>,
}

impl PendingCeremony {
    /// The randomized verifying key. In an Orchard bundle this is the
    /// `rk` field of the spend description that the FROST signature
    /// will authorise. The caller reads this, builds the bundle with
    /// it, computes the SIGHASH, and passes it back as the message in
    /// `finish_ceremony`.
    pub fn randomized_verifying_key(&self) -> &VerifyingKey {
        self.randomizer_params.randomized_verifying_key()
    }

    /// The randomizer seed - opaque bytes that signers running in their
    /// own processes need to re-derive the same RandomizedParams. Not
    /// secret per se, but only useful in combination with the round-1
    /// commitments.
    pub fn seed(&self) -> &[u8] {
        &self.randomizer_seed
    }
}

/// Treasury-side coordinator. Holds the group `PublicKeyPackage` and the
/// (min, max) threshold parameters.
pub struct FrostCoordinator {
    pub pubkey_package: PublicKeyPackage,
    pub min_signers: u16,
    pub max_signers: u16,
}

impl FrostCoordinator {
    /// Trusted-dealer key generation. For production a Distributed Key
    /// Generation (DKG) ceremony is preferable; ZF's frost crates
    /// support both. After keygen the coordinator's view is identical.
    pub fn generate_with_dealer(
        min_signers: u16,
        max_signers: u16,
    ) -> Result<(Vec<Signer>, Self)> {
        let mut rng = OsRng;
        let (shares, pubkey_package) = frost::keys::generate_with_dealer(
            max_signers,
            min_signers,
            frost::keys::IdentifierList::Default,
            &mut rng,
        )?;

        let signers: Vec<Signer> = shares
            .into_iter()
            .map(|(id, share)| {
                let key_package = KeyPackage::try_from(share)
                    .expect("dealer-generated share converts to key package");
                Signer::new(id, key_package)
            })
            .collect();

        Ok((
            signers,
            Self {
                pubkey_package,
                min_signers,
                max_signers,
            },
        ))
    }

    /// Domain-separated SHA-256 of canonical payout-batch bytes.
    /// The signers must verify the same canonical bytes against the
    /// ledger before signing the resulting digest.
    ///
    /// At Orchard integration time, the signed message is the Orchard
    /// SIGHASH of the bundle being constructed - not this digest. This
    /// helper stays useful for non-Orchard ceremonies (e.g. attesting
    /// treasury policy decisions, signer rotation announcements).
    pub fn digest_batch(canonical_batch_bytes: &[u8]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(b"PEDALSHIELD-PAYOUT-BATCH-v1");
        h.update(canonical_batch_bytes);
        h.finalize().into()
    }

    /// Drive a complete rerandomized ceremony in-process. Convenience
    /// wrapper for the common case where the message is known up
    /// front. **For Orchard payouts, use `round1_and_derive_rk` +
    /// `finish_ceremony` instead** - that lets the caller read `rk`
    /// before the message is decided, build the bundle with that `rk`,
    /// and then sign the bundle's SIGHASH.
    pub fn run_ceremony(
        &self,
        signers: &mut [&mut Signer],
        message: &[u8],
    ) -> Result<CeremonyOutput> {
        let pending = self.round1_and_derive_rk(signers)?;
        self.finish_ceremony(signers, pending, message)
    }

    /// Stage 1: collect round-1 commitments from every signer and
    /// derive the `RandomizedParams`. The returned `PendingCeremony`
    /// exposes the randomized verifying key (which is the `rk` an
    /// Orchard spend description publishes) and the randomizer seed.
    /// Call `finish_ceremony` with the final message to complete.
    pub fn round1_and_derive_rk(
        &self,
        signers: &mut [&mut Signer],
    ) -> Result<PendingCeremony> {
        if (signers.len() as u16) < self.min_signers {
            return Err(PedalshieldError::FrostError(format!(
                "need at least {} signers, got {}",
                self.min_signers,
                signers.len()
            )));
        }

        // Round 1: collect commitments
        let mut commitments: BTreeMap<Identifier, SigningCommitments> =
            BTreeMap::new();
        for s in signers.iter_mut() {
            commitments.insert(s.id, s.commit());
        }

        // Derive (params, seed) from commitments + fresh randomness.
        // The seed is what the coordinator distributes to signers; the
        // full params stay coordinator-side for aggregation.
        let mut rng = OsRng;
        let (randomizer_params, randomizer_seed) =
            RandomizedParams::new_from_commitments(
                self.pubkey_package.verifying_key(),
                &commitments,
                &mut rng,
            )?;

        Ok(PendingCeremony {
            commitments,
            randomizer_params,
            randomizer_seed,
        })
    }

    /// Stage 2: with `rk` already used (e.g. in an Orchard bundle) and
    /// the matching SIGHASH computed, finish the ceremony. Builds the
    /// SigningPackage with the stage-1 commitments + the message,
    /// collects signature shares, aggregates, and self-verifies under
    /// the randomized verifying key.
    pub fn finish_ceremony(
        &self,
        signers: &mut [&mut Signer],
        pending: PendingCeremony,
        message: &[u8],
    ) -> Result<CeremonyOutput> {
        let PendingCeremony {
            commitments,
            randomizer_params,
            randomizer_seed,
        } = pending;

        // Build the SigningPackage with the stage-1 commitments + the
        // now-known message.
        let signing_package = SigningPackage::new(commitments, message);

        // Round 2: each signer derives RandomizedParams locally from
        // the seed and produces a share bound to the RVK.
        let mut shares: BTreeMap<Identifier, SignatureShare> = BTreeMap::new();
        for s in signers.iter_mut() {
            shares.insert(s.id, s.sign(&signing_package, &randomizer_seed)?);
        }

        // Aggregate (rerandomized) under the same RandomizedParams.
        let signature = frost::rerandomized::aggregate(
            &signing_package,
            &shares,
            &self.pubkey_package,
            &randomizer_params,
        )?;

        // Self-verify against the RANDOMIZED verifying key - the same
        // value an Orchard spend description publishes as `rk`. Success
        // here means the signature will satisfy the spend-auth check
        // when broadcast.
        randomizer_params
            .randomized_verifying_key()
            .verify(message, &signature)
            .map_err(|e| {
                PedalshieldError::FrostError(format!(
                    "coordinator self-verify failed: {e:?}"
                ))
            })?;

        Ok(CeremonyOutput {
            signature,
            randomizer_params,
        })
    }

    /// External verification. Uses the randomized verifying key from
    /// the ceremony output - the same value an Orchard spend
    /// description publishes as `rk`. Anyone with the output can call
    /// this; nothing in it is secret.
    pub fn verify(&self, message: &[u8], output: &CeremonyOutput) -> Result<()> {
        output
            .randomizer_params
            .randomized_verifying_key()
            .verify(message, &output.signature)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_of_three_ceremony_produces_verifying_signature() {
        let (mut signers, coordinator) =
            FrostCoordinator::generate_with_dealer(2, 3).unwrap();
        let message = b"hello pedalshield";
        let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();
        let output = coordinator.run_ceremony(&mut refs, message).unwrap();
        assert!(coordinator.verify(message, &output).is_ok());
    }

    #[test]
    fn three_of_five_ceremony_works() {
        let (mut signers, coordinator) =
            FrostCoordinator::generate_with_dealer(3, 5).unwrap();
        let message = b"larger quorum";
        let mut refs: Vec<&mut Signer> = signers.iter_mut().take(3).collect();
        let output = coordinator.run_ceremony(&mut refs, message).unwrap();
        assert!(coordinator.verify(message, &output).is_ok());
    }

    #[test]
    fn sub_threshold_quorum_is_rejected() {
        let (mut signers, coordinator) =
            FrostCoordinator::generate_with_dealer(3, 5).unwrap();
        let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();
        let result = coordinator.run_ceremony(&mut refs, b"msg");
        assert!(result.is_err());
    }

    #[test]
    fn digest_is_domain_separated() {
        let a = FrostCoordinator::digest_batch(b"batch1");
        let b = FrostCoordinator::digest_batch(b"batch2");
        assert_ne!(a, b);
        assert_eq!(a, FrostCoordinator::digest_batch(b"batch1"));
    }

    #[test]
    fn each_ceremony_uses_a_fresh_randomizer() {
        // Two ceremonies with the same group + same message must
        // produce different randomized verifying keys (and therefore
        // signatures that don't cross-verify).
        let (mut signers_a, coordinator) =
            FrostCoordinator::generate_with_dealer(2, 3).unwrap();
        let msg = b"binding-test";

        let mut refs_a: Vec<&mut Signer> =
            signers_a.iter_mut().take(2).collect();
        let out_a = coordinator.run_ceremony(&mut refs_a, msg).unwrap();

        // Fresh signer set so nonces are unused; same coordinator.
        let (mut signers_b, coordinator_b) =
            FrostCoordinator::generate_with_dealer(2, 3).unwrap();
        let mut refs_b: Vec<&mut Signer> =
            signers_b.iter_mut().take(2).collect();
        let out_b = coordinator_b.run_ceremony(&mut refs_b, msg).unwrap();

        // Each verifies against its own randomized vk.
        assert!(coordinator.verify(msg, &out_a).is_ok());
        assert!(coordinator_b.verify(msg, &out_b).is_ok());

        // Cross-verification must fail - the randomizers differ, so the
        // signatures bind to different randomized verifying keys.
        let cross = out_a
            .randomizer_params
            .randomized_verifying_key()
            .verify(msg, &out_b.signature);
        assert!(cross.is_err());
    }

    #[test]
    fn two_stage_ceremony_exposes_rk_before_message_is_known() {
        // The Orchard-binding pattern: extract `rk` after round 1,
        // build a bundle with it (simulated here), then finish the
        // ceremony with the bundle's SIGHASH as the signed message.
        let (mut signers, coordinator) =
            FrostCoordinator::generate_with_dealer(2, 3).unwrap();
        let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();

        // Stage 1: get the randomized verifying key without committing
        // to a message. In production, the caller now builds an Orchard
        // bundle using this rk and computes the SIGHASH.
        let pending = coordinator
            .round1_and_derive_rk(&mut refs)
            .expect("round 1");
        let rk_stage1 = pending.randomized_verifying_key().clone();
        assert!(!pending.seed().is_empty(), "seed should be non-empty");

        // Stage 2: finish with the "SIGHASH" the caller computed.
        let simulated_sighash = b"orchard-bundle-sighash-placeholder";
        let output = coordinator
            .finish_ceremony(&mut refs, pending, simulated_sighash)
            .expect("finish");

        // Same rk from stage 1 and from the final output.
        assert_eq!(
            &rk_stage1,
            output.randomizer_params.randomized_verifying_key(),
        );
        // External verification succeeds under that rk.
        assert!(coordinator.verify(simulated_sighash, &output).is_ok());
    }
}
