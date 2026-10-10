//! One-note payment disclosure.
//!
//! The rider (or the sponsor, who can recover its own outputs with its OVK)
//! reveals the *opening* of exactly one shielded note: recipient receiver,
//! value, and `rseed`. `rho` is not revealed because it is public: in the
//! Orchard protocol it is the nullifier of the action that created the note.
//!
//! Anyone holding the disclosure and the transaction can then:
//!   1. rebuild the note and check its commitment equals the action's `cmx`
//!      (so the value and recipient are exactly what was put on chain);
//!   2. derive `esk` from `rseed` (ZIP 212), check it reproduces the action's
//!      ephemeral key, and decrypt that one action's ciphertext, which yields
//!      the memo;
//!   3. check the memo's receipt id against the rider's signed attestation.
//!
//! Steps 1 and 2 are `zcash_note_encryption::try_output_recovery_with_pkd_esk`,
//! the same routine a wallet uses to recover its own sent notes; nothing here
//! is new cryptography. No other note, key, or address of either party is
//! exposed, and the route was never in the transaction to begin with.

use anyhow::{anyhow, bail, ensure, Context, Result};
use orchard::{
    keys::{PreparedIncomingViewingKey, Scope},
    note::{RandomSeed, Rho},
    note_encryption::{IronwoodDomain, OrchardDomain},
    value::NoteValue,
    Address, Note, NoteVersion,
};
use serde_json::{json, Value};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_note_encryption::{
    try_note_decryption, try_output_recovery_with_ovk, try_output_recovery_with_pkd_esk, Domain,
    ShieldedOutput, ENC_CIPHERTEXT_SIZE,
};
use orchard::keys::FullViewingKey;
use sha2::{Digest, Sha256};
use zcash_primitives::transaction::Transaction;

use crate::{attest, memo, net::{self, Net}};

pub const DISCLOSURE_VERSION: &str = "ghost-commute/disclosure/1";

/// Which Orchard-protocol value pool a note lives in. Since NU6.3 (Ironwood),
/// payments to a third party land in the Ironwood pool: same action format,
/// same keys and receivers, V3 note plaintexts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pool {
    Orchard,
    Ironwood,
}

impl Pool {
    pub fn name(self) -> &'static str {
        match self {
            Pool::Orchard => "orchard",
            Pool::Ironwood => "ironwood",
        }
    }
    fn from_name(s: &str) -> Result<Self> {
        match s {
            "orchard" => Ok(Pool::Orchard),
            "ironwood" => Ok(Pool::Ironwood),
            _ => bail!("unknown pool `{s}`"),
        }
    }
    fn note_version(self) -> NoteVersion {
        match self {
            Pool::Orchard => NoteVersion::V2,
            Pool::Ironwood => NoteVersion::V3,
        }
    }
}

type AuthAction = orchard::Action<orchard::primitives::redpallas::Signature<orchard::primitives::redpallas::SpendAuth>>;

fn actions(tx: &Transaction, pool: Pool) -> Vec<&AuthAction> {
    let b = match pool {
        Pool::Orchard => tx.orchard_bundle(),
        Pool::Ironwood => tx.ironwood_bundle(),
    };
    b.map(|b| b.actions().iter().collect()).unwrap_or_default()
}

/// Generic over the pool's note-encryption domain.
fn recover<D, O>(domain: &D, note: &D::Note, out: &O) -> Option<(D::Note, D::Recipient, D::Memo)>
where
    D: Domain,
    O: ShieldedOutput<D, ENC_CIPHERTEXT_SIZE>,
{
    let esk = D::derive_esk(note)?;
    let pk_d = D::get_pk_d(note);
    try_output_recovery_with_pkd_esk(domain, pk_d, esk, out)
}

/// A note the viewing key can see in a transaction.
pub struct Found {
    pub pool: Pool,
    pub action_index: usize,
    pub note: Note,
    pub memo_text: Option<String>,
    pub role: Role,
}

