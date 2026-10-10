# Ghost Commute

**Get paid to bike. Nobody learns where you live.**

ZECATHON 2026 · Track: **Shielded Payments** (secondary fit: Wildcard)

A bike-to-earn loop where the reward is shielded ZEC and the route never leaves the phone. The rider proves they rode. The sponsor (an employer, city or insurer) pays a shielded note with an encrypted memo. An auditor gets a **one-note disclosure** that verifies the payout and doesn't contain the route, because the route was never in the system.

Modes: **Snitchless subsidy** (sponsor side). **Strava for people who hate Strava** (rider side).

> Pay someone in public for "biked from home to work" every weekday and you've built a stalking kit: two addresses, a schedule, and a wallet graph. That's why this runs on Zcash. Shielded payments are what the product is made of.

---

## Run it in under 10 minutes

You need Rust (stable), Node 20+ and Python 3 (for a static file server). No wallet, faucet or network needed for this path.

```bash
git clone <this repo> ghost-commute && cd ghost-commute
(cd cli && cargo build --release)        # ~3–5 min the first time (librustzcash + halo2)
./scripts/demo-offline.sh                # full loop + "try to cheat", ~10 s
python3 -m http.server 8000              # then open http://localhost:8000/web/
```

In the web app:

1. **Ride**: click *🚗 car "commute"* and it's rejected. Click *🚌 bus teleport* and it's rejected. Click *🚲 bike commute*, paste the address from `demo-out/sim/rider.json` (`payout_ua`), then **Sign attestation**. Compare the two panels: *Stays on this device* and *Leaves this device*.
2. **Sponsor**: click *use the one from tab 1* to see what the sponsor learns and what it never gets.
3. **Auditor**: load `demo-out/report.json` and `demo-out/attestation.json`. You get the **ROUTE WITHHELD** stamp, every check, and a browser re-check of the receipt hash.
4. **Rider wallet**: load `demo-out/rider-receipt.local.json` to see the memo only the rider can read.

The offline path uses real cryptography: an Ed25519 attestation, Orchard-protocol note encryption and commitments, a real Halo 2 proof, and the real v6 transaction encoding and txid. Only chain inclusion is missing. The CLI prints `! OFFLINE: chain inclusion not checked` every time, so nobody mistakes it for a mined payment.

### On testnet (the real thing)

```bash
cargo install --git https://github.com/zcash/zcash-devtool --rev 5a26ee854e634a4e88d1d79dab13f8fbb1eac6b8 --locked
./scripts/testnet.sh setup                 # sponsor + rider wallets (zcash-devtool, testnet.zec.rocks)
./scripts/testnet.sh fund                  # faucet → sponsor; shields any transparent coins (setup only)
UA=$(./scripts/testnet.sh rider-address)   # fresh diversified Orchard-only address for this payout
node web/attest-cli.mjs samples/bike-commute.gpx --payout-ua "$UA"
./scripts/testnet.sh pay attestation.json  # shielded send, memo encrypted to the rider
./scripts/testnet.sh public                # what an explorer sees
./scripts/testnet.sh disclose              # rider: decrypt memo, write disclosure.json
./scripts/testnet.sh verify                # auditor: verify against lightwalletd → report.json
```

