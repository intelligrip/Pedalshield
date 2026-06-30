//! Price + carbon-peg oracle (the Rust side of `deploy/oracle.sh`).
//!
//! Zcash has no on-chain contracts, so the oracle is an off-chain, SIGNED
//! price service the treasury host runs. This module is the consumer: it
//! parses a [`PriceAttestation`], **verifies** its HMAC-SHA256 signature
//! against a shared secret, and exposes the two things the treasury needs:
//!
//!   * [`carbon_zat_per_km`] — the reward rate that makes a mile pay exactly
//!     the carbon value ($0.006/mile), given a ZEC/USD price. The same math
//!     `oracle.sh` runs, so a verified attestation's `zat_per_km` can be
//!     recomputed and cross-checked here.
//!   * [`carbon_miles_funded`] / [`value_zat_usd`] — VALUE an inbound miner
//!     contribution: how many dollars, and how many carbon-miles of rewards,
//!     a donation of N zatoshi funds at the attested price.
//!
//! Pure + unit-tested; no network. Fetching/median/signing lives in the
//! shell oracle; verification + valuation live here.

use crate::types::Zatoshi;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Carbon peg inputs (single source of truth; matches `oracle.sh`).
pub const USD_PER_LB_CO2: f64 = 0.006; // value of 1 lb CO2 not emitted
pub const LB_CO2_PER_MILE: f64 = 1.0; // CO2 avoided per mile biked vs. driven
pub const KM_PER_MILE: f64 = 1.609344;
pub const ZAT_PER_ZEC: f64 = 100_000_000.0;

/// Dollar value of a mile of riding under the carbon peg.
pub fn usd_per_mile() -> f64 {
    USD_PER_LB_CO2 * LB_CO2_PER_MILE
}

/// A signed price attestation as emitted by `deploy/oracle.sh`.
///
/// `payload` is the canonical string the signature is computed over:
/// `v1|price_usd=<p>|zat_per_km=<z>|n=<n>|ts=<ts>`. The backend verifies
/// `sig_hmac_sha256` over exactly this string before trusting any field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceAttestation {
    pub v: u32,
    pub price_usd: f64,
    pub sources: String,
    pub n: u32,
    pub zat_per_km: Zatoshi,
    pub ts: u64,
    pub payload: String,
    pub sig_hmac_sha256: String,
}

impl PriceAttestation {
    /// Verify the HMAC-SHA256 signature over `payload` with `secret`.
    /// Constant-time compare via the `hmac` crate's `verify_slice`.
    pub fn verify(&self, secret: &[u8]) -> bool {
        let mut mac = match HmacSha256::new_from_slice(secret) {
            Ok(m) => m,
            Err(_) => return false,
        };
        mac.update(self.payload.as_bytes());
        match hex::decode(self.sig_hmac_sha256.as_bytes()) {
            Ok(sig) => mac.verify_slice(&sig).is_ok(),
            Err(_) => false,
        }
    }

    /// True if the attestation's `zat_per_km` matches the carbon peg recomputed
    /// from its own `price_usd` (within 1 zat of rounding). Defends against a
    /// correctly-signed but internally-inconsistent attestation.
    pub fn peg_is_consistent(&self) -> bool {
        let expected = carbon_zat_per_km(self.price_usd);
        self.zat_per_km.abs_diff(expected) <= 1
    }
}

/// zat/km that makes a mile pay exactly the carbon value at `price_usd`.
/// Mirrors `oracle.sh` (verified: $470 -> 793 zat/km).
pub fn carbon_zat_per_km(price_usd: f64) -> Zatoshi {
    if !(price_usd > 0.0) {
        return 0;
    }
    let usd_per_km = usd_per_mile() / KM_PER_MILE;
    let zat = (usd_per_km / price_usd) * ZAT_PER_ZEC;
    if !zat.is_finite() || zat < 0.0 {
        0
    } else {
        (zat + 0.5) as Zatoshi
    }
}

/// USD value of `amount_zat` at `price_usd`.
pub fn value_zat_usd(amount_zat: Zatoshi, price_usd: f64) -> f64 {
    (amount_zat as f64 / ZAT_PER_ZEC) * price_usd.max(0.0)
}

/// How many carbon-miles of rewards an inbound contribution funds: its USD
/// value divided by the per-mile reward cost. This is how a miner donation is
/// "attested" into the pool — e.g. 0.1 ZEC at $470 funds ~7,833 rider-miles.
pub fn carbon_miles_funded(amount_zat: Zatoshi, price_usd: f64) -> f64 {
    let upm = usd_per_mile();
    if upm <= 0.0 {
        return 0.0;
    }
    value_zat_usd(amount_zat, price_usd) / upm
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peg_matches_shell_oracle_at_470() {
        // oracle.sh verified: $470 -> 793 zat/km.
        assert_eq!(carbon_zat_per_km(470.0), 793);
    }

    #[test]
    fn peg_rejects_nonpositive_price() {
        assert_eq!(carbon_zat_per_km(0.0), 0);
        assert_eq!(carbon_zat_per_km(-5.0), 0);
        assert_eq!(carbon_zat_per_km(f64::NAN), 0);
    }

    #[test]
    fn peg_scales_inversely_with_price() {
        // Cheaper ZEC -> more zat per km (same dollar value).
        assert!(carbon_zat_per_km(235.0) > carbon_zat_per_km(470.0));
    }

    #[test]
    fn value_and_miles_funded() {
        // 0.1 ZEC = 10_000_000 zat at $470 = $47.00.
        let v = value_zat_usd(10_000_000, 470.0);
        assert!((v - 47.0).abs() < 1e-9, "got {v}");
        // $47 / $0.006 per mile ≈ 7833.33 miles funded.
        let miles = carbon_miles_funded(10_000_000, 470.0);
        assert!((miles - 7833.333).abs() < 0.01, "got {miles}");
    }

    #[test]
    fn verify_accepts_good_sig_and_rejects_tampering() {
        // HMAC-SHA256("testkey", payload) computed by openssl in oracle.sh.
        let payload = "v1|price_usd=470|zat_per_km=793|n=1|ts=1782843462".to_string();
        let good = "3576f6db147ceabb125125ec64503f99ed73150b46b654a646dfab0f40d8b798";
        let att = PriceAttestation {
            v: 1,
            price_usd: 470.0,
            sources: "inject0".into(),
            n: 1,
            zat_per_km: 793,
            ts: 1782843462,
            payload: payload.clone(),
            sig_hmac_sha256: good.into(),
        };
        assert!(att.verify(b"testkey"));
        assert!(!att.verify(b"wrongkey"));
        assert!(att.peg_is_consistent());

        // Tampered signature must fail.
        let mut bad = att.clone();
        bad.sig_hmac_sha256 = "deadbeef".into();
        assert!(!bad.verify(b"testkey"));
    }

    #[test]
    fn inconsistent_peg_is_flagged() {
        let att = PriceAttestation {
            v: 1,
            price_usd: 470.0,
            sources: "x".into(),
            n: 1,
            zat_per_km: 9999, // wrong for this price
            ts: 0,
            payload: String::new(),
            sig_hmac_sha256: String::new(),
        };
        assert!(!att.peg_is_consistent());
    }
}
