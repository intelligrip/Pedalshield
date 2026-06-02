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
//!     GET  /healthz             liveness check
//!     GET  /treasury/info       treasury UA + status
//!     POST /claim               accept a ride claim (queues for payout)
//!     GET  /claims              admin: list claims, optional ?status=pending|paid
//!     GET  /claims/{id}         fetch a single claim
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
    response::{IntoResponse, Response},
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
