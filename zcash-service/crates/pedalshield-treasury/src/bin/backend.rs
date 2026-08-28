//! Pedalshield backend HTTP service (v0.5.1 skeleton).
//!
//! Today: accepts ride claims from the mobile app, validates the shape,
//! persists to sqlite, and exposes admin/health endpoints. Payouts are
//! NOT constructed here yet - that's v0.5.2 (lightwalletd connectivity)
//! and v0.5.3 (real Orchard spend construction). For now claims sit in
//! the `pending` state until we wire the payout pipeline.
//!
//! USAGE
//!
//!     cargo run --bin backend --release
//!
//! Optional env vars:
//!     PEDALSHIELD_DB         path to sqlite file (default: ./pedalshield.sqlite)
//!     PEDALSHIELD_PORT       port to bind (default: 8787)
//!     PEDALSHIELD_TREASURY_UA   the treasury UA to report on /treasury/info
//!     TREASURY_SPENDING_KEY_FILE path to treasury_spending_key.bin (informational
//!                                only at this stage; not used until v0.5.3)
//!
//! ENDPOINTS
//!
//!     GET  /healthz                       liveness check
//!     GET  /treasury/info                 treasury UA + status
//!     POST /claim                         accept a ride claim (queues for payout)
//!     GET  /claims                        admin: list claims, optional ?status=...
//!     GET  /claims/{id}                   fetch a single claim
//!     POST /claims/{id}/mark-paid         operator action: mark claim paid + record tx hash
//!     POST /claims/{id}/reject            operator action: reject a claim with a reason
//!     POST /settle                        accrual mode: run one settlement sweep now
//!     POST /withdraw/{ua}                 accrual mode: settle a recipient's balance now
//!     GET  /proof/{txid}                  public ride receipt (JSON, or HTML if Accept: text/html)
//!
//! All endpoints return JSON unless noted. Errors use HTTP status codes
//! (400 / 404 / 500) with a JSON body `{ "error": "..." }`.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

// ---------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------

type SharedDb = Arc<Mutex<Connection>>;

#[derive(Clone)]
struct AppState {
    db: SharedDb,
    treasury_ua: String,
    spending_key_path: Option<PathBuf>,
    /// lightwalletd gRPC endpoint used for autonomous payouts.
    lightwalletd: String,
    /// Treasury birthday height (deposit block) - scan start for payouts.
    birthday: u64,
    /// Payout rate: zatoshi per kilometre ridden.
    zat_per_km: u64,
    /// Hard cap on any single payout, in zatoshi.
    max_payout_zat: u64,
    /// Spend limits (security v0.6) — server-side ceilings that bound
    /// treasury loss while claim signatures are unverified. See post_claim.
    min_claim_interval_s: u64,
    require_signed_claims: bool,
    claim_signature_max_age_s: u64,
    ua_daily_meters: u64,
    global_daily_meters: u64,
    /// Treasury mechanism: progressive-trust multiplier + flat per-claim
    /// fee. Inert with stock config (see compute_payout_split).
    trust: TrustConfig,
    /// Serializes payouts so two claims never try to spend the same note
    /// before the first has been mined.
    payout_lock: Arc<tokio::sync::Mutex<()>>,
    /// When true, `POST /claim` fires the payout automatically (fully
    /// hands-off). When false, payouts only run via `POST /approve`.
    auto_payout: bool,
    /// When true, `POST /claim` credits an off-chain accrual balance
    /// instead of paying per ride; balances settle on-chain once they
    /// cross `payout_floor_zat` (or via `/withdraw`). See
    /// docs/SCALING_PAYOUTS.md. Takes precedence over `auto_payout`.
    accrual_mode: bool,
    /// Payout floor: a recipient's accrued balance settles on-chain once
    /// it reaches this many zatoshi. Default 1_000_000 (0.01 ZEC).
    payout_floor_zat: u64,
    /// Operator bearer token gating the admin endpoints (/approve, /claims
    /// list, /withdraw, /settle, /admin). Read from PEDALSHIELD_ADMIN_TOKEN.
    /// When None/empty those endpoints fail closed (locked).
    admin_token: Option<String>,
}

// ---------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct NewClaim {
    /// 26-char ULID-style ride id from the phone (matches what
    /// RideSession.newRideId() generates).
    claim_id: String,
    /// Recipient's mainnet UA (their Zashi address). Must start with `u1`.
    recipient_ua: String,
    /// Verified distance in whole meters.
    distance_meters: u64,
    /// Hex-encoded claim signature (rider's signing key over claim
    /// payload). Verified once we wire the rider keys; for v0.5.1 we
    /// store it but don't yet check it.
    signature: String,
    /// Optional device attestation token (Play Integrity / App Attest).
    attestation: Option<String>,
    /// Security v0.7: pseudonymous rider id issued by POST /rider/register.
    rider_id: Option<String>,
    /// Unix seconds the claim was signed (replay window).
    signed_at: Option<u64>,
    /// Integrity score from the on-device verifier (0..=1). Already part of
    /// the public ClaimPayload; stored so the public proof page can show it.
    /// Optional so older app builds keep working.
    #[serde(default)]
    integrity_score: Option<f64>,
    /// Wall-clock ride duration in seconds, derived from ClaimPayload
    /// `startedAt`/`endedAt`. Used only to compute average speed on the
    /// public proof page. We store the duration, never the timestamps —
    /// those would fingerprint time of day. Optional; omitted rather than
    /// widening ClaimPayload.
    #[serde(default)]
    duration_seconds: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ClaimRow {
    id: String,
    recipient_ua: String,
    distance_meters: u64,
    signature: String,
    #[serde(default)]
    rider_id: Option<String>,
    #[serde(default)]
    signed_at: Option<u64>,
    attestation: Option<String>,
    status: String,
    payout_txid: Option<String>,
    rejection_reason: Option<String>,
    /// The actual amount sent, in zatoshi. Recorded at payout time so the
    /// paid value never has to be reconstructed from a rate that may since
    /// have been re-pegged (which is what made the lifetime backfill
    /// approximate). Null on claims paid before this column existed.
    #[serde(default)]
    payout_zat: Option<u64>,
    /// Reward before the treasury mechanism, and what it withheld. Surfaced
    /// so the app can show the rider the full split — an invisible deduction
    /// is skimming, a visible one is membership.
    #[serde(default)]
    payout_gross_zat: Option<u64>,
    #[serde(default)]
    payout_withheld_zat: Option<u64>,
    #[serde(default)]
    trust_bps: Option<u32>,
    created_at: u64,
    updated_at: u64,
    /// On-device integrity score (0..=1). Absent on claims submitted
    /// before the public proof page existed.
    #[serde(default)]
    integrity_score: Option<f64>,
    /// Wall-clock duration in seconds. Absent on older claims; the public
    /// page omits average speed rather than inventing one.
    #[serde(default)]
    duration_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ClaimAcceptResponse {
    status: &'static str,
    claim_id: String,
}

#[derive(Debug, Serialize)]
struct TreasuryInfo {
    network: &'static str,
    treasury_ua: String,
    spending_key_loaded: bool,
    lightwalletd_connected: bool,
    balance_zatoshi: Option<u64>,
    /// Reward rate in zatoshi per kilometre. The mobile app uses this to
    /// show riders exactly how much ZEC they earn per mile / km.
    zat_per_km: u64,
    /// Hard cap on any single ride's reward, in zatoshi.
    max_payout_zat: u64,
    notes: &'static str,
}

#[derive(Debug, Serialize)]
struct Health {
    ok: bool,
    version: &'static str,
    pending_claims: u64,
    accrual_mode: bool,
}

#[derive(Debug, Deserialize)]
struct ClaimsQuery {
    /// pending | paid | rejected | all (default: all)
    status: Option<String>,
    /// max rows to return (default 100, max 500)
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct MarkPaidBody {
    /// 64-character hex Zcash mainnet transaction id from the operator's
    /// Zashi wallet (or any wallet that broadcast the payout).
    tx_hash: String,
}

#[derive(Debug, Deserialize)]
struct RejectBody {
    reason: String,
}

#[derive(Debug, Serialize)]
struct OperatorActionResponse {
    status: &'static str,
    claim_id: String,
}

#[derive(Debug, Serialize)]
struct ApiError {
    error: String,
}

enum AppError {
    BadRequest(String),
    NotFound(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (code, msg) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m),
        };
        (code, Json(ApiError { error: msg })).into_response()
    }
}

// ---------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------

fn validate_ua(ua: &str) -> Result<(), AppError> {
    if !ua.starts_with("u1") {
        return Err(AppError::BadRequest(
            "recipient_ua must be a mainnet UA starting with 'u1'".into(),
        ));
    }
    if ua.len() < 80 || ua.len() > 800 {
        return Err(AppError::BadRequest(format!(
            "recipient_ua length {} is implausible for a UA",
            ua.len()
        )));
    }
    // bech32m alphabet sanity: lowercase, no b/i/o/1 (except the '1'
    // separator after the 'u' prefix).
    for (i, c) in ua.chars().enumerate() {
        if !c.is_ascii_alphanumeric() || c.is_ascii_uppercase() {
            return Err(AppError::BadRequest(format!(
                "recipient_ua contains invalid char {:?} at position {}",
                c, i
            )));
        }
    }
    Ok(())
}

fn validate_tx_hash(tx: &str) -> Result<(), AppError> {
    // Zcash tx ids are 32-byte SHA-256 digests, hex-encoded => 64 chars.
    // Most block explorers also accept and display them in lowercase.
    if tx.len() != 64 {
        return Err(AppError::BadRequest(format!(
            "tx_hash must be 64 hex chars; got {} chars",
            tx.len()
        )));
    }
    for c in tx.chars() {
        if !c.is_ascii_hexdigit() {
            return Err(AppError::BadRequest(format!(
                "tx_hash contains non-hex char {c:?}"
            )));
        }
    }
    Ok(())
}

fn validate_distance(d: u64) -> Result<(), AppError> {
    if d == 0 {
        return Err(AppError::BadRequest("distance_meters must be > 0".into()));
    }
    if d > 200_000 {
        // 200 km is more than any single legitimate ride for the
        // payout cap we're shipping. Reject obvious bogus claims here
        // to keep the queue clean.
        return Err(AppError::BadRequest(format!(
            "distance_meters {} exceeds 200km cap",
            d
        )));
    }
    Ok(())
}

/// Drop an integrity score that isn't a real 0..=1 value rather than
/// rejecting the claim — a proof-page field must never fail a payout.
fn sanitize_integrity_score(v: Option<f64>) -> Option<f64> {
    v.filter(|s| s.is_finite() && (0.0..=1.0).contains(s))
        .map(|s| (s * 100.0).round() / 100.0)
}