/// Who is producing the disclosure. Both end up with the same note opening.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// The rider: trial-decrypts with the incoming viewing key.
    Recipient,
    /// The payer (sponsor / treasury): recovers its own payments with its
    /// outgoing viewing key. No rider key needed, so a sponsor can disclose
    /// every payout it ever made.
    Sender,
}

impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Role::Recipient => "recipient",
            Role::Sender => "sender",
        }
    }
}

/// Accept a UFVK (`uview…` / `uviewtest…`) or a raw 96-byte Orchard FVK in hex
/// (what `ghost key fvk-from-sk` prints for a bare Orchard spending key).
pub fn parse_fvk(s: &str, n: Net) -> Result<FullViewingKey> {
    let s = s.trim();
    if s.starts_with("uview") {
        let ufvk = UnifiedFullViewingKey::decode(&n.params(), s)
            .map_err(|e| anyhow!("could not parse UFVK: {e}"))?;
        return ufvk.orchard().cloned().ok_or_else(|| anyhow!("UFVK has no Orchard component"));
    }
    let b: [u8; 96] = hex::decode(s)
        .context("viewing key is neither a UFVK nor hex")?
        .try_into()
        .map_err(|_| anyhow!("raw Orchard FVK must be 96 bytes"))?;
    FullViewingKey::from_bytes(&b).ok_or_else(|| anyhow!("invalid Orchard full viewing key"))
}

pub fn find_notes(tx: &Transaction, fvk: &FullViewingKey, role: Role) -> Vec<Found> {
    let ivk = PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::External));
    let ovk = fvk.to_ovk(Scope::External);
    let mut found = vec![];
    for pool in [Pool::Orchard, Pool::Ironwood] {
        for (i, a) in actions(tx, pool).into_iter().enumerate() {
            let out_ct = &a.encrypted_note().out_ciphertext;
            let hit = match (pool, role) {
                (Pool::Orchard, Role::Recipient) => try_note_decryption(&OrchardDomain::for_action(a), &ivk, a),
                (Pool::Ironwood, Role::Recipient) => try_note_decryption(&IronwoodDomain::for_action(a), &ivk, a),
                (Pool::Orchard, Role::Sender) => {
                    try_output_recovery_with_ovk(&OrchardDomain::for_action(a), &ovk, a, a.cv_net(), out_ct)
                }
                (Pool::Ironwood, Role::Sender) => {
                    try_output_recovery_with_ovk(&IronwoodDomain::for_action(a), &ovk, a, a.cv_net(), out_ct)
                }
            };
            if let Some((note, addr, m)) = hit {
                // As sender, skip anything paid back to our own wallet (change).
                if role == Role::Sender && fvk.scope_for_address(&addr).is_some() {
                    continue;
                }
                found.push(Found { pool, action_index: i, note, memo_text: memo::from_bytes(&m).ok(), role });
            }
        }
    }
    found
}

pub fn make_disclosure(found: &Found, txid: &str, n: Net, height: Option<u32>) -> Result<Value> {
    let receiver = found.note.recipient().to_raw_address_bytes();
    let receipt = found.memo_text.as_deref().and_then(memo::receipt_of);
    Ok(json!({
        "v": DISCLOSURE_VERSION,
        "network": n.name(),
        "txid": txid,
        "mined_height": height,
        "pool": found.pool.name(),
        "action_index": found.action_index,
        "recipient": net::orchard_only_ua(receiver, n)?,
        "value_zat": found.note.value().inner(),
        "rseed": hex::encode(found.note.rseed().as_bytes()),
        "receipt_id": receipt,
        "issued_by": found.role.name(),
        "withheld": ["route", "gps trace", "home", "workplace", "other notes in this wallet", "viewing keys", "spending keys"],
    }))
}

pub struct Report {
    pub txid: String,
    pub source: String,
    pub mined_height: Option<u32>,
    pub pool: Pool,
    pub action_index: usize,
    pub value_zat: u64,
    pub recipient: String,
    pub memo_text: String,
    pub memo_sha256: String,
    pub receipt_id: Option<String>,
    pub attestation: Option<attest::Attestation>,
    pub checks: Vec<(String, bool)>,
}

