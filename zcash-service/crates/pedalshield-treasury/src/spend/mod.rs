//! Pedalshield v0.5.3d hand-rolled autonomous Orchard spend.
//!
//! Bypasses zcash_client_backend / zcash_client_sqlite (their published
//! version graph is broken and main is mid-refactor as of the hackathon
//! window). Builds spends directly on:
//!
//! - `orchard` for the note commitment scheme + Builder API
//! - `bridgetree` / `incrementalmerkletree` for tree state + witnesses
//! - our existing `tonic` + minimal lightwalletd .proto for the chain
//!
//! Phase 1 (this module ships): tree state primitives (append, mark,
//! checkpoint, witness). Phase 2 layers note-position tracking on the
//! existing scanner. Phase 3 wires `orchard::builder::Builder`. Phase 4
//! wraps in v5 tx + SIGHASH + sign + broadcast.

pub mod scanner;
pub mod spender;
pub mod tree;

pub use scanner::{
    process_block, FoundNote, ScanError, ScanProgress,
};
pub use tree::{OrchardTree, OrchardTreeError, OrchardWitness};