/// Drop absurd durations. Cap is 24h, matching the per-claim distance cap
/// being a single ride, not a multi-day tour stored as one claim.
fn sanitize_duration_seconds(v: Option<u64>) -> Option<u64> {
    v.filter(|d| *d > 0 && *d <= 24 * 60 * 60)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS claims (
    id                TEXT PRIMARY KEY,
    recipient_ua      TEXT NOT NULL,
    distance_meters   INTEGER NOT NULL,
    signature         TEXT NOT NULL,
    rider_id          TEXT,
    signed_at         INTEGER,
    attestation       TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    payout_txid       TEXT,
    rejection_reason  TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_created ON claims(created_at);

-- Rider signing keys (security v0.7). A rider's app generates an Ed25519
-- keypair on first run, keeps the private half in the phone's
-- Secure-Enclave-protected keychain, and registers ONLY the public half
-- here. Every claim must carry a signature over the canonical claim
-- message, verified against this table. That turns anyone-can-POST-a-claim
-- into only-a-registered-device-can, and lets spend limits attach to a
-- stable rider identity instead of a self-declared address.
--
-- Deliberately NOT identity: the rider id is a random pseudonym, there is
-- no email/phone/name column, and the key says nothing about who holds it.
CREATE TABLE IF NOT EXISTS riders (
    rider_id      TEXT PRIMARY KEY,
    pubkey_b64    TEXT NOT NULL UNIQUE,
    recipient_ua  TEXT,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER NOT NULL,
    revoked       INTEGER NOT NULL DEFAULT 0
);

-- Optional, rider-chosen display name for the community leaderboard.
-- Keyed by recipient UA; the UA itself stays the source of truth.
CREATE TABLE IF NOT EXISTS handles (
    recipient_ua  TEXT PRIMARY KEY,
    handle        TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
);

-- Data co-op contributions (OPT-IN only; default off in the app).
-- PRIVACY: this table stores ONLY coarse, non-identifying aggregates that the
-- phone computes on-device. There is deliberately NO column for coordinates,
-- routes, raw sensor samples, or precise timestamps. distance/CO2 are coarse
-- buckets and hour_bucket is hour-of-day (0-23) with no date. The handler
-- rejects anything finer-grained. A rider opts in (consent_version) and may
-- revoke at any time; revocation just stops new rows being added.
CREATE TABLE IF NOT EXISTS coop_contributions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_ua        TEXT NOT NULL,
    consent_version     INTEGER NOT NULL,
    distance_bucket_km  INTEGER NOT NULL,
    hour_bucket         INTEGER NOT NULL,
    co2_grams           INTEGER NOT NULL,
    region              TEXT,
    created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coop_created ON coop_contributions(created_at);

-- Small key/value store for wallet scan state.
--
-- Today it holds exactly one key, 'scan_from_height': the block height the
-- next payout scan may safely start from, instead of the treasury birthday.
-- Payouts used to stream every block from the birthday to the tip (~68k
-- blocks and climbing by ~1150/day), which was the whole of the multi-minute
-- payout latency.
--
-- This is a CACHE, never an authority on funds: if a scan from the watermark
-- finds no spendable note, the spender silently rescans from the birthday.
-- Deleting this row is therefore always safe and just costs one slow payout.
CREATE TABLE IF NOT EXISTS wallet_state (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- App Attest, Tier 0 (security v0.8). See docs/ANTI_CHEAT_THREAT_MODEL.md.
--
-- One-time challenges. The challenge is what makes an attestation
-- unreplayable: generated here, bound into the signed object by Apple, and
-- accepted exactly once. Rows are consumed on use and swept by age.
CREATE TABLE IF NOT EXISTS attest_challenges (
    challenge   TEXT PRIMARY KEY,
    rider_id    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    used_at     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_attest_challenges_created
    ON attest_challenges(created_at);

-- Device attestations. PHASE A stores the raw object without verifying it,
-- so the verifier can be written and tested against real hardware output
-- instead of against a reading of Apple's spec. `verified` therefore stays
-- 0 until phase B lands; nothing may treat a row here as proof of
-- integrity while verified = 0.
--
-- public_key_b64 and sign_count are populated by the phase B verifier:
-- the P-256 key extracted from the attestation certificate, and Apple's
-- monotonic assertion counter used to reject replays.
CREATE TABLE IF NOT EXISTS rider_attestations (
    rider_id        TEXT PRIMARY KEY,
    key_id          TEXT NOT NULL,
    platform        TEXT NOT NULL,
    challenge       TEXT NOT NULL,
    attestation_b64 TEXT NOT NULL,
    public_key_b64  TEXT,
    sign_count      INTEGER NOT NULL DEFAULT 0,
    verified        INTEGER NOT NULL DEFAULT 0,
    reject_reason   TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
";

fn open_db(path: &PathBuf) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    // Accrual ledger tables (step 1 of docs/SCALING_PAYOUTS.md). Additive
    // and idempotent; harmless when accrual mode is off.
    pedalshield_treasury::accrual::ensure_schema(&conn)?;
    // Additive migration for databases created before security v0.7.
    // ALTER TABLE ADD COLUMN errors if the column exists; ignore that.
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN rider_id TEXT", []);
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN signed_at INTEGER", []);
    // Treasury mechanism + exact paid amount. Additive; errors when the
    // column already exists, which is expected and ignored.
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN payout_zat INTEGER", []);
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN payout_gross_zat INTEGER", []);
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN payout_withheld_zat INTEGER", []);
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN trust_bps INTEGER", []);
    // Public proof page: attested stats that already leave the phone in
    // ClaimPayload (integrity) or are derived from it (duration from
    // startedAt/endedAt). Additive; ignored when the column exists.
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN integrity_score REAL", []);
    let _ = conn.execute("ALTER TABLE claims ADD COLUMN duration_seconds INTEGER", []);
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_claims_payout_txid ON claims(payout_txid)",
        [],
    );

    // --- Crash recovery: un-stick claims abandoned mid-payout ----------
    // A claim moves pending -> paying before the (slow) scan + prove +
    // broadcast. If the process dies in that window — deploy, restart,
    // OOM, upgrade — the row stays `paying` forever: /approve refuses it
    // (not pending), the app's retry hits the same wall, and the rider is
    // silently owed money with no path to recovery. Found the hard way
    // during the Ironwood migration, where a restart stranded a claim.
    //
    // On startup nothing can legitimately be mid-payout (we are the only
    // payer and we just booted), so any `paying` row is by definition
    // abandoned: revert it to `pending` and let the normal path retry.
    match conn.execute(
        "UPDATE claims SET status = 'pending', updated_at = ?1,
             rejection_reason = 'auto-recovered: payout abandoned at restart'
         WHERE status = 'paying'",
        params![now_secs() as i64],
    ) {
        Ok(0) => {}
        Ok(n) => tracing::warn!(
            recovered = n,
            "startup recovery: reverted abandoned 'paying' claims to pending"
        ),
        Err(e) => tracing::error!(error = %e, "startup recovery failed"),
    }

    // --- Operator escape hatch: force an exhaustive scan ---------------
    // The scan watermark assumes the treasury only ever gains funds from
    // its own change outputs. Topping it up from an external wallet breaks
    // that assumption if the new note lands below the watermark. The
    // spender's fallback would catch it anyway, but this makes the intent
    // explicit and the first payout after a top-up predictable.
    if env::var("PEDALSHIELD_FULL_RESCAN").ok().as_deref() == Some("1") {
        clear_scan_from(&conn);
    }

    Ok(conn)
}

/// Distance already claimed in a rolling window, in metres.
///
/// SPEND LIMITS (security v0.6). Claim signatures are not yet verified
/// (`post_claim`), so ANY caller can POST a claim. Until claim signing +
/// App Attest land, these server-side ceilings are what actually bounds
/// the treasury's loss: they are enforced on the server, from the
/// server's own ledger, and no client assertion can raise them.
///
/// `ua_filter = Some(ua)` scopes the window to one recipient; `None`
/// totals every claim (the global budget).
fn claimed_meters_since(
    conn: &Connection,
    since_secs: u64,
    ua_filter: Option<&str>,
) -> Result<u64, rusqlite::Error> {
    let sum: Option<i64> = match ua_filter {
        Some(ua) => conn.query_row(
            "SELECT SUM(distance_meters) FROM claims
             WHERE created_at >= ?1 AND recipient_ua = ?2
               AND status IN ('pending','paying','paid')",
            params![since_secs as i64, ua],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT SUM(distance_meters) FROM claims
             WHERE created_at >= ?1
               AND status IN ('pending','paying','paid')",
            params![since_secs as i64],
            |r| r.get(0),
        )?,
    };
    Ok(sum.unwrap_or(0).max(0) as u64)
}

/// Seconds since this recipient's most recent claim, or None if first.
fn secs_since_last_claim(
    conn: &Connection,
    ua: &str,
    now: u64,
) -> Result<Option<u64>, rusqlite::Error> {
    let last: Option<i64> = conn.query_row(
        "SELECT MAX(created_at) FROM claims WHERE recipient_ua = ?1",
        params![ua],
        |r| r.get(0),
    )?;
    Ok(last.map(|t| now.saturating_sub(t.max(0) as u64)))
}


// ---------------------------------------------------------------------
// Rider claim signing (security v0.7)
// ---------------------------------------------------------------------

/// Registration request: the rider's app posts the PUBLIC half of a
/// keypair whose private half never leaves the device's keychain.
#[derive(Debug, Deserialize)]
struct RegisterRider {
    /// Base64 (standard, padded) 32-byte Ed25519 public key.
    pubkey_b64: String,
    /// Optional: bind this device to a payout address at registration.
    recipient_ua: Option<String>,
}

#[derive(Debug, Serialize)]
struct RegisterRiderResponse {
    rider_id: String,
    /// Echoed so the app can confirm what the server recorded.
    pubkey_b64: String,
}

/// Canonical message a rider signs. Field order and separator are part of
/// the protocol: any change breaks existing clients, so version it if it
/// must change. Includes `signed_at` so signatures expire, and the UA so
/// a captured signature cannot be redirected to a different wallet.
fn claim_signing_message(
    claim_id: &str,
    recipient_ua: &str,
    distance_meters: u64,
    signed_at: u64,
) -> String {
    format!(
        "pedalshield-claim-v1|{}|{}|{}|{}",
        claim_id, recipient_ua, distance_meters, signed_at
    )
}

/// Verify a base64 Ed25519 signature over the canonical claim message
/// against a registered rider's public key.
fn verify_claim_signature(
    pubkey_b64: &str,
    signature_b64: &str,
    message: &str,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let pk_bytes = STANDARD
        .decode(pubkey_b64)
        .map_err(|_| "stored pubkey is not valid base64".to_string())?;
    let pk_arr: [u8; 32] = pk_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "stored pubkey is not 32 bytes".to_string())?;
    let vk = VerifyingKey::from_bytes(&pk_arr)
        .map_err(|_| "stored pubkey is not a valid Ed25519 key".to_string())?;

    let sig_bytes = STANDARD
        .decode(signature_b64)
        .map_err(|_| "signature is not valid base64".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "signature is not 64 bytes".to_string())?;
    let sig = Signature::from_bytes(&sig_arr);

    vk.verify(message.as_bytes(), &sig)
        .map_err(|_| "signature does not verify".to_string())
}

/// Look up a rider's public key; None if unknown or revoked.
fn rider_pubkey(
    conn: &Connection,
    rider_id: &str,
) -> Result<Option<String>, rusqlite::Error> {
    let mut stmt = conn
        .prepare("SELECT pubkey_b64 FROM riders WHERE rider_id = ?1 AND revoked = 0")?;
    let mut rows = stmt.query(params![rider_id])?;
    Ok(match rows.next()? {
        Some(r) => Some(r.get(0)?),
        None => None,
    })
}

// --- App Attest (Tier 0, security v0.8) -------------------------------
//
// PHASE A ONLY. These endpoints issue challenges and record attestation
// objects; they do NOT verify them. Verification (CBOR decode, X.509 chain
// to Apple's App Attest root, nonce binding, App ID hash, key identifier
// match) lands in phase B, written against the real objects this phase
// collects. Until then `verified` stays 0 and nothing downstream may treat
// an attestation as evidence of anything.

/// How long a challenge stays usable. Short enough that a captured
/// challenge is worthless quickly, long enough to survive a slow network
/// and Apple's own attestation round-trip.
const ATTEST_CHALLENGE_TTL_S: u64 = 300;

#[derive(Deserialize)]
struct ChallengeQuery {
    rider_id: String,
}

#[derive(Serialize)]
struct ChallengeResponse {
    challenge: String,
    expires_in_s: u64,
}

/// GET /attest/challenge?rider_id=… — issue a one-time nonce.
///
/// 32 bytes from the OS CSPRNG. Apple requires at least 16; guessing must
/// be infeasible because the challenge is the only thing preventing an
/// attacker from replaying an attestation captured from a genuine device.
async fn attest_challenge_handler(
    State(state): State<AppState>,
    Query(q): Query<ChallengeQuery>,
) -> Result<Json<ChallengeResponse>, AppError> {
    use rand::{rngs::OsRng, RngCore};

    let now = now_secs();
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    let challenge = hex::encode(raw);

    let conn = state.db.lock().unwrap();
    // Opportunistic sweep: challenges are single-use and short-lived, so
    // expired rows are pure garbage. Cheap here, avoids a background task.
    let _ = conn.execute(
        "DELETE FROM attest_challenges WHERE created_at < ?1",
        params![(now.saturating_sub(ATTEST_CHALLENGE_TTL_S * 4)) as i64],
    );
    conn.execute(
        "INSERT INTO attest_challenges (challenge, rider_id, created_at)
         VALUES (?1, ?2, ?3)",
        params![challenge, q.rider_id, now as i64],
    )
    .map_err(|e| AppError::Internal(format!("db: {e}")))?;

    Ok(Json(ChallengeResponse {
        challenge,
        expires_in_s: ATTEST_CHALLENGE_TTL_S,
    }))
}

#[derive(Deserialize)]
struct AttestBody {
    rider_id: String,
    key_id: String,
    challenge: String,
    attestation: String,
    platform: Option<String>,
}

#[derive(Serialize)]
struct AttestResponse {
    stored: bool,
    verified: bool,
    /// Honest signal to the client: phase A records without verifying.
    note: &'static str,
}

/// POST /rider/attest — record a device attestation object.
///
/// The challenge IS enforced even in phase A: it must exist, belong to
/// this rider, be unexpired, and be unused. That costs nothing now and
/// means the samples we collect are genuine round-trips rather than
/// anything a client felt like posting.
async fn attest_register_handler(
    State(state): State<AppState>,
    Json(body): Json<AttestBody>,
) -> Result<Json<AttestResponse>, AppError> {
    if body.attestation.is_empty() || body.key_id.is_empty() {
        return Err(AppError::BadRequest("key_id and attestation required".into()));
    }
    // Bound the stored blob. Real attestation objects are a few KB; this
    // rejects anything trying to use the table as free storage.
    if body.attestation.len() > 32 * 1024 {
        return Err(AppError::BadRequest("attestation too large".into()));
    }

    let now = now_secs();
    let conn = state.db.lock().unwrap();

    // Rider must exist — attestation binds to a registered device identity.
    let known: Option<String> = conn
        .query_row(
            "SELECT rider_id FROM riders WHERE rider_id = ?1 AND revoked = 0",
            params![body.rider_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| AppError::Internal(format!("db: {e}")))?;
    if known.is_none() {
        return Err(AppError::BadRequest("unknown rider_id".into()));
    }

    // Consume the challenge: must match this rider, be fresh, be unused.
    let row: Option<(String, i64, Option<i64>)> = conn
        .query_row(
            "SELECT rider_id, created_at, used_at FROM attest_challenges
             WHERE challenge = ?1",
            params![body.challenge],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| AppError::Internal(format!("db: {e}")))?;

    let (chal_rider, created_at, used_at) =
        row.ok_or_else(|| AppError::BadRequest("unknown challenge".into()))?;
    if chal_rider != body.rider_id {
        return Err(AppError::BadRequest("challenge belongs to another rider".into()));
    }
    if used_at.is_some() {
        return Err(AppError::BadRequest("challenge already used".into()));
    }
    if now.saturating_sub(created_at as u64) > ATTEST_CHALLENGE_TTL_S {
        return Err(AppError::BadRequest("challenge expired".into()));
    }
    conn.execute(
        "UPDATE attest_challenges SET used_at = ?1 WHERE challenge = ?2",
        params![now as i64, body.challenge],
    )
    .map_err(|e| AppError::Internal(format!("db: {e}")))?;

    let platform = body.platform.unwrap_or_else(|| "ios".to_string());
    conn.execute(
        "INSERT INTO rider_attestations
            (rider_id, key_id, platform, challenge, attestation_b64,
             verified, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)
         ON CONFLICT(rider_id) DO UPDATE SET
             key_id          = excluded.key_id,
             platform        = excluded.platform,
             challenge       = excluded.challenge,
             attestation_b64 = excluded.attestation_b64,
             verified        = 0,
             reject_reason   = NULL,
             updated_at      = excluded.updated_at",
        params![
            body.rider_id,
            body.key_id,
            platform,
            body.challenge,
            body.attestation,
            now as i64
        ],
    )
    .map_err(|e| AppError::Internal(format!("db: {e}")))?;

    tracing::info!(
        rider_id = %body.rider_id,
        bytes = body.attestation.len(),
        "attestation recorded (phase A: stored, NOT verified)"
    );

    Ok(Json(AttestResponse {
        stored: true,
        verified: false,
        note: "phase A: attestation stored but not yet verified",
    }))
}

/// POST /rider/register — record a device public key, return a pseudonym.
async fn register_rider_handler(
    State(state): State<AppState>,
    Json(body): Json<RegisterRider>,
) -> Result<Json<RegisterRiderResponse>, AppError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let raw = STANDARD
        .decode(&body.pubkey_b64)
        .map_err(|_| AppError::BadRequest("pubkey_b64 must be base64".into()))?;
    if raw.len() != 32 {
        return Err(AppError::BadRequest(
            "pubkey must be a 32-byte Ed25519 public key".into(),
        ));
    }
    if let Some(ua) = body.recipient_ua.as_deref() {
        validate_ua(ua)?;
    }

    let now = now_secs();
    let conn = state.db.lock().unwrap();

    // Idempotent: re-registering the same key returns the same rider id,
    // so an app reinstall with a retained keychain keeps its identity.
    let existing: Option<String> = conn
        .query_row(
            "SELECT rider_id FROM riders WHERE pubkey_b64 = ?1",
            params![body.pubkey_b64],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| AppError::Internal(format!("db: {e}")))?;

    let rider_id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE riders SET last_seen_at = ?1 WHERE rider_id = ?2",
                params![now as i64, id],
            )
            .map_err(|e| AppError::Internal(format!("db: {e}")))?;
            id
        }
        None => {
            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO riders
                    (rider_id, pubkey_b64, recipient_ua, created_at, last_seen_at, revoked)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![id, body.pubkey_b64, body.recipient_ua, now as i64, now as i64],
            )
            .map_err(|e| AppError::Internal(format!("db: {e}")))?;
            tracing::info!(rider_id = %id, "new rider device registered");
            id
        }
    };

    Ok(Json(RegisterRiderResponse {
        rider_id,
        pubkey_b64: body.pubkey_b64,
    }))
}

