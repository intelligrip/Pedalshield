//! Fogline — quest claims and the 0.1 ZEC demo pot.
//!
//! Pure logic only (validation, the quest predicate, the treasury gate and
//! the ledger queries). The HTTP handler and the spend live in
//! `bin/backend.rs`, next to the existing payout path they reuse.
//!
//! PRIVACY. Nothing about where a rider went reaches this server: no
//! coordinates, no sensors, no timestamps, no distance, and no tiles. The
//! quest is evaluated on the phone; the claim says only "a verified ride
//! completed quest X". The wire structs use `deny_unknown_fields`, so a claim
//! that tries to carry `lat`, `polyline`, `questTiles` or anything else not
//! on the list is rejected before it is read — the server enforces the same
//! contract as `mobile/src/map/foglineClaim.ts`.
//!
//! QUESTS. `mobile/src/map/quests.json` is embedded at compile time. The
//! app's copy is pinned to the same file by a test, so the predicate the
//! phone shows and the predicate the treasury pays on are the same bytes.

use std::sync::OnceLock;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

// ---------------------------------------------------------------------
// Incentive constants (documented in docs/FOGLINE_INCENTIVES.md)
// ---------------------------------------------------------------------

/// Smallest output we treat as spendable in a normal wallet. ZIP-317 charges
/// 5,000 zat per logical action with a 2-action minimum, so a note worth
/// less than ~10,000 zat costs more to spend than it holds. The spender has
/// no minimum output of its own, so this floor is the binding one.
pub const DUST_FLOOR_ZAT: u64 = 10_000;
/// The drop: bare-minimum spendable note, plus one zatoshi.
pub const PAYOUT_ZAT: u64 = DUST_FLOOR_ZAT + 1;
/// Held back so fees can never strand the last notes in the pot.
pub const FEE_RESERVE_ZAT: u64 = 2_000_000;
/// Fee assumed until a real payout tells us otherwise. Observed on mainnet
/// for this treasury's 1-in/1-out Orchard spend: 20,000 zat (not 10,000).
pub const DEFAULT_FEE_ESTIMATE_ZAT: u64 = 20_000;
/// Paid quests per recipient address per UTC day.
pub const DAILY_PAID_PER_UA: u64 = 1;
/// Paid quests across everyone per UTC day. Bounds how fast a patched app
/// with many addresses can drain the demo pot.
pub const DAILY_PAID_GLOBAL: u64 = 50;
pub const CLAIM_VERSION: u32 = 1;

// ---------------------------------------------------------------------
// Quests (embedded from the app's quests.json)
// ---------------------------------------------------------------------

const QUESTS_JSON: &str = include_str!("../../../../mobile/src/map/quests.json");

#[derive(Debug, Deserialize)]
struct QuestFile {
    quests: Vec<QuestDef>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuestDef {
    pub id: String,
    pub need: usize,
    pub stops: Vec<QuestStop>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QuestStop {
    pub label: String,
    pub tile: String,
}

/// All quests. Panics at first use if the embedded JSON is malformed, which
/// `cargo test` catches long before a deploy does.
pub fn quests() -> &'static [QuestDef] {
    static Q: OnceLock<Vec<QuestDef>> = OnceLock::new();
    Q.get_or_init(|| {
        serde_json::from_str::<QuestFile>(QUESTS_JSON)
            .expect("mobile/src/map/quests.json is malformed")
            .quests
    })
}

pub fn quest(id: &str) -> Option<&'static QuestDef> {
    quests().iter().find(|q| q.id == id)
}

