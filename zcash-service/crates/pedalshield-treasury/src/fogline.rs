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
/// Held back so fees can never strand the last notes in the pot. Sized for
/// the live 0.03 ZEC pot: 500,000 zat covers 50 Ironwood-only spends at the
/// measured 10,000 zat fee (25 at the conservative 20,000 default).
pub const FEE_RESERVE_ZAT: u64 = 500_000;
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
    #[serde(default)]
    chapters: Vec<ChapterDef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct QuestDef {
    pub id: String,
    pub need: usize,
    pub stops: Vec<QuestStop>,
    /// Memo text delivered with this quest's drop.
    #[serde(default)]
    pub letter: String,
}

/// A chapter of the letter chain. Its rule is evaluated on the phone (it is
/// location-free, so there is nothing for the server to re-check); the
/// server owns the ORDER, the per-address codes, and the letters.
#[derive(Debug, Clone, Deserialize)]
pub struct ChapterDef {
    pub id: String,
    pub title: String,
    pub letter: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
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

/// All chapters, in order.
pub fn chapters() -> &'static [ChapterDef] {
    static C: OnceLock<Vec<ChapterDef>> = OnceLock::new();
    C.get_or_init(|| {
        serde_json::from_str::<QuestFile>(QUESTS_JSON)
            .expect("mobile/src/map/quests.json is malformed")
            .chapters
    })
}

pub fn chapter_index(id: &str) -> Option<usize> {
    chapters().iter().position(|c| c.id == id)
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
    /// Code from the previous chapter's letter. Required from chapter 2 on.
    pub code: Option<String>,
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

/// What a claim is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// A public, place-based quest (the River Line).
    Quest(&'static QuestDef),
    /// Chapter `n` (0-based) of the letter chain.
    Chapter(usize),
}

/// Structural validation. `Err` is a 400. Quest and chapter rules are
/// evaluated on the phone; the server never receives the tiles it would
/// need to re-check them, by design. What the server checks: the claim is
/// well-formed, the ride verified, the target exists, and any code is
/// well-formed (whether it is the RIGHT code is `check_chain`'s job).
pub fn evaluate(c: &FoglineClaim) -> Result<Target, String> {
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
    if let Some(code) = &c.code {
        if !is_code(code) {
            return Err("code is malformed".into());
        }
    }
    if let Some(i) = chapter_index(&c.quest_id) {
        return Ok(Target::Chapter(i));
    }
    quest(&c.quest_id)
        .map(Target::Quest)
        .ok_or_else(|| format!("unknown quest {}", c.quest_id))
}

// ---------------------------------------------------------------------
// Letter chain: per-address codes
// ---------------------------------------------------------------------

/// 32 symbols with no I, O, 0 or 1 — and 256 is a multiple of 32, so
/// `byte % 32` is unbiased.
const CODE_ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// `ABCD-EFGH` over CODE_ALPHABET — mirrors CODE_PATTERN in chapters.ts.
pub fn is_code(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 9
        && b[4] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || CODE_ALPHABET.contains(c))
}

/// The code that opens chapter `chapter` for address `ua`. Deterministic
/// under the server secret, unguessable without it, and different for every
/// address — a code posted online opens nothing for anyone else.
pub fn mint_code(secret: &[u8; 32], ua: &str, chapter: usize) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(format!("fogline-code-v1|{ua}|{chapter}").as_bytes());
    let tag = mac.finalize().into_bytes();
    let ch: Vec<char> = tag
        .iter()
        .take(8)
        .map(|b| CODE_ALPHABET[(b % 32) as usize] as char)
        .collect();
    format!(
        "{}-{}",
        ch[..4].iter().collect::<String>(),
        ch[4..].iter().collect::<String>()
    )
}

/// Is this claim for the chapter this address is on, with the right code?
/// `Err` carries a machine-readable prefix the app acts on.
pub fn check_chain(
    position: usize,
    chapter: usize,
    code: Option<&str>,
    expected: Option<&str>,
) -> Result<(), String> {
    if chapter != position {
        return Err(format!("chapter_mismatch: this address is on chapter {}", position + 1));
    }
    if position == 0 {
        return Ok(());
    }
    match (code, expected) {
        (Some(c), Some(e)) if c == e => Ok(()),
        _ => Err("code_mismatch: that code does not match your last letter".into()),
    }
}

