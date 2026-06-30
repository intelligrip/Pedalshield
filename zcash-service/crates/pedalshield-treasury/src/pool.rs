//! Reward-pool ledger — the treasury's inflows and outflows in one place, so
//! the pool stops being a pure outflow.
//!
//! Three jobs, all pure rusqlite bookkeeping (no network, no spend pipeline),
//! same shape as [`crate::accrual`]:
//!
//!   1. INFLOWS  — crypto miners (and donors) send ZEC to the treasury pool
//!      address. The viewing-key scanner detects each inbound note and calls
//!      [`record_inflow`], idempotent on the funding txid, tagging the source
//!      from the memo (`miner:<id>`, `mining-split`, `donation`).
//!   2. OUTFLOWS — every reward settlement records the amount paid to riders
//!      AND the network fee the pool bore, via [`record_outflow`], so runway
//!      reflects true cost.
//!   3. FEE RECOVERY — [`fee_buffer_zat`] computes each ride's amortized share
//!      of the ZIP-317 settlement fee; collecting it ([`add_fee_recovery`])
//!      keeps the pool whole instead of bleeding the fixed fee per batch.
//!
//! Net spendable balance and days of runway fall out of the ledger:
//! [`pool_net`], [`runway_days`].

use crate::types::Zatoshi;
use rusqlite::{params, Connection};

/// Approx. ZIP-317 fee for a single-action shielded spend.
pub const DEFAULT_FEE_ZAT: Zatoshi = 5_000;

pub const SCHEMA: &str = "
-- Inbound ZEC: miner contributions + donations. Idempotent on funding txid.
CREATE TABLE IF NOT EXISTS pool_inflows (
    txid_hex   TEXT PRIMARY KEY,
    source     TEXT NOT NULL,       -- 'miner:<id>' | 'mining-split' | 'donation'
    amount_zat INTEGER NOT NULL,
    memo       TEXT,
    created_at INTEGER NOT NULL
);

-- Reward settlements paid out of the pool, with the fee the pool bore.
CREATE TABLE IF NOT EXISTS pool_outflows (
    txid_hex     TEXT NOT NULL,
    recipient_ua TEXT NOT NULL,
    amount_zat   INTEGER NOT NULL,  -- reward actually paid to riders
    fee_zat      INTEGER NOT NULL,  -- network fee the pool bore
    rides        INTEGER NOT NULL DEFAULT 1,
    settled_at   INTEGER NOT NULL
);

-- Singleton row accumulating per-ride fee buffers collected back into the pool.
CREATE TABLE IF NOT EXISTS pool_fee_recovery (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    recovered_zat INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO pool_fee_recovery (id, recovered_zat) VALUES (1, 0);
";

/// Aggregate snapshot of the pool for reporting / the `/pool` endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoolStats {
    pub total_in_zat: Zatoshi,
    pub rewards_out_zat: Zatoshi,
    pub fees_zat: Zatoshi,
    pub recovered_zat: Zatoshi,
    pub net_zat: Zatoshi,
    pub inflow_count: u64,
}

pub fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA)
}

/// Credit an inbound contribution (miner/donation). Idempotent on `txid_hex`:
/// a re-scanned note does not double-credit. Returns `true` if newly recorded.
pub fn record_inflow(
    conn: &Connection,
    txid_hex: &str,
    source: &str,
    amount_zat: Zatoshi,
    memo: Option<&str>,
    now: u64,
) -> rusqlite::Result<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO pool_inflows (txid_hex, source, amount_zat, memo, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![txid_hex, source, amount_zat as i64, memo, now as i64],
    )?;
    Ok(n == 1)
}

/// Record a reward settlement paid out of the pool.
pub fn record_outflow(
    conn: &Connection,
    txid_hex: &str,
    recipient_ua: &str,
    amount_zat: Zatoshi,
    fee_zat: Zatoshi,
    rides: u64,
    now: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO pool_outflows (txid_hex, recipient_ua, amount_zat, fee_zat, rides, settled_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            txid_hex,
            recipient_ua,
            amount_zat as i64,
            fee_zat as i64,
            rides as i64,
            now as i64
        ],
    )?;
    Ok(())
}

/// Add a collected per-ride fee buffer to the recovery counter.
pub fn add_fee_recovery(conn: &Connection, buffer_zat: Zatoshi) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE pool_fee_recovery SET recovered_zat = recovered_zat + ?1 WHERE id = 1",
        params![buffer_zat as i64],
    )?;
    Ok(())
}

fn sum(conn: &Connection, sql: &str) -> rusqlite::Result<Zatoshi> {
    let v: i64 = conn.query_row(sql, [], |r| r.get(0))?;
    Ok(v.max(0) as Zatoshi)
}