Testnet faucets: [zechub.wiki/using-zcash/faucets](https://zechub.wiki/using-zcash/faucets). Explorer: [testnet.zcashexplorer.app](https://testnet.zcashexplorer.app).
`fund` is the **only** transparent step: faucets often pay to transparent addresses, so the sponsor shields those coins first. Payouts always go to the Orchard receiver. `ghost claim` removes the transparent and Sapling receivers from the rider's address before printing the send command.

---

## Sponsor audit packs (payer-side disclosure)

The payer can disclose its own payouts with its **outgoing viewing key**, so riders don't need to hand over any keys. That turns a month of payouts into one folder finance can re-verify:

```bash
ghost key fvk-from-sk treasury_spending_key.bin > treasury.fvk.local     # view-only; never leaves the machine
ghost audit pack --network main --fvk @treasury.fvk.local --txids txids.txt --label "Pilot · Oct" --out audit-pack
ghost audit verify audit-pack            # → ALL PAYOUTS VERIFIED, total ZEC, routes withheld; statement.json for the web
ghost audit verify audit-pack --redact-items   # totals only, for publishing
```

`scripts/pedalshield-mainnet-audit.sh` runs this against Pedalshield's real mainnet treasury. A pack names each payout's receiver and lets the holder decrypt that memo, so packs for other people's payouts stay private. Only payouts to the founder's own wallet go in `fixtures/mainnet/`.

---

## What leaks and what doesn't

| | Public chain | Sponsor | Auditor (with disclosure) | Rider |
|---|---|---|---|---|
| GPS trace / route | – | – | – | ✓ (device only) |
| Home / workplace | – | – | – | ✓ |
| Exact start/end time | – | – | – | ✓ |
| ~Distance (100 m), 15-min window, city | – | ✓ | ✓ (if given the attestation) | ✓ |
| Payout amount | – | ✓ (sent it) | ✓ | ✓ |
| Rider's payout address | – | ✓ one-time diversified | ✓ that one only | ✓ |
| Memo (receipt + roast line) | – (ciphertext) | ✓ (wrote it) | ✓ that one memo | ✓ |
| Rider's other notes, balance, history | – | – | – | ✓ |
| That *a* shielded tx happened, its size, fee | ✓ | ✓ | ✓ | ✓ |

Things that still leak, stated plainly:

- **Timing.** If the sponsor pays the moment you arrive at work, the tx timestamp is a clue. Sponsors should batch payouts (e.g. nightly).
- **Coarse metadata goes to the sponsor.** Distance to 100 m, a 15-minute window and a city id, under a pseudonymous rider key. Five rides a week from the same key still sketch a habit. Riders can rotate keys if the sponsor's enrollment model allows it.
- **The memo is readable by whoever gets the disclosure.** Opening a note commitment necessarily allows decrypting that note. So the memo holds only a receipt id and a joke, never anything location-shaped (`ghost claim` also refuses `@` in memos).
- **Network level.** lightwalletd sees your IP and which txids you ask about. Use your own node or devtool's `--connection tor`.

---

## Zcash primitives used (for real)

| Primitive | Where |
|---|---|
| **Shielded payment** (Orchard protocol; Ironwood pool after NU6.3) | `testnet.sh pay` → `zcash-devtool send`. Sender, receiver and amount are hidden |
| **Encrypted memo** (ZIP 302, 512 B) | `GHOST1 r=<receipt> d=7.3km` plus the rider's streak/roast line. `cli/src/memo.rs` |
| **Diversified unified addresses** | A fresh `gen-addr` per payout, reduced to the Orchard receiver only. Repeat rewards don't link |
| **Selective disclosure** | One-note opening, verified with `try_output_recovery_with_pkd_esk` (ZIP 212 `esk` derivation). `cli/src/disclose.rs` |
| **Viewing keys** | Rider finds their payout with the UFVK's external IVK. The UFVK never leaves the rider's machine |

**NU6.3 / Ironwood note.** Since NU6.3 (mainnet block 3,428,143; testnet 4,134,000), consensus disables cross-address sends in the legacy Orchard pool. Payments to another person land in the **Ironwood** pool: same action format, keys and receivers, V3 note plaintexts. The verifier checks both pools and reports which one it found. The offline sim builds an Ironwood-pool v6 transaction. This uses nothing unreleased: it's the consensus rules running today, read through the crates `zcash-devtool` already pins (orchard 0.15, zcash_primitives 0.30).

---

## Repo

```
cli/                 ghost: Rust CLI (claim, disclose create/verify, tx public, sim)
  src/attest.rs      attestation schema + Ed25519 verify + receipt id
  src/canon.rs       canonical JSON (byte-identical to web/ghost-core.js)
  src/memo.rs        memo format + roasts
  src/disclose.rs    one-note disclosure: create (rider) / verify (auditor)
  src/net.rs         Orchard-only address handling, lightwalletd fetch
  src/sim.rs         offline: real proven Ironwood-pool tx, never broadcast
web/                 static rider/sponsor/auditor app (no build, no server)
  ghost-core.js      GPX parse, motion check, attestation (browser + Node)
  attest-cli.mjs     same core from a terminal
samples/             synthetic Bend, OR rides: bike, car, bus teleport, walk
scripts/demo-offline.sh   whole loop + cheat attempts, no network
scripts/testnet.sh        whole loop on testnet via zcash-devtool
scripts/pedalshield-mainnet-audit.sh   audit pack from Pedalshield's real mainnet payouts
scripts/build-single.mjs  one-file web build (web/dist/) for hosting the demo
  src/audit.rs       sponsor audit packs + statements
COLOSSEUM.md         Colosseum World's Fair submission copy + video scripts
ARCHITECTURE.md      what is hidden, what is proved, what is trusted
SUBMISSION.md        blurb + 60-second demo script
```

---

## Known limits (prototype; no anti-cheat claims)

- **The motion check is a plausibility filter, not anti-cheat.** It rejects car-speed traces, GPS-gap teleports, walks and very short rides. It does **not** detect a forged or replayed GPX, a phone on a slow scooter, or an e-bike. Real deployments need platform attestation (App Attest / Play Integrity), sensor fusion, and ideally a ZK proof over the trace. Pedalshield's ANTI_CHEAT_THREAT_MODEL.md is the longer version.
- **The phone is trusted** to run the check honestly and to compute the route commitment over the real trace. Signatures prove *who* attested, not that the ride happened.
- **Replay protection is per rider key**: same attestation, same route commitment, or overlapping 15-minute windows are refused. A rider with many keys can double-dip unless the sponsor enrolls keys (one per employee or member).
- **Chain inclusion is trusted to lightwalletd.** The verifier checks the tx bytes hash to the txid and that the disclosed note opens an action in it. It trusts lightwalletd's mined height. Point `--server` at your own Zebra-backed lightwalletd for an independent check.
- **Not finished for mainnet UX (TODOs):**
  - TODO: rider wallet in-app (Zashi-compatible flow, or the Zcash Android/iOS SDK) instead of `zcash-devtool`. Today the rider copies a UA and holds a UFVK file.
  - TODO: the sponsor sends with `OvkPolicy::Sender`. Batched payouts via PCZT/FROST treasury (Pedalshield's `zcash-service`) would remove the single hot key.
  - TODO: a WASM build of `disclose verify` so auditors don't need the CLI.
  - TODO: FROST friend-pool that matches miles (stretch goal, not started; not on the demo path).
  - TODO: route-commitment opening for disputes (the salt is kept; no opening protocol yet).
- **`ghost sim` transactions are not consensus-valid** (no spends, zero sighash). They exist only so the demo survives bad Wi-Fi.

License: MIT (see LICENSE-MIT).
