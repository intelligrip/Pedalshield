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
//!
//! All endpoints return JSON. Errors use HTTP status codes (400 / 404 /
//! 500) with a JSON body `{ "error": "..." }`.

use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection};
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
    notes: &'static str,
}

#[derive(Debug, Serialize)]
struct Health {
    ok: bool,
    version: &'static str,
    pending_claims: u64,
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
";

fn open_db(path: &PathBuf) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
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

fn count_pending(conn: &Connection) -> Result<u64, rusqlite::Error> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM claims WHERE status = 'pending'",
        [],
        |r| r.get(0),
    )?;
    Ok(n as u64)
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
        lightwalletd_connected: false,
        balance_zatoshi: None,
        notes: "v0.5.1 - claim collection only. Lightwalletd + payout \
                construction land in v0.5.2 / v0.5.3.",
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
    Ok((
        StatusCode::ACCEPTED,
        Json(ClaimAcceptResponse {
            status: "queued",
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
  <div class="sub">Operator console &middot; v0.5.3 manual payout</div>

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
      After you've sent the payout from Zashi, paste the 64-char transaction
      id (Zashi shows it in the transaction details). The claim will flip to
      <b>paid</b> with that hash recorded.
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

    let conn = open_db(&db_path)?;
    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        treasury_ua: treasury_ua.clone(),
        spending_key_path,
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/treasury/info", get(treasury_info))
        .route("/claim", post(post_claim))
        .route("/claims", get(list_claims_handler))
        .route("/claims/:id", get(get_claim_handler))
        .route("/claims/:id/mark-paid", post(mark_paid_handler))
        .route("/claims/:id/reject", post(reject_handler))
        .route("/admin", get(admin_page))
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
