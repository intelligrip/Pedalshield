//! Claim ledger.
//!
//! The `ClaimLedger` trait lets us swap in a SQLite-backed
//! implementation later without touching call sites. For Chunk 3 we
//! ship `InMemoryLedger`; the persistent version is a one-file change
//! using `rusqlite`.

use crate::error::{PedalshieldError, Result};
use crate::types::{
    BatchId, Claim, ClaimId, ClaimLedgerStatus, LedgerEntry, RideId,
};
use std::collections::HashMap;
use std::sync::Mutex;

pub trait ClaimLedger: Send + Sync {
    fn submit(&self, claim: Claim) -> Result<ClaimId>;
    fn get(&self, id: ClaimId) -> Result<Option<LedgerEntry>>;
    fn pending(&self) -> Result<Vec<LedgerEntry>>;
    fn mark_batched(&self, ids: &[ClaimId], batch_id: BatchId) -> Result<()>;
    fn mark_paid(
        &self,
        ids: &[ClaimId],
        batch_id: BatchId,
        txid_hex: &str,
    ) -> Result<()>;
    fn has_ride(&self, ride_id: &RideId) -> Result<bool>;
    fn claims_for_rider(&self, rider_id: &str) -> Result<Vec<Claim>>;
}

#[derive(Default)]
pub struct InMemoryLedger {
    state: Mutex<LedgerState>,
}

#[derive(Default)]
struct LedgerState {
    next_id: ClaimId,
    by_id: HashMap<ClaimId, LedgerEntry>,
    by_ride: HashMap<RideId, ClaimId>,
}

impl InMemoryLedger {
    pub fn new() -> Self {
        Self::default()
    }
}

impl ClaimLedger for InMemoryLedger {
    fn submit(&self, claim: Claim) -> Result<ClaimId> {
        let mut s = self.state.lock().map_err(|_| {
            PedalshieldError::Ledger("poisoned mutex".into())
        })?;
        if s.by_ride.contains_key(&claim.ride_id) {
            return Err(PedalshieldError::DuplicateClaim(claim.ride_id));
        }
        s.next_id += 1;
        let id = s.next_id;
        let ride_id = claim.ride_id.clone();
        s.by_id.insert(
            id,
            LedgerEntry {
                claim_id: id,
                claim,
                status: ClaimLedgerStatus::Pending,
            },
        );
        s.by_ride.insert(ride_id, id);
        Ok(id)
    }

    fn get(&self, id: ClaimId) -> Result<Option<LedgerEntry>> {
        let s = self
            .state
            .lock()
            .map_err(|_| PedalshieldError::Ledger("poisoned mutex".into()))?;
        Ok(s.by_id.get(&id).cloned())
    }

    fn pending(&self) -> Result<Vec<LedgerEntry>> {
        let s = self
            .state
            .lock()
            .map_err(|_| PedalshieldError::Ledger("poisoned mutex".into()))?;
        Ok(s.by_id
            .values()
            .filter(|e| matches!(e.status, ClaimLedgerStatus::Pending))
            .cloned()
            .collect())
    }

    fn mark_batched(&self, ids: &[ClaimId], batch_id: BatchId) -> Result<()> {
        let mut s = self
            .state
            .lock()
            .map_err(|_| PedalshieldError::Ledger("poisoned mutex".into()))?;
        for id in ids {
            if let Some(entry) = s.by_id.get_mut(id) {
                entry.status = ClaimLedgerStatus::Batched(batch_id);
            }
        }
        Ok(())
    }

    fn mark_paid(
        &self,
        ids: &[ClaimId],
        batch_id: BatchId,
        txid_hex: &str,
    ) -> Result<()> {
        let mut s = self
            .state
            .lock()
            .map_err(|_| PedalshieldError::Ledger("poisoned mutex".into()))?;
        for id in ids {
            if let Some(entry) = s.by_id.get_mut(id) {
                entry.status = ClaimLedgerStatus::Paid {
                    batch_id,
                    txid_hex: txid_hex.to_string(),
                };
            }
        }
        Ok(())
    }

    fn has_ride(&self, ride_id: &RideId) -> Result<bool> {
        let s = self
            .state
            .lock()
            .map_err(|_| PedalshieldError::Ledger("poisoned mutex".into()))?;
        Ok(s.by_ride.contains_key(ride_id))
    }

    fn claims_for_rider(&self, rider_id: &str) -> Result<Vec<Claim>> {
        let s = self
            .state
            .lock()
            .map_err(|_| PedalshieldError::Ledger("poisoned mutex".into()))?;
        Ok(s.by_id
            .values()
            .map(|e| e.claim.clone())
            .filter(|c| c.rider_id == rider_id)
            .collect())
    }
}
