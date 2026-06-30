# Sustainable treasury: reward pool + oracle + fee recovery

Pedalshield pays real shielded ZEC for verified rides. Left alone, the treasury
is pure outflow — you fund it, riders drain it. This design turns it into a
**pool with inflows, a trusted price, and fee recovery**, so it can sustain
itself instead of bleeding.

Three parts, matching the three decisions made:

1. **Inflows** — crypto miners (and donors) add ZEC to the pool. Direct
   contributions now; a mining-pool split later.
2. **Oracle** — an off-chain, signed price service that (a) holds the reward
   rate on the carbon peg and (b) values each inbound contribution.
3. **Fee recovery** — a per-ride buffer that recovers the network fee the
   treasury pays on each settlement, so batched fees don't drain the pool.

> **Why "off-chain oracle"?** Zcash has no on-chain smart contracts, so there
> is nowhere to put a Chainlink-style on-chain oracle or an escrow contract.
> The oracle is therefore a service the treasury host runs and **signs**; the
> backend verifies the signature before trusting a price. This is the correct
> and only architecture on Zcash today, and it keeps the non-custodial design
> intact — no third party ever controls funds.

---

## 1. The reward pool (inflows)

The pool is the existing treasury account, now with an accounted ledger of what
goes **in** as well as what goes **out** (`crates/.../src/pool.rs`).

### Direct miner contributions (live today)

A miner points part of their ZEC at the **treasury pool Unified Address** and
includes a memo tagging themselves:

```
MINER:<handle>           e.g.  MINER:alice-rig-01
```

The treasury already runs a viewing-key scanner (the same one that finds change
notes). When it sees an inbound note to the pool address it calls:

```rust
pool::record_inflow(&conn, txid_hex, "miner:alice-rig-01", amount_zat, memo, now)?;
```

`record_inflow` is **idempotent on the funding txid**, so a re-scanned note
never double-credits — the same guarantee the accrual ledger gives per claim.
Sources are tagged `miner:<id>`, `mining-split`, or `donation` so the `/pool`
view can break down where the funding came from.

This is fully non-custodial and works **right now**: a miner just sends ZEC to
an address. Nothing new on-chain is required.

### Mining-pool split (phase 2)

For passive, continuous funding: run or partner a Zcash mining pool whose payout
config routes a configurable percentage of block rewards to the treasury pool
address. To the ledger it looks identical to a direct contribution
(`source = "mining-split"`); only the plumbing differs. This is infrastructure
work (a pool operator agreement or a self-hosted pool), deferred until direct
contributions prove the loop.

**Headline framing that this unlocks:** *mining funds riding.* Hashpower
converts electricity into ZEC that pays people to avoid burning gasoline — a
clean story for the carbon thesis.

---

## 2. The oracle (price peg + contribution attestation)

`deploy/oracle.sh` (the producer) and `crates/.../src/oracle.rs` (the consumer).

### What it produces