fn insert_claim(conn: &Connection, c: &ClaimRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO claims
            (id, recipient_ua, distance_meters, signature, attestation,
             status, payout_txid, rejection_reason, created_at, updated_at,
             rider_id, signed_at, integrity_score, duration_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            c.id,
            c.recipient_ua,
            c.distance_meters as i64,
            c.signature,
            c.attestation,
            c.status,
            c.payout_txid,
            c.rejection_reason,
            c.created_at as i64,
            c.updated_at as i64,
            c.rider_id,
            c.signed_at.map(|t| t as i64),
            c.integrity_score,
            c.duration_seconds.map(|t| t as i64),
        ],
    )?;
    Ok(())
}

fn fetch_claim(conn: &Connection, id: &str) -> Result<Option<ClaimRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, recipient_ua, distance_meters, signature, attestation,
                status, payout_txid, rejection_reason, created_at, updated_at,
                payout_zat, payout_gross_zat, payout_withheld_zat, trust_bps
         FROM claims WHERE id = ?1",
    )?;
    let row = stmt
        .query_row([id], row_to_claim)
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    Ok(row)
}

fn list_claims(
    conn: &Connection,
    status_filter: Option<&str>,
    limit: u32,
) -> Result<Vec<ClaimRow>, rusqlite::Error> {
    let (sql, use_filter) = if let Some(_) = status_filter {
        (
            "SELECT id, recipient_ua, distance_meters, signature, attestation,
                    status, payout_txid, rejection_reason, created_at, updated_at
             FROM claims WHERE status = ?1
             ORDER BY created_at DESC LIMIT ?2",
            true,
        )
    } else {
        (
            "SELECT id, recipient_ua, distance_meters, signature, attestation,
                    status, payout_txid, rejection_reason, created_at, updated_at
             FROM claims ORDER BY created_at DESC LIMIT ?1",
            false,
        )
    };
    let mut stmt = conn.prepare(sql)?;
    let rows: Vec<ClaimRow> = if use_filter {
        stmt.query_map(
            params![status_filter.unwrap(), limit as i64],
            row_to_claim,
        )?
        .collect::<Result<_, _>>()?
    } else {
        stmt.query_map(params![limit as i64], row_to_claim)?
            .collect::<Result<_, _>>()?
    };
    Ok(rows)
}

/// Update a pending claim to paid + record the on-chain tx hash.
/// Returns Ok(true) on success, Ok(false) if the claim doesn't exist
/// or isn't in `pending` state.
fn mark_claim_paid(
    conn: &Connection,
    id: &str,
    tx_hash: &str,
) -> Result<bool, rusqlite::Error> {
    let now = now_secs() as i64;
    let n = conn.execute(
        "UPDATE claims
         SET status = 'paid', payout_txid = ?1, updated_at = ?2
         WHERE id = ?3 AND status = 'pending'",
        params![tx_hash, now, id],
    )?;
    Ok(n > 0)
}

/// Update a pending claim to rejected with a free-form reason.
fn reject_claim(
    conn: &Connection,
    id: &str,
    reason: &str,
) -> Result<bool, rusqlite::Error> {
    let now = now_secs() as i64;
    let n = conn.execute(
        "UPDATE claims
         SET status = 'rejected', rejection_reason = ?1, updated_at = ?2
         WHERE id = ?3 AND status = 'pending'",
        params![reason, now, id],
    )?;
    Ok(n > 0)
}

/// Atomically transition a claim from `pending` to `paying`. Returns true
/// only if this call won the race; concurrent or duplicate approve
/// requests get false and must not pay. This is the double-pay guard.
fn begin_paying(conn: &Connection, id: &str) -> Result<bool, rusqlite::Error> {
    let now = now_secs() as i64;
    let n = conn.execute(
        "UPDATE claims SET status = 'paying', updated_at = ?1
         WHERE id = ?2 AND status = 'pending'",
        params![now, id],
    )?;
    Ok(n > 0)
}

/// Mark a claim paid (only valid from the `paying` state) and record txid.
fn set_paid_from_paying(
    conn: &Connection,
    id: &str,
    txid: &str,
    split: &PayoutSplit,
) -> Result<bool, rusqlite::Error> {
    let now = now_secs() as i64;
    let n = conn.execute(
        "UPDATE claims SET status = 'paid', payout_txid = ?1, updated_at = ?2,
             payout_zat = ?4, payout_gross_zat = ?5,
             payout_withheld_zat = ?6, trust_bps = ?7
         WHERE id = ?3 AND status = 'paying'",
        params![
            txid,
            now,
            id,
            split.net_zat as i64,
            split.gross_zat as i64,
            split.withheld_zat as i64,
            split.trust_bps as i64
        ],
    )?;
    Ok(n > 0)
}

/// Revert a `paying` claim back to `pending` (so it can be retried) and
/// record the failure reason.
fn revert_to_pending(conn: &Connection, id: &str, reason: &str) -> Result<(), rusqlite::Error> {
    let now = now_secs() as i64;
    conn.execute(
        "UPDATE claims SET status = 'pending', rejection_reason = ?1, updated_at = ?2
         WHERE id = ?3 AND status = 'paying'",
        params![reason, now, id],
    )?;
    Ok(())
}

// --- wallet scan watermark -------------------------------------------
//
// See the `wallet_state` table comment in SCHEMA. The watermark makes
// payouts fast; the spender's automatic fallback to the birthday is what
// makes them correct. Nothing here is allowed to fail a payout: every
// read defaults to the birthday, and a failed write is logged, not
// propagated — a stale watermark costs one slow scan, while a payout that
// errors out costs a rider their money.

/// Blocks of slack between the tip at broadcast time and the watermark we
/// persist. Covers reorgs and guarantees the window still contains the
/// block our own change note lands in.
const WATERMARK_REORG_MARGIN: u64 = 100;

/// Height the next payout scan may start from. Falls back to `birthday`
/// when unset, unparseable, or below the birthday.
fn get_scan_from(conn: &Connection, birthday: u64) -> u64 {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM wallet_state WHERE key = 'scan_from_height'",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    stored
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(|h| h.max(birthday))
        .unwrap_or(birthday)
}

/// Advance the watermark after a successful broadcast. Monotonic: a lower
/// value is ignored, so an out-of-order or stale update can never drag the
/// window backwards past funds we already accounted for.
fn set_scan_from(conn: &Connection, height: u64) {
    let now = now_secs() as i64;
    let res = conn.execute(
        "INSERT INTO wallet_state (key, value, updated_at)
         VALUES ('scan_from_height', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at
         WHERE CAST(excluded.value AS INTEGER) > CAST(wallet_state.value AS INTEGER)",
        params![height.to_string(), now],
    );
    if let Err(e) = res {
        tracing::warn!(error = %e, height, "could not persist scan watermark (payout unaffected)");
    }
}

/// Drop the watermark so the next payout scans from the birthday. Called
/// on startup when PEDALSHIELD_FULL_RESCAN=1 — the operator's escape
/// hatch after topping up the treasury from an external wallet, where the
/// new note may sit below the current watermark.
fn clear_scan_from(conn: &Connection) {
    match conn.execute("DELETE FROM wallet_state WHERE key = 'scan_from_height'", []) {
        Ok(n) if n > 0 => tracing::info!("PEDALSHIELD_FULL_RESCAN=1: scan watermark cleared"),
        Ok(_) => tracing::info!("PEDALSHIELD_FULL_RESCAN=1: no watermark was set"),
        Err(e) => tracing::warn!(error = %e, "could not clear scan watermark"),
    }
}

fn count_pending(conn: &Connection) -> Result<u64, rusqlite::Error> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM claims WHERE status = 'pending'",
        [],
        |r| r.get(0),
    )?;
    Ok(n as u64)
}

fn fetch_accrual_balance(conn: &Connection, ua: &str) -> Result<Option<BalanceInfo>, rusqlite::Error> {
    let row: Option<(i64, i64, i64)> = conn
        .query_row(
            "SELECT pending_zat, lifetime_zat, rides_count FROM balances WHERE recipient_ua = ?1",
            params![ua],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    Ok(row.map(|(p, l, c)| BalanceInfo {
        recipient_ua: ua.to_string(),
        pending_zatoshi: p as u64,
        lifetime_zatoshi: l as u64,
        rides_count: c as u64,
    }))
}

fn row_to_claim(row: &rusqlite::Row) -> rusqlite::Result<ClaimRow> {
    Ok(ClaimRow {
        id: row.get(0)?,
        recipient_ua: row.get(1)?,
        distance_meters: row.get::<_, i64>(2)? as u64,
        signature: row.get(3)?,
        // Not selected by the positional queries that feed this mapper;
        // rider_id / signed_at matter at verification time (post_claim),
        // not when replaying a stored claim for payout. Kept None here so
        // existing SELECT column orders stay untouched.
        rider_id: None,
        signed_at: None,
        attestation: row.get(4)?,
        status: row.get(5)?,
        payout_txid: row.get(6)?,
        rejection_reason: row.get(7)?,
        created_at: row.get::<_, i64>(8)? as u64,
        updated_at: row.get::<_, i64>(9)? as u64,
        // Positional 10..13 — only the `fetch_claim` query selects these;
        // the list queries don't, so they're read defensively and default
        // to None rather than failing the whole row.
        payout_zat: row.get::<_, Option<i64>>(10).unwrap_or(None).map(|v| v as u64),
        payout_gross_zat: row.get::<_, Option<i64>>(11).unwrap_or(None).map(|v| v as u64),
        payout_withheld_zat: row.get::<_, Option<i64>>(12).unwrap_or(None).map(|v| v as u64),
        trust_bps: row.get::<_, Option<i64>>(13).unwrap_or(None).map(|v| v as u32),
        // Not selected by the positional payout queries; proof lookup uses
        // fetch_public_proof instead of this mapper.
        integrity_score: None,
        duration_seconds: None,
    })
}

// ---------------------------------------------------------------------
// Public proof page (txid → attested stats, no geo / no wallet)
// ---------------------------------------------------------------------

const EXPLORER_TX_BASE: &str = "https://mainnet.zcashexplorer.app/transactions/";

/// Public receipt for a paid ride. Deliberately omits recipient UA, rider
/// id, claim id (ULIDs encode time), created_at (time of day), signature,
/// and anything that could reconstruct a route or local loop.
#[derive(Debug, Serialize, Clone, PartialEq)]
struct PublicProof {
    txid: String,
    distance_meters: u64,
    verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    integrity_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payout_zat: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avg_speed_kmh: Option<f64>,
    explorer_url: String,
}

fn avg_speed_kmh(distance_meters: u64, duration_seconds: u64) -> Option<f64> {
    if duration_seconds == 0 {
        return None;
    }
    let kmh = (distance_meters as f64 / 1000.0) / (duration_seconds as f64 / 3600.0);
    if !kmh.is_finite() || kmh < 0.0 {
        return None;
    }
    Some((kmh * 10.0).round() / 10.0)
}

fn explorer_url_for(txid: &str) -> String {
    format!("{EXPLORER_TX_BASE}{txid}")
}

fn fetch_public_proof(
    conn: &Connection,
    txid: &str,
) -> Result<Option<PublicProof>, rusqlite::Error> {
    let row: Option<(i64, String, Option<i64>, Option<f64>, Option<i64>)> = conn
        .query_row(
            "SELECT distance_meters, status, payout_zat, integrity_score, duration_seconds
             FROM claims
             WHERE lower(payout_txid) = lower(?1) AND status = 'paid'
             LIMIT 1",
            params![txid],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(meters, status, payout_zat, integrity, duration)| {
        let duration = duration.and_then(|d| u64::try_from(d).ok());
        PublicProof {
            txid: txid.to_ascii_lowercase(),
            distance_meters: meters.max(0) as u64,
            verified: status == "paid",
            integrity_score: sanitize_integrity_score(integrity),
            payout_zat: payout_zat.and_then(|v| u64::try_from(v).ok()).filter(|v| *v > 0),
            avg_speed_kmh: duration.and_then(|d| avg_speed_kmh(meters.max(0) as u64, d)),
            explorer_url: explorer_url_for(&txid.to_ascii_lowercase()),
        }
    }))
}

