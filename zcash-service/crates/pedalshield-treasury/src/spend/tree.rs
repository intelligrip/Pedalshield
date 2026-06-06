//! Orchard commitment-tree wrapper for hand-rolled spend construction.
//!
//! incrementalmerkletree 0.8 architecture (different from the older
//! BridgeTree-based one):
//!   - `Frontier<H, DEPTH>`: append-only tree state. Memory is O(log n).
//!   - `IncrementalWitness<H, DEPTH>`: per-marked-leaf path tracker that
//!     must be updated with every new commitment appended *after* it
//!     was created. Memory is O(log n) per tracked leaf.
//!
//! Pedalshield maintains one `Frontier` representing the global Orchard
//! commitment tree (synced from chain) plus a per-marked-leaf
//! `IncrementalWitness` for every note we want to be able to spend.
//! When we IVK-decrypt an Orchard action as ours, the scanner calls
//! `append(cmx, mark=true)` which both feeds the frontier *and* spins up
//! a fresh IncrementalWitness rooted at this position. Subsequent
//! `append`s update the witness so the path stays valid.
//!
//! On spend time, `witness(position)` returns the auth_path + the
//! current anchor; we pass both into `orchard::builder::Builder::add_spend`.

use std::collections::HashMap;

use incrementalmerkletree::frontier::CommitmentTree;
use incrementalmerkletree::witness::IncrementalWitness;
use orchard::tree::MerkleHashOrchard;
use thiserror::Error;
use zcash_primitives::merkle_tree::read_commitment_tree;

/// Orchard note commitment tree depth. Hardcoded in the protocol spec.
pub const ORCHARD_TREE_DEPTH: u8 = 32;

#[derive(Debug, Error)]
pub enum OrchardTreeError {
    #[error("frontier append failed (tree full or invariant violation)")]
    AppendFailed,
    #[error("position {0} is not marked; cannot compute witness")]
    PositionNotMarked(u64),
    #[error("witness internal error: {0}")]
    WitnessInternal(String),
}

/// A merkle witness path + the anchor root it binds to. Pass into
/// `orchard::builder::Builder::add_spend` along with the note + FVK.
#[derive(Debug, Clone)]
pub struct OrchardWitness {
    /// Position of the leaf this witness is for (i.e. the note's
    /// position in the global tree at the time it was marked).
    pub position: u64,
    /// Tree root at the witness's current state - the "anchor" the
    /// Orchard spend description binds to via SIGHASH.
    pub anchor: MerkleHashOrchard,
    /// 32 sibling hashes from leaf to root. `orchard::tree::MerklePath`
    /// is constructed from these.
    pub auth_path: Vec<MerkleHashOrchard>,
}

/// Orchard commitment tree state.
pub struct OrchardTree {
    /// The global commitment tree as we've seen it on chain.
    tree: CommitmentTree<MerkleHashOrchard, ORCHARD_TREE_DEPTH>,
    /// Counter for the next leaf position we'll append.
    next_position: u64,
    /// One IncrementalWitness per marked leaf. Keyed by leaf position.
    witnesses: HashMap<u64, IncrementalWitness<MerkleHashOrchard, ORCHARD_TREE_DEPTH>>,
}

impl OrchardTree {
    /// Construct an empty tree.
    pub fn empty() -> Self {
        Self {
            tree: CommitmentTree::empty(),
            next_position: 0,
            witnesses: HashMap::new(),
        }
    }

    /// Seed the tree from a lightwalletd `GetTreeState.orchardTree` blob
    /// (hex-encoded legacy CommitmentTree frontier) so positions and the
    /// witness anchor match consensus. Starts with no marked witnesses;
    /// mark notes via `append` as you scan forward from the seed height.
    pub fn from_tree_state(orchard_tree_hex: &str) -> Result<Self, OrchardTreeError> {
        let h = orchard_tree_hex.trim();
        if h.is_empty() {
            return Ok(Self::empty());
        }
        if h.len() % 2 != 0 {
            return Err(OrchardTreeError::WitnessInternal(
                "orchardTree hex has odd length".into(),
            ));
        }
        let hb = h.as_bytes();
        let mut bytes = Vec::with_capacity(h.len() / 2);
        for i in (0..h.len()).step_by(2) {
            let hi = (hb[i] as char).to_digit(16);
            let lo = (hb[i + 1] as char).to_digit(16);
            match (hi, lo) {
                (Some(a), Some(b)) => bytes.push((a * 16 + b) as u8),
                _ => {
                    return Err(OrchardTreeError::WitnessInternal(
                        "orchardTree hex has non-hex digit".into(),
                    ))
                }
            }
        }
        let tree: CommitmentTree<MerkleHashOrchard, ORCHARD_TREE_DEPTH> =
            read_commitment_tree(&bytes[..]).map_err(|e| {
                OrchardTreeError::WitnessInternal(format!("read_commitment_tree: {e}"))
            })?;
        let next_position = tree.size() as u64;
        Ok(Self {
            tree,
            next_position,
            witnesses: HashMap::new(),
        })
    }

