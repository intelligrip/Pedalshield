//! Cross-ride anomaly detection.
//!
//! Server-side guard rails complementing the on-device integrity score:
//! caps on single-ride distance and daily volume, average-speed
//! envelope, minimum integrity score. The on-device check filters most
//! noise; this layer catches what the device alone can miss
//! (multi-ride aggregation, identical traces, etc).

use crate::error::{PedalshieldError, Result};
use crate::types::Claim;

#[derive(Debug, Clone)]
pub struct AnomalyConfig {
    pub max_km_per_day: f64,
    pub max_km_per_ride: f64,
    pub min_integrity_score: f64,
    pub max_avg_kmh: f64,
}

impl Default for AnomalyConfig {
    fn default() -> Self {
        Self {
            max_km_per_day: 250.0,    // generous century-plus
            max_km_per_ride: 220.0,
            min_integrity_score: 0.40,
            max_avg_kmh: 65.0,
        }
    }
}

pub fn check_claim(claim: &Claim, cfg: &AnomalyConfig) -> Result<()> {
    if claim.integrity_score < cfg.min_integrity_score {
        return Err(PedalshieldError::Anomaly(format!(
            "integrity score {} below threshold {}",
            claim.integrity_score, cfg.min_integrity_score
        )));
    }
    if claim.verified_km > cfg.max_km_per_ride {
        return Err(PedalshieldError::Anomaly(format!(
            "single-ride distance {:.1} km exceeds cap {:.1}",
            claim.verified_km, cfg.max_km_per_ride
        )));
    }
    let duration_s =
        claim.ended_at_ms.saturating_sub(claim.started_at_ms) as f64 / 1000.0;
    if duration_s > 1.0 {
        let avg_kmh = claim.verified_km / (duration_s / 3600.0);
        if avg_kmh > cfg.max_avg_kmh {
            return Err(PedalshieldError::Anomaly(format!(
                "average speed {avg_kmh:.1} km/h exceeds cap {:.1}",
                cfg.max_avg_kmh
            )));
        }
    }
    Ok(())
}

/// Sum of verified_km for claims submitted within the lookback window.
pub fn km_in_window(claims: &[Claim], window_ms: u64, now_ms: u64) -> f64 {
    claims
        .iter()
        .filter(|c| now_ms.saturating_sub(c.submitted_at_ms) <= window_ms)
        .map(|c| c.verified_km)
        .sum()
}

pub fn enforce_daily_cap(
    rider_claims: &[Claim],
    cfg: &AnomalyConfig,
    now_ms: u64,
) -> Result<()> {
    const DAY_MS: u64 = 24 * 60 * 60 * 1000;
    let total = km_in_window(rider_claims, DAY_MS, now_ms);
    if total > cfg.max_km_per_day {
        return Err(PedalshieldError::Anomaly(format!(
            "rider daily km {total:.1} exceeds cap {:.1}",
            cfg.max_km_per_day
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{compute_reward_zatoshi, now_ms, RideStatus};

    fn claim_for(km: f64, score: f64) -> Claim {
        let now = now_ms();
        Claim {
            ride_id: "test".into(),
            rider_id: "rider".into(),
            rider_ua: "u1mock".into(),
            started_at_ms: now - 30 * 60 * 1000,
            ended_at_ms: now,
            verified_km: km,
            integrity_score: score,
            status: RideStatus::Verified,
            reward_zatoshi: compute_reward_zatoshi(
                km, score, 5_000, 1.0, 1.0, 1.0,
            ),
            submitted_at_ms: now,
        }
    }

    #[test]
    fn passes_a_normal_ride() {
        let cfg = AnomalyConfig::default();
        assert!(check_claim(&claim_for(15.0, 0.9), &cfg).is_ok());
    }

    #[test]
    fn rejects_low_integrity_score() {
        let cfg = AnomalyConfig::default();
        assert!(check_claim(&claim_for(10.0, 0.30), &cfg).is_err());
    }

    #[test]
    fn rejects_implausibly_long_ride() {
        let cfg = AnomalyConfig::default();
        assert!(check_claim(&claim_for(500.0, 0.95), &cfg).is_err());
    }

    #[test]
    fn daily_cap_aggregates_across_claims() {
        let cfg = AnomalyConfig::default();
        let claims = vec![
            claim_for(100.0, 0.9),
            claim_for(100.0, 0.9),
            claim_for(60.0, 0.9),
        ];
        let now = now_ms();
        assert!(enforce_daily_cap(&claims, &cfg, now).is_err());
    }
}