fn wants_html(headers: &HeaderMap) -> bool {
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    // Browsers send text/html first. fetch() from the marketing site sets
    // Accept: application/json so it gets the machine-readable receipt.
    let html = accept.split(',').next().unwrap_or("").trim();
    html.starts_with("text/html")
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_proof_html(proof: &PublicProof) -> String {
    let txid = html_escape(&proof.txid);
    let explorer = html_escape(&proof.explorer_url);
    let km = proof.distance_meters as f64 / 1000.0;
    let miles = km / 1.609344;
    let dist = if km < 1.0 {
        format!("{} m", proof.distance_meters)
    } else {
        format!("{km:.2} km")
    };
    let dist_alt = format!("{miles:.2} mi");
    let integrity = proof
        .integrity_score
        .map(|s| format!("{s:.2}"))
        .unwrap_or_else(|| "—".into());
    let speed = proof
        .avg_speed_kmh
        .map(|v| format!("{v:.1} km/h"))
        .unwrap_or_else(|| "—".into());
    let payout = match proof.payout_zat {
        Some(zat) if zat > 0 => {
            let s = format!("{:.8}", zat as f64 / 1e8);
            let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
            format!("{s} ZEC")
        }
        _ => "—".into(),
    };
    let verified = if proof.verified { "Verified" } else { "Unverified" };
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ride proof — Pedalshield</title>
<meta name="robots" content="noindex" />
<style>
  :root {{ --bg:#0B1512; --panel:#132420; --line:rgba(255,255,255,.09);
    --mint:#2BD99F; --ink:#EAF6F0; --muted:#93A8A0; --dim:#6E8079; }}
  * {{ box-sizing:border-box; margin:0; padding:0 }}
  body {{ font-family: Inter, system-ui, sans-serif; background:var(--bg); color:var(--ink);
    line-height:1.55; min-height:100vh; padding:32px 20px 64px; }}
  .wrap {{ max-width:560px; margin:0 auto; }}
  .brand {{ font-weight:800; letter-spacing:-.02em; font-size:1.2rem; }}
  .brand span {{ color:var(--mint); }}
  h1 {{ font-size:1.7rem; font-weight:800; letter-spacing:-.03em; margin:28px 0 10px; }}
  .split {{ background:rgba(43,217,159,.1); border:1px solid rgba(43,217,159,.28);
    border-radius:14px; padding:14px 16px; color:var(--muted); font-size:.95rem; margin:18px 0 28px; }}
  .split b {{ color:var(--mint); font-weight:700; }}
  .card {{ background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:22px; }}
  .dist {{ font-size:2.6rem; font-weight:800; letter-spacing:-.04em; }}
  .dist span {{ font-size:1rem; color:var(--muted); font-weight:600; margin-left:8px; }}
  .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:22px; }}
  .lbl {{ font-size:.7rem; font-weight:700; letter-spacing:.08em; color:var(--dim); text-transform:uppercase; }}
  .val {{ font-size:1.15rem; font-weight:700; margin-top:4px; }}
  .ok {{ color:var(--mint); }}
  .txid {{ margin-top:22px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size:.78rem; color:var(--muted); word-break:break-all; }}
  a {{ color:var(--mint); font-weight:700; }}
  .foot {{ margin-top:22px; color:var(--dim); font-size:.85rem; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">Pedal<span>shield</span></div>
  <h1>Ride receipt</h1>
  <div class="split">
    The <a href="{explorer}">chain explorer</a> proves the payout moved.
    <b>This page proves what the phone attested.</b>
    No route, no coordinates, no time of day.
  </div>
  <div class="card">
    <div class="dist">{dist}<span>{dist_alt}</span></div>
    <div class="grid">
      <div><div class="lbl">Status</div><div class="val ok">{verified}</div></div>
      <div><div class="lbl">Integrity</div><div class="val">{integrity}</div></div>
      <div><div class="lbl">Avg speed</div><div class="val">{speed}</div></div>
      <div><div class="lbl">Payout</div><div class="val ok">{payout}</div></div>
    </div>
    <div class="txid">txid {txid}</div>
    <p style="margin-top:14px"><a href="{explorer}">View on Zcash explorer ›</a></p>
  </div>
  <p class="foot">Altitude, route, and start/end times are not part of a Pedalshield claim and are not shown here.</p>
</div>
</body>
</html>"#,
        explorer = explorer,
        dist = html_escape(&dist),
        dist_alt = html_escape(&dist_alt),
        verified = verified,
        integrity = html_escape(&integrity),
        speed = html_escape(&speed),
        payout = html_escape(&payout),
        txid = txid,
    )
}

async fn proof_handler(
    State(state): State<AppState>,
    Path(txid): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let txid = txid.trim().to_ascii_lowercase();
    validate_tx_hash(&txid)?;
    let proof = {
        let conn = state.db.lock().unwrap();
        fetch_public_proof(&conn, &txid)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };
    let proof = proof.ok_or_else(|| {
        AppError::NotFound(format!("no paid Pedalshield ride for txid {txid}"))
    })?;
    if wants_html(&headers) {
        Ok(Html(render_proof_html(&proof)).into_response())
    } else {
        Ok(Json(proof).into_response())
    }
}

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------

async fn healthz(State(state): State<AppState>) -> Result<Json<Health>, AppError> {
    let pending = {
        let conn = state.db.lock().unwrap();
        count_pending(&conn)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };
    Ok(Json(Health {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
        pending_claims: pending,
        accrual_mode: state.accrual_mode,
    }))
}

async fn treasury_info(State(state): State<AppState>) -> Json<TreasuryInfo> {
    let spending_key_loaded = state
        .spending_key_path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);
    Json(TreasuryInfo {
        network: "mainnet",
        treasury_ua: state.treasury_ua.clone(),
        spending_key_loaded,
        lightwalletd_connected: !state.lightwalletd.is_empty(),
        balance_zatoshi: None,
        zat_per_km: state.zat_per_km,
        max_payout_zat: state.max_payout_zat,
        notes: "Autonomous Orchard payouts are live: each verified claim \
                triggers a real shielded spend + broadcast via lightwalletd. \
                Rewards pegged to the EPA social cost of carbon (~$0.09/mile).",
    })
}

async fn post_claim(
    State(state): State<AppState>,
    Json(body): Json<NewClaim>,
) -> Result<(StatusCode, Json<ClaimAcceptResponse>), AppError> {
    // Basic validation; signature verification is v0.5.2.
    if body.claim_id.is_empty() {
        return Err(AppError::BadRequest("claim_id is required".into()));
    }
    if body.claim_id.len() > 64 {
        return Err(AppError::BadRequest("claim_id too long".into()));
    }
    validate_ua(&body.recipient_ua)?;
    validate_distance(body.distance_meters)?;
    if body.signature.is_empty() {
        return Err(AppError::BadRequest("signature is required".into()));
    }

    // --- CLAIM SIGNATURE VERIFICATION (security v0.7) --------------------
    // A registered device signs the canonical claim message with a key
    // held in the phone's Secure-Enclave-protected keychain. Verified
    // here, this is what makes the endpoint non-forgeable: an attacker
    // with curl has no registered key and cannot produce a signature.
    //
    // ROLLOUT: while PEDALSHIELD_REQUIRE_SIGNED_CLAIMS=0 (default during
    // the transition) unsigned legacy claims are accepted but logged, so
    // installed app builds keep working. Flip to 1 once riders are on a
    // signing build — that is the moment forgery actually dies.
    match (&body.rider_id, body.signed_at) {
        (Some(rider_id), Some(signed_at)) => {
            let now = now_secs();
            let skew = now.abs_diff(signed_at);
            if skew > state.claim_signature_max_age_s {
                return Err(AppError::BadRequest(format!(
                    "claim signature is stale ({}s old, max {}s)",
                    skew, state.claim_signature_max_age_s
                )));
            }
            let pubkey = {
                let conn = state.db.lock().unwrap();
                rider_pubkey(&conn, rider_id)
                    .map_err(|e| AppError::Internal(format!("db: {e}")))?
            };
            let pubkey = pubkey.ok_or_else(|| {
                AppError::BadRequest("unknown or revoked rider_id".into())
            })?;
            let msg = claim_signing_message(
                &body.claim_id,
                &body.recipient_ua,
                body.distance_meters,
                signed_at,
            );
            if let Err(why) =
                verify_claim_signature(&pubkey, &body.signature, &msg)
            {
                tracing::warn!(rider_id = %rider_id, %why, "claim signature REJECTED");
                return Err(AppError::BadRequest(format!(
                    "claim signature invalid: {why}"
                )));
            }
        }
        _ => {
            if state.require_signed_claims {
                return Err(AppError::BadRequest(
                    "this endpoint requires a signed claim (rider_id + signed_at); \
                     update the Pedalshield app"
                        .into(),
                ));
            }
            tracing::warn!(
                ua = %body.recipient_ua,
                "UNSIGNED claim accepted (legacy grace mode) — enable \
                 PEDALSHIELD_REQUIRE_SIGNED_CLAIMS once riders are updated"
            );
        }
    }

    // --- SPEND LIMITS (security v0.6) ------------------------------------
    // Enforced server-side, from our own ledger, before a claim is ever
    // queued for payout. These bound the treasury's exposure while claim
    // signatures remain unverified: a forged claim can at worst consume
    // one rider's daily allowance, and the global budget caps total daily
    // loss no matter how many identities an attacker invents.
    {
        let now = now_secs();
        let day_ago = now.saturating_sub(24 * 60 * 60);
        let conn = state.db.lock().unwrap();

        // 1. Per-rider cooldown: real rides take time; back-to-back claims
        //    from one address are either a retry (idempotent, handled by
        //    the claim_id primary key) or abuse.
        if let Some(elapsed) =
            secs_since_last_claim(&conn, &body.recipient_ua, now)
                .map_err(|e| AppError::Internal(format!("db: {e}")))?
        {
            if elapsed < state.min_claim_interval_s {
                return Err(AppError::BadRequest(format!(
                    "too soon: {}s since your last claim, minimum is {}s",
                    elapsed, state.min_claim_interval_s
                )));
            }
        }

        // 2. Per-rider daily distance allowance.
        let ua_today =
            claimed_meters_since(&conn, day_ago, Some(&body.recipient_ua))
                .map_err(|e| AppError::Internal(format!("db: {e}")))?;
        if ua_today + body.distance_meters > state.ua_daily_meters {
            return Err(AppError::BadRequest(format!(
                "daily limit reached for this address ({} m of {} m in 24h)",
                ua_today, state.ua_daily_meters
            )));
        }

        // 3. Global daily budget — the treasury's hard ceiling.
        let all_today = claimed_meters_since(&conn, day_ago, None)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?;
        if all_today + body.distance_meters > state.global_daily_meters {
            tracing::warn!(
                claimed_m = all_today,
                budget_m = state.global_daily_meters,
                "GLOBAL DAILY BUDGET reached — refusing further claims"
            );
            return Err(AppError::BadRequest(
                "the treasury's daily budget is exhausted; try again tomorrow"
                    .into(),
            ));
        }
    }

    // Use the client-supplied claim_id as the primary key so retries
    // are idempotent. Fall back to a server-side UUID if empty (we
    // already errored above, but defence-in-depth).
    let id = if body.claim_id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        body.claim_id.clone()
    };

    let now = now_secs();
    let row = ClaimRow {
        id: id.clone(),
        recipient_ua: body.recipient_ua,
        distance_meters: body.distance_meters,
        signature: body.signature,
        rider_id: body.rider_id,
        signed_at: body.signed_at,
        attestation: body.attestation,
        status: "pending".into(),
        payout_txid: None,
        rejection_reason: None,
        // A pending claim has no split yet — the trust tier is evaluated at
        // payout time, not at submission, so a rider who attests between
        // riding and being paid gets the better rate.
        payout_zat: None,
        payout_gross_zat: None,
        payout_withheld_zat: None,
        trust_bps: None,
        created_at: now,
        updated_at: now,
        integrity_score: sanitize_integrity_score(body.integrity_score),
        duration_seconds: sanitize_duration_seconds(body.duration_seconds),
    };

    {
        let conn = state.db.lock().unwrap();
        match insert_claim(&conn, &row) {
            Ok(()) => {}
            Err(rusqlite::Error::SqliteFailure(err, _))
                if err.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                // Duplicate claim_id - treat as idempotent ACK.
                tracing::info!(claim_id = %id, "duplicate claim - idempotent ack");
                return Ok((
                    StatusCode::OK,
                    Json(ClaimAcceptResponse {
                        status: "duplicate",
                        claim_id: id,
                    }),
                ));
            }
            Err(e) => return Err(AppError::Internal(format!("db: {e}"))),
        }
    }

    tracing::info!(
        claim_id = %id,
        meters = row.distance_meters,
        "claim accepted"
    );

    // Accrual path (docs/SCALING_PAYOUTS.md, step 1): credit the reward to
    // an off-chain balance instead of firing a per-ride spend. No on-chain
    // action, no ZIP-317 fee per ride. Settlement happens later, once the
    // balance crosses the floor, via the sweep / `/withdraw`. Takes
    // precedence over the per-claim auto-payout path.
    if state.accrual_mode {
        let amount = compute_payout(row.distance_meters, state.zat_per_km, state.max_payout_zat);
        let conn = state.db.lock().unwrap();
        pedalshield_treasury::accrual::accrue(&conn, &id, &row.recipient_ua, amount, now)
            .map_err(|e| AppError::Internal(format!("accrue: {e}")))?;
        tracing::info!(claim_id = %id, amount, "claim accrued (no on-chain action)");
        return Ok((
            StatusCode::ACCEPTED,
            Json(ClaimAcceptResponse {
                status: "accrued",
                claim_id: id,
            }),
        ));
    }

    // Fully autonomous path: fire the payout in the background and ACK
    // immediately (building + proving + broadcasting takes a few seconds).
    // The claim flips pending -> paying -> paid as it settles; poll
    // GET /claims/{id} for the txid.
    if state.auto_payout {
        let st = state.clone();
        let pid = id.clone();
        tokio::spawn(async move {
            match run_payout(st, pid.clone()).await {
                Ok(o) => tracing::info!(
                    claim_id = %pid, txid = %o.txid, amount = o.amount_zat,
                    "auto-payout complete"
                ),
                Err(e) => tracing::warn!(claim_id = %pid, "auto-payout failed: {}", e.msg(&pid)),
            }
        });
    }

    Ok((
        StatusCode::ACCEPTED,
        Json(ClaimAcceptResponse {
            status: if state.auto_payout { "paying" } else { "queued" },
            claim_id: id,
        }),
    ))
}