/// A canonical Fogline v1 tile id: `fl1:<q>:<r>` with plain integers. The
/// round-trip check rejects `+1`, `01`, `-0` and anything else that would
/// let one cell have two spellings.
pub fn is_tile_id(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("fl1:") else { return false };
    let mut parts = rest.split(':');
    let (Some(a), Some(b), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    match (a.parse::<i64>(), b.parse::<i64>()) {
        (Ok(q), Ok(r)) => format!("fl1:{q}:{r}") == s,
        _ => false,
    }
}

// ---------------------------------------------------------------------
// Wire format — mirrors FoglineClaim in mobile/src/map/foglineClaim.ts
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attestation {
    pub platform: String,
    pub token: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FoglineClaim {
    pub v: u32,
    #[serde(rename = "rideId")]
    pub ride_id: String,
    #[serde(rename = "questId")]
    pub quest_id: String,
    pub pass: bool,
    pub attestation: Option<Attestation>,
}

/// What the app POSTs: the privacy-checked claim, plus where to pay and the
/// device signature the app already produces.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FoglineSubmit {
    pub claim: FoglineClaim,
    pub recipient_ua: String,
    pub signature: Option<String>,
    pub rider_id: Option<String>,
    pub signed_at: Option<u64>,
}

/// Canonical message the device signs for a Fogline claim. Binds the UA so
/// a captured signature cannot be redirected to another wallet. Field order
/// is protocol; version the prefix if it ever changes.
pub fn signing_message(c: &FoglineClaim, recipient_ua: &str, signed_at: u64) -> String {
    format!(
        "fogline-claim-v1|{}|{}|{}|{}",
        c.ride_id, recipient_ua, c.quest_id, signed_at
    )
}

/// Structural validation. `Err` is a 400. The quest predicate itself is
/// evaluated on the phone — the server never receives the tiles it would
/// need to re-check it, by design. What the server can and does check: the
/// claim is well-formed, the ride verified, and the quest exists.
pub fn evaluate(c: &FoglineClaim) -> Result<&'static QuestDef, String> {
    if c.v != CLAIM_VERSION {
        return Err(format!("unsupported claim version {}", c.v));
    }
    if !c.pass {
        return Err("only verified rides may claim".into());
    }
    if c.ride_id.is_empty()
        || c.ride_id.len() > 64
        || !c.ride_id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
    {
        return Err("rideId is malformed".into());
    }
    quest(&c.quest_id).ok_or_else(|| format!("unknown quest {}", c.quest_id))
}

// ---------------------------------------------------------------------
// Treasury gate
// ---------------------------------------------------------------------

/// Pay, or pause because the pot can no longer cover a drop above the
/// reserve. `known_balance` is the change left by the last payout; `None`
/// before the first payout, in which case the spender's own sufficiency
/// check is the backstop.
pub fn treasury_can_pay(known_balance_zat: Option<u64>, est_fee_zat: u64) -> bool {
    match known_balance_zat {
        None => true,
        Some(b) => b.saturating_sub(FEE_RESERVE_ZAT) >= PAYOUT_ZAT.saturating_add(est_fee_zat),
    }
}

// ---------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS fogline_claims (
    ride_id        TEXT PRIMARY KEY,
    recipient_ua   TEXT NOT NULL,
    quest_id       TEXT NOT NULL,   -- no tiles, no route: see module docs
    status         TEXT NOT NULL,   -- capped|treasury_paused|paying|paid|failed
    payout_zat     INTEGER,
    payout_txid    TEXT,
    reason         TEXT,
    utc_day        INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fogline_ua_day ON fogline_claims(recipient_ua, utc_day);
CREATE INDEX IF NOT EXISTS idx_fogline_day ON fogline_claims(utc_day, status);
";

pub fn utc_day(now_secs: u64) -> i64 {
    (now_secs / 86_400) as i64
}

/// Claims that count against the daily caps: anything paid or in flight.
const COUNTS_AGAINST_CAP: &str = "status IN ('paying','paid')";

pub fn paid_today_for(conn: &Connection, ua: &str, day: i64) -> rusqlite::Result<u64> {
    let n: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM fogline_claims WHERE recipient_ua = ?1 AND utc_day = ?2 AND {COUNTS_AGAINST_CAP}"
        ),
        params![ua, day],
        |r| r.get(0),
    )?;
    Ok(n as u64)
}

pub fn paid_today_global(conn: &Connection, day: i64) -> rusqlite::Result<u64> {
    let n: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM fogline_claims WHERE utc_day = ?1 AND {COUNTS_AGAINST_CAP}"),
        params![day],
        |r| r.get(0),
    )?;
    Ok(n as u64)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FoglineRow {
    pub ride_id: String,
    pub status: String,
    pub payout_zat: Option<u64>,
    pub payout_txid: Option<String>,
    pub reason: Option<String>,
}

pub fn fetch(conn: &Connection, ride_id: &str) -> rusqlite::Result<Option<FoglineRow>> {
    conn.query_row(
        "SELECT ride_id, status, payout_zat, payout_txid, reason FROM fogline_claims WHERE ride_id = ?1",
        params![ride_id],
        |r| {
            Ok(FoglineRow {
                ride_id: r.get(0)?,
                status: r.get(1)?,
                payout_zat: r.get::<_, Option<i64>>(2)?.map(|v| v as u64),
                payout_txid: r.get(3)?,
                reason: r.get(4)?,
            })
        },
    )
    .optional()
}

