//! Sponsor audit packs: one-note disclosures for every payout a sponsor made,
//! plus a statement an auditor can re-verify against the chain.
//!
//! The sponsor (payer) recovers each of its own payment notes with its
//! outgoing viewing key, so building a pack needs no rider keys and no rider
//! cooperation. The pack contains, per payout: txid, pool, action index,
//! the receiver, the value and `rseed`. It contains no route, no claim data
//! and no key material.
//!
//! What an auditor can learn from a pack beyond the totals: the receiver of
//! each payout. Riders who reuse one address across payouts are linkable
//! *to each other* within the pack (not to a person). Ghost Commute riders use
//! a fresh diversified address per payout, which removes that.

use std::collections::BTreeMap;

use anyhow::{anyhow, ensure, Context, Result};
use orchard::keys::FullViewingKey;
use serde_json::{json, Value};
use zcash_protocol::TxId;

use crate::{
    disclose::{self, Role},
    net::{self, Net},
};

pub const PACK_VERSION: &str = "ghost-commute/audit-pack/1";
pub const STATEMENT_VERSION: &str = "ghost-commute/audit-statement/1";

fn tx_file_for(tx_dir: Option<&str>, txid: &TxId) -> Option<String> {
    tx_dir.map(|d| format!("{d}/{txid}.hex"))
}

fn zec(z: u64) -> String {
    format!("{}.{:08}", z / 100_000_000, z % 100_000_000)
}

pub fn read_txids(path: &str) -> Result<Vec<TxId>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {path}"))?;
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(net::parse_txid)
        .collect()
}

pub async fn pack(
    fvk: &FullViewingKey,
    txids: &[TxId],
    tx_dir: Option<&str>,
    server: Option<&str>,
    n: Net,
    label: &str,
    out_dir: &str,
) -> Result<Value> {
    std::fs::create_dir_all(out_dir)?;
    let mut files = vec![];
    let mut skipped = vec![];
    for txid in txids {
        let tf = tx_file_for(tx_dir, txid);
        let (tx, height, _source) = net::load_tx(txid, tf.as_deref(), server, n).await?;
        let found = disclose::find_notes(&tx, fvk, Role::Sender);
        if found.is_empty() {
            skipped.push(txid.to_string());
            eprintln!("  · {txid}: no outgoing payment recoverable with this key (not ours, or sent without OVK)");
            continue;
        }
        for f in &found {
            let d = disclose::make_disclosure(f, &txid.to_string(), n, height)?;
            let name = format!("{}-{}-{}.json", &txid.to_string()[..16], f.pool.name(), f.action_index);
            std::fs::write(format!("{out_dir}/{name}"), serde_json::to_string_pretty(&d)?)?;
            eprintln!("  ✓ {txid} {} #{}: {} ZEC", f.pool.name(), f.action_index, zec(f.note.value().inner()));
            files.push(name);
        }
    }
    let manifest = json!({
        "v": PACK_VERSION,
        "label": label,
        "network": n.name(),
        "issued_by": "sender",
        "disclosures": files,
        "txids_without_payments": skipped,
        "contains": ["txid", "pool", "action index", "receiver", "value", "rseed (opens that one note only)"],
        "does_not_contain": ["routes", "GPS", "claim data", "rider identity", "viewing keys", "spending keys", "other wallet activity"],
    });
    std::fs::write(format!("{out_dir}/pack.json"), serde_json::to_string_pretty(&manifest)?)?;
    Ok(manifest)
}

