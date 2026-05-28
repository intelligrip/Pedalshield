//! End-to-end Pedalshield treasury ceremony, in process.
//!
//! Run with:
//!
//!     cd zcash-service
//!     cargo run --bin treasury_demo
//!
//! Steps:
//!   1. Generate a FROST 2-of-3 key share group (trusted dealer).
//!   2. Build synthetic claims, run them through the anomaly check,
//!      and persist to the in-memory ledger.
//!   3. Aggregate pending claims into a payout batch grouped by UA.
//!   4. Canonical-serialise + domain-separated digest the batch.
//!   5. Run the rerandomized FROST 2-of-3 ceremony over the digest.
//!   6. External verification of the aggregated signature against the
//!      RANDOMIZED verifying key - the same value an Orchard spend
//!      description publishes as `rk`.
//!   7. Mark claims as paid in the ledger.
//!
//! Next chunk: bind this signature to a real Orchard bundle SIGHASH
//! and broadcast via lightwalletd. See `docs/ORCHARD_INTEGRATION.md`.

use pedalshield_treasury::{
    anomaly, compute_reward_zatoshi, now_ms, AnomalyConfig, Claim, ClaimLedger,
    FrostCoordinator, InMemoryLedger, PayoutBatch, PayoutRecipient, RideStatus,
    Signer,
};
use std::collections::HashMap;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Pedalshield treasury - in-process ceremony demo");
    println!("================================================\n");

    // 1. FROST 2-of-3 keygen
    let (mut signers, coordinator) =
        FrostCoordinator::generate_with_dealer(2, 3)?;
    println!(
        "[FROST] generated {}-of-{} key shares across {} signers",
        coordinator.min_signers,
        coordinator.max_signers,
        signers.len(),
    );
    println!(
        "[FROST] group (static) verifying key: {:?}\n",
        coordinator.pubkey_package.verifying_key()
    );

    // 2. Submit synthetic claims to the ledger via anomaly check
    let ledger = InMemoryLedger::new();
    let cfg = AnomalyConfig::default();
    let now = now_ms();
    let base_zatoshi_per_km: u64 = 5_000; // demo-calibrated

    let synthetic = vec![
        ("rider-alpha", "u1mockalphariderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 9.2_f64, 0.94_f64),
        ("rider-beta",  "u1mockbetariderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 15.8, 0.89),
        ("rider-gamma", "u1mockgammariderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 3.5, 0.72),
    ];

    for (rider_id, ua, km, score) in synthetic {
        let reward =
            compute_reward_zatoshi(km, score, base_zatoshi_per_km, 1.0, 1.0, 1.0);
        let claim = Claim {
            ride_id: format!("01HX{}", &rider_id.to_uppercase()),
            rider_id: rider_id.into(),
            rider_ua: ua.into(),
            started_at_ms: now - 30 * 60 * 1000,
            ended_at_ms: now,
            verified_km: km,
            integrity_score: score,
            status: RideStatus::Verified,
            reward_zatoshi: reward,
            submitted_at_ms: now,
        };
        anomaly::check_claim(&claim, &cfg)?;
        let id = ledger.submit(claim)?;
        println!(
            "[LEDGER] claim id={id} rider={rider_id} km={km:.1} score={score:.2} reward={reward} zatoshi"
        );
    }
    println!();

    // 3. Aggregate pending claims into a batch grouped by UA
    let pending = ledger.pending()?;
    println!("[BATCH] {} pending claims to batch", pending.len());

    let mut by_ua: HashMap<String, (u64, Vec<u64>)> = HashMap::new();
    for entry in &pending {
        let bucket = by_ua.entry(entry.claim.rider_ua.clone()).or_insert((0, Vec::new()));
        bucket.0 += entry.claim.reward_zatoshi;
        bucket.1.push(entry.claim_id);
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
        created_at_ms: now,
    };
    println!(
        "[BATCH] batch_id={} recipients={} total={} zatoshi",
        batch.batch_id,
        batch.recipient_count(),
        batch.total_zatoshi(),
    );

    // 4. Canonicalise + digest. The signers must verify the same
    //    canonical bytes against the ledger before signing. (At Orchard
    //    integration time, the signed message becomes the Orchard
    //    SIGHASH of the bundle being constructed.)
    let canonical = serde_json::to_vec(&batch)?;
    let digest = FrostCoordinator::digest_batch(&canonical);
    println!("[BATCH] digest = 0x{}\n", hex::encode(digest));

    // 5. Rerandomized FROST 2-of-3 ceremony over the digest
    println!("[FROST] running rerandomized 2-of-3 ceremony...");
    let mut signer_refs: Vec<&mut Signer> =
        signers.iter_mut().take(2).collect();
    let output = coordinator.run_ceremony(&mut signer_refs, &digest)?;
    println!("[FROST] signature aggregated and self-verified");
    println!(
        "[FROST] randomized verifying key (the on-chain `rk`): {:?}",
        output.randomizer_params.randomized_verifying_key()
    );

    // 6. External verification (anyone with the CeremonyOutput)
    coordinator.verify(&digest, &output)?;
    println!("[VERIFY] external verification passed\n");

    // 7. Mark all claims in the batch as paid (in production: after
    //    broadcast confirms on mainnet).
    let all_ids: Vec<u64> = batch
        .recipients
        .iter()
        .flat_map(|r| r.claim_ids.iter().copied())
        .collect();
    let demo_txid = format!("0x{}", hex::encode(&digest[..16]));
    ledger.mark_paid(&all_ids, batch.batch_id, &demo_txid)?;
    println!(
        "[LEDGER] marked {} claims paid (demo txid: {})",
        all_ids.len(),
        demo_txid,
    );

    println!(
        "\nNext chunk: bind this signature to a real Orchard bundle\nSIGHASH and broadcast via lightwalletd. See\ndocs/ORCHARD_INTEGRATION.md for the step-by-step path."
    );

    Ok(())
}