/// Insert a new claim row. Returns false if `ride_id` already exists, so a
/// retried submission is idempotent rather than a second payout.
#[allow(clippy::too_many_arguments)]
pub fn insert(
    conn: &Connection,
    ride_id: &str,
    ua: &str,
    quest_id: &str,
    status: &str,
    reason: Option<&str>,
    now: u64,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO fogline_claims
           (ride_id, recipient_ua, quest_id, status, reason, utc_day, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![ride_id, ua, quest_id, status, reason, utc_day(now), now as i64],
    )?;
    Ok(n == 1)
}

pub fn set_status(
    conn: &Connection,
    ride_id: &str,
    status: &str,
    txid: Option<&str>,
    payout_zat: Option<u64>,
    reason: Option<&str>,
    now: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE fogline_claims
            SET status = ?2, payout_txid = COALESCE(?3, payout_txid),
                payout_zat = COALESCE(?4, payout_zat), reason = ?5, updated_at = ?6
          WHERE ride_id = ?1",
        params![ride_id, status, txid, payout_zat.map(|v| v as i64), reason, now as i64],
    )?;
    Ok(())
}

// Known treasury balance, cached in the existing wallet_state table. Like
// the scan watermark it is a cache, never an authority: the spender still
// refuses to build a tx it cannot fund.

const KEY_BALANCE: &str = "fogline_known_balance_zat";
const KEY_FEE: &str = "fogline_last_fee_zat";

