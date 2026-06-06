//! Phase 3 + 4 — Orchard spend construction and broadcast.
//!
//! Given the treasury spending key, a recipient Unified Address, and a
//! block range, this:
//!   1. seeds the Orchard tree from `GetTreeState(from - 1)`,
//!   2. scans forward to `to` (the anchor height), rediscovering our note
//!      and computing its real witness (auth path + consensus anchor),
//!   3. drives `zcash_primitives` v5 `TransactionBuilder` to add the
//!      Orchard spend + output, prove the bundle, compute the SIGHASH,
//!      apply the spend-authorization signature with the hot
//!      `SpendAuthorizingKey`, attach the binding signature, and
//!      serialize a complete v5 transaction,
//!   4. optionally broadcasts it via `SendTransaction`.
//!
//! The transaction is fully shielded: one Orchard spend, one Orchard
//! output, no transparent or Sapling components. The Sapling mock provers
//! satisfy the builder's generic bounds but are never invoked.

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
    pub output_value_zat: u64,
    pub fee_zat: u64,
    pub position: u64,
    pub anchor_hex: String,
    pub target_height: u64,
    pub tx_size: usize,
    pub txid_hex: String,
    /// `Some((error_code, message))` if broadcast was attempted.
    pub broadcast: Option<(i32, String)>,
}

/// Build a complete v5 Orchard transaction spending the treasury note
/// found in `[from_height, to_height]` and paying `note - fee` to
/// `recipient_ua`. If `to_height == 0`, the chain tip is used (so the
/// anchor is recent enough to be accepted by consensus). Broadcasts when
/// `broadcast` is true.
pub async fn build_transfer(
    endpoint: &str,
    sk: &SpendingKey,
    recipient_ua: &str,
    from_height: u64,
    to_height: u64,
    broadcast: bool,
) -> Result<SpendResult, Box<dyn std::error::Error>> {
    // --- keys ---
    let fvk = FullViewingKey::from(sk);
    let ivk: IncomingViewingKey = fvk.to_ivk(Scope::External);
    let prepared_ivk = PreparedIncomingViewingKey::new(&ivk);
    let ovk: OutgoingViewingKey = fvk.to_ovk(Scope::External);
    let sak = SpendAuthorizingKey::from(sk);

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
    let to_height = if to_height == 0 { tip } else { to_height };

    // --- seed from the frontier just before our note, then scan forward ---
    let seed_height = from_height.saturating_sub(1);
    let ts = client
        .get_tree_state(proto::BlockId { height: seed_height, hash: vec![] })
        .await?
        .into_inner();
    let mut tree = OrchardTree::from_tree_state(&ts.orchard_tree)?;

    let range = proto::BlockRange {
        start: Some(proto::BlockId { height: from_height, hash: vec![] }),
        end: Some(proto::BlockId { height: to_height, hash: vec![] }),
    };
    let mut stream = client.get_block_range(range).await?.into_inner();
    let mut found: Vec<FoundNote> = Vec::new();
    let mut progress = ScanProgress::default();
    while let Some(block) = stream.next().await {
        let block = block.map_err(|e| format!("stream error: {e}"))?;
        process_block(&block, &prepared_ivk, &mut tree, &mut found, &mut progress)?;
    }

    let note_meta = found
        .first()
        .ok_or("no treasury note found in the given range")?;
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

    // --- fee probe: action counts (hence the ZIP-317 fee) are fixed by
    //     the number of spends/outputs, not their values ---
    let fee_rule = FeeRule::standard();
    let fee_zat: u64 = {
        let mut probe = Builder::new(
            MainNetwork,
            target_height,
            BuildConfig::Standard { sapling_anchor: None, orchard_anchor: Some(anchor) },
        );
        probe
            .add_orchard_spend::<FeeError>(fvk.clone(), note, merkle_path.clone())
            .map_err(|e| format!("probe add_orchard_spend: {e:?}"))?;
        probe
            .add_orchard_output::<FeeError>(
                Some(ovk.clone()),
                recipient.clone(),
                Zatoshis::from_u64(note_value_zat).map_err(|e| format!("zatoshis: {e:?}"))?,
                MemoBytes::empty(),
            )
            .map_err(|e| format!("probe add_orchard_output: {e:?}"))?;
        let fee = probe.get_fee(&fee_rule).map_err(|e| format!("get_fee: {e:?}"))?;
        u64::from(fee)
    };

    if note_value_zat <= fee_zat {
        return Err(format!("note value {note_value_zat} <= fee {fee_zat}; nothing to send").into());
    }
    let output_value_zat = note_value_zat - fee_zat;

    // --- real build: prove, sighash, sign, binding sig, serialize ---
    let mut builder = Builder::new(
        MainNetwork,
        target_height,
        BuildConfig::Standard { sapling_anchor: None, orchard_anchor: Some(anchor) },
    );
    builder
        .add_orchard_spend::<FeeError>(fvk.clone(), note, merkle_path)
        .map_err(|e| format!("add_orchard_spend: {e:?}"))?;
    builder
        .add_orchard_output::<FeeError>(
            Some(ovk),
            recipient,
            Zatoshis::from_u64(output_value_zat).map_err(|e| format!("zatoshis: {e:?}"))?,
            MemoBytes::empty(),
        )
        .map_err(|e| format!("add_orchard_output: {e:?}"))?;

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
        output_value_zat,
        fee_zat,
        position,
        anchor_hex,
        target_height: u32::from(target_height) as u64,
        tx_size: tx_bytes.len(),
        txid_hex,
        broadcast: broadcast_res,
    })
}
