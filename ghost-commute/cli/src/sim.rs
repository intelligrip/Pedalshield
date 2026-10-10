//! Offline simulation: a real, proven, encrypted Orchard-protocol transaction
//! built locally, so the disclosure demo runs even when testnet or the venue
//! Wi-Fi does not cooperate.
//!
//! What is real: note encryption, note commitments, the Halo 2 proof, the
//! transaction encoding and its txid. What is NOT real: chain inclusion. The
//! bundle has no spends (value enters from an imaginary transparent input) and
//! its signatures are over a zero sighash, so this transaction is not
//! consensus-valid and must never be broadcast. Every command that touches it
//! says "offline".

use anyhow::{anyhow, Context, Result};
use orchard::{
    builder::{Builder, BundleType},
    bundle::{BundleVersion, Flags},
    circuit::{OrchardCircuitVersion, ProvingKey},
    keys::{FullViewingKey, Scope, SpendingKey},
    value::NoteValue,
    Address, Anchor,
};
use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_primitives::transaction::{Authorized, TransactionData};
use zcash_protocol::consensus::{BlockHeight, BranchId};
use zcash_protocol::value::ZatBalance;

use crate::net::{self, Net};

/// A throwaway rider wallet: UFVK + a fresh diversified Orchard-only address.
pub fn rider(seed: Option<[u8; 32]>, n: Net) -> Result<Value> {
    let seed = seed.unwrap_or_else(|| {
        let mut s = [0u8; 32];
        OsRng.fill_bytes(&mut s);
        s
    });
    let usk = UnifiedSpendingKey::from_seed(&n.params(), &seed, zip32::AccountId::ZERO)
        .map_err(|e| anyhow!("{e:?}"))?;
    let ufvk = usk.to_unified_full_viewing_key();
    let fvk = ufvk.orchard().ok_or_else(|| anyhow!("no orchard key"))?;
    // A random diversifier index per payout: addresses from one account are
    // unlinkable without the viewing key.
    let j = OsRng.next_u32();
    let addr = fvk.address_at(j, Scope::External);
    Ok(json!({
        "WARNING": "offline demo wallet; seed is printed on purpose; never fund it",
        "network": n.name(),
        "seed_hex": hex::encode(seed),
        "ufvk": ufvk.encode(&n.params()),
        "diversifier_index": j,
        "payout_ua": net::orchard_only_ua(addr.to_raw_address_bytes(), n)?,
    }))
}

fn sponsor_sk() -> Result<SpendingKey> {
    // Fixed, public, worthless: the offline sim sponsor. Network-independent seed.
    SpendingKey::from_zip32_seed(&[0x5Au8; 32], 1, zip32::AccountId::ZERO)
        .map_err(|e| anyhow!("sim sponsor key: {e:?}"))
}

pub fn sponsor_fvk_hex() -> Result<String> {
    Ok(hex::encode(FullViewingKey::from(&sponsor_sk()?).to_bytes()))
}

/// Build a real proven Ironwood-pool (post-NU6.3) transaction with one payout output.
pub fn pay(n: Net, to_ua: &str, value_zat: u64, memo_text: &str) -> Result<(String, Vec<u8>)> {
    let receiver = net::orchard_receiver(to_ua, n)?;
    let to: Address = Option::from(Address::from_raw_address_bytes(&receiver))
        .ok_or_else(|| anyhow!("invalid Orchard receiver"))?;
    let memo = crate::memo::to_bytes(memo_text)?;

    // Sponsor key for the simulation (fixed, public, worthless).
    let sk = sponsor_sk()?;
    let ovk = FullViewingKey::from(&sk).to_ovk(Scope::External);

    let mut rng = OsRng;
    let mut b = Builder::new(BundleType::DEFAULT, BundleVersion::ironwood_v3(), Flags::ENABLED, Anchor::empty_tree())
        .map_err(|e| anyhow!("builder: {e:?}"))?;
    b.add_output(Some(ovk), to, NoteValue::from_raw(value_zat), memo)
        .map_err(|e| anyhow!("add_output: {e:?}"))?;
    let (unauth, _meta) = b
        .build::<ZatBalance>(&mut rng)
        .map_err(|e| anyhow!("build: {e:?}"))?
        .ok_or_else(|| anyhow!("empty bundle"))?;

    eprintln!("[sim] building Halo 2 proving key (post-NU6.3 circuit) — a few seconds…");
    let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
    eprintln!("[sim] proving…");
    let proven = unauth.create_proof(&pk, &mut rng).map_err(|e| anyhow!("prove: {e:?}"))?;
    // Zero sighash: see module docs. Not consensus-valid, never broadcast.
    let authorized = proven
        .apply_signatures(&mut rng, [0u8; 32], &[])
        .map_err(|e| anyhow!("sign: {e:?}"))?;

    let txd = TransactionData::<Authorized>::from_parts_v6(
        BranchId::Nu6_3,
        0,
        BlockHeight::from_u32(0),
        None,
        None,
        None,
        Some(authorized),
    );
    let tx = txd.freeze().context("freeze tx")?;
    let mut raw = vec![];
    tx.write(&mut raw)?;
    Ok((tx.txid().to_string(), raw))
}