fn get_u64(conn: &Connection, key: &str) -> Option<u64> {
    conn.query_row("SELECT value FROM wallet_state WHERE key = ?1", params![key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
    .and_then(|s| s.trim().parse().ok())
}

fn set_u64(conn: &Connection, key: &str, v: u64, now: u64) {
    let _ = conn.execute(
        "INSERT INTO wallet_state (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, v.to_string(), now as i64],
    );
}

pub fn known_balance(conn: &Connection) -> Option<u64> {
    get_u64(conn, KEY_BALANCE)
}

pub fn fee_estimate(conn: &Connection) -> u64 {
    get_u64(conn, KEY_FEE).unwrap_or(DEFAULT_FEE_ESTIMATE_ZAT)
}

/// Record what a successful payout left behind. The treasury is a
/// single-note wallet, so the change output IS the remaining balance.
pub fn record_after_payout(conn: &Connection, change_zat: u64, fee_zat: u64, now: u64) {
    set_u64(conn, KEY_BALANCE, change_zat, now);
    set_u64(conn, KEY_FEE, fee_zat.max(1), now);
}

/// Forget the cached balance (after an external top-up).
pub fn clear_known_balance(conn: &Connection) {
    let _ = conn.execute("DELETE FROM wallet_state WHERE key = ?1", params![KEY_BALANCE]);
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn claim() -> FoglineClaim {
        FoglineClaim {
            v: 1,
            ride_id: "01HXTEST000001".into(),
            quest_id: quests()[0].id.clone(),
            pass: true,
            attestation: None,
        }
    }

    #[test]
    fn embedded_quests_parse() {
        let q = &quests()[0];
        assert_eq!(q.id, "q-bend-river-line");
        assert_eq!(q.stops.len(), 5);
        assert!(q.stops.iter().all(|s| is_tile_id(&s.tile)));
        assert!(q.need >= 1 && q.need <= q.stops.len());
    }

    #[test]
    fn payout_constants_are_consistent() {
        assert_eq!(PAYOUT_ZAT, DUST_FLOOR_ZAT + 1);
        assert!(FEE_RESERVE_ZAT > 50 * DEFAULT_FEE_ESTIMATE_ZAT);
    }

    #[test]
    fn tile_ids_are_canonical() {
        assert!(is_tile_id("fl1:-30067:11400"));
        for bad in ["", "fl1:1", "fl1:1:2:3", "fl2:1:2", "fl1:+1:2", "fl1:01:2", "fl1:-0:2", "fl1:1.5:2"] {
            assert!(!is_tile_id(bad), "{bad}");
        }
    }

    #[test]
    fn accepts_a_wellformed_claim() {
        assert_eq!(evaluate(&claim()).unwrap().id, "q-bend-river-line");
    }

    #[test]
    fn rejects_failed_rides_unknown_quests_and_bad_ids() {
        let mut c = claim();
        c.pass = false;
        assert!(evaluate(&c).is_err());
        let mut c = claim();
        c.quest_id = "nope".into();
        assert!(evaluate(&c).is_err());
        let mut c = claim();
        c.ride_id = "fl1:1:2".into();
        assert!(evaluate(&c).is_err(), "a tile smuggled in as a ride id");
    }

    #[test]
    fn signing_message_matches_the_app() {
        // Same vector as mobile/src/map/__tests__/foglineClaim.test.ts.
        let c = FoglineClaim {
            v: 1,
            ride_id: "01HXVECTOR0001".into(),
            quest_id: "q-bend-river-line".into(),
            pass: true,
            attestation: None,
        };
        assert_eq!(
            signing_message(&c, "u1vector", 1_800_000_000),
            "fogline-claim-v1|01HXVECTOR0001|u1vector|q-bend-river-line|1800000000"
        );
    }

    #[test]
    fn wire_format_rejects_any_location() {
        let ok = r#"{"claim":{"v":1,"rideId":"01HXA","questId":"q-bend-river-line","pass":true},"recipient_ua":"u1x"}"#;
        assert!(serde_json::from_str::<FoglineSubmit>(ok).is_ok());

        for leak in [
            r#""lat":44.05"#,
            r#""polyline":"abc""#,
            r#""questTiles":["fl1:-30067:11400"]"#,
            r#""tiles":[]"#,
            r#""accel":[]"#,
            r#""startedAt":1"#,
            r#""distanceBand":"lt5""#,
        ] {
            let bad = ok.replacen(r#""pass":true"#, &format!(r#""pass":true,{leak}"#), 1);
            assert!(serde_json::from_str::<FoglineSubmit>(&bad).is_err(), "accepted {leak}");
        }
        let nested = ok.replacen(
            r#""pass":true"#,
            r#""pass":true,"attestation":{"platform":"ios","token":"t","issuedAt":1,"lat":44}"#,
            1,
        );
        assert!(serde_json::from_str::<FoglineSubmit>(&nested).is_err());
        let envelope = ok.replacen(r#""recipient_ua":"u1x""#, r#""recipient_ua":"u1x","lon":-121.3"#, 1);
        assert!(serde_json::from_str::<FoglineSubmit>(&envelope).is_err());
    }

    #[test]
    fn treasury_gate() {
        let fee = DEFAULT_FEE_ESTIMATE_ZAT;
        assert!(treasury_can_pay(None, fee));
        assert!(treasury_can_pay(Some(10_000_000), fee));
        let edge = FEE_RESERVE_ZAT + PAYOUT_ZAT + fee;
        assert!(treasury_can_pay(Some(edge), fee));
        assert!(!treasury_can_pay(Some(edge - 1), fee));
        assert!(!treasury_can_pay(Some(0), fee));
    }

    #[test]
    fn ledger_stores_no_location_and_caps_hold() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(
            "CREATE TABLE wallet_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();

        // The ledger schema itself has nowhere to put a location.
        let cols: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('fogline_claims')")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for c in &cols {
            assert!(!c.contains("tile") && !c.contains("lat") && !c.contains("lon"), "column {c}");
        }

        let now = 1_800_000_000;
        let day = utc_day(now);
        assert!(insert(&conn, "r1", "u1a", "q", "paying", None, now).unwrap());
        assert!(!insert(&conn, "r1", "u1a", "q", "paying", None, now).unwrap(), "idempotent");
        assert_eq!(paid_today_for(&conn, "u1a", day).unwrap(), 1);

        insert(&conn, "r2", "u1a", "q", "capped", None, now).unwrap();
        insert(&conn, "r3", "u1a", "q", "failed", None, now).unwrap();
        assert_eq!(paid_today_for(&conn, "u1a", day).unwrap(), 1, "only paying/paid count");
        assert_eq!(paid_today_for(&conn, "u1a", day + 1).unwrap(), 0);
        assert_eq!(paid_today_global(&conn, day).unwrap(), 1);

        set_status(&conn, "r1", "paid", Some("ab"), Some(PAYOUT_ZAT), None, now).unwrap();
        let row = fetch(&conn, "r1").unwrap().unwrap();
        assert_eq!(row.status, "paid");
        assert_eq!(row.payout_zat, Some(PAYOUT_ZAT));

        assert_eq!(known_balance(&conn), None);
        record_after_payout(&conn, 9_000_000, 20_000, now);
        assert_eq!(known_balance(&conn), Some(9_000_000));
        assert_eq!(fee_estimate(&conn), 20_000);
        clear_known_balance(&conn);
        assert_eq!(known_balance(&conn), None);
    }
}
