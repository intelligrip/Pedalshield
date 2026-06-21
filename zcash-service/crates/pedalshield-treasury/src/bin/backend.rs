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
//!
//! All endpoints return JSON. Errors use HTTP status codes (400 / 404 /
//! 500) with a JSON body `{ "error": "..." }`.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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
}

#[derive(Debug, Serialize, Deserialize)]
struct ClaimRow {
    id: String,
    recipient_ua: String,
    distance_meters: u64,
    signature: String,
    attestation: Option<String>,
    status: String,
    payout_txid: Option<String>,
    rejection_reason: Option<String>,
    created_at: u64,
    updated_at: u64,
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
    attestation       TEXT,
    status            TEXT NOT NULL DEFAULT 'pending',
    payout_txid       TEXT,
    rejection_reason  TEXT,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_created ON claims(created_at);

-- Optional, rider-chosen display name for the community leaderboard.
-- Keyed by recipient UA; the UA itself stays the source of truth.
CREATE TABLE IF NOT EXISTS handles (
    recipient_ua  TEXT PRIMARY KEY,
    handle        TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
);
";

fn open_db(path: &PathBuf) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    // Accrual ledger tables (step 1 of docs/SCALING_PAYOUTS.md). Additive
    // and idempotent; harmless when accrual mode is off.
    pedalshield_treasury::accrual::ensure_schema(&conn)?;
    Ok(conn)
}

fn insert_claim(conn: &Connection, c: &ClaimRow) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO claims
            (id, recipient_ua, distance_meters, signature, attestation,
             status, payout_txid, rejection_reason, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
        ],
    )?;
    Ok(())
}

fn fetch_claim(conn: &Connection, id: &str) -> Result<Option<ClaimRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, recipient_ua, distance_meters, signature, attestation,
                status, payout_txid, rejection_reason, created_at, updated_at
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
) -> Result<bool, rusqlite::Error> {
    let now = now_secs() as i64;
    let n = conn.execute(
        "UPDATE claims SET status = 'paid', payout_txid = ?1, updated_at = ?2
         WHERE id = ?3 AND status = 'paying'",
        params![txid, now, id],
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
        attestation: row.get(4)?,
        status: row.get(5)?,
        payout_txid: row.get(6)?,
        rejection_reason: row.get(7)?,
        created_at: row.get::<_, i64>(8)? as u64,
        updated_at: row.get::<_, i64>(9)? as u64,
    })
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
                Rewards pegged to carbon value (~$0.006/mile).",
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
        attestation: body.attestation,
        status: "pending".into(),
        payout_txid: None,
        rejection_reason: None,
        created_at: now,
        updated_at: now,
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

    let amount_zat = compute_payout(claim.distance_meters, state.zat_per_km, state.max_payout_zat);
    if amount_zat == 0 {
        return Err(PayoutError::ZeroAmount);
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

    // Serialize payouts so concurrent claims can't pick the same note.
    let result = {
        let _guard = state.payout_lock.lock().await;
        pedalshield_treasury::spend::spender::pay(
            &state.lightwalletd,
            &sk,
            &claim.recipient_ua,
            amount_zat,
            state.birthday,
            true, // broadcast
        )
        .await
    };

    match result {
        Ok(r) => match r.broadcast {
            Some((0, _)) => {
                let conn = state.db.lock().unwrap();
                set_paid_from_paying(&conn, &id, &r.txid_hex)
                    .map_err(|e| PayoutError::Internal(format!("db: {e}")))?;
                tracing::info!(claim_id = %id, txid = %r.txid_hex, amount = amount_zat, "claim paid autonomously");
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

    let result = {
        let _guard = state.payout_lock.lock().await;
        pedalshield_treasury::spend::spender::pay(
            &state.lightwalletd,
            &sk,
            recipient_ua,
            amount,
            state.birthday,
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
            tracing::info!(recipient = %recipient_ua, txid = %r.txid_hex, amount, "balance settled");
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
        .unwrap_or(500_000); // 0.005 ZEC cap per claim
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

    let conn = open_db(&db_path)?;
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        treasury_ua: treasury_ua.clone(),
        spending_key_path,
        lightwalletd,
        birthday,
        zat_per_km,
        max_payout_zat,
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

    // Public endpoints the app needs: liveness, treasury info, submit a
    // claim, poll your own claim's status, read a balance.
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/treasury/info", get(treasury_info))
        .route("/claim", post(post_claim))
        .route("/claims/:id", get(get_claim_handler))
        .route("/balance/:ua", get(balance_handler))
        .route("/leaderboard", get(leaderboard_handler))
        .route("/handle/:ua", post(set_handle_handler))
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