async fn list_claims_handler(
    State(state): State<AppState>,
    Query(q): Query<ClaimsQuery>,
) -> Result<Json<Vec<ClaimRow>>, AppError> {
    let limit = q.limit.unwrap_or(100).min(500);
    let status_filter = match q.status.as_deref() {
        Some("all") | None => None,
        Some(s @ ("pending" | "paid" | "rejected")) => Some(s),
        Some(other) => {
            return Err(AppError::BadRequest(format!(
                "invalid status '{}'; expected pending|paid|rejected|all",
                other
            )))
        }
    };
    let rows = {
        let conn = state.db.lock().unwrap();
        list_claims(&conn, status_filter, limit)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };
    Ok(Json(rows))
}

async fn get_claim_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ClaimRow>, AppError> {
    let row = {
        let conn = state.db.lock().unwrap();
        fetch_claim(&conn, &id)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };
    row.map(Json).ok_or_else(|| AppError::NotFound(format!("claim {id} not found")))
}

async fn mark_paid_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<MarkPaidBody>,
) -> Result<Json<OperatorActionResponse>, AppError> {
    let tx_hash = body.tx_hash.trim().to_lowercase();
    validate_tx_hash(&tx_hash)?;

    let updated = {
        let conn = state.db.lock().unwrap();
        // Ensure the claim exists first so we can return a 404 instead of
        // a misleading "not in pending state" if the operator typo's the id.
        let row = fetch_claim(&conn, &id)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?;
        if row.is_none() {
            return Err(AppError::NotFound(format!("claim {id} not found")));
        }
        mark_claim_paid(&conn, &id, &tx_hash)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };

    if !updated {
        return Err(AppError::BadRequest(format!(
            "claim {id} is not in `pending` state; refusing to overwrite"
        )));
    }

    tracing::info!(claim_id = %id, tx_hash = %tx_hash, "claim marked paid");
    Ok(Json(OperatorActionResponse {
        status: "paid",
        claim_id: id,
    }))
}

async fn admin_page() -> Html<&'static str> {
    Html(ADMIN_HTML)
}

const ADMIN_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pedalshield Treasury Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0A0E1A; --bg-elev: #141A2A; --bg-card: #1A2238;
    --text: #E6EBFF; --dim: #8993B5; --muted: #5A6485;
    --accent: #D946EF; --accent-soft: #A855F7;
    --success: #22D3A1; --warn: #FBBF24; --danger: #F87171;
    --border: #252D44;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text);
  }
  h1 { margin: 0 0 4px 0; font-size: 28px; letter-spacing: -0.5px; }
  .sub { color: var(--dim); margin-bottom: 24px; font-size: 14px; }
  .status-bar {
    display: flex; gap: 16px; align-items: center;
    padding: 12px 16px; background: var(--bg-elev);
    border: 1px solid var(--border); border-radius: 12px;
    margin-bottom: 24px; font-size: 13px;
  }
  .dot { width: 8px; height: 8px; border-radius: 4px; background: var(--success); }
  .pill {
    padding: 2px 10px; border-radius: 999px;
    font-weight: 700; font-size: 11px; letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .pill-pending { background: rgba(251, 191, 36, 0.15); color: var(--warn); }
  .pill-paid    { background: rgba(34, 211, 161, 0.15); color: var(--success); }
  .pill-reject  { background: rgba(248, 113, 113, 0.15); color: var(--danger); }
  .claim {
    background: var(--bg-elev); border: 1px solid var(--border);
    border-radius: 14px; padding: 16px 20px; margin-bottom: 14px;
  }
  .claim-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .claim-id { font-family: 'SF Mono', Menlo, monospace; font-size: 13px; color: var(--accent-soft); }
  .row { display: grid; grid-template-columns: 140px 1fr; gap: 8px; margin: 6px 0; font-size: 13px; }
  .row .k { color: var(--dim); }
  .row .v { color: var(--text); word-break: break-all; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
  .copy {
    margin-left: 8px; padding: 1px 8px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 4px; color: var(--accent-soft);
    font-size: 10px; cursor: pointer;
  }
  .copy:hover { color: var(--accent); }
  .actions { display: flex; gap: 10px; margin-top: 14px; }
  button.act {
    padding: 8px 16px; border-radius: 8px; border: none;
    font-weight: 700; font-size: 13px; cursor: pointer;
  }
  button.pay { background: var(--accent); color: var(--bg); }
  button.pay:hover { background: var(--accent-soft); }
  button.reject {
    background: transparent; color: var(--danger);
    border: 1px solid var(--danger);
  }
  button.reject:hover { background: rgba(248,113,113,0.1); }
  .empty {
    text-align: center; color: var(--muted);
    padding: 60px 20px; font-size: 14px;
  }
  .ts { color: var(--muted); font-size: 11px; }
  dialog {
    background: var(--bg-elev); color: var(--text);
    border: 1px solid var(--border); border-radius: 12px;
    padding: 24px; max-width: 480px; width: 90%;
  }
  dialog::backdrop { background: rgba(10,14,26,0.85); }
  dialog input, dialog textarea {
    width: 100%; padding: 8px 12px; margin: 8px 0;
    background: var(--bg-card); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px;
    font-family: 'SF Mono', Menlo, monospace; font-size: 12px;
  }
  dialog .dlg-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; }
  dialog button { padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 700; }
  dialog button.confirm { background: var(--accent); color: var(--bg); border: none; }
  dialog button.cancel { background: transparent; color: var(--dim); border: 1px solid var(--border); }
</style>
</head>
<body>
  <h1>Pedalshield Treasury</h1>
  <div class="sub">Diagnostics console &middot; v0.5.3 &middot; payouts are autonomous</div>

  <div class="status-bar">
    <span class="dot"></span>
    <span id="status">connecting...</span>
    <span style="flex:1"></span>
    <span class="ts" id="ts">--</span>
  </div>

  <div id="claims"></div>

  <dialog id="pay-dlg">
    <h3 style="margin:0 0 12px 0">Mark claim paid</h3>
    <div class="ts" id="pay-claim-id"></div>
    <p style="font-size:13px;color:var(--dim);line-height:20px">
      Diagnostics override only &mdash; payouts run autonomously. If a payout
      was completed out-of-band, paste the 64-char transaction id to flip the
      claim to <b>paid</b> with that hash recorded.
    </p>
    <input id="pay-txhash" placeholder="64-char hex tx hash" maxlength="64">
    <div class="dlg-actions">
      <button class="cancel" onclick="document.getElementById('pay-dlg').close()">Cancel</button>
      <button class="confirm" onclick="confirmPay()">Mark paid</button>
    </div>
  </dialog>

  <dialog id="reject-dlg">
    <h3 style="margin:0 0 12px 0">Reject claim</h3>
    <div class="ts" id="reject-claim-id"></div>
    <textarea id="reject-reason" rows="3" placeholder="Reason..."></textarea>
    <div class="dlg-actions">
      <button class="cancel" onclick="document.getElementById('reject-dlg').close()">Cancel</button>
      <button class="confirm" onclick="confirmReject()">Reject</button>
    </div>
  </dialog>

<script>
let currentClaimId = null;

async function tick() {
  try {
    const [health, claims] = await Promise.all([
      fetch('/healthz').then(r => r.json()),
      fetch('/claims?status=pending').then(r => r.json()),
    ]);
    document.getElementById('status').textContent =
      `backend up · v${health.version} · ${health.pending_claims} pending`;
    document.getElementById('ts').textContent = new Date().toLocaleTimeString();
    renderClaims(claims);
  } catch (e) {
    document.getElementById('status').textContent = 'backend unreachable: ' + e.message;
  }
}

function renderClaims(claims) {
  const el = document.getElementById('claims');
  if (!claims || claims.length === 0) {
    el.innerHTML = '<div class="empty">No pending claims. Take Pedalshield for a ride to queue one.</div>';
    return;
  }
  el.innerHTML = claims.map(c => `
    <div class="claim">
      <div class="claim-head">
        <span class="claim-id">${c.id}</span>
        <span class="pill pill-pending">pending</span>
      </div>
      <div class="row">
        <span class="k">Distance</span>
        <span class="v">${(c.distance_meters / 1000).toFixed(2)} km (${c.distance_meters} m)</span>
      </div>
      <div class="row">
        <span class="k">Recipient UA</span>
        <span class="v">${c.recipient_ua}<button class="copy" onclick="copy('${c.recipient_ua}')">copy</button></span>
      </div>
      <div class="row">
        <span class="k">Submitted</span>
        <span class="v">${new Date(c.created_at * 1000).toLocaleString()}</span>
      </div>
      <div class="actions">
        <button class="act pay" onclick="openPay('${c.id}')">Mark paid</button>
        <button class="act reject" onclick="openReject('${c.id}')">Reject</button>
      </div>
    </div>
  `).join('');
}

function copy(text) {
  navigator.clipboard.writeText(text);
}

function openPay(id) {
  currentClaimId = id;
  document.getElementById('pay-claim-id').textContent = id;
  document.getElementById('pay-txhash').value = '';
  document.getElementById('pay-dlg').showModal();
}

function openReject(id) {
  currentClaimId = id;
  document.getElementById('reject-claim-id').textContent = id;
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-dlg').showModal();
}

async function confirmPay() {
  const tx = document.getElementById('pay-txhash').value.trim().toLowerCase();
  if (tx.length !== 64) { alert('tx hash must be 64 hex chars'); return; }
  const r = await fetch(`/claims/${currentClaimId}/mark-paid`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({tx_hash: tx}),
  });
  if (!r.ok) { alert('failed: ' + await r.text()); return; }
  document.getElementById('pay-dlg').close();
  tick();
}

async function confirmReject() {
  const reason = document.getElementById('reject-reason').value.trim();
  if (!reason) { alert('reason is required'); return; }
  const r = await fetch(`/claims/${currentClaimId}/reject`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({reason}),
  });
  if (!r.ok) { alert('failed: ' + await r.text()); return; }
  document.getElementById('reject-dlg').close();
  tick();
}

tick();
setInterval(tick, 4000);
</script>
</body>
</html>"#;

async fn reject_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RejectBody>,
) -> Result<Json<OperatorActionResponse>, AppError> {
    if body.reason.is_empty() {
        return Err(AppError::BadRequest("reason is required".into()));
    }
    if body.reason.len() > 500 {
        return Err(AppError::BadRequest("reason exceeds 500 chars".into()));
    }

    let updated = {
        let conn = state.db.lock().unwrap();
        let row = fetch_claim(&conn, &id)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?;
        if row.is_none() {
            return Err(AppError::NotFound(format!("claim {id} not found")));
        }
        reject_claim(&conn, &id, &body.reason)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };

    if !updated {
        return Err(AppError::BadRequest(format!(
            "claim {id} is not in `pending` state; refusing to overwrite"
        )));
    }

    tracing::info!(claim_id = %id, reason = %body.reason, "claim rejected");
    Ok(Json(OperatorActionResponse {
        status: "rejected",
        claim_id: id,
    }))
}

// ---------------------------------------------------------------------
// Autonomous payout
// ---------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct PayoutResponse {
    status: &'static str,
    claim_id: String,
    amount_zatoshi: u64,
    txid: String,
}

/// Distance -> payout amount, in zatoshi, clamped to the configured cap.
fn compute_payout(distance_meters: u64, zat_per_km: u64, max_payout_zat: u64) -> u64 {
    let raw = (distance_meters.saturating_mul(zat_per_km)) / 1000;
    raw.min(max_payout_zat)
}

// --- Treasury mechanism: trust multiplier + flat claim fee ------------
//
// A deduction from a payout creates NO new money — withholding 10% is
// arithmetic-identical to paying 10% less. This exists as a MECHANISM, not
// as revenue, and it does two things heuristics can't:
//
//  1. FLAT FEE, per claim rather than per mile. Makes many tiny claims
//     strictly worse than fewer real rides, which inverts a farmer's
//     optimal strategy. Economic, so it has no false-positive rate.
//
//  2. TRUST MULTIPLIER, the progressive-trust item from the threat model.
//     A device with no attestation and no history earns at a reduced rate
//     until it accrues either. A fresh Sybil identity is therefore never
//     worth creating, and nothing has to DETECT anything.
//
// The withheld portion is never sent, so it costs no ZIP-317 fee — a
// separate on-chain movement would cost ~15-20k zat and dwarf any
// plausible deduction.
//
// DEFAULTS ARE A NO-OP. Fee 0, every trust tier 10000 bps (1.0x). Shipping
// a live deduction that silently cuts existing riders' earnings would be
// the third false promise this codebase has had to remove; the mechanism
// lands inert and is turned on deliberately.

/// One basis point = 1/10000. 10000 bps = 1.0x = no reduction.
pub const TRUST_BPS_FULL: u32 = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PayoutSplit {
    /// Reward before any deduction.
    pub gross_zat: u64,
    /// Trust multiplier actually applied, in basis points.
    pub trust_bps: u32,
    /// Flat per-claim fee applied after the multiplier.
    pub flat_fee_zat: u64,
    /// Total withheld (gross - net). Shown to the rider, never hidden.
    pub withheld_zat: u64,
    /// What is actually sent on-chain.
    pub net_zat: u64,
}

/// Apply the trust multiplier then the flat fee. Saturating throughout: a
/// misconfiguration must never underflow into a giant payout.
fn compute_payout_split(gross_zat: u64, trust_bps: u32, flat_fee_zat: u64) -> PayoutSplit {
    let after_trust = (gross_zat as u128 * trust_bps as u128 / TRUST_BPS_FULL as u128) as u64;
    let net = after_trust.saturating_sub(flat_fee_zat);
    PayoutSplit {
        gross_zat,
        trust_bps,
        flat_fee_zat,
        withheld_zat: gross_zat.saturating_sub(net),
        net_zat: net,
    }
}

