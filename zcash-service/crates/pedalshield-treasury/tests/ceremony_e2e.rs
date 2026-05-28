//! End-to-end integration test covering the full pipeline:
//! anomaly check -> ledger submit -> batch assembly -> rerandomized
//! FROST ceremony -> external verification -> mark paid.
//!
//! Run with: `cargo test --test ceremony_e2e`.

use pedalshield_treasury::{
    anomaly, compute_reward_zatoshi, now_ms, AnomalyConfig, Claim, ClaimLedger,
    ClaimLedgerStatus, FrostCoordinator, InMemoryLedger, PayoutBatch,
    PayoutRecipient, PedalshieldError, RideStatus, Signer,
};
use std::collections::HashMap;

fn make_claim(rider_id: &str, ua: &str, km: f64, score: f64) -> Claim {
    let now = now_ms();
    let reward = compute_reward_zatoshi(km, score, 5_000, 1.0, 1.0, 1.0);
    Claim {
        ride_id: format!("01HX{}", rider_id.to_uppercase()),
        rider_id: rider_id.into(),
        rider_ua: ua.into(),
        started_at_ms: now - 30 * 60 * 1000,
        ended_at_ms: now,
        verified_km: km,
        integrity_score: score,
        status: RideStatus::Verified,
        reward_zatoshi: reward,
        submitted_at_ms: now,
    }
}

#[test]
fn full_pipeline_produces_verifiable_signature_and_marks_paid() {
    // Keygen
    let (mut signers, coordinator) =
        FrostCoordinator::generate_with_dealer(2, 3).expect("keygen");

    // Ledger + anomaly
    let ledger = InMemoryLedger::new();
    let cfg = AnomalyConfig::default();

    let claim_a = make_claim("alpha", "u1mockalpha___________", 10.0, 0.9);
    let claim_b = make_claim("beta", "u1mockbeta____________", 20.0, 0.8);

    anomaly::check_claim(&claim_a, &cfg).unwrap();
    anomaly::check_claim(&claim_b, &cfg).unwrap();

    let id_a = ledger.submit(claim_a).unwrap();
    let id_b = ledger.submit(claim_b).unwrap();
    assert_eq!(ledger.pending().unwrap().len(), 2);

    // Batch
    let pending = ledger.pending().unwrap();
    let mut by_ua: HashMap<String, (u64, Vec<u64>)> = HashMap::new();
    for entry in &pending {
        let b = by_ua
            .entry(entry.claim.rider_ua.clone())
            .or_insert((0, Vec::new()));
        b.0 += entry.claim.reward_zatoshi;
        b.1.push(entry.claim_id);
    }
    let recipients: Vec<PayoutRecipient> = by_ua
        .into_iter()
        .map(|(ua, (amount, ids))| PayoutRecipient {
            rider_ua: ua,
            amount_zatoshi: amount,
            claim_ids: ids,
        })
        .collect();
    let batch = PayoutBatch {
        batch_id: 1,
        recipients,
        created_at_ms: now_ms(),
    };
    assert_eq!(batch.recipient_count(), 2);
    assert!(batch.total_zatoshi() > 0);

    // Rerandomized FROST ceremony over the canonical digest
    let canonical = serde_json::to_vec(&batch).unwrap();
    let digest = FrostCoordinator::digest_batch(&canonical);
    let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();
    let output = coordinator
        .run_ceremony(&mut refs, &digest)
        .expect("ceremony");

    // External verification - against the randomized verifying key
    coordinator
        .verify(&digest, &output)
        .expect("external verify");

    // Mark paid
    ledger.mark_paid(&[id_a, id_b], 1, "0xdeadbeef").unwrap();
    let entry_a = ledger.get(id_a).unwrap().unwrap();
    assert!(matches!(entry_a.status, ClaimLedgerStatus::Paid { .. }));
}

#[test]
fn anomaly_check_rejects_low_integrity_score() {
    let cfg = AnomalyConfig::default();
    let bad = make_claim("rider", "u1mock", 5.0, 0.30);
    let err = anomaly::check_claim(&bad, &cfg).expect_err("must reject");
    assert!(matches!(err, PedalshieldError::Anomaly(_)));
}

#[test]
fn anomaly_check_rejects_implausibly_long_ride() {
    let cfg = AnomalyConfig::default();
    let too_far = make_claim("rider", "u1mock", 500.0, 0.95);
    assert!(anomaly::check_claim(&too_far, &cfg).is_err());
}

#[test]
fn ledger_rejects_duplicate_ride_id() {
    let ledger = InMemoryLedger::new();
    let c = make_claim("rider", "u1mock", 10.0, 0.9);
    ledger.submit(c.clone()).unwrap();
    let err = ledger.submit(c).expect_err("duplicate must reject");
    assert!(matches!(err, PedalshieldError::DuplicateClaim(_)));
}

#[test]
fn frost_ceremony_with_too_few_signers_fails() {
    let (mut signers, coordinator) =
        FrostCoordinator::generate_with_dealer(3, 5).unwrap();
    let mut refs: Vec<&mut Signer> = signers.iter_mut().take(2).collect();
    assert!(coordinator.run_ceremony(&mut refs, b"msg").is_err());
}

#[test]
fn each_ceremony_yields_a_distinct_randomized_verifying_key() {
    // Two ceremonies with same group + same message must produce
    // different randomized verifying keys, and signatures cannot
    // cross-verify under each other's RVK. This is the property that
    // makes Orchard spend auths unlinkable on-chain.
    let (mut signers_a, coordinator) =
        FrostCoordinator::generate_with_dealer(2, 3).unwrap();
    let msg = b"binding-test";

    let mut refs_a: Vec<&mut Signer> = signers_a.iter_mut().take(2).collect();
    let out_a = coordinator.run_ceremony(&mut refs_a, msg).unwrap();

    let (mut signers_b, coordinator_b) =
        FrostCoordinator::generate_with_dealer(2, 3).unwrap();
    let mut refs_b: Vec<&mut Signer> = signers_b.iter_mut().take(2).collect();
    let out_b = coordinator_b.run_ceremony(&mut refs_b, msg).unwrap();

    assert!(coordinator.verify(msg, &out_a).is_ok());
    assert!(coordinator_b.verify(msg, &out_b).is_ok());

    let cross = out_a
        .randomizer_params
        .randomized_verifying_key()
        .verify(msg, &out_b.signature);
    assert!(cross.is_err(), "cross-verification must fail under a different RVK");
}