The shell oracle fetches ZEC/USD from **several independent exchanges**
(CoinGecko, Kraken, Coinbase), takes the **median** (so one stale or hostile
source can't move the peg), computes the carbon-peg reward rate, and emits a
**signed** attestation:

```json
{
  "v": 1,
  "price_usd": 470.00000000,
  "sources": "coingecko,kraken,coinbase",
  "n": 3,
  "zat_per_km": 793,
  "usd_per_mile_target": 0.006,
  "ts": 1782843462,
  "payload": "v1|price_usd=470|zat_per_km=793|n=3|ts=1782843462",
  "sig_hmac_sha256": "3576f6db…"
}
```

`sig_hmac_sha256 = HMAC-SHA256(secret, payload)`. The `secret` is shared only
between the oracle host and the backend.

### The carbon peg

The reward rate is the ZEC amount that makes a mile pay exactly the carbon
value — the dollar value of 1 lb of CO₂ kept out of the air by biking instead
of driving:

```
1 lb CO₂ avoided / mile  ×  $0.006 / lb  =  $0.006 / mile
usd_per_km   = 0.006 / 1.609344
zat_per_km   = (usd_per_km / price_usd) × 100_000_000
```

Verified: at **$470 → 793 zat/km** (matches the deployed peg). The math lives in
exactly one place in each language and is cross-checked: `oracle.rs`’
`peg_is_consistent()` recomputes `zat_per_km` from the attestation’s own price
and rejects a signed-but-inconsistent attestation.

### What the backend does with it

```rust
let att: PriceAttestation = serde_json::from_str(&body)?;
if !att.verify(secret.as_bytes()) || !att.peg_is_consistent() {
    return Err(/* reject: bad signature or inconsistent peg */);
}
// 1) hold the peg
set_zat_per_km(att.zat_per_km);
// 2) value an inbound contribution
let usd   = oracle::value_zat_usd(amount_zat, att.price_usd);
let miles = oracle::carbon_miles_funded(amount_zat, att.price_usd); // rider-miles funded
```

So a miner sending **0.1 ZEC at $470** is attested as **$47.00 ≈ 7,833
rider-miles** of carbon-pegged rewards funded — an honest, on-the-record measure
of what each contribution buys.

### Operating it

```bash
# dry run: print the signed attestation
PEDALSHIELD_ORACLE_SECRET=…  ./oracle.sh

# apply the peg to the live backend (refuses if unsigned)
sudo PEDALSHIELD_ORACLE_SECRET=…  ./oracle.sh --apply

# test the math offline, no network
ORACLE_PRICES="430.10 435.00 428.50"  ./oracle.sh
```

Run from cron (e.g. hourly) so the peg tracks the market automatically. It
replaces the single-source `repeg_carbon_rate.sh` with a multi-source, signed
feed.

---

## 3. Fee recovery (per-ride buffer)

Every on-chain settlement costs a fixed ZIP-317 network fee (~5,000 zat). With
accrual batching one settlement covers many rides, but the fee is still real and
comes out of the pool. **Per-ride fee recovery** charges each ride its amortized
slice of that fee so the pool stays whole:

```rust
let buffer = pool::fee_buffer_zat(reward_zat, floor_zat, fee_zat); // ceil(reward·fee/floor)
pool::add_fee_recovery(&conn, buffer)?;
```

Because a settlement fires at `floor`, the buffers collected over one floor's
worth of rewards sum to ≈ the fee. Example at floor = 0.01 ZEC, fee = 5,000 zat:
each ride contributes ~0.5% of its reward; ten 0.001-ZEC rides recover the full
5,000-zat fee. The fee stops being dead weight on the pool.

Net spendable balance and runway then fall straight out of the ledger:

```
net_zat      = inflows − rewards_paid − fees_borne
runway_days  = net_zat / daily_burn_zat
```

surfaced for a `/pool` endpoint via `pool::stats()`.

---

## Endpoints to add (next wiring step)

The modules are deliberately **not yet wired into the running backend** — same
rollout as `accrual.rs`: land the tested module first, opt in second. To
activate:

- `GET  /pool` → `pool::stats()` as JSON (balance, inflows by source, fees
  recovered, runway). A natural live artifact.
- `POST /oracle` (auth) → accept a `PriceAttestation`, `verify()` +
  `peg_is_consistent()`, then update the peg. Or have the backend pull/verify on
  a timer.
- In the settlement sweep: `record_outflow(...)` with the fee, and
  `add_fee_recovery(fee_buffer_zat(...))` per ride credited.
- In the viewing-key scanner: `record_inflow(...)` for inbound notes to the pool
  address, source-tagged from the memo.

---

## Security & honesty notes

- **Oracle trust.** The signed attestation only proves *the oracle host* said a
  price; it is not a trustless on-chain feed (impossible on Zcash today). Keep
  the secret on the treasury host; rotate it if exposed. The median-of-three
  defends against a single bad exchange, not against a compromised host.
- **Non-custodial intact.** Inflows are plain ZEC sends to an address the
  treasury controls; nothing here introduces custody of *other people's* funds
  or any new key authority.
- **No hand-rolled crypto.** HMAC verification uses the audited `hmac` crate.
- **Reward integrity unchanged.** None of this alters ride verification or the
  reward formula; it only accounts for money in/out and tracks the peg.

## Verification status

- `deploy/oracle.sh`: median (odd/even), carbon peg ($470 → 793 zat/km), and
  HMAC signing **verified in-sandbox**; signature reproduced independently and
  shown to reject a wrong key.
- `oracle.rs` / `pool.rs`: written to the proven `accrual.rs` pattern with
  `#[cfg(test)]` unit tests (peg vector, signature accept/reject, idempotent
  inflow, net/runway, fee-buffer amortization). The Rust **builds and tests on
  the droplet** (the toolchain + crates.io aren't available in the build
  sandbox), exactly as the rest of `zcash-service` is built.
