//! Pedalshield domain types: claims, ledger entries, payout batches,
//! and the canonical reward formula.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Zatoshi - smallest Zcash unit. 1 ZEC = 100_000_000 zatoshi.
pub type Zatoshi = u64;

pub type RideId = String;
pub type RiderId = String;
pub type ClaimId = u64;
pub type BatchId = u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RideStatus {
    Verified,
    Review,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claim {
    pub ride_id: RideId,
    pub rider_id: RiderId,
    /// Rider's Unified Address with Orchard receiver.
    pub rider_ua: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    /// As computed by the on-device verifier.
    pub verified_km: f64,
    /// 0.0 ..= 1.0
    pub integrity_score: f64,
    pub status: RideStatus,
    /// Server-computed reward owed for this claim, in zatoshi.
    pub reward_zatoshi: Zatoshi,
    pub submitted_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaimLedgerStatus {
    Pending,
    Batched(BatchId),
    Paid { batch_id: BatchId, txid_hex: String },
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub claim_id: ClaimId,
    pub claim: Claim,
    pub status: ClaimLedgerStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayoutRecipient {
    pub rider_ua: String,
    pub amount_zatoshi: Zatoshi,
    pub claim_ids: Vec<ClaimId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayoutBatch {
    pub batch_id: BatchId,
    pub recipients: Vec<PayoutRecipient>,
    pub created_at_ms: u64,
}

impl PayoutBatch {
    pub fn total_zatoshi(&self) -> Zatoshi {
        self.recipients.iter().map(|r| r.amount_zatoshi).sum()
    }

    pub fn recipient_count(&self) -> usize {
        self.recipients.len()
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pedalshield reward formula.
///
/// ```text
/// reward = base_zatoshi_per_km * verified_km * integrity_score
///                              * trust * streak * upgrade
/// ```
///
/// Effort (`verified_km`) is the only linear, uncapped term; `upgrade`
/// is bounded at 1.15 elsewhere so ZEC upgrades cannot out-earn pedaling.
pub fn compute_reward_zatoshi(
    verified_km: f64,
    integrity_score: f64,
    base_zatoshi_per_km: Zatoshi,
    trust: f64,
    streak: f64,
    upgrade: f64,
) -> Zatoshi {
    let r = (base_zatoshi_per_km as f64)
        * verified_km.max(0.0)
        * integrity_score.clamp(0.0, 1.0)
        * trust.max(0.0)
        * streak.max(0.0)
        * upgrade.max(0.0);
    if !r.is_finite() || r < 0.0 {
        0
    } else {
        r as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_formula_basic() {
        // 10 km * score 0.9 * base 5_000 = 45_000 zatoshi
        let r = compute_reward_zatoshi(10.0, 0.9, 5_000, 1.0, 1.0, 1.0);
        assert_eq!(r, 45_000);
    }

    #[test]
    fn reward_formula_caps_score() {
        let r = compute_reward_zatoshi(10.0, 5.0, 5_000, 1.0, 1.0, 1.0);
        assert_eq!(r, 50_000); // score clamped to 1.0
    }

    #[test]
    fn reward_formula_rejects_negative_km() {
        assert_eq!(compute_reward_zatoshi(-5.0, 1.0, 5_000, 1.0, 1.0, 1.0), 0);
    }
}