/// One-shot aggregate snapshot of the pool.
pub fn stats(conn: &Connection) -> rusqlite::Result<PoolStats> {
    let total_in = sum(conn, "SELECT COALESCE(SUM(amount_zat),0) FROM pool_inflows")?;
    let rewards_out = sum(conn, "SELECT COALESCE(SUM(amount_zat),0) FROM pool_outflows")?;
    let fees = sum(conn, "SELECT COALESCE(SUM(fee_zat),0) FROM pool_outflows")?;
    let recovered: Zatoshi = conn
        .query_row(
            "SELECT recovered_zat FROM pool_fee_recovery WHERE id = 1",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v.max(0) as Zatoshi)
        .unwrap_or(0);
    let inflow_count: u64 = conn
        .query_row("SELECT COUNT(*) FROM pool_inflows", [], |r| {
            r.get::<_, i64>(0)
        })
        .map(|v| v.max(0) as u64)
        .unwrap_or(0);
    let net = pool_net_from(total_in, rewards_out, fees);
    Ok(PoolStats {
        total_in_zat: total_in,
        rewards_out_zat: rewards_out,
        fees_zat: fees,
        recovered_zat: recovered,
        net_zat: net,
        inflow_count,
    })
}

/// Net spendable = inflows − rewards paid − fees borne (saturating at 0).
pub fn pool_net(conn: &Connection) -> rusqlite::Result<Zatoshi> {
    Ok(stats(conn)?.net_zat)
}

fn pool_net_from(total_in: Zatoshi, rewards_out: Zatoshi, fees: Zatoshi) -> Zatoshi {
    total_in.saturating_sub(rewards_out).saturating_sub(fees)
}

/// Per-ride amortized share of a settlement fee: `ceil(reward * fee / floor)`.
///
/// A settlement fires when a balance reaches `floor` and costs ~`fee` in
/// network fees. Charging each ride this fraction of the fee means the buffers
/// collected over one floor's worth of rewards sum to ≈ the fee — so batched
/// settlement fees are recovered into the pool rather than bleeding it.
pub fn fee_buffer_zat(reward_zat: Zatoshi, floor_zat: Zatoshi, fee_zat: Zatoshi) -> Zatoshi {
    if floor_zat == 0 {
        return 0;
    }
    let num = reward_zat as u128 * fee_zat as u128 + (floor_zat as u128 - 1);
    (num / floor_zat as u128) as Zatoshi
}

/// Days of runway: net pool ÷ daily reward burn. Infinite if burn is zero.
pub fn runway_days(net_zat: Zatoshi, daily_burn_zat: Zatoshi) -> f64 {
    if daily_burn_zat == 0 {
        f64::INFINITY
    } else {
        net_zat as f64 / daily_burn_zat as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn inflow_is_idempotent_on_txid() {
        let c = db();
        assert!(record_inflow(&c, "tx1", "miner:alice", 50_000_000, Some("MINER:alice"), 1).unwrap());
        // Same txid re-scanned — must not double-credit.
        assert!(!record_inflow(&c, "tx1", "miner:alice", 50_000_000, None, 2).unwrap());
        assert_eq!(stats(&c).unwrap().total_in_zat, 50_000_000);
        assert_eq!(stats(&c).unwrap().inflow_count, 1);
    }

    #[test]
    fn net_is_inflows_minus_rewards_and_fees() {
        let c = db();
        record_inflow(&c, "tx1", "mining-split", 100_000_000, None, 1).unwrap();
        record_inflow(&c, "tx2", "donation", 20_000_000, None, 1).unwrap();
        record_outflow(&c, "txp", "u1rider", 30_000_000, 5_000, 12, 2).unwrap();
        let s = stats(&c).unwrap();
        assert_eq!(s.total_in_zat, 120_000_000);
        assert_eq!(s.rewards_out_zat, 30_000_000);
        assert_eq!(s.fees_zat, 5_000);
        assert_eq!(s.net_zat, 120_000_000 - 30_000_000 - 5_000);
    }

    #[test]
    fn net_saturates_at_zero() {
        let c = db();
        record_outflow(&c, "txp", "u1rider", 10, 5_000, 1, 1).unwrap();
        assert_eq!(pool_net(&c).unwrap(), 0);
    }

    #[test]
    fn fee_buffer_amortizes_the_fee_over_a_floor() {
        // A full floor's worth of reward pays ≈ the whole fee.
        assert_eq!(fee_buffer_zat(1_000_000, 1_000_000, 5_000), 5_000);
        // A tenth of the floor pays ≈ a tenth of the fee (ceil).
        assert_eq!(fee_buffer_zat(100_000, 1_000_000, 5_000), 500);
        // Sum over ten such rides recovers the full fee.
        let total: Zatoshi = (0..10).map(|_| fee_buffer_zat(100_000, 1_000_000, 5_000)).sum();
        assert!(total >= 5_000);
    }

    #[test]
    fn fee_buffer_zero_floor_is_safe() {
        assert_eq!(fee_buffer_zat(100_000, 0, 5_000), 0);
    }

    #[test]
    fn fee_recovery_accumulates() {
        let c = db();
        add_fee_recovery(&c, 500).unwrap();
        add_fee_recovery(&c, 500).unwrap();
        assert_eq!(stats(&c).unwrap().recovered_zat, 1_000);
    }

    #[test]
    fn runway_in_days() {
        // 1 ZEC net, burning 0.01 ZEC/day -> 100 days.
        assert!((runway_days(100_000_000, 1_000_000) - 100.0).abs() < 1e-9);
        assert_eq!(runway_days(100_000_000, 0), f64::INFINITY);
    }
}
