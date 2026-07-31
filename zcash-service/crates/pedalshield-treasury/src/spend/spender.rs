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
    /// Chain tip observed at build time. The caller persists
    /// `tip_height - REORG_MARGIN` as the next scan watermark.
    pub tip_height: u64,
    /// Height the successful scan actually started from. Equals the
    /// watermark on the fast path, the birthday after a fallback.
    pub scanned_from: u64,
    /// True when the watermark window produced no spendable note and the
    /// scan was retried from the birthday. Always worth logging: a
    /// watermark that keeps missing is a bug we want to see, not absorb.
    pub full_rescan_used: bool,
}

/// Pay `amount_zat` to `recipient_ua` from an unspent treasury note,
/// returning change to an internal treasury address. If `amount_zat == 0`
/// the entire selected note (minus fee) is swept to the recipient with no
/// change output. Broadcasts when `broadcast` is true.
///
/// ## Scan watermark (why this isn't a full rescan)
///
/// Scanning from `birthday` on every payout meant streaming ~68k blocks
/// per claim — the whole of the ~4 minute payout latency, growing by
/// ~1150 blocks a day forever.
///
/// The treasury is effectively a SINGLE-NOTE wallet: each payout spends
/// one note and sweeps the remainder into one change note. So the only
/// spendable money is in the change output of the most recent payout, and
/// scanning needs to start at the last payout — not at the birthday.
/// `scan_from` is that watermark, persisted by the caller.
///
/// The correctness argument rests on the fallback, not on the watermark:
/// if the narrow window yields no spendable note, we rescan from
/// `birthday` automatically. That covers every way the watermark can be
/// wrong — a tx dropped from the mempool, a manual deposit made below the
/// watermark, a stale or corrupted value. The worst case is today's
/// latency; there is no case where we silently report "no funds" because
/// we looked in too small a window.
///
/// Nullifier coverage stays sound under a narrow scan: a note discovered
/// in [scan_from, tip] can only be spent at or after its own creation, so
/// any spend of it also falls inside the window we scanned.
pub async fn pay(
    endpoint: &str,
    sk: &SpendingKey,
    recipient_ua: &str,
    amount_zat: u64,
    birthday: u64,
    scan_from: u64,
    broadcast: bool,
) -> Result<SpendResult, Box<dyn std::error::Error>> {
    // --- keys ---
    let fvk = FullViewingKey::from(sk);
    let ivk: IncomingViewingKey = fvk.to_ivk(Scope::External);
    let prepared_ivk = PreparedIncomingViewingKey::new(&ivk);
    // Scan BOTH external and internal (change) scopes, so change notes from
    // prior payouts are rediscovered and stay spendable.
    let scan_ivks = [
        prepared_ivk,
        PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::Internal)),
    ];
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

    // --- scan: fast path from the watermark, fall back to the birthday ---
    // Clamp: never start before the birthday (nothing of ours exists) and
    // never past the tip (an over-advanced watermark must not scan an
    // empty range and masquerade as "no funds").
    let window_start = scan_from.clamp(birthday, tip.max(birthday));
    let (mut tree, mut found, mut progress) =
        scan_range(&mut client, &scan_ivks, window_start, tip).await?;
    let mut scanned_from = window_start;
    let mut full_rescan_used = false;

    if window_start > birthday
        && insufficient(select_unspent(&found, &progress, &fvk), amount_zat)
    {
        // The watermark is an optimisation, never an authority on funds.
        tracing::warn!(
            watermark = window_start,
            birthday,
            tip,
            "no unspent note in watermark window; falling back to full rescan"
        );
        let full = scan_range(&mut client, &scan_ivks, birthday, tip).await?;
        tree = full.0;
        found = full.1;
        progress = full.2;
        scanned_from = birthday;
        full_rescan_used = true;
    }

    let note_meta = select_unspent(&found, &progress, &fvk)
        .ok_or("no unspent treasury note found in range")?;
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
    let cfg = || BuildConfig::Standard {
        sapling_anchor: None,
        orchard_anchor: Some(anchor),
        // NU6.3 (Ironwood) — MIGRATION SPEND.
        //
        // After activation, legacy `orchard_v3` bundles are built with
        // cross-address transfers DISABLED (zcash_primitives 0.29
        // builder.rs:306-317): every output must be wallet-controlled
        // change. Paying a rider from a legacy bundle therefore fails with
        // OutputError::CrossAddressDisabled — which is exactly what the
        // treasury hit on the first post-activation claim.
        //
        // Supplying an ironwood anchor selects the `ironwood_v3` bundle
        // version (builder.rs:327-333), which permits ordinary outputs. We
        // spend legacy Orchard notes (orchard_anchor, above) and create
        // Ironwood notes: the migration path, one payout at a time.
        //
        // The anchor may be the empty tree because this bundle spends
        // NOTHING from the Ironwood pool — an anchor is only needed to
        // witness spends, and upstream's own tests use empty_tree() for
        // exactly this case. NOTE: our CHANGE now lands in the Ironwood
        // pool, so the scanner must learn to track Ironwood notes before
        // the treasury can spend that change (see IRONWOOD_MIGRATION.md).
        ironwood_anchor: Some(orchard::Anchor::empty_tree()),
        // Same padded transactional discipline the pre-0.29 builder applied
        // implicitly; padding hides the true action count (privacy).
        orchard_pool_bundle_type: orchard::builder::BundleType::DEFAULT,
    };

    // --- fee probe (action count, hence fee, is independent of values) ---
    let has_change = amount_zat > 0;
    let fee_zat: u64 = {
        let mut probe = Builder::new(MainNetwork, target_height, cfg());
        probe
            .add_orchard_spend::<FeeError>(fvk.clone(), note, merkle_path.clone())
            .map_err(|e| format!("probe add_orchard_spend: {e:?}"))?;
        let probe_recipient_val = if amount_zat == 0 { note_value_zat } else { amount_zat };
        // NU6.3: rider payment must be an IRONWOOD output (see the real
        // build below for the full rationale).
        probe
            .add_ironwood_output::<FeeError>(
                Some(ovk_ext.clone()),
                recipient.clone(),
                Zatoshis::from_u64(probe_recipient_val).map_err(|e| format!("zatoshis: {e:?}"))?,
                MemoBytes::empty(),
            )
            .map_err(|e| format!("probe add_ironwood_output: {e:?}"))?;
        if has_change {
            probe
                .add_orchard_change_output::<FeeError>(
                    fvk.clone(),
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
    // NU6.3 (Ironwood) migration spend, three moving parts:
    //
    //  1. SPEND stays legacy Orchard — that's where the treasury's notes
    //     live (add_orchard_spend above, orchard_anchor from our tree).
    //  2. The RIDER'S PAYMENT must be an IRONWOOD output. Post-activation,
    //     legacy `orchard_v3` bundles are constructed with cross-address
    //     transfers disabled (zcash_primitives 0.29 builder.rs: flags come
    //     from `bundle_version.default_flags()`), so a legacy output to a
    //     third party fails with OutputError::CrossAddressDisabled — the
    //     exact error that stopped payouts on activation day. The Ironwood
    //     builder permits ordinary recipients.
    //  3. CHANGE stays in the LEGACY pool via add_orchard_change_output:
    //     wallet-controlled change is explicitly allowed even when
    //     cross-address transfers are disabled. This matters operationally
    //     — our scanner tracks legacy Orchard notes, so keeping change in
    //     that pool means the treasury can still see and spend its own
    //     balance. (Ironwood-pool scanning is the next milestone; it only
    //     becomes necessary if the treasury is ever paid INTO Ironwood.)
    //
    // Value flows legacy pool -> Ironwood pool across the two bundles,
    // which is precisely the migration path the upgrade defines.
    builder
        .add_ironwood_output::<FeeError>(
            Some(ovk_ext),
            recipient,
            Zatoshis::from_u64(recipient_value_zat).map_err(|e| format!("zatoshis: {e:?}"))?,
            MemoBytes::empty(),
        )
        .map_err(|e| format!("add_ironwood_output: {e:?}"))?;
    if change_value_zat > 0 {
        builder
            .add_orchard_change_output::<FeeError>(
                fvk.clone(),
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
        tip_height: tip,
        scanned_from,
        full_rescan_used,
    })
}

/// Seed the Orchard tree from the frontier just before `from`, then stream
/// `[from, tip]`, feeding every action into the tree and collecting the
/// notes that IVK-decrypt as ours.
///
/// Seeding from `GetTreeState(from - 1)` is what makes a partial scan
/// legitimate: lightwalletd hands us the authoritative global frontier at
/// that height, so leaf positions and the witness anchor match consensus
/// exactly as they would after a scan from genesis.
async fn scan_range(
    client: &mut CompactTxStreamerClient<Channel>,
    scan_ivks: &[PreparedIncomingViewingKey],
    from: u64,
    tip: u64,
) -> Result<(OrchardTree, Vec<FoundNote>, ScanProgress), Box<dyn std::error::Error>> {
    let seed_height = from.saturating_sub(1);
    let ts = client
        .get_tree_state(proto::BlockId { height: seed_height, hash: vec![] })
        .await?
        .into_inner();
    let mut tree = OrchardTree::from_tree_state(&ts.orchard_tree)?;

    let range = proto::BlockRange {
        start: Some(proto::BlockId { height: from, hash: vec![] }),
        end: Some(proto::BlockId { height: tip, hash: vec![] }),
    };
    let mut stream = client.get_block_range(range).await?.into_inner();
    let mut found: Vec<FoundNote> = Vec::new();
    let mut progress = ScanProgress::default();
    while let Some(block) = stream.next().await {
        let block = block.map_err(|e| format!("stream error: {e}"))?;
        process_block(&block, scan_ivks, &mut tree, &mut found, &mut progress)?;
    }
    Ok((tree, found, progress))
}

/// Deliberately generous upper bound on the ZIP-317 fee for this
/// transaction shape (one spend, two outputs). Used only to decide whether
/// the watermark window looks under-funded and a full rescan is warranted
/// — never to compute an actual fee, which the builder derives exactly.
/// Over-estimating here costs at most one unnecessary rescan; under-
/// estimating would let a payout fail that a rescan could have satisfied.
const FEE_HEADROOM_ZAT: u64 = 100_000;

/// Should we widen the search? True when the window yielded no spendable
/// note at all, or one that plainly cannot cover the payment plus fee.
///
/// The second case is the top-up scenario: an external deposit lands below
/// the watermark while a small change note sits above it. Selecting the
/// small note would fail the payout with "note < amount + fee" even though
/// the treasury is funded — so we rescan instead of erroring.
fn insufficient(best: Option<&FoundNote>, amount_zat: u64) -> bool {
    match best {
        None => true,
        // Sweep (amount 0) spends whatever the note holds; any note works.
        Some(_) if amount_zat == 0 => false,
        Some(n) => n.value_zatoshi < amount_zat.saturating_add(FEE_HEADROOM_ZAT),
    }
}

/// Largest note of ours whose nullifier has not appeared on chain.
fn select_unspent<'a>(
    found: &'a [FoundNote],
    progress: &ScanProgress,
    fvk: &FullViewingKey,
) -> Option<&'a FoundNote> {
    let mut best: Option<&FoundNote> = None;
    for fnote in found {
        let nf = fnote.note.nullifier(fvk).to_bytes();
        if progress.all_nullifiers.contains(&nf) {
            continue; // already spent on chain
        }
        match best {
            Some(b) if b.value_zatoshi >= fnote.value_zatoshi => {}
            _ => best = Some(fnote),
        }
    }
    best
}