    /// Append a single note commitment. If `mark=true`, also create a
    /// fresh `IncrementalWitness` for this position so we can compute
    /// its merkle path later when we want to spend the corresponding
    /// note. Returns the leaf's position.
    pub fn append(
        &mut self,
        cmx: MerkleHashOrchard,
        mark: bool,
    ) -> Result<u64, OrchardTreeError> {
        let position = self.next_position;

        // Every existing witness needs to absorb this new leaf so its
        // path stays consistent with the global tree.
        for w in self.witnesses.values_mut() {
            w.append(cmx)
                .map_err(|e| OrchardTreeError::WitnessInternal(format!("{e:?}")))?;
        }

        // Append to the global tree.
        self.tree
            .append(cmx)
            .map_err(|_| OrchardTreeError::AppendFailed)?;

        if mark {
            // Spin up a new witness rooted at this position. The witness
            // remembers the tree state at the moment of creation; as
            // future leaves are appended, the witness updates internally.
            let w = IncrementalWitness::from_tree(self.tree.clone())
                .ok_or(OrchardTreeError::WitnessInternal(
                    "from_tree returned None".into(),
                ))?;
            self.witnesses.insert(position, w);
        }

        self.next_position += 1;
        Ok(position)
    }

    /// Number of leaves appended so far.
    pub fn position(&self) -> u64 {
        self.next_position
    }

    /// Current tree root from the global commitment tree.
    pub fn root(&self) -> MerkleHashOrchard {
        self.tree.root()
    }

    /// Compute a witness for a previously-marked position. Returned
    /// `anchor` is the current tree root as seen by the witness; the
    /// `auth_path` is the 32-element sibling chain from leaf to root.
    pub fn witness(&self, position: u64) -> Result<OrchardWitness, OrchardTreeError> {
        let w = self
            .witnesses
            .get(&position)
            .ok_or(OrchardTreeError::PositionNotMarked(position))?;
        let merkle_path = w
            .path()
            .ok_or(OrchardTreeError::WitnessInternal("path() returned None".into()))?;
        // MerklePath in incrementalmerkletree 0.8 wraps a Vec<H>
        // accessible via path_elems(). Convert to owned Vec for the
        // caller (and for orchard's MerklePath::from_parts later).
        let auth_path: Vec<MerkleHashOrchard> = merkle_path.path_elems().to_vec();
        Ok(OrchardWitness {
            position,
            anchor: w.root(),
            auth_path,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use incrementalmerkletree::Hashable;

    /// Round-trip sanity: append three leaves, mark the middle one,
    /// witness it. If this passes the merkle primitive foundation is
    /// solid and we move to Phase 2 (note marking via the scanner).
    #[test]
    fn mark_and_witness_round_trip() {
        let mut t = OrchardTree::empty();
        let leaf_a = <MerkleHashOrchard as Hashable>::empty_leaf();
        let leaf_b = <MerkleHashOrchard as Hashable>::empty_leaf();
        let leaf_c = <MerkleHashOrchard as Hashable>::empty_leaf();
        let _ = t.append(leaf_a, false).unwrap();
        let our_pos = t.append(leaf_b, /* mark = */ true).unwrap();
        let _ = t.append(leaf_c, false).unwrap();
        let w = t.witness(our_pos).expect("witness");
        assert_eq!(w.auth_path.len(), ORCHARD_TREE_DEPTH as usize);
        assert_eq!(w.position, our_pos);
    }
}
