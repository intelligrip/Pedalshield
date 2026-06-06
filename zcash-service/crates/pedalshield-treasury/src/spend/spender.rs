//! Phase 3 + 4 — Orchard spend construction and broadcast.
//!
//! `pay()` is the autonomous payout primitive:
//!   1. seeds the Orchard tree from `GetTreeState(birthday - 1)`,
//!   2. scans to the chain tip, rediscovering treasury notes, their
//!      witnesses, and every on-chain nullifier,
//!   3. selects an UNSPENT note (nullifier not seen on chain) large
//!      enough to cover amount + fee,
//!   4. drives `zcash_primitives` v5 `TransactionBuilder` to add the
//!      Orchard spend, the recipient output, and a change output back to
//!      an internal treasury address, prove, SIGHASH, sign with the hot
//!      `SpendAuthorizingKey`, attach the binding signature, serialize,
//!   5. optionally broadcasts via `SendTransaction`.
//!
//! Fully shielded: one Orchard spend, one or two Orchard outputs, no
//! transparent or Sapling components (the Sapling mock provers satisfy
//! the builder's generic bounds but are never invoked).

use std::time::Duration;

use orchard::keys::{
    FullViewingKey, IncomingViewingKey, OutgoingViewingKey, PreparedIncomingViewingKey, Scope,
    SpendAuthorizingKey, SpendingKey,
};
use orchard::tree::MerklePath;
use orchard::Anchor;
use rand::rngs::OsRng;
use sapling::prover::mock::{MockOutputProver, MockSpendProver};
use tokio_stream::StreamExt;
use tonic::transport::{Channel, ClientTlsConfig};
use transparent::builder::TransparentSigningSet;
use zcash_keys::address::Address;
use zcash_primitives::transaction::builder::{BuildConfig, Builder};
use zcash_primitives::transaction::fees::zip317::{FeeError, FeeRule};
use zcash_protocol::consensus::{BlockHeight, MainNetwork};
use zcash_protocol::memo::MemoBytes;
use zcash_protocol::value::Zatoshis;

use crate::proto;
use crate::proto::compact_tx_streamer_client::CompactTxStreamerClient;
use crate::spend::scanner::{process_block, FoundNote, ScanProgress};
use crate::spend::tree::OrchardTree;

/// Outcome of building (and optionally broadcasting) a spend.
pub struct SpendResult {
    pub note_value_zat: u64,
    pub recipient_value_zat: u64,
    pub change_value_zat: u64,
    pub fee_zat: u64,
    pub position: u64,
    pub anchor_hex: String,
    pub target_height: u64,
    pub tx_size: usize,
    pub txid_hex: String,
    /// `Some((error_code, message))` if broadcast was attempted.
    pub broadcast: Option<(i32, String)>,
}