/// The memo for a drop: the letter, and the next chapter's code when there
/// is one. Validated against the 512-byte limit by tests.
pub fn letter_memo(target: Target, next_code: Option<&str>) -> String {
    match target {
        Target::Quest(q) => q.letter.clone(),
        Target::Chapter(i) => {
            let letter = &chapters()[i].letter;
            match next_code {
                Some(code) => format!(
                    "{letter}\n\nNEXT CODE: {code}\nEnter it in Fogline to open the next chapter."
                ),
                None => letter.clone(),
            }
        }
    }
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
    chapter        INTEGER,         -- chain chapter (0-based) when quest_id is a chapter
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
CREATE TABLE IF NOT EXISTS fogline_chain (
    recipient_ua   TEXT PRIMARY KEY,
    next_chapter   INTEGER NOT NULL,  -- 0-based chapter this address plays next
    updated_at     INTEGER NOT NULL
);
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
    chapter: Option<usize>,
    status: &str,
    reason: Option<&str>,
    now: u64,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO fogline_claims
           (ride_id, recipient_ua, quest_id, chapter, status, reason, utc_day, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![ride_id, ua, quest_id, chapter.map(|c| c as i64), status, reason, utc_day(now), now as i64],
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

/// The chapter this address plays next (0 if it has never claimed).
pub fn chain_position(conn: &Connection, ua: &str) -> rusqlite::Result<usize> {
    let v: Option<i64> = conn
        .query_row(
            "SELECT next_chapter FROM fogline_chain WHERE recipient_ua = ?1",
            params![ua],
            |r| r.get(0),
        )
        .optional()?;
    Ok(v.map(|n| n.max(0) as usize).unwrap_or(0))
}

pub fn set_chain_position(conn: &Connection, ua: &str, next: usize, now: u64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO fogline_chain (recipient_ua, next_chapter, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(recipient_ua) DO UPDATE SET next_chapter = excluded.next_chapter,
                                                updated_at = excluded.updated_at",
        params![ua, next as i64, now as i64],
    )?;
    Ok(())
}

/// Undo a chapter reservation after a failed or paused letter — but only if
/// the address still sits exactly one past it, so a later success is never
/// rolled back by a stale failure.
pub fn rollback_chain(conn: &Connection, ua: &str, chapter: usize, now: u64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE fogline_chain SET next_chapter = ?2, updated_at = ?3
          WHERE recipient_ua = ?1 AND next_chapter = ?4",
        params![ua, chapter as i64, now as i64, (chapter + 1) as i64],
    )?;
    Ok(())
}

/// Startup recovery: nothing can be mid-payout at boot, so every `paying`
/// row was abandoned. Mark it failed (it stops counting against caps) and
/// return its chapter reservation, so the rider is not stranded waiting for
/// a letter that will never come.
pub fn recover_abandoned(conn: &Connection, now: u64) -> rusqlite::Result<usize> {
    let rows: Vec<(String, Option<i64>)> = {
        let mut st = conn.prepare(
            "SELECT recipient_ua, chapter FROM fogline_claims WHERE status = 'paying'",
        )?;
        let it = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        it.collect::<rusqlite::Result<_>>()?
    };
    for (ua, ch) in &rows {
        if let Some(c) = ch {
            rollback_chain(conn, ua, (*c).max(0) as usize, now)?;
        }
    }
    conn.execute(
        "UPDATE fogline_claims SET status = 'failed', updated_at = ?1,
             reason = 'auto-recovered: payout abandoned at restart'
         WHERE status = 'paying'",
        params![now as i64],
    )?;
    Ok(rows.len())
}

/// The server's code secret, created on first use and kept only in this
/// database. Losing it invalidates outstanding codes (riders mid-chain would
/// need a re-sent letter); it is never logged or returned by any endpoint.
pub fn code_secret(conn: &Connection, now: u64) -> rusqlite::Result<[u8; 32]> {
    const KEY: &str = "fogline_code_secret";
    let existing: Option<String> = conn
        .query_row("SELECT value FROM wallet_state WHERE key = ?1", params![KEY], |r| r.get(0))
        .optional()?;
    if let Some(h) = existing {
        if let Ok(bytes) = hex::decode(h.trim()) {
            if let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice()) {
                return Ok(arr);
            }
        }
    }
    let mut fresh = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut fresh);
    conn.execute(
        "INSERT INTO wallet_state (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO NOTHING",
        params![KEY, hex::encode(fresh), now as i64],
    )?;
    // Re-read: if two callers raced, both end up with the stored one.
    let stored: String =
        conn.query_row("SELECT value FROM wallet_state WHERE key = ?1", params![KEY], |r| r.get(0))?;
    let bytes = hex::decode(stored.trim()).map_err(|_| rusqlite::Error::InvalidQuery)?;
    <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| rusqlite::Error::InvalidQuery)
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
            code: None,
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
        // The reserve must cover at least 25 spends at the conservative fee.
        assert!(FEE_RESERVE_ZAT >= 25 * DEFAULT_FEE_ESTIMATE_ZAT);
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
        match evaluate(&claim()).unwrap() {
            Target::Quest(q) => assert_eq!(q.id, "q-bend-river-line"),
            other => panic!("expected the River Line, got {other:?}"),
        }
    }

    #[test]
    fn chapters_parse_in_order() {
        let ids: Vec<&str> = chapters().iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["ch-1", "ch-2", "ch-3"]);
        let mut c = claim();
        c.quest_id = "ch-2".into();
        assert_eq!(evaluate(&c).unwrap(), Target::Chapter(1));
    }

    #[test]
    fn codes_are_per_address_and_well_formed() {
        let secret = [7u8; 32];
        let a = mint_code(&secret, "u1alice", 1);
        assert!(is_code(&a), "{a}");
        assert_eq!(a, mint_code(&secret, "u1alice", 1), "deterministic");
        assert_ne!(a, mint_code(&secret, "u1bob", 1), "per address");
        assert_ne!(a, mint_code(&secret, "u1alice", 2), "per chapter");
        assert_ne!(a, mint_code(&[8u8; 32], "u1alice", 1), "per secret");
        for bad in ["", "ABCD-EFG", "ABCDEFGHI", "ABCD-EFG0", "abcd-efgh", "ABCD_EFGH"] {
            assert!(!is_code(bad), "{bad}");
        }
        let mut c = claim();
        c.code = Some("not-a-code".into());
        assert!(evaluate(&c).is_err());
    }

    #[test]
    fn chain_order_and_codes_are_enforced() {
        let e = Some("ABCD-EFGH");
        assert!(check_chain(0, 0, None, None).is_ok(), "chapter 1 needs no code");
        assert!(check_chain(1, 1, e, e).is_ok());
        let wrong = check_chain(1, 1, Some("ZZZZ-ZZZZ"), e).unwrap_err();
        assert!(wrong.starts_with("code_mismatch"));
        assert!(check_chain(1, 1, None, e).unwrap_err().starts_with("code_mismatch"));
        let skip = check_chain(0, 2, e, e).unwrap_err();
        assert!(skip.starts_with("chapter_mismatch"));
        assert!(check_chain(2, 1, e, e).unwrap_err().starts_with("chapter_mismatch"), "no replaying an old chapter");
    }

    #[test]
    fn every_letter_fits_in_a_memo() {
        let code = mint_code(&[1u8; 32], "u1x", 1);
        for i in 0..chapters().len() {
            let next = if i + 1 < chapters().len() { Some(code.as_str()) } else { None };
            let memo = letter_memo(Target::Chapter(i), next);
            assert!(crate::spend::spender::text_memo(&memo).is_ok(), "chapter {i}: {} bytes", memo.len());
            if let Some(c) = next {
                assert!(memo.contains(c), "chapter {i} memo must carry the next code");
            }
        }
        let last = letter_memo(Target::Chapter(chapters().len() - 1), None);
        assert!(!last.contains("NEXT CODE"), "the finale has no next chapter");
        let river = letter_memo(Target::Quest(&quests()[0]), None);
        assert!(crate::spend::spender::text_memo(&river).is_ok());
    }

    #[test]
    fn letters_carry_no_location() {
        for c in chapters() {
            assert!(!c.letter.contains("fl1:"), "{}", c.id);
        }
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
            code: None,
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
        assert!(insert(&conn, "r1", "u1a", "q", None, "paying", None, now).unwrap());
        assert!(!insert(&conn, "r1", "u1a", "q", None, "paying", None, now).unwrap(), "idempotent");
        assert_eq!(paid_today_for(&conn, "u1a", day).unwrap(), 1);

        insert(&conn, "r2", "u1a", "q", None, "capped", None, now).unwrap();
        insert(&conn, "r3", "u1a", "q", None, "failed", None, now).unwrap();
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

    #[test]
    fn chain_reserve_rollback_and_recovery() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(
            "CREATE TABLE wallet_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);",
        )
        .unwrap();
        let now = 1_800_000_000;

        assert_eq!(chain_position(&conn, "u1a").unwrap(), 0);
        // Reserve chapter 0 while its letter pays.
        set_chain_position(&conn, "u1a", 1, now).unwrap();
        insert(&conn, "r1", "u1a", "ch-1", Some(0), "paying", None, now).unwrap();

        // A stale rollback for a different chapter changes nothing.
        rollback_chain(&conn, "u1a", 2, now).unwrap();
        assert_eq!(chain_position(&conn, "u1a").unwrap(), 1);

        // Crash mid-payout: recovery fails the row and returns the reservation.
        assert_eq!(recover_abandoned(&conn, now).unwrap(), 1);
        assert_eq!(fetch(&conn, "r1").unwrap().unwrap().status, "failed");
        assert_eq!(chain_position(&conn, "u1a").unwrap(), 0);

        // The secret is created once and then stable.
        let s1 = code_secret(&conn, now).unwrap();
        let s2 = code_secret(&conn, now).unwrap();
        assert_eq!(s1, s2);
        assert_ne!(s1, [0u8; 32]);
    }
}