/// Trust tier for a rider, in basis points.
///
/// Attestation outranks history: a hardware-attested device is a stronger
/// signal than any number of unverified rides, because history can be
/// manufactured and Secure Enclave attestation cannot. A rider with neither
/// still earns — just at the reduced rate — because "new" is not "fraudulent"
/// and refusing to pay a genuine first-time rider is how you lose them.
fn trust_bps_for(
    conn: &Connection,
    recipient_ua: &str,
    rider_id: Option<&str>,
    cfg: &TrustConfig,
) -> u32 {
    if let Some(rid) = rider_id {
        let attested: Option<i64> = conn
            .query_row(
                "SELECT verified FROM rider_attestations WHERE rider_id = ?1",
                params![rid],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        if attested == Some(1) {
            return cfg.attested_bps;
        }
    }

    let paid: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM claims WHERE recipient_ua = ?1 AND status = 'paid'",
            params![recipient_ua],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if paid as u64 >= cfg.history_rides {
        cfg.history_bps
    } else {
        cfg.new_bps
    }
}

#[derive(Debug, Clone, Copy)]
struct TrustConfig {
    new_bps: u32,
    history_bps: u32,
    attested_bps: u32,
    history_rides: u64,
    flat_fee_zat: u64,
}

impl TrustConfig {
    fn from_env() -> Self {
        let get = |k: &str, d: u32| {
            env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d)
        };
        Self {
            new_bps: get("PEDALSHIELD_TRUST_NEW_BPS", TRUST_BPS_FULL),
            history_bps: get("PEDALSHIELD_TRUST_HISTORY_BPS", TRUST_BPS_FULL),
            attested_bps: get("PEDALSHIELD_TRUST_ATTESTED_BPS", TRUST_BPS_FULL),
            history_rides: env::var("PEDALSHIELD_TRUST_HISTORY_RIDES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            flat_fee_zat: env::var("PEDALSHIELD_FLAT_FEE_ZAT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        }
    }
}

#[cfg(test)]
mod split_tests {
    use super::*;

    #[test]
    fn defaults_are_a_no_op() {
        let s = compute_payout_split(30_000, TRUST_BPS_FULL, 0);
        assert_eq!(s.net_zat, 30_000);
        assert_eq!(s.withheld_zat, 0);
    }

    #[test]
    fn trust_multiplier_reduces_proportionally() {
        let s = compute_payout_split(30_000, 5_000, 0); // 0.5x
        assert_eq!(s.net_zat, 15_000);
        assert_eq!(s.withheld_zat, 15_000);
    }

    #[test]
    fn flat_fee_applies_after_the_multiplier() {
        let s = compute_payout_split(30_000, 5_000, 1_000);
        assert_eq!(s.net_zat, 14_000);
    }

    #[test]
    fn a_fee_larger_than_the_reward_floors_at_zero() {
        // Must never underflow into an enormous payout.
        let s = compute_payout_split(500, TRUST_BPS_FULL, 10_000);
        assert_eq!(s.net_zat, 0);
        assert_eq!(s.withheld_zat, 500);
    }

    #[test]
    fn gross_and_net_always_reconcile() {
        for gross in [0u64, 1, 500, 30_000, u64::MAX / 2] {
            for bps in [0u32, 2_500, 10_000] {
                for fee in [0u64, 1_000] {
                    let s = compute_payout_split(gross, bps, fee);
                    assert_eq!(s.net_zat + s.withheld_zat, s.gross_zat);
                }
            }
        }
    }
}

#[cfg(test)]
mod proof_tests {
    use super::*;
    use serde_json::Value;

    const TXID: &str = "2a849aca04f9b9661ec826c22db97edfb988a22fc7ce7432a651abbc08b264ab";
    const UA: &str = "u1testaddressaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn mem_db() -> Connection {
        open_db(&PathBuf::from(":memory:")).expect("in-memory db")
    }

    fn paid_row(
        txid: &str,
        meters: u64,
        zat: Option<u64>,
        score: Option<f64>,
        duration: Option<u64>,
    ) -> ClaimRow {
        let now = 1_700_000_000;
        ClaimRow {
            id: format!("ride-{txid}"),
            recipient_ua: UA.into(),
            distance_meters: meters,
            signature: "sig".into(),
            rider_id: Some("rider-secret".into()),
            signed_at: Some(now),
            attestation: None,
            status: "paid".into(),
            payout_txid: Some(txid.into()),
            rejection_reason: None,
            payout_zat: zat,
            payout_gross_zat: zat,
            payout_withheld_zat: Some(0),
            trust_bps: Some(10_000),
            created_at: now,
            updated_at: now,
            integrity_score: score,
            duration_seconds: duration,
        }
    }

    #[test]
    fn public_proof_shows_attested_stats_and_hides_identity() {
        let conn = mem_db();
        insert_claim(&conn, &paid_row(TXID, 492, Some(390), Some(0.94), Some(180))).unwrap();

        let proof = fetch_public_proof(&conn, TXID).unwrap().expect("found");
        assert_eq!(proof.distance_meters, 492);
        assert!(proof.verified);
        assert_eq!(proof.integrity_score, Some(0.94));
        assert_eq!(proof.payout_zat, Some(390));
        assert_eq!(proof.avg_speed_kmh, Some(9.8)); // 0.492 km / 0.05 h
        assert_eq!(
            proof.explorer_url,
            format!("https://mainnet.zcashexplorer.app/transactions/{TXID}")
        );

        let json = serde_json::to_value(&proof).unwrap();
        let obj = json.as_object().expect("object");
        let keys: Vec<_> = obj.keys().cloned().collect();
        for forbidden in [
            "recipient_ua",
            "rider_id",
            "signature",
            "created_at",
            "updated_at",
            "id",
            "claim_id",
            "lat",
            "lon",
            "altitude",
            "barometer",
            "accel",
            "gyro",
            "pedometer",
            "pressure",
            "startedAt",
            "endedAt",
            "duration_seconds",
        ] {
            assert!(!obj.contains_key(forbidden), "leaked {forbidden}");
        }
        assert!(keys.contains(&"txid".to_string()));
        assert!(keys.contains(&"distance_meters".to_string()));
        assert!(keys.contains(&"verified".to_string()));
        assert!(keys.contains(&"explorer_url".to_string()));
    }

    #[test]
    fn missing_duration_omits_average_speed() {
        let conn = mem_db();
        insert_claim(&conn, &paid_row(TXID, 492, Some(390), Some(0.9), None)).unwrap();
        let proof = fetch_public_proof(&conn, TXID).unwrap().unwrap();
        assert_eq!(proof.avg_speed_kmh, None);
        let json = serde_json::to_value(&proof).unwrap();
        assert!(json.get("avg_speed_kmh").is_none());
    }

    #[test]
    fn unpaid_claims_are_not_public() {
        let conn = mem_db();
        let mut row = paid_row(TXID, 492, None, None, None);
        row.status = "pending".into();
        insert_claim(&conn, &row).unwrap();
        assert!(fetch_public_proof(&conn, TXID).unwrap().is_none());
    }

    #[test]
    fn lookup_is_case_insensitive_and_does_not_embed_the_ua() {
        let conn = mem_db();
        insert_claim(&conn, &paid_row(TXID, 1500, Some(1_193), None, None)).unwrap();
        let proof = fetch_public_proof(&conn, &TXID.to_ascii_uppercase())
            .unwrap()
            .unwrap();
        assert_eq!(proof.distance_meters, 1500);
        let html = render_proof_html(&proof);
        assert!(!html.contains(UA), "wallet UA leaked into HTML");
        assert!(!html.to_ascii_lowercase().contains("altitude"));
        assert!(!html.to_ascii_lowercase().contains("barometer"));
        assert!(!html.contains("lat"));
        assert!(html.contains("chain explorer"));
        assert!(html.contains("phone attested"));
        assert!(html.contains("View on Zcash explorer"));
    }

    #[test]
    fn json_value_never_includes_geo_keys() {
        let proof = PublicProof {
            txid: TXID.into(),
            distance_meters: 492,
            verified: true,
            integrity_score: Some(0.91),
            payout_zat: Some(390),
            avg_speed_kmh: Some(12.4),
            explorer_url: explorer_url_for(TXID),
        };
        let dumped = serde_json::to_string(&proof).unwrap();
        for needle in ["\"lat\"", "\"lon\"", "accel", "gyro", "barometer", "pedometer", "pressure"] {
            assert!(!dumped.contains(needle), "{needle} in {dumped}");
        }
        let v: Value = serde_json::from_str(&dumped).unwrap();
        assert_eq!(v["verified"], true);
    }

    #[test]
    fn sanitize_drops_out_of_range_optional_fields() {
        assert_eq!(sanitize_integrity_score(Some(1.2)), None);
        assert_eq!(sanitize_integrity_score(Some(-0.1)), None);
        assert_eq!(sanitize_integrity_score(Some(0.941)), Some(0.94));
        assert_eq!(sanitize_duration_seconds(Some(0)), None);
        assert_eq!(sanitize_duration_seconds(Some(86_401)), None);
        assert_eq!(sanitize_duration_seconds(Some(180)), Some(180));
    }

    #[test]
    fn wants_html_from_browser_accept_not_from_json_clients() {
        let mut browser = HeaderMap::new();
        browser.insert(
            header::ACCEPT,
            "text/html,application/xhtml+xml;q=0.9".parse().unwrap(),
        );
        assert!(wants_html(&browser));

        let mut api = HeaderMap::new();
        api.insert(header::ACCEPT, "application/json".parse().unwrap());
        assert!(!wants_html(&api));
        assert!(!wants_html(&HeaderMap::new()));
    }
}

/// One-time backfill of lifetime totals for rides that were paid before
/// `record_direct_payout` existed.
///
/// Auto-payout mode never wrote to `balances`, so every already-paid claim
/// is missing from lifetime totals AND from the leaderboard, which reads
/// the same tables. Without this, the fix only counts rides from today
/// forward and a rider's history silently vanishes.
///
/// CAVEAT, deliberately logged: `claims` never stored the amount actually
/// paid, so historical rewards are RECONSTRUCTED at the current rate. If
/// the rate has been re-pegged since a ride, its credited value is an
/// approximation of what was really sent on-chain. The txid in `claims` is
/// the authoritative record; this figure is for display.
///
/// Idempotent: the `accruals` primary key means re-running credits nothing
/// twice, so a restart loop cannot inflate anyone's total.
fn backfill_lifetime_totals(conn: &Connection, zat_per_km: u64, max_payout_zat: u64) {
    let rows: Result<Vec<(String, String, u64, Option<String>, i64)>, rusqlite::Error> = (|| {
        let mut stmt = conn.prepare(
            "SELECT id, recipient_ua, distance_meters, payout_txid, updated_at
             FROM claims WHERE status = 'paid'",
        )?;
        let r = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get::<_, i64>(2)? as u64,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(r)
    })();

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "lifetime backfill skipped (query failed)");
            return;
        }
    };

    let mut credited = 0usize;
    let mut total = 0u64;
    for (id, ua, meters, txid, updated_at) in rows {
        let amount = compute_payout(meters, zat_per_km, max_payout_zat);
        if amount == 0 {
            continue;
        }
        match pedalshield_treasury::accrual::record_direct_payout(
            conn,
            &id,
            &ua,
            amount,
            txid.as_deref().unwrap_or(""),
            updated_at.max(0) as u64,
        ) {
            Ok(true) => {
                credited += 1;
                total += amount;
            }
            Ok(false) => {} // already counted
            Err(e) => tracing::warn!(claim_id = %id, error = %e, "backfill row failed"),
        }
    }

    if credited > 0 {
        tracing::info!(
            rides = credited,
            zatoshi = total,
            "lifetime backfill: credited previously-paid rides (amounts reconstructed at the CURRENT rate; txids in `claims` remain authoritative)"
        );
    }
}

fn load_spending_key(state: &AppState) -> Result<orchard::keys::SpendingKey, String> {
    let path = state
        .spending_key_path
        .as_ref()
        .ok_or("treasury spending key not configured")?;
    let bytes = std::fs::read(path).map_err(|e| format!("reading spending key: {e}"))?;
    if bytes.len() != 32 {
        return Err(format!("spending key must be 32 bytes, got {}", bytes.len()));
    }
    let mut a = [0u8; 32];
    a.copy_from_slice(&bytes);
    orchard::keys::SpendingKey::from_bytes(a)
        .into_option()
        .ok_or_else(|| "spending key failed validation".to_string())
}

/// Typed payout failure so the HTTP endpoint and the auto-trigger task
/// can each react appropriately.
enum PayoutError {
    NotFound,
    NotPending,
    ZeroAmount,
    Internal(String),
}

impl PayoutError {
    fn msg(&self, id: &str) -> String {
        match self {
            PayoutError::NotFound => format!("claim {id} not found"),
            PayoutError::NotPending => {
                format!("claim {id} is not in `pending` state (already paid/paying/rejected)")
            }
            PayoutError::ZeroAmount => "computed payout is zero for this distance".into(),
            PayoutError::Internal(m) => m.clone(),
        }
    }
}

struct PayoutOutcome {
    amount_zat: u64,
    txid: String,
}