impl Report {
    pub fn ok(&self) -> bool {
        self.checks.iter().all(|(_, ok)| *ok)
    }
}

/// Auditor side.
pub fn verify(
    d: &Value,
    tx: &Transaction,
    height: Option<u32>,
    source: String,
    att: Option<&Value>,
    n: Net,
) -> Result<Report> {
    let s = |k: &str| d.get(k).and_then(Value::as_str).ok_or_else(|| anyhow!("disclosure field `{k}` missing"));
    ensure!(s("v")? == DISCLOSURE_VERSION, "unknown disclosure version");
    ensure!(net::Net::from_name(s("network")?)? == n, "disclosure is for a different network");
    let pool = Pool::from_name(s("pool")?)?;
    let action_index = d["action_index"].as_u64().ok_or_else(|| anyhow!("action_index missing"))? as usize;
    let value_zat = d["value_zat"].as_u64().ok_or_else(|| anyhow!("value_zat missing"))?;
    let recipient = s("recipient")?.to_string();
    let rseed_bytes: [u8; 32] = hex::decode(s("rseed")?)
        .context("rseed not hex")?
        .try_into()
        .map_err(|_| anyhow!("rseed must be 32 bytes"))?;

    let mut checks = vec![];
    checks.push((format!("transaction data hashes to txid {}", tx.txid()), true));

    let acts = actions(tx, pool);
    let action = *acts
        .get(action_index)
        .ok_or_else(|| anyhow!("tx has no {} action #{action_index}", pool.name()))?;

    let receiver = net::orchard_receiver(&recipient, n)?;
    let addr: Address = Option::from(Address::from_raw_address_bytes(&receiver))
        .ok_or_else(|| anyhow!("recipient receiver is not a valid Orchard address"))?;
    let rho: Rho = action.rho();
    let rseed: RandomSeed = Option::from(RandomSeed::from_bytes(rseed_bytes, &rho))
        .ok_or_else(|| anyhow!("invalid rseed"))?;
    let note: Note = Option::from(Note::from_parts(
        addr,
        NoteValue::from_raw(value_zat),
        rho,
        rseed,
        pool.note_version(),
    ))
    .ok_or_else(|| anyhow!("disclosed values do not form a valid note"))?;

    // cmx + epk + AEAD all checked inside try_output_recovery_with_pkd_esk.
    let recovered = match pool {
        Pool::Orchard => recover(&OrchardDomain::for_action(action), &note, action),
        Pool::Ironwood => recover(&IronwoodDomain::for_action(action), &note, action),
    };
    let (rnote, _to, memo_bytes) = recovered.ok_or_else(|| {
        anyhow!("disclosure does NOT open this action: commitment, ephemeral key or ciphertext mismatch")
    })?;
    ensure!(rnote == note, "recovered note differs from disclosed note");
    checks.push((
        format!(
            "note commitment opens {} action #{action_index}: {value_zat} zat to the disclosed receiver",
            pool.name()
        ),
        true,
    ));
    checks.push(("esk re-derived from rseed reproduces the on-chain ephemeral key; memo decrypted".into(), true));

    let memo_text = memo::from_bytes(&memo_bytes).unwrap_or_else(|_| "(binary or empty memo)".into());
    let memo_sha256 = hex::encode(Sha256::digest(memo_bytes));
    let receipt_id = memo::receipt_of(&memo_text);
    match (&receipt_id, d.get("receipt_id").and_then(Value::as_str)) {
        (Some(r), Some(claimed)) => checks.push(("memo receipt id matches disclosure".into(), claimed == r)),
        (None, Some(_)) => checks.push(("disclosure claims a receipt id but the memo has none".into(), false)),
        _ => {}
    }
    checks.push((
        match height {
            Some(h) => format!("lightwalletd reports the tx mined at height {h}"),
            None => "OFFLINE: chain inclusion not checked (tx read from a file, or unmined)".into(),
        },
        height.is_some() || source.starts_with("file"),
    ));

    let attestation = match att {
        Some(v) => {
            let a = attest::verify(v)?;
            checks.push((format!("rider signature on attestation verifies (key {}…)", &hex::encode(a.rider_pk)[..12]), true));
            checks.push(("memo receipt id = SHA-256(attestation)".into(), receipt_id.as_deref() == Some(a.receipt_id.as_str())));
            let attested = net::orchard_receiver(&a.payout_ua, n)?;
            checks.push(("payment went to the receiver the rider signed for".into(), attested == receiver));
            checks.push(("motion check verdict is `bike` (prototype check, see README)".into(), a.verdict == "bike"));
            Some(a)
        }
        None => None,
    };

    Ok(Report {
        txid: tx.txid().to_string(),
        source,
        mined_height: height,
        pool,
        action_index,
        value_zat,
        recipient,
        memo_text,
        receipt_id,
        memo_sha256,
        attestation,
        checks,
    })
}

