//! Accrual ledger — step 1 of the payout-scaling plan
//! (`docs/SCALING_PAYOUTS.md`).
//!
//! Instead of firing one Orchard spend per ride (one 5,000-zat ZIP-317
//! action per rider per ride — the treasury wall), rides **accrue** to a
//! per-recipient pending balance off-chain. Coins move on-chain only when
//! a balance crosses the payout floor `F` or the rider withdraws, at which
//! point a balance is *settled* (paid). At `F = 0.01 ZEC` the fixed
//! per-settlement fee is ~0.5% of the amount instead of up to 100%.
//!
//! This module is **pure rusqlite + bookkeeping**: no network, no spend
//! pipeline, fully unit-testable. It does not change the proven autonomous
//! payout path — the backend opts in by calling [`accrue`] from
//! `post_claim` and running a settlement sweep over [`due_for_settlement`].
//!
//! ## Reservation, the same shape as the proven double-pay guard
//!
//! The binary already guards per-claim payouts with an atomic
//! `pending -> paying` transition (`begin_paying`). We mirror that at the
//! balance level: [`begin_settling`] atomically moves a recipient's
//! `pending_zat` into `settling_zat`, and only the caller that observes a
//! non-zero reservation proceeds to build the spend. That kills
//! double-settlement and is the per-balance analogue of note reservation.
//!
//! ## Durability / reconstructability
//!
//! Every credit is also written to the append-only `accruals` table keyed
//! by `claim_id`. A pending balance is therefore reconstructable by
//! replaying `accruals` minus what `settlements` recorded as paid — the
//! mitigation for the "off-chain liability" caveat in the design doc.

use crate::types::Zatoshi;
use rusqlite::{params, Connection};

/// Default payout floor: 0.01 ZEC. A balance settles on-chain once it
/// reaches this, making the fixed ~5,000-zat ZIP-317 fee ~0.5% overhead.
pub const DEFAULT_FLOOR_ZAT: Zatoshi = 1_000_000;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS balances (
    recipient_ua   TEXT PRIMARY KEY,
    pending_zat    INTEGER NOT NULL DEFAULT 0,  -- owed, not yet on-chain
    settling_zat   INTEGER NOT NULL DEFAULT 0,  -- reserved in an in-flight settlement
    lifetime_zat   INTEGER NOT NULL DEFAULT 0,  -- total ever credited
    rides_count    INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL DEFAULT 0
);

-- Append-only audit so pending balances are reconstructable.
CREATE TABLE IF NOT EXISTS accruals (
    claim_id     TEXT PRIMARY KEY,
    recipient_ua TEXT NOT NULL,
    amount_zat   INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
);

-- Append-only record of on-chain settlements.
CREATE TABLE IF NOT EXISTS settlements (
    txid_hex     TEXT NOT NULL,
    recipient_ua TEXT NOT NULL,
    amount_zat   INTEGER NOT NULL,
    settled_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balances_due
    ON balances(pending_zat, settling_zat);
";

/// One recipient owed a settlement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueRecipient {
    pub recipient_ua: String,
    pub amount_zat: Zatoshi,
}

/// Create the accrual tables if they don't exist. Safe to call repeatedly
/// (the backend can call this right after its existing `SCHEMA`).
pub fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)
}

/// Credit a verified ride's reward to the recipient's pending balance.
///
/// Idempotent on `claim_id`: a retried claim does not double-credit.
/// Returns `Ok(true)` if this was a new credit, `Ok(false)` if the
/// `claim_id` had already been accrued.
pub fn accrue(
    conn: &Connection,
    claim_id: &str,
    recipient_ua: &str,
    amount_zat: Zatoshi,
    now: u64,
) -> rusqlite::Result<bool> {
    // Append-only audit row first; the PRIMARY KEY makes this the
    // idempotency guard.
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO accruals (claim_id, recipient_ua, amount_zat, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![claim_id, recipient_ua, amount_zat as i64, now as i64],
    )?;
    if inserted == 0 {
        return Ok(false); // duplicate claim_id — already credited
    }

    conn.execute(
        "INSERT INTO balances (recipient_ua, pending_zat, lifetime_zat, rides_count, updated_at)
         VALUES (?1, ?2, ?2, 1, ?3)
         ON CONFLICT(recipient_ua) DO UPDATE SET
            pending_zat  = pending_zat  + excluded.pending_zat,
            lifetime_zat = lifetime_zat + excluded.lifetime_zat,
            rides_count  = rides_count  + 1,
            updated_at   = excluded.updated_at",
        params![recipient_ua, amount_zat as i64, now as i64],
    )?;
    Ok(true)
}