/// Core autonomous payout, shared by the auto-trigger on claim submission
/// and the manual `/approve` endpoint. Reserve (pending -> paying), then
/// build + prove + sign + broadcast a shielded Orchard spend and mark
/// paid; revert to pending on any failure. Serialized via `payout_lock`
/// so two claims never select the same note.
async fn run_payout(state: AppState, id: String) -> Result<PayoutOutcome, PayoutError> {
    let claim = {
        let conn = state.db.lock().unwrap();
        fetch_claim(&conn, &id).map_err(|e| PayoutError::Internal(format!("db: {e}")))?
    }
    .ok_or(PayoutError::NotFound)?;

    // Gross reward, then the treasury mechanism: trust multiplier + flat
    // claim fee. Inert by default (see compute_payout_split) — with stock
    // config `split.net_zat == gross`, so existing riders are unaffected
    // until the rates are deliberately set.
    let gross_zat = compute_payout(claim.distance_meters, state.zat_per_km, state.max_payout_zat);
    let split = {
        let conn = state.db.lock().unwrap();
        // `fetch_claim`'s positional query doesn't select rider_id (see
        // row_to_claim), so read it directly rather than silently losing the
        // attestation tier for every claim.
        let rider_id: Option<String> = conn
            .query_row("SELECT rider_id FROM claims WHERE id = ?1", params![id], |r| {
                r.get(0)
            })
            .optional()
            .ok()
            .flatten();
        let bps = trust_bps_for(&conn, &claim.recipient_ua, rider_id.as_deref(), &state.trust);
        compute_payout_split(gross_zat, bps, state.trust.flat_fee_zat)
    };
    let amount_zat = split.net_zat;
    if amount_zat == 0 {
        return Err(PayoutError::ZeroAmount);
    }
    if split.withheld_zat > 0 {
        tracing::info!(
            claim_id = %id,
            gross = split.gross_zat,
            net = split.net_zat,
            withheld = split.withheld_zat,
            trust_bps = split.trust_bps,
            "treasury mechanism applied"
        );
    }

    // Atomic reserve; only the winner proceeds (double-pay guard).
    let reserved = {
        let conn = state.db.lock().unwrap();
        begin_paying(&conn, &id).map_err(|e| PayoutError::Internal(format!("db: {e}")))?
    };
    if !reserved {
        return Err(PayoutError::NotPending);
    }

    let sk = match load_spending_key(&state) {
        Ok(sk) => sk,
        Err(e) => {
            let conn = state.db.lock().unwrap();
            let _ = revert_to_pending(&conn, &id, "spending key unavailable");
            return Err(PayoutError::Internal(e));
        }
    };

    let scan_from = {
        let conn = state.db.lock().unwrap();
        get_scan_from(&conn, state.birthday)
    };

    // Serialize payouts so concurrent claims can't pick the same note.
    let result = {
        let _guard = state.payout_lock.lock().await;
        pedalshield_treasury::spend::spender::pay(
            &state.lightwalletd,
            &sk,
            &claim.recipient_ua,
            amount_zat,
            state.birthday,
            scan_from,
            true, // broadcast
        )
        .await
    };

    match result {
        Ok(r) => match r.broadcast {
            Some((0, _)) => {
                let conn = state.db.lock().unwrap();
                set_paid_from_paying(&conn, &id, &r.txid_hex, &split)
                    .map_err(|e| PayoutError::Internal(format!("db: {e}")))?;
                // Only advance on a CONFIRMED-ACCEPTED broadcast. Our change
                // note is created by this tx, so tip-at-build minus the reorg
                // margin is guaranteed to still contain it.
                set_scan_from(&conn, r.tip_height.saturating_sub(WATERMARK_REORG_MARGIN));
                if r.full_rescan_used {
                    tracing::warn!(
                        claim_id = %id,
                        scanned_from = r.scanned_from,
                        "payout needed a full rescan; watermark was stale"
                    );
                }
                // Credit lifetime totals. Auto-payout spends immediately, so
                // nothing else ever wrote to `balances` and the app's
                // LIFETIME REWARDS figure read 0 after every ride. Idempotent
                // on claim_id; failure here must never fail a paid claim.
                if let Err(e) = pedalshield_treasury::accrual::record_direct_payout(
                    &conn,
                    &id,
                    &claim.recipient_ua,
                    amount_zat,
                    &r.txid_hex,
                    now_secs(),
                ) {
                    tracing::warn!(claim_id = %id, error = %e, "lifetime credit failed (payment stands)");
                }
                tracing::info!(claim_id = %id, txid = %r.txid_hex, amount = amount_zat, scanned_from = r.scanned_from, "claim paid autonomously");
                Ok(PayoutOutcome { amount_zat, txid: r.txid_hex })
            }
            Some((code, msg)) => {
                let conn = state.db.lock().unwrap();
                let _ = revert_to_pending(&conn, &id, &format!("broadcast rejected ({code}): {msg}"));
                Err(PayoutError::Internal(format!("broadcast rejected ({code}): {msg}")))
            }
            None => {
                let conn = state.db.lock().unwrap();
                let _ = revert_to_pending(&conn, &id, "not broadcast");
                Err(PayoutError::Internal("payout was not broadcast".into()))
            }
        },
        Err(e) => {
            let conn = state.db.lock().unwrap();
            let _ = revert_to_pending(&conn, &id, &format!("payout error: {e}"));
            Err(PayoutError::Internal(format!("payout failed: {e}")))
        }
    }
}

/// Manual trigger / retry for a payout. The autonomous path fires
/// automatically on claim submission; this endpoint stays for diagnostics
/// and to retry a claim that reverted to `pending` after a transient error.
async fn approve_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<PayoutResponse>, AppError> {
    match run_payout(state, id.clone()).await {
        Ok(o) => Ok(Json(PayoutResponse {
            status: "paid",
            claim_id: id,
            amount_zatoshi: o.amount_zat,
            txid: o.txid,
        })),
        Err(e) => {
            let m = e.msg(&id);
            Err(match e {
                PayoutError::NotFound => AppError::NotFound(m),
                PayoutError::NotPending | PayoutError::ZeroAmount => AppError::BadRequest(m),
                PayoutError::Internal(_) => AppError::Internal(m),
            })
        }
    }
}

// ---------------------------------------------------------------------
// Admin auth: gate operator endpoints behind a bearer token
// ---------------------------------------------------------------------

/// Constant-time byte comparison so token checks don't leak length/content
/// via timing.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Middleware: require `Authorization: Bearer <PEDALSHIELD_ADMIN_TOKEN>` on
/// the admin endpoints. Fails closed: if no token is configured, all admin
/// access is denied.
async fn require_admin(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let Some(expected) = state.admin_token.as_deref().filter(|t| !t.is_empty()) else {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    };
    let ok = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|tok| ct_eq(tok.as_bytes(), expected.as_bytes()))
        .unwrap_or(false);
    if ok {
        Ok(next.run(req).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

// ---------------------------------------------------------------------
// Accrual settlement (docs/SCALING_PAYOUTS.md)
// ---------------------------------------------------------------------

use pedalshield_treasury::accrual;

/// Settle a single recipient's reserved balance on-chain. Caller must have
/// already won `begin_settling` and pass the reserved `amount`. Reuses the
/// proven spend path; serialized via `payout_lock` so concurrent settles
/// never select the same note. Reverts the reservation on any failure.
async fn settle_one(
    state: &AppState,
    recipient_ua: &str,
    amount: u64,
) -> Result<String, String> {
    let sk = match load_spending_key(state) {
        Ok(sk) => sk,
        Err(e) => {
            let conn = state.db.lock().unwrap();
            let _ = accrual::revert_settling(&conn, recipient_ua, now_secs());
            return Err(e);
        }
    };

    let scan_from = {
        let conn = state.db.lock().unwrap();
        get_scan_from(&conn, state.birthday)
    };

    let result = {
        let _guard = state.payout_lock.lock().await;
        pedalshield_treasury::spend::spender::pay(
            &state.lightwalletd,
            &sk,
            recipient_ua,
            amount,
            state.birthday,
            scan_from,
            true, // broadcast
        )
        .await
    };

    let now = now_secs();
    match result {
        Ok(r) if matches!(r.broadcast, Some((0, _))) => {
            let conn = state.db.lock().unwrap();
            accrual::mark_settled(&conn, recipient_ua, amount, &r.txid_hex, now)
                .map_err(|e| format!("db: {e}"))?;
            set_scan_from(&conn, r.tip_height.saturating_sub(WATERMARK_REORG_MARGIN));
            if r.full_rescan_used {
                tracing::warn!(
                    recipient = %recipient_ua,
                    scanned_from = r.scanned_from,
                    "settle needed a full rescan; watermark was stale"
                );
            }
            tracing::info!(recipient = %recipient_ua, txid = %r.txid_hex, amount, scanned_from = r.scanned_from, "balance settled");
            Ok(r.txid_hex)
        }
        other => {
            let conn = state.db.lock().unwrap();
            let _ = accrual::revert_settling(&conn, recipient_ua, now);
            Err(match other {
                Ok(r) => format!("broadcast not accepted: {:?}", r.broadcast),
                Err(e) => format!("settle failed: {e}"),
            })
        }
    }
}

/// One settlement sweep: pay every balance at or above the floor, up to
/// `max` recipients. Returns (settled_count, total_zatoshi). Forward path
/// to batching: today one spend per recipient; later one multi-output tx
/// over this same due-list.
async fn run_settlement_sweep(state: &AppState, max: usize) -> (usize, u64) {
    let due = {
        let conn = state.db.lock().unwrap();
        accrual::due_for_settlement(&conn, state.payout_floor_zat, max)
            .unwrap_or_default()
    };
    let mut settled = 0usize;
    let mut total = 0u64;
    for d in due {
        let reserved = {
            let conn = state.db.lock().unwrap();
            accrual::begin_settling(&conn, &d.recipient_ua, now_secs())
                .ok()
                .flatten()
        };
        let Some(amount) = reserved else { continue }; // lost the race; skip
        match settle_one(state, &d.recipient_ua, amount).await {
            Ok(_) => {
                settled += 1;
                total += amount;
            }
            Err(e) => tracing::warn!(recipient = %d.recipient_ua, "settle skipped: {e}"),
        }
    }
    (settled, total)
}

#[derive(Debug, Serialize)]
struct SettleResponse {
    settled: usize,
    total_zatoshi: u64,
}

#[derive(Debug, Serialize)]
struct BalanceInfo {
    recipient_ua: String,
    pending_zatoshi: u64,
    lifetime_zatoshi: u64,
    rides_count: u64,
}

/// One row of the community leaderboard. `zatoshi` is lifetime-earned for
/// the all-time window, or the sum earned within the window for "week".
#[derive(Debug, Serialize)]
struct LeaderboardEntry {
    rank: u32,
    /// Rider-chosen handle if set, else `None` (mobile falls back to a
    /// shortened UA so the board still renders).
    handle: Option<String>,
    /// Shortened UA (`u1abcd…wxyz`) — never the full address, for privacy.
    short_ua: String,
    zatoshi: u64,
    rides_count: u64,
}

#[derive(Debug, Serialize)]
struct Leaderboard {
    window: String,
    entries: Vec<LeaderboardEntry>,
}

#[derive(Debug, Deserialize)]
struct LeaderboardQuery {
    /// "all" (lifetime) | "week" (rolling 7 days). Default "all".
    window: Option<String>,
    /// Max rows to return (default 50, max 200).
    limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct SetHandleBody {
    handle: String,
}

#[derive(Debug, Serialize)]
struct HandleResponse {
    recipient_ua: String,
    handle: String,
}

/// Privacy-preserving short form of a UA for public display:
/// first 8 + last 4 chars, e.g. `u1abcdef…wxyz`.
fn short_ua(ua: &str) -> String {
    if ua.len() <= 14 {
        return ua.to_string();
    }
    format!("{}…{}", &ua[..8], &ua[ua.len() - 4..])
}

/// Admin trigger: run one settlement sweep now.
async fn settle_handler(
    State(state): State<AppState>,
) -> Result<Json<SettleResponse>, AppError> {
    if !state.accrual_mode {
        return Err(AppError::BadRequest("accrual mode is off".into()));
    }
    let (settled, total_zatoshi) = run_settlement_sweep(&state, 100).await;
    Ok(Json(SettleResponse { settled, total_zatoshi }))
}

/// Rider-initiated withdraw: settle this recipient's full pending balance
/// now, ignoring the floor.
async fn withdraw_handler(
    State(state): State<AppState>,
    Path(ua): Path<String>,
) -> Result<Json<PayoutResponse>, AppError> {
    if !state.accrual_mode {
        return Err(AppError::BadRequest("accrual mode is off".into()));
    }
    validate_ua(&ua)?;
    let reserved = {
        let conn = state.db.lock().unwrap();
        accrual::begin_settling(&conn, &ua, now_secs())
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };
    let Some(amount) = reserved else {
        return Err(AppError::BadRequest("no pending balance to withdraw".into()));
    };
    match settle_one(&state, &ua, amount).await {
        Ok(txid) => Ok(Json(PayoutResponse {
            status: "paid",
            claim_id: ua,
            amount_zatoshi: amount,
            txid,
        })),
        Err(e) => Err(AppError::Internal(e)),
    }
}

async fn balance_handler(
    State(state): State<AppState>,
    Path(ua): Path<String>,
) -> Result<Json<BalanceInfo>, AppError> {
    validate_ua(&ua)?;
    let info = {
        let conn = state.db.lock().unwrap();
        fetch_accrual_balance(&conn, &ua)
            .map_err(|e| AppError::Internal(format!("db: {e}")))?
    };
    // If never accrued anything, return zeros rather than 404 so the
    // mobile can render "0.00000000 ZEC accrued" cleanly.
    let info = info.unwrap_or(BalanceInfo {
        recipient_ua: ua,
        pending_zatoshi: 0,
        lifetime_zatoshi: 0,
        rides_count: 0,
    });
    Ok(Json(info))
}

/// Set (or update) the rider-chosen display handle for a UA. Public
/// endpoint: the rider proves ownership by knowing their own UA, same
/// trust model as the rest of the accrual API for the demo.
// ---------------------------------------------------------------------
// Data co-op (opt-in) — privacy-preserving aggregate contributions
// ---------------------------------------------------------------------

/// Consent version the server currently accepts. Must match the app's
/// DATA_COOP_CONSENT_VERSION. Bump in lockstep when co-op terms change so old
/// consent stops being accepted.
const COOP_CONSENT_VERSION: u32 = 1;

/// Defensive caps so a single contribution can't carry an outlier that might
/// be re-identifying. A real bike ride well under these; anything larger is
/// clamped.
const COOP_MAX_DISTANCE_KM: u32 = 1_000;
const COOP_MAX_CO2_GRAMS: u32 = 1_000_000;

/// A privacy-preserving co-op contribution. The phone computes these coarse
/// aggregates ON-DEVICE; nothing here can reconstruct a route. There is no
/// field for coordinates, raw samples, or precise time — by design.
#[derive(Debug, Deserialize)]
struct CoopContribution {
    /// Contributor's mainnet UA (so contributions can be rewarded later).
    recipient_ua: String,
    /// Must equal COOP_CONSENT_VERSION; proves the rider opted in under the
    /// current terms.
    consent_version: u32,
    /// Coarse distance bucket in whole km (already rounded on-device).
    distance_bucket_km: u32,
    /// Hour of day, 0-23. No date — so it cannot pin a specific ride in time.
    hour_bucket: u8,
    /// Coarse CO2 saved, in grams (already aggregated on-device).
    co2_grams: u32,
    /// Optional coarse area label (e.g. a city or region NAME). Never
    /// coordinates — the handler rejects coordinate-looking strings.
    #[serde(default)]
    region: Option<String>,
}

#[derive(Debug, Serialize)]
struct CoopAck {
    status: &'static str,
    contribution_id: i64,
}

/// Accept an opt-in data co-op contribution. Validates consent + that the
/// payload is a coarse aggregate (no coordinates), then stores it. Returns the
/// new row id. This endpoint NEVER accepts route or raw-sensor data.
async fn coop_contribute_handler(
    State(state): State<AppState>,
    Json(body): Json<CoopContribution>,
) -> Result<Json<CoopAck>, AppError> {
    validate_ua(&body.recipient_ua)?;

    if body.consent_version != COOP_CONSENT_VERSION {
        return Err(AppError::BadRequest(format!(
            "consent_version {} not accepted; current is {} — re-opt-in in the app",
            body.consent_version, COOP_CONSENT_VERSION
        )));
    }

    if body.hour_bucket > 23 {
        return Err(AppError::BadRequest(
            "hour_bucket must be 0-23 (hour of day, no date)".into(),
        ));
    }

    // Clamp aggregates to defensive caps rather than rejecting, so a genuine
    // long ride still contributes without carrying an outlier value.
    let distance_bucket_km = body.distance_bucket_km.min(COOP_MAX_DISTANCE_KM);
    let co2_grams = body.co2_grams.min(COOP_MAX_CO2_GRAMS);

    // Region must be a coarse human-readable area label, never coordinates.
    // Reject anything that looks like lat/lon (digits + separators) or is too
    // long/precise. Defense-in-depth: the app never sends coordinates anyway.
    let region: Option<String> = match body.region {
        None => None,
        Some(r) => {
            let r = r.trim().to_string();
            if r.is_empty() {
                None
            } else {
                if r.chars().count() > 32 {
                    return Err(AppError::BadRequest(
                        "region must be a short area name (<=32 chars)".into(),
                    ));
                }
                let digits = r.chars().filter(|c| c.is_ascii_digit()).count();
                let looks_like_coords =
                    digits >= 4 || r.contains(',') || r.matches('.').count() >= 1 && digits > 0;
                if r.chars().any(|c| c.is_control()) || looks_like_coords {
                    return Err(AppError::BadRequest(
                        "region must be an area NAME, not coordinates".into(),
                    ));
                }
                Some(r)
            }
        }
    };

    let id = {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "INSERT INTO coop_contributions
                (recipient_ua, consent_version, distance_bucket_km,
                 hour_bucket, co2_grams, region, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                body.recipient_ua,
                COOP_CONSENT_VERSION as i64,
                distance_bucket_km as i64,
                body.hour_bucket as i64,
                co2_grams as i64,
                region,
                now_secs() as i64,
            ],
        )
        .map_err(|e| AppError::Internal(format!("db: {e}")))?;
        conn.last_insert_rowid()
    };

    Ok(Json(CoopAck {
        status: "accepted",
        contribution_id: id,
    }))
}

async fn set_handle_handler(
    State(state): State<AppState>,
    Path(ua): Path<String>,
    Json(body): Json<SetHandleBody>,
) -> Result<Json<HandleResponse>, AppError> {
    validate_ua(&ua)?;
    let handle = body.handle.trim().to_string();
    if handle.is_empty() || handle.chars().count() > 24 {
        return Err(AppError::BadRequest(
            "handle must be 1-24 characters".into(),
        ));
    }
    // Keep it to printable, non-control characters; no newlines in a board.
    if handle.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest(
            "handle contains invalid characters".into(),
        ));
    }
    {
        let conn = state.db.lock().unwrap();
        conn.execute(
            "INSERT INTO handles (recipient_ua, handle, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(recipient_ua) DO UPDATE SET
                handle = excluded.handle,
                updated_at = excluded.updated_at",
            params![ua, handle, now_secs() as i64],
        )
        .map_err(|e| AppError::Internal(format!("db: {e}")))?;
    }
    Ok(Json(HandleResponse {
        recipient_ua: ua,
        handle,
    }))
}