pub fn report_json(r: &Report, show_memo: bool) -> Value {
    let a = r.attestation.as_ref();
    json!({
        "verified": r.ok(),
        "txid": r.txid,
        "source": r.source,
        "mined_height": r.mined_height,
        "pool": r.pool.name(),
        "action_index": r.action_index,
        "value_zat": r.value_zat,
        "value_zec": format!("{}.{:08}", r.value_zat / 100_000_000, r.value_zat % 100_000_000),
        "receipt_id": r.receipt_id,
        "memo_sha256": r.memo_sha256,
        "memo": if show_memo { Value::String(r.memo_text.clone()) } else { Value::Null },
        "ride": a.map(|a| json!({
            "distance_m": a.distance_m,
            "window": {"start": a.window_start, "end": a.window_end},
            "zone": a.zone,
            "motion_check": a.check,
            "verdict": a.verdict,
            "route_commit": a.route_commit,
        })),
        "route": "withheld",
        "checks": r.checks.iter().map(|(c, ok)| json!({"check": c, "ok": ok})).collect::<Vec<_>>(),
    })
}

pub fn print_report(r: &Report, show_memo: bool) {
    let zec = format!("{}.{:08}", r.value_zat / 100_000_000, r.value_zat % 100_000_000);
    println!();
    println!("  ┌──────────────────────────────────────────────────────────────┐");
    if r.ok() {
        println!("  │  GHOST COMMUTE · PAYOUT VERIFIED                             │");
    } else {
        println!("  │  GHOST COMMUTE · VERIFICATION FAILED                         │");
    }
    println!("  └──────────────────────────────────────────────────────────────┘");
    println!("  tx        {}", r.txid);
    println!("  source    {}", r.source);
    println!("  pool      {} (shielded), action #{}", r.pool.name(), r.action_index);
    println!("  amount    {zec} ZEC ({} zat)", r.value_zat);
    println!("  to        {}…  (Orchard receiver, one-time diversified address)", &r.recipient[..24]);
    println!("  receipt   {}", r.receipt_id.as_deref().unwrap_or("— (memo is not a Ghost Commute receipt)"));
    println!("  memo hash {}", r.memo_sha256);
    if let Some(a) = &r.attestation {
        println!(
            "  ride      {}.{} km · zone {} · window {}–{} (unix, 15-min rounded)",
            a.distance_m / 1000,
            (a.distance_m % 1000) / 100,
            a.zone,
            a.window_start,
            a.window_end
        );
    }
    if show_memo {
        println!("  memo      {}", r.memo_text.replace('\n', "\n            "));
    } else {
        println!("  memo      (decrypted and checked; pass --show-memo to print the rider's line)");
    }
    println!("  route     WITHHELD — not in this disclosure, not in the memo, not on chain, not on a server");
    println!();
    for (c, ok) in &r.checks {
        let mark = if !*ok { "✗" } else if c.starts_with("OFFLINE") { "!" } else { "✓" };
        println!("  {mark} {c}");
    }
    println!();
}
