//! Block scanner that feeds Orchard commitments into our OrchardTree
//! and marks positions for actions that IVK-decrypt as ours.
//!
//! This is the "Phase 2" part of the hand-rolled wallet. The treasury_balance
//! binary uses a simpler version that only decrypts (no tree). This module
//! does both: tree update + IVK decryption, with mark=true on matches.
//!
//! Usage from `treasury_wallet sync` (and similar):
//!
//!     let mut tree = OrchardTree::empty();
//!     let mut found = Vec::new();
//!     let mut progress = ScanProgress::default();
//!     for block in block_stream {
//!         process_block(&block, &ivk, &mut tree, &mut found, &mut progress)?;
//!     }

use std::collections::HashSet;

use orchard::keys::PreparedIncomingViewingKey;
use orchard::note::{ExtractedNoteCommitment, Note, Nullifier};
use orchard::note_encryption::{CompactAction, OrchardDomain};
use orchard::tree::MerkleHashOrchard;
use thiserror::Error;
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};

use crate::proto;
use crate::spend::tree::{OrchardTree, OrchardTreeError};

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("malformed CompactOrchardAction at block {height}, tx {tx_index}: {field}")]
    MalformedAction {
        height: u64,
        tx_index: u64,
        field: &'static str,
    },
    #[error("tree update failed at block {height}: {source}")]
    TreeUpdate {
        height: u64,
        #[source]
        source: OrchardTreeError,
    },
}

/// A note belonging to us that the scanner discovered during sync.
/// Position is the leaf's index in the global Orchard commitment tree.
#[derive(Debug, Clone)]
pub struct FoundNote {
    /// Position in the global Orchard tree (leaf index from 0).
    pub position: u64,
    /// Value in zatoshi.
    pub value_zatoshi: u64,
    /// Block height where the originating tx was mined.
    pub block_height: u64,
    /// Index of the tx within that block.
    pub tx_index: u64,
    /// The on-chain nullifier from the action header. We don't yet use
    /// this for spent-detection (Phase 3+), but it's the unique anchor
    /// for "this output exists".
    pub nullifier_bytes: [u8; 32],
    /// The fully decrypted Orchard note. Carries recipient, value, rho,
    /// and rseed - everything `orchard::builder::Builder::add_spend`
    /// needs to reconstruct this note as a spend input.
    pub note: Note,
}

/// Cumulative scan progress across multiple `process_block` calls.
#[derive(Debug, Default, Clone)]
pub struct ScanProgress {
    pub blocks_scanned: u64,
    pub actions_inspected: u64,
    pub notes_found: u64,
    /// Every nullifier revealed on chain in the scanned range. Each
    /// Orchard action publishes the nullifier of the note it spends, so
    /// a note we own is spent iff its nullifier appears in this set.
    pub all_nullifiers: HashSet<[u8; 32]>,
}

/// Walk every Orchard action in `block` in canonical (tx, action) order,
/// appending each `cmx` to `tree`. For each action that successfully
/// IVK-decrypts under `ivk`, mark the position and record metadata in
/// `found`.
///
/// Canonical order matters: the position of a leaf in the global tree
/// is its index in the concatenation of all Orchard actions across the
/// chain. We MUST visit txs in their `index` order and actions in their
/// declaration order, with no skips.
pub fn process_block(
    block: &proto::CompactBlock,
    ivks: &[PreparedIncomingViewingKey],
    tree: &mut OrchardTree,
    found: &mut Vec<FoundNote>,
    progress: &mut ScanProgress,
) -> Result<(), ScanError> {
    let height = block.height;
    progress.blocks_scanned += 1;

    // Sort txs by their declared `index` to enforce canonical order.
    // The wire format generally returns them sorted already, but it
    // costs us little to be defensive and the position math is
    // unforgiving of mistakes.
    let mut vtx: Vec<&proto::CompactTx> = block.vtx.iter().collect();
    vtx.sort_by_key(|t| t.index);

    for tx in vtx {
        let tx_index = tx.index;
        for action in &tx.actions {
            progress.actions_inspected += 1;

            let nullifier_bytes = bytes32(&action.nullifier).ok_or(
                ScanError::MalformedAction {
                    height,
                    tx_index,
                    field: "nullifier",
                },
            )?;
            // Record every on-chain nullifier so the spender can tell
            // which of our notes have already been spent.
            progress.all_nullifiers.insert(nullifier_bytes);
            let cmx_bytes = bytes32(&action.cmx).ok_or(ScanError::MalformedAction {
                height,
                tx_index,
                field: "cmx",
            })?;
            let ephemeral_key_bytes = bytes32(&action.ephemeral_key).ok_or(
                ScanError::MalformedAction {
                    height,
                    tx_index,
                    field: "ephemeral_key",
                },
            )?;
            if action.ciphertext.len() != 52 {
                return Err(ScanError::MalformedAction {
                    height,
                    tx_index,
                    field: "ciphertext",
                });
            }

            // Build the typed orchard primitives. If any of these fail
            // their range/encoding checks the action is technically
            // malformed - skip it (rather than failing the whole sync),
            // but still advance the tree position by appending a
            // placeholder. In practice this branch is never taken on
            // chain data; lightwalletd already validates these.
            let (cmx, nullifier) = match (
                ExtractedNoteCommitment::from_bytes(&cmx_bytes).into_option(),
                Nullifier::from_bytes(&nullifier_bytes).into_option(),
            ) {
                (Some(c), Some(n)) => (c, n),
                _ => {
                    // Append a placeholder leaf so positions stay aligned
                    // with what other wallets compute. Use the all-zeros
                    // hash, which matches what librustzcash does for
                    // malformed-output positions.
                    let placeholder = MerkleHashOrchard::from_bytes(&[0u8; 32])
                        .into_option()
                        .expect("zero is a valid MerkleHashOrchard");
                    tree.append(placeholder, false).map_err(|e| {
                        ScanError::TreeUpdate {
                            height,
                            source: e,
                        }
                    })?;
                    continue;
                }
            };

            let ephemeral_key = EphemeralKeyBytes(ephemeral_key_bytes);
            let mut enc_ciphertext = [0u8; 52];
            enc_ciphertext.copy_from_slice(&action.ciphertext);
            let compact_action = CompactAction::from_parts(
                nullifier,
                cmx,
                ephemeral_key,
                enc_ciphertext,
            );
            let domain = OrchardDomain::for_compact_action(&compact_action);

            // Try IVK decryption against every scope (external + internal
            // change). Some => the note is ours.
            let maybe_note = ivks
                .iter()
                .find_map(|k| try_compact_note_decryption(&domain, k, &compact_action));

            // Convert the on-chain cmx to the tree's hash type and append.
            // mark=true ⇔ this action's note is ours.
            let leaf = MerkleHashOrchard::from_cmx(&cmx);
            let mark = maybe_note.is_some();
            let position = tree
                .append(leaf, mark)
                .map_err(|e| ScanError::TreeUpdate { height, source: e })?;

            if let Some((note, _recipient)) = maybe_note {
                let value_zatoshi = note.value().inner();
                found.push(FoundNote {
                    position,
                    value_zatoshi,
                    block_height: height,
                    tx_index,
                    nullifier_bytes,
                    note,
                });
                progress.notes_found += 1;
            }
        }
    }

    Ok(())
}

fn bytes32(slice: &[u8]) -> Option<[u8; 32]> {
    if slice.len() == 32 {
        let mut out = [0u8; 32];
        out.copy_from_slice(slice);
        Some(out)
    } else {
        None
    }
}
