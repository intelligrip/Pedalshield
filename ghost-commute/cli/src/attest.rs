//! Ride attestations: what the rider's phone signs instead of uploading a route.
//!
//! An attestation is a small JSON object signed with the rider's Ed25519 key.
//! It contains distance (rounded down to 100 m), a time window (widened to
//! 15-minute boundaries), a coarse zone id, a few bucketed motion stats, a
//! salted commitment to the raw trace, and the payout address. It contains no
//! coordinates. See ARCHITECTURE.md for what that does and does not prove.

use anyhow::{anyhow, bail, ensure, Context, Result};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::canon::canonical;

pub const ATTEST_VERSION: &str = "ghost-commute/attest/1";
/// Distances are rounded down to this many metres before signing.
pub const DISTANCE_QUANTUM_M: u64 = 100;
/// Time windows are widened to multiples of this many seconds.
pub const WINDOW_QUANTUM_S: u64 = 900;

#[derive(Debug, Clone)]
pub struct Attestation {
    #[allow(dead_code)]
    pub raw: Value,
    pub rider_pk: [u8; 32],
    pub payout_ua: String,
    pub distance_m: u64,
    pub window_start: u64,
    pub window_end: u64,
    pub zone: String,
    pub verdict: String,
    pub check: String,
    pub route_commit: String,
    pub receipt_id: String,
}

fn get_str<'a>(v: &'a Value, k: &str) -> Result<&'a str> {
    v.get(k)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("attestation field `{k}` missing or not a string"))
}
fn get_u64(v: &Value, k: &str) -> Result<u64> {
    v.get(k)
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("attestation field `{k}` missing or not a non-negative integer"))
}
fn hex32(s: &str, what: &str) -> Result<[u8; 32]> {
    let b = hex::decode(s).with_context(|| format!("{what} is not hex"))?;
    b.try_into().map_err(|_| anyhow!("{what} must be 32 bytes"))
}

/// The bytes the rider signs: canonical JSON of the attestation minus `sig`.
pub fn signing_bytes(v: &Value) -> Result<Vec<u8>> {
    let mut unsigned = v.clone();
    unsigned
        .as_object_mut()
        .ok_or_else(|| anyhow!("attestation must be a JSON object"))?
        .remove("sig");
    Ok(canonical(&unsigned)?.into_bytes())
}

/// Receipt id: first 16 bytes of SHA-256 over the canonical *signed* attestation.
/// This is what the sponsor puts in the memo, binding the payment to the ride.
pub fn receipt_id(v: &Value) -> Result<String> {
    let c = canonical(v)?;
    Ok(hex::encode(&Sha256::digest(c.as_bytes())[..16]))
}

/// Parse and fully check an attestation: schema, rounding rules, and signature.
pub fn verify(v: &Value) -> Result<Attestation> {
    ensure!(get_str(v, "v")? == ATTEST_VERSION, "unknown attestation version");

    // Refuse anything that smells like location data. Belt and braces: the
    // schema has no place for it, but a buggy client could still add fields.
    for forbidden in ["lat", "lon", "lng", "coords", "points", "trace", "gpx", "path", "route"] {
        ensure!(
            v.get(forbidden).is_none(),
            "attestation contains a `{forbidden}` field; refusing to process location data"
        );
    }
    let allowed = [
        "v", "rider_pk", "payout_ua", "distance_m", "window", "zone", "motion",
        "route_commit", "nonce", "sig",
    ];
    for k in v.as_object().ok_or_else(|| anyhow!("not an object"))?.keys() {
        ensure!(allowed.contains(&k.as_str()), "unexpected attestation field `{k}`");
    }

    let rider_pk = hex32(get_str(v, "rider_pk")?, "rider_pk")?;
    let payout_ua = get_str(v, "payout_ua")?.to_string();
    let distance_m = get_u64(v, "distance_m")?;
    ensure!(distance_m % DISTANCE_QUANTUM_M == 0, "distance_m must be rounded to 100 m");
    let window = v.get("window").ok_or_else(|| anyhow!("missing window"))?;
    let window_start = get_u64(window, "start")?;
    let window_end = get_u64(window, "end")?;
    ensure!(
        window_start % WINDOW_QUANTUM_S == 0 && window_end % WINDOW_QUANTUM_S == 0,
        "time window must be widened to 15-minute boundaries"
    );
    ensure!(window_end > window_start, "empty time window");
    let zone = get_str(v, "zone")?.to_string();
    let motion = v.get("motion").ok_or_else(|| anyhow!("missing motion"))?;
    let verdict = get_str(motion, "verdict")?.to_string();
    let check = get_str(motion, "check")?.to_string();
    let route_commit = get_str(v, "route_commit")?.to_string();
    hex32(&route_commit, "route_commit")?;
    get_str(v, "nonce")?;

    let sig_bytes: [u8; 64] = hex::decode(get_str(v, "sig")?)
        .context("sig is not hex")?
        .try_into()
        .map_err(|_| anyhow!("sig must be 64 bytes"))?;
    let vk = VerifyingKey::from_bytes(&rider_pk).context("rider_pk is not a valid Ed25519 key")?;
    vk.verify(&signing_bytes(v)?, &Signature::from_bytes(&sig_bytes))
        .map_err(|_| anyhow!("rider signature does not verify"))?;

    Ok(Attestation {
        raw: v.clone(),
        rider_pk,
        payout_ua,
        distance_m,
        window_start,
        window_end,
        zone,
        verdict,
        check,
        route_commit,
        receipt_id: receipt_id(v)?,
    })
}

/// Sponsor-side policy on top of a valid signature.
pub fn require_bike(a: &Attestation) -> Result<()> {
    if a.verdict != "bike" {
        bail!("motion check verdict is `{}`, not `bike`; no payout", a.verdict);
    }
    Ok(())
}

/// Sign an attestation (tests only; the real signer is the phone, web/ghost-core.js).
#[allow(dead_code)]
pub fn sign(mut v: Value, sk: &ed25519_dalek::SigningKey) -> Result<Value> {
    use ed25519_dalek::Signer;
    let sig = sk.sign(&signing_bytes(&v)?);
    v.as_object_mut()
        .unwrap()
        .insert("sig".into(), Value::String(hex::encode(sig.to_bytes())));
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(sk: &ed25519_dalek::SigningKey) -> Value {
        sign(
            json!({
                "v": ATTEST_VERSION,
                "rider_pk": hex::encode(sk.verifying_key().to_bytes()),
                "payout_ua": "utest1example",
                "distance_m": 8400,
                "window": {"start": 1790000100 - 1790000100 % 900, "end": 1790003700 - 1790003700 % 900 + 900},
                "zone": "bend-or",
                "motion": {"verdict": "bike", "check": "prototype-v1", "median_kmh": 19, "p95_kmh": 29, "points": 400},
                "route_commit": "00".repeat(32),
                "nonce": "abcd",
            }),
            sk,
        )
        .unwrap()
    }

    #[test]
    fn roundtrip_and_tamper() {
        let sk = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
        let v = sample(&sk);
        let a = verify(&v).unwrap();
        assert_eq!(a.distance_m, 8400);
        let mut bad = v.clone();
        bad["distance_m"] = json!(84000);
        assert!(verify(&bad).is_err());
        let mut leaky = v.clone();
        leaky.as_object_mut().unwrap().insert("lat".into(), json!(44));
        assert!(verify(&leaky).is_err());
    }
}