/// Record a ride that was paid on-chain IMMEDIATELY (auto-payout mode),
/// crediting lifetime totals without ever touching `pending_zat`.
///
/// WHY THIS EXISTS: `balances` was only ever written by `accrue()`, which
/// runs in accrual mode. In auto-payout mode — the mode Pedalshield
/// actually runs in — each claim is spent on-chain the moment it verifies,
/// so nothing wrote to `balances` at all and GET /balance/{ua} reported
/// lifetime 0 forever. The app's headline "LIFETIME REWARDS" figure read
/// zero after every ride.
///
/// `pending_zat` stays 0 on purpose: the money is already on chain, so
/// counting it as owed would double-pay it on the next settlement sweep.
/// Only lifetime totals and the ride count move.
///
/// Idempotent on `claim_id` via the `accruals` primary key, so a retried
/// or replayed payout cannot inflate a rider's lifetime figure.
pub fn record_direct_payout(
    conn: &Connection,
    claim_id: &str,
    recipient_ua: &str,
    amount_zat: Zatoshi,
    txid_hex: &str,
    now: u64,
) -> rusqlite::Result<bool> {
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO accruals (claim_id, recipient_ua, amount_zat, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![claim_id, recipient_ua, amount_zat as i64, now as i64],
    )?;
    if inserted == 0 {
        return Ok(false); // already counted
    }

    conn.execute(
        "INSERT INTO balances (recipient_ua, pending_zat, lifetime_zat, rides_count, updated_at)
         VALUES (?1, 0, ?2, 1, ?3)
         ON CONFLICT(recipient_ua) DO UPDATE SET
            lifetime_zat = lifetime_zat + excluded.lifetime_zat,
            rides_count  = rides_count  + 1,
            updated_at   = excluded.updated_at",
        params![recipient_ua, amount_zat as i64, now as i64],
    )?;

    // Same append-only settlement audit the accrual path writes, so both
    // modes produce one comparable on-chain history.
    conn.execute(
        "INSERT INTO settlements (txid_hex, recipient_ua, amount_zat, settled_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![txid_hex, recipient_ua, amount_zat as i64, now as i64],
    )?;
    Ok(true)
}

/// Current pending (owed, not-yet-settling) balance for a recipient.
pub fn pending(conn: &Connection, recipient_ua: &str) -> rusqlite::Result<Zatoshi> {
    let v: Option<i64> = conn
        .query_row(
            "SELECT pending_zat FROM balances WHERE recipient_ua = ?1",
            params![recipient_ua],
            |r| r.get(0),
        )
        .ok();
    Ok(v.unwrap_or(0) as Zatoshi)
}