/// Pay `amount_zat` to `recipient_ua` from an unspent treasury note,
/// returning change to an internal treasury address. If `amount_zat == 0`
/// the entire selected note (minus fee) is swept to the recipient with no
/// change output. Scans from `birthday` to the chain tip. Broadcasts when
/// `broadcast` is true.
pub async fn pay(
    endpoint: &str,
    sk: &SpendingKey,
    recipient_ua: &str,
    amount_zat: u64,
    birthday: u64,
    broadcast: bool,
) -> Result<SpendResult, Box<dyn std::error::Error>> {
    // --- keys ---
    let fvk = FullViewingKey::from(sk);
    let ivk: IncomingViewingKey = fvk.to_ivk(Scope::External);
    let prepared_ivk = PreparedIncomingViewingKey::new(&ivk);
    let ovk_ext: OutgoingViewingKey = fvk.to_ovk(Scope::External);
    let ovk_int: OutgoingViewingKey = fvk.to_ovk(Scope::Internal);
    let sak = SpendAuthorizingKey::from(sk);

    // Change goes to our own internal (change) Orchard address.
    let change_addr = fvk.address_at(0u32, Scope::Internal);

    // --- recipient ---
    let recipient = match Address::decode(&MainNetwork, recipient_ua) {
        Some(Address::Unified(ua)) => ua
            .orchard()
            .ok_or("recipient UA has no Orchard receiver")?
            .clone(),
        Some(_) => return Err("recipient is not a Unified Address".into()),
        None => return Err("could not decode recipient address".into()),
    };

    // --- connect ---
    let channel = Channel::from_shared(endpoint.to_string())?
        .tls_config(ClientTlsConfig::new())?
        .timeout(Duration::from_secs(60))
        .connect()
        .await?;
    let mut client = CompactTxStreamerClient::new(channel);

    let tip = client
        .get_latest_block(proto::ChainSpec {})
        .await?
        .into_inner()
        .height;

    // --- seed from the frontier just before the birthday, scan to tip ---
    let seed_height = birthday.saturating_sub(1);
    let ts = client
        .get_tree_state(proto::BlockId { height: seed_height, hash: vec![] })
        .await?
        .into_inner();
    let mut tree = OrchardTree::from_tree_state(&ts.orchard_tree)?;

    let range = proto::BlockRange {
        start: Some(proto::BlockId { height: birthday, hash: vec![] }),
        end: Some(proto::BlockId { height: tip, hash: vec![] }),
    };
    let mut stream = client.get_block_range(range).await?.into_inner();
    let mut found: Vec<FoundNote> = Vec::new();
    let mut progress = ScanProgress::default();
    while let Some(block) = stream.next().await {
        let block = block.map_err(|e| format!("stream error: {e}"))?;
        process_block(&block, &prepared_ivk, &mut tree, &mut found, &mut progress)?;
    }

    // --- select the largest UNSPENT note ---
    let mut best: Option<&FoundNote> = None;
    for fnote in &found {
        let nf = fnote.note.nullifier(&fvk).to_bytes();
        if progress.all_nullifiers.contains(&nf) {
            continue; // already spent on chain
        }
        match best {
            Some(b) if b.value_zatoshi >= fnote.value_zatoshi => {}
            _ => best = Some(fnote),
        }
    }
    let note_meta = best.ok_or("no unspent treasury note found in range")?;
    let note = note_meta.note;
    let note_value_zat = note_meta.value_zatoshi;
    let position = note_meta.position;

    // --- witness -> merkle path + anchor ---
    let w = tree.witness(position)?;
    let auth_path: [orchard::tree::MerkleHashOrchard; 32] = w
        .auth_path
        .clone()
        .try_into()
        .map_err(|_| "auth path is not 32 elements")?;
    let merkle_path = MerklePath::from_parts(position as u32, auth_path);
    let anchor = Anchor::from_bytes(w.anchor.to_bytes())
        .into_option()
        .ok_or("anchor bytes invalid")?;
    let anchor_hex: String = w.anchor.to_bytes().iter().map(|b| format!("{b:02x}")).collect();

    let target_height = BlockHeight::from_u32(tip as u32);
    let fee_rule = FeeRule::standard();
    let cfg = || BuildConfig::Standard { sapling_anchor: None, orchard_anchor: Some(anchor) };

    // --- fee probe (action count, hence fee, is independent of values) ---
    let has_change = amount_zat > 0;
    let fee_zat: u64 = {
        let mut probe = Builder::new(MainNetwork, target_height, cfg());
        probe
            .add_orchard_spend::<FeeError>(fvk.clone(), note, merkle_path.clone())
            .map_err(|e| format!("probe add_orchard_spend: {e:?}"))?;
        let probe_recipient_val = if amount_zat == 0 { note_value_zat } else { amount_zat };
        probe
            .add_orchard_output::<FeeError>(
                Some(ovk_ext.clone()),
                recipient.clone(),
                Zatoshis::from_u64(probe_recipient_val).map_err(|e| format!("zatoshis: {e:?}"))?,
                MemoBytes::empty(),
            )
            .map_err(|e| format!("probe add_orchard_output: {e:?}"))?;
        if has_change {
            probe
                .add_orchard_output::<FeeError>(
                    Some(ovk_int.clone()),
                    change_addr,
                    Zatoshis::from_u64(1).unwrap(),
                    MemoBytes::empty(),
                )
                .map_err(|e| format!("probe add change: {e:?}"))?;
        }
        u64::from(probe.get_fee(&fee_rule).map_err(|e| format!("get_fee: {e:?}"))?)
    };

    // --- value distribution ---
    let (recipient_value_zat, change_value_zat) = if amount_zat == 0 {
        if note_value_zat <= fee_zat {
            return Err(format!("note {note_value_zat} <= fee {fee_zat}").into());
        }
        (note_value_zat - fee_zat, 0)
    } else {
        if note_value_zat < amount_zat + fee_zat {
            return Err(format!(
                "note {note_value_zat} < amount {amount_zat} + fee {fee_zat}"
            )
            .into());
        }
        (amount_zat, note_value_zat - amount_zat - fee_zat)
    };

    // --- real build: prove, sighash, sign, binding sig, serialize ---
    let mut builder = Builder::new(MainNetwork, target_height, cfg());
    builder
        .add_orchard_spend::<FeeError>(fvk.clone(), note, merkle_path)
        .map_err(|e| format!("add_orchard_spend: {e:?}"))?;
    builder
        .add_orchard_output::<FeeError>(
            Some(ovk_ext),
            recipient,
            Zatoshis::from_u64(recipient_value_zat).map_err(|e| format!("zatoshis: {e:?}"))?,
            MemoBytes::empty(),
        )
        .map_err(|e| format!("add_orchard_output: {e:?}"))?;
    if change_value_zat > 0 {
        builder
            .add_orchard_output::<FeeError>(
                Some(ovk_int),
                change_addr,
                Zatoshis::from_u64(change_value_zat).map_err(|e| format!("zatoshis: {e:?}"))?,
                MemoBytes::empty(),
            )
            .map_err(|e| format!("add change output: {e:?}"))?;
    }

    let transparent_signing_set = TransparentSigningSet::new();
    let result = builder
        .build(
            &transparent_signing_set,
            &[],
            &[sak],
            OsRng,
            &MockSpendProver,
            &MockOutputProver,
            &fee_rule,
        )
        .map_err(|e| format!("build (prove/sign): {e:?}"))?;

    let tx = result.transaction();
    let mut tx_bytes = Vec::new();
    tx.write(&mut tx_bytes)?;
    let txid_hex = format!("{}", tx.txid());

    let broadcast_res = if broadcast {
        let resp = client
            .send_transaction(proto::RawTransaction { data: tx_bytes.clone(), height: 0 })
            .await?
            .into_inner();
        Some((resp.error_code, resp.error_message))
    } else {
        None
    };

    Ok(SpendResult {
        note_value_zat,
        recipient_value_zat,
        change_value_zat,
        fee_zat,
        position,
        anchor_hex,
        target_height: u32::from(target_height) as u64,
        tx_size: tx_bytes.len(),
        txid_hex,
        broadcast: broadcast_res,
    })
}