pub async fn verify(pack_dir: &str, tx_dir: Option<&str>, server: Option<&str>) -> Result<Value> {
    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(format!("{pack_dir}/pack.json")).context("reading pack.json")?,
    )?;
    ensure!(manifest["v"] == PACK_VERSION, "unknown pack version");
    let n = Net::from_name(manifest["network"].as_str().unwrap_or("test"))?;
    let files: Vec<String> = manifest["disclosures"]
        .as_array()
        .ok_or_else(|| anyhow!("pack has no disclosures"))?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();

    let mut items = vec![];
    let (mut total, mut ok_count, mut receipts) = (0u64, 0usize, 0usize);
    let mut pools: BTreeMap<String, usize> = BTreeMap::new();
    let mut heights: Vec<u32> = vec![];
    let mut seen = std::collections::HashSet::new();
    let mut offline = false;
    for f in &files {
        let d: Value = serde_json::from_str(&std::fs::read_to_string(format!("{pack_dir}/{f}"))?)?;
        let txid = net::parse_txid(d["txid"].as_str().unwrap_or_default())?;
        let tf = tx_file_for(tx_dir, &txid);
        offline |= tf.is_some();
        let key = format!("{}:{}:{}", d["txid"], d["pool"], d["action_index"]);
        ensure!(seen.insert(key), "pack lists the same note twice ({f})");
        let item = match async {
            let (tx, height, source) = net::load_tx(&txid, tf.as_deref(), server, n).await?;
            disclose::verify(&d, &tx, height, source, None, n)
        }
        .await
        {
            Ok(r) => {
                let ok = r.ok();
                if ok {
                    ok_count += 1;
                    total += r.value_zat;
                    *pools.entry(r.pool.name().into()).or_default() += 1;
                    if let Some(h) = r.mined_height {
                        heights.push(h);
                    }
                    if r.receipt_id.is_some() {
                        receipts += 1;
                    }
                }
                json!({"txid": r.txid, "pool": r.pool.name(), "action_index": r.action_index,
                       "value_zat": r.value_zat, "mined_height": r.mined_height,
                       "receipt_id": r.receipt_id, "memo_sha256": r.memo_sha256, "verified": ok})
            }
            Err(e) => json!({"txid": txid.to_string(), "verified": false, "error": e.to_string()}),
        };
        items.push(item);
    }
    Ok(json!({
        "v": STATEMENT_VERSION,
        "label": manifest["label"],
        "network": n.name(),
        "payouts": files.len(),
        "verified": ok_count,
        "all_verified": ok_count == files.len() && !files.is_empty(),
        "total_zat": total,
        "total_zec": zec(total),
        "pools": pools,
        "mined_height_range": if heights.is_empty() { Value::Null } else { json!([heights.iter().min(), heights.iter().max()]) },
        "with_ghost_receipt": receipts,
        "chain_inclusion": if offline { "NOT checked (offline tx files)" } else { "lightwalletd-reported mined heights" },
        "route": "withheld",
        "items": items,
    }))
}

pub fn print_statement(s: &Value) {
    println!();
    println!("  ┌──────────────────────────────────────────────────────────────┐");
    println!("  │  SPONSOR AUDIT STATEMENT · {:<34}│", if s["all_verified"] == true { "ALL PAYOUTS VERIFIED" } else { "NOT ALL VERIFIED" });
    println!("  └──────────────────────────────────────────────────────────────┘");
    println!("  label      {}", s["label"].as_str().unwrap_or(""));
    println!("  network    {}", s["network"].as_str().unwrap_or(""));
    println!("  payouts    {} verified of {}", s["verified"], s["payouts"]);
    println!("  total      {} ZEC ({} zat)", s["total_zec"].as_str().unwrap_or(""), s["total_zat"]);
    println!("  pools      {}", s["pools"]);
    println!("  heights    {}", s["mined_height_range"]);
    println!("  inclusion  {}", s["chain_inclusion"].as_str().unwrap_or(""));
    println!("  routes     WITHHELD — the pack has no field that could hold one");
    println!();
    for it in s["items"].as_array().into_iter().flatten() {
        let mark = if it["verified"] == true { "✓" } else { "✗" };
        let v = it["value_zat"].as_u64().map(zec).unwrap_or_else(|| "—".into());
        let t = it["txid"].as_str().unwrap_or("");
        println!(
            "  {mark} {}…  {:>10} ZEC  {:<8} {}",
            &t[..t.len().min(16)],
            v,
            it["pool"].as_str().unwrap_or(""),
            it["error"].as_str().unwrap_or("")
        );
    }
    println!();
}