/// Recipients whose pending balance has crossed the floor and that are not
/// already reserved in an in-flight settlement. These are the inputs to a
/// settlement batch. `limit` caps how many a single sweep returns (one
/// settlement tx's recipient count).
pub fn due_for_settlement(
    conn: &Connection,
    floor_zat: Zatoshi,
    limit: usize,
) -> rusqlite::Result<Vec<DueRecipient>> {
    let mut stmt = conn.prepare(
        "SELECT recipient_ua, pending_zat
         FROM balances
         WHERE pending_zat >= ?1 AND settling_zat = 0
         ORDER BY pending_zat DESC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![floor_zat as i64, limit as i64], |r| {
            Ok(DueRecipient {
                recipient_ua: r.get(0)?,
                amount_zat: r.get::<_, i64>(1)? as Zatoshi,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Atomically reserve a recipient's pending balance for settlement
/// (`pending -> settling`). Returns the reserved amount if this call won
/// the race (pending > 0 and nothing already settling), else `None`. Only
/// the winner should build + broadcast the spend. Mirrors the proven
/// per-claim `begin_paying` guard, at the balance level.
pub fn begin_settling(
    conn: &Connection,
    recipient_ua: &str,
    now: u64,
) -> rusqlite::Result<Option<Zatoshi>> {
    let n = conn.execute(
        "UPDATE balances
         SET settling_zat = pending_zat, pending_zat = 0, updated_at = ?2
         WHERE recipient_ua = ?1 AND pending_zat > 0 AND settling_zat = 0",
        params![recipient_ua, now as i64],
    )?;
    if n == 0 {
        return Ok(None);
    }
    let amount: i64 = conn.query_row(
        "SELECT settling_zat FROM balances WHERE recipient_ua = ?1",
        params![recipient_ua],
        |r| r.get(0),
    )?;
    Ok(Some(amount as Zatoshi))
}

/// Settlement succeeded: clear the reservation and record the on-chain
/// payment in the append-only `settlements` table.
pub fn mark_settled(
    conn: &Connection,
    recipient_ua: &str,
    amount_zat: Zatoshi,
    txid_hex: &str,
    now: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE balances
         SET settling_zat = settling_zat - ?2, updated_at = ?3
         WHERE recipient_ua = ?1",
        params![recipient_ua, amount_zat as i64, now as i64],
    )?;
    conn.execute(
        "INSERT INTO settlements (txid_hex, recipient_ua, amount_zat, settled_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![txid_hex, recipient_ua, amount_zat as i64, now as i64],
    )?;
    Ok(())
}

/// Settlement failed: return the reserved amount to pending so a later
/// sweep retries it.
pub fn revert_settling(
    conn: &Connection,
    recipient_ua: &str,
    now: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE balances
         SET pending_zat = pending_zat + settling_zat, settling_zat = 0, updated_at = ?2
         WHERE recipient_ua = ?1",
        params![recipient_ua, now as i64],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        conn
    }

    const UA: &str = "u1testrecipient";

    #[test]
    fn accrue_credits_pending() {
        let c = db();
        assert!(accrue(&c, "ride-1", UA, 30_000, 1).unwrap());
        assert_eq!(pending(&c, UA).unwrap(), 30_000);
    }

    #[test]
    fn accrue_is_idempotent_on_claim_id() {
        let c = db();
        assert!(accrue(&c, "ride-1", UA, 30_000, 1).unwrap());
        // Same claim_id retried — must NOT double-credit.
        assert!(!accrue(&c, "ride-1", UA, 30_000, 2).unwrap());
        assert_eq!(pending(&c, UA).unwrap(), 30_000);
    }

    #[test]
    fn accruals_accumulate_across_rides() {
        let c = db();
        accrue(&c, "ride-1", UA, 200_000, 1).unwrap();
        accrue(&c, "ride-2", UA, 350_000, 2).unwrap();
        accrue(&c, "ride-3", UA, 100_000, 3).unwrap();
        assert_eq!(pending(&c, UA).unwrap(), 650_000);
    }

    #[test]
    fn below_floor_is_not_due_crossing_floor_is() {
        let c = db();
        accrue(&c, "ride-1", UA, 400_000, 1).unwrap(); // < 0.01 ZEC floor
        assert!(due_for_settlement(&c, DEFAULT_FLOOR_ZAT, 100).unwrap().is_empty());
        accrue(&c, "ride-2", UA, 700_000, 2).unwrap(); // now 1_100_000 >= floor
        let due = due_for_settlement(&c, DEFAULT_FLOOR_ZAT, 100).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].amount_zat, 1_100_000);
    }

    #[test]
    fn begin_settling_reserves_and_blocks_double_settle() {
        let c = db();
        accrue(&c, "ride-1", UA, 1_500_000, 1).unwrap();
        let amt = begin_settling(&c, UA, 2).unwrap();
        assert_eq!(amt, Some(1_500_000));
        // Reserved: pending is now 0, so it is no longer "due", and a
        // second settlement attempt finds nothing to reserve.
        assert!(due_for_settlement(&c, DEFAULT_FLOOR_ZAT, 100).unwrap().is_empty());
        assert_eq!(begin_settling(&c, UA, 3).unwrap(), None);
    }

    #[test]
    fn mark_settled_clears_reservation_and_records_tx() {
        let c = db();
        accrue(&c, "ride-1", UA, 1_500_000, 1).unwrap();
        let amt = begin_settling(&c, UA, 2).unwrap().unwrap();
        mark_settled(&c, UA, amt, "deadbeef", 3).unwrap();
        // Nothing pending, nothing settling.
        assert_eq!(pending(&c, UA).unwrap(), 0);
        let settling: i64 = c
            .query_row(
                "SELECT settling_zat FROM balances WHERE recipient_ua = ?1",
                params![UA],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(settling, 0);
        let recorded: i64 = c
            .query_row("SELECT COUNT(*) FROM settlements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(recorded, 1);
    }

    #[test]
    fn revert_settling_returns_funds_for_retry() {
        let c = db();
        accrue(&c, "ride-1", UA, 1_500_000, 1).unwrap();
        begin_settling(&c, UA, 2).unwrap();
        revert_settling(&c, UA, 3).unwrap();
        // Back to pending and due again.
        assert_eq!(pending(&c, UA).unwrap(), 1_500_000);
        assert_eq!(due_for_settlement(&c, DEFAULT_FLOOR_ZAT, 100).unwrap().len(), 1);
    }

    #[test]
    fn new_rides_accrue_during_an_in_flight_settlement() {
        let c = db();
        accrue(&c, "ride-1", UA, 1_500_000, 1).unwrap();
        begin_settling(&c, UA, 2).unwrap(); // reserves the 1_500_000
        // A fresh ride lands while the settlement is in flight; it starts
        // a new pending window and must not be lost.
        accrue(&c, "ride-2", UA, 250_000, 3).unwrap();
        assert_eq!(pending(&c, UA).unwrap(), 250_000);
    }
}