/// Community leaderboard: top riders by ZEC earned. `window=all` ranks by
/// lifetime balance; `window=week` ranks by reward accrued in the last 7
/// days (from the append-only `accruals` audit log). Full UAs are never
/// returned — only a rider-chosen handle and a shortened UA.
async fn leaderboard_handler(
    State(state): State<AppState>,
    Query(q): Query<LeaderboardQuery>,
) -> Result<Json<Leaderboard>, AppError> {
    let window = q.window.as_deref().unwrap_or("all").to_string();
    let limit = q.limit.unwrap_or(50).clamp(1, 200) as i64;

    let rows: Vec<(String, u64, u64)> = {
        let conn = state.db.lock().unwrap();
        if window == "week" {
            let cutoff = now_secs().saturating_sub(7 * 24 * 60 * 60) as i64;
            let mut stmt = conn
                .prepare(
                    "SELECT recipient_ua, SUM(amount_zat) AS total, COUNT(*) AS n
                     FROM accruals
                     WHERE created_at >= ?1
                     GROUP BY recipient_ua
                     ORDER BY total DESC
                     LIMIT ?2",
                )
                .map_err(|e| AppError::Internal(format!("db: {e}")))?;
            let r = stmt
                .query_map(params![cutoff, limit], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, i64>(2)? as u64,
                    ))
                })
                .map_err(|e| AppError::Internal(format!("db: {e}")))?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| AppError::Internal(format!("db: {e}")))?;
            r
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT recipient_ua, lifetime_zat, rides_count
                     FROM balances
                     WHERE lifetime_zat > 0
                     ORDER BY lifetime_zat DESC
                     LIMIT ?1",
                )
                .map_err(|e| AppError::Internal(format!("db: {e}")))?;
            let r = stmt
                .query_map(params![limit], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? as u64,
                        row.get::<_, i64>(2)? as u64,
                    ))
                })
                .map_err(|e| AppError::Internal(format!("db: {e}")))?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| AppError::Internal(format!("db: {e}")))?;
            r
        }
    };

    // Resolve handles in a second pass (small N) to keep the queries simple.
    let entries = {
        let conn = state.db.lock().unwrap();
        rows.into_iter()
            .enumerate()
            .map(|(i, (ua, zat, rides))| {
                let handle: Option<String> = conn
                    .query_row(
                        "SELECT handle FROM handles WHERE recipient_ua = ?1",
                        params![ua],
                        |r| r.get(0),
                    )
                    .optional()
                    .unwrap_or(None);
                LeaderboardEntry {
                    rank: (i as u32) + 1,
                    handle,
                    short_ua: short_ua(&ua),
                    zatoshi: zat,
                    rides_count: rides,
                }
            })
            .collect::<Vec<_>>()
    };

    Ok(Json(Leaderboard { window, entries }))
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,backend=info")),
        )
        .with_target(false)
        .init();

    let db_path = PathBuf::from(
        env::var("PEDALSHIELD_DB").unwrap_or_else(|_| "pedalshield.sqlite".into()),
    );
    let port: u16 = env::var("PEDALSHIELD_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8787);
    let treasury_ua = env::var("PEDALSHIELD_TREASURY_UA").unwrap_or_else(|_| {
        // Fallback: try reading from the default keygen output path.
        std::fs::read_to_string("treasury-keys/treasury_address.txt")
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "<unset>".into())
    });
    let spending_key_path = env::var("TREASURY_SPENDING_KEY_FILE")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            let p = PathBuf::from("treasury-keys/treasury_spending_key.bin");
            p.exists().then_some(p)
        });

    let lightwalletd = env::var("PEDALSHIELD_LIGHTWALLETD")
        .unwrap_or_else(|_| "https://zec.rocks:443".into());
    let birthday: u64 = env::var("PEDALSHIELD_BIRTHDAY")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3_361_149);
    let zat_per_km: u64 = env::var("PEDALSHIELD_ZAT_PER_KM")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20_000); // 0.0002 ZEC per km
    let max_payout_zat: u64 = env::var("PEDALSHIELD_MAX_PAYOUT_ZAT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(500_000);

    // --- Spend limits (security v0.6) ---------------------------------
    // Conservative defaults: one rider ~40 km/day, whole treasury
    // ~200 km/day of rewards, 10 minutes minimum between claims.
    let min_claim_interval_s: u64 = env::var("PEDALSHIELD_MIN_CLAIM_INTERVAL_S")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(600);
    // Security v0.7: leave OFF during rollout so installed builds keep
    // working; flip to 1 once riders are on a claim-signing app build.
    let require_signed_claims: bool = env::var("PEDALSHIELD_REQUIRE_SIGNED_CLAIMS")
        .map(|v| v != "0").unwrap_or(false);
    let claim_signature_max_age_s: u64 = env::var("PEDALSHIELD_CLAIM_SIG_MAX_AGE_S")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(3600);
    let ua_daily_meters: u64 = env::var("PEDALSHIELD_UA_DAILY_METERS")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(40_000);
    let global_daily_meters: u64 = env::var("PEDALSHIELD_GLOBAL_DAILY_METERS")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(200_000); // 0.005 ZEC cap per claim
    // Auto-payout defaults ON (fully hands-off). Set PEDALSHIELD_AUTO_PAYOUT=0
    // to require the manual /approve endpoint instead.
    let auto_payout = env::var("PEDALSHIELD_AUTO_PAYOUT")
        .map(|s| !matches!(s.as_str(), "0" | "false" | "no"))
        .unwrap_or(true);
    // Accrual mode (docs/SCALING_PAYOUTS.md). Off by default — the proven
    // per-claim autonomous path stays the default until explicitly enabled.
    let accrual_mode = env::var("PEDAL_ACCRUAL")
        .map(|s| matches!(s.as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let payout_floor_zat: u64 = env::var("PEDAL_FLOOR_ZAT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(accrual::DEFAULT_FLOOR_ZAT); // 0.01 ZEC
    // How often the background sweep settles due balances, in seconds.
    let settle_interval_secs: u64 = env::var("PEDAL_SETTLE_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(300);

    let admin_token = env::var("PEDALSHIELD_ADMIN_TOKEN")
        .ok()
        .filter(|t| !t.is_empty());
    if admin_token.is_none() {
        tracing::warn!(
            "PEDALSHIELD_ADMIN_TOKEN is not set - admin endpoints (/approve, /claims, /withdraw, /settle, /admin) are LOCKED until you set it."
        );
    }

    let trust = TrustConfig::from_env();
    if trust.flat_fee_zat > 0
        || trust.new_bps != TRUST_BPS_FULL
        || trust.history_bps != TRUST_BPS_FULL
        || trust.attested_bps != TRUST_BPS_FULL
    {
        tracing::warn!(
            flat_fee_zat = trust.flat_fee_zat,
            new_bps = trust.new_bps,
            history_bps = trust.history_bps,
            attested_bps = trust.attested_bps,
            history_rides = trust.history_rides,
            "treasury mechanism is LIVE — payouts are being reduced"
        );
    }

    let conn = open_db(&db_path)?;
    backfill_lifetime_totals(&conn, zat_per_km, max_payout_zat);
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        treasury_ua: treasury_ua.clone(),
        spending_key_path,
        lightwalletd,
        birthday,
        zat_per_km,
        max_payout_zat,
        min_claim_interval_s,
        require_signed_claims,
        claim_signature_max_age_s,
        ua_daily_meters,
        global_daily_meters,
        trust,
        payout_lock: Arc::new(tokio::sync::Mutex::new(())),
        auto_payout,
        accrual_mode,
        payout_floor_zat,
        admin_token,
    };

    // Background settlement sweep: only runs in accrual mode.
    if accrual_mode {
        let sweep_state = state.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(
                std::time::Duration::from_secs(settle_interval_secs.max(1)),
            );
            loop {
                tick.tick().await;
                let (n, total) = run_settlement_sweep(&sweep_state, 100).await;
                if n > 0 {
                    tracing::info!(settled = n, total_zatoshi = total, "settlement sweep");
                }
            }
        });
    }

    // Admin / operator endpoints: gated behind PEDALSHIELD_ADMIN_TOKEN.
    // These can move money or read every claim, so they must never be open.
    let admin = Router::new()
        .route("/claims", get(list_claims_handler))
        .route("/claims/:id/mark-paid", post(mark_paid_handler))
        .route("/claims/:id/approve", post(approve_handler))
        .route("/claims/:id/reject", post(reject_handler))
        .route("/settle", post(settle_handler))
        .route("/withdraw/:ua", post(withdraw_handler))
        .route("/admin", get(admin_page))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_admin));

    // Public ride receipt. CORS is open on this route only so the
    // marketing site (pedalshield.app/proof/<txid>) can fetch JSON.
    let proof = Router::new()
        .route("/proof/:txid", get(proof_handler))
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    // Public endpoints the app needs: liveness, treasury info, submit a
    // claim, poll your own claim's status, read a balance.
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/treasury/info", get(treasury_info))
        .route("/claim", post(post_claim))
        .route("/rider/register", post(register_rider_handler))
        .route("/attest/challenge", get(attest_challenge_handler))
        .route("/rider/attest", post(attest_register_handler))
        .route("/claims/:id", get(get_claim_handler))
        .route("/balance/:ua", get(balance_handler))
        .route("/leaderboard", get(leaderboard_handler))
        .route("/handle/:ua", post(set_handle_handler))
        .route("/coop/contribute", post(coop_contribute_handler))
        .merge(proof)
        .merge(admin)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(
        "Pedalshield backend listening on http://{} | db={} | treasury_ua={}",
        addr,
        db_path.display(),
        treasury_ua,
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
