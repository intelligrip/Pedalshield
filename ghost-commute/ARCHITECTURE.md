# Ghost Commute: architecture note

What is hidden, what is proved, and what is trusted. Short version: the only new construction is a signed attestation. Everything on chain is standard Zcash, and the disclosure is the ZIP 212 sender-recovery path pointed at a third party.

## Parties and flow

```
 Rider device                     Sponsor                         Chain (testnet)          Auditor
 ────────────                     ───────                         ───────────────          ───────
 GPS trace T (stays)
 motion check(T) → "bike"
 salt s (stays)
 A = {rider_pk, payout_ua, ⌊dist⌋₁₀₀ₘ,
      window₁₅ₘᵢₙ, zone, stats,
      C = H(s‖T), nonce}
 σ = Ed25519_sk(canon(A))  ──A,σ──►  verify σ, policy, replay
                                     r = H(canon(A,σ))[0..16]
                                     memo = "GHOST1 r=… d=…\n<line>"
                                     shielded send v → Orchard
                                     receiver of payout_ua  ──tx──►  action (cmx, epk, C_enc)
 IVK trial-decrypts tx ◄──────────────────────────────────────────── 
 disclosure D = {txid, pool, i,
   addr, v, rseed, r}  ──────────────────────────────────────────────────────────────────►  fetch tx
                                                                                          check D opens action i
                                                                                          decrypt memo, check r
                                                                                          verify σ on A, r = H(A),
                                                                                          addr ∈ payout_ua
```

## What is hidden

- **On chain:** sender, recipient, amount and memo of the payout, by the Orchard-protocol action (Halo 2 proof, note commitment `cmx`, ChaCha20-Poly1305 note ciphertext). Since NU6.3 the payout lands in the Ironwood pool. That's the same action format with V3 note plaintexts, and the analysis is unchanged.
- **From the sponsor:** the trace `T`, exact times, exact distance, and the rider's wallet beyond one diversified address. Diversified addresses from one IVK are unlinkable without that IVK, so a fresh address per payout keeps a sponsor (or a leaked sponsor database) from seeing that payouts share a wallet. The sponsor does see a stable `rider_pk` by design (for replay control and streaks). Unlinkability is between payouts on chain, not toward the payer.
- **From the auditor:** everything in the rider's wallet except the one disclosed note, and `T`.
- **From everyone:** `T` and `s`. `C = SHA-256(s ‖ T)` with a 256-bit salt is hiding under the usual random-oracle assumption on SHA-256.

## What is proved, and by what

1. **The rider endorsed this claim.** EUF-CMA of Ed25519 over the canonical JSON of `A`. The canonical form (sorted keys, integers only, ASCII strings) is byte-identical across the JS signer and the Rust verifier, which is tested end to end.
2. **The payment pays this claim.** The memo carries `r = SHA-256(canon(A‖σ))[0..16]`. The 128-bit truncation gives 2⁶⁴ collision resistance, which is enough for a receipt id but isn't a commitment against a sponsor grinding claims. The sponsor writes the memo, so `r` binds "the sponsor says this payment is for `A`".
3. **The payment went where the rider asked.** The verifier rebuilds the note from `(addr, v, ρ, rseed)` with `ρ` = the action's nullifier, which is public. It requires `cmx` to match the action's on-chain `cmx` and requires `addr` to equal the Orchard receiver inside the signed `payout_ua`. Binding of the Sinsemilla note commitment means no other `(addr, v)` opens that `cmx`.
4. **The memo is the one actually sent.** From `rseed` the verifier derives `esk = ToScalar(PRF^expand_rseed([4]‖ρ))` (ZIP 212). It checks `[esk]·g_d = epk`, derives the KDF key from `[esk]·pk_d`, and AEAD-decrypts that action's `C_enc`. For Ironwood V3 notes the pool's own note-encryption domain supplies the derivation, through the same code path. This is `zcash_note_encryption::try_output_recovery_with_pkd_esk`, the routine wallets use for sender recovery. It also runs the ZIP 212 consistency check (`esk` must match the one derivable from the note) and the note validity check against `cmx`. We then require the recovered note to equal the disclosed note exactly. A disclosure with an inflated `v` fails here, and the demo script tests that.
5. **The transaction is the one named.** The tx bytes hash (ZIP 244) to the disclosed txid.

The disclosure reveals that note's `rseed`, which reveals the memo and the receiver. It does **not** reveal the note's nullifier: that needs `nk` from the rider's FVK, so the auditor cannot tell whether or when the rider spent the note. That's a deliberate property. The disclosure covers one note and doesn't give anyone a view of the rider's later spending.

## What is trusted (and isn't proved)

| Assumption | Why it's here | How to remove it |
|---|---|---|
| The rider's device runs the motion check honestly and commits to the real trace | Nothing proves a GPX came from a bicycle | Platform attestation (App Attest / Play Integrity) of the app + sensor-fusion check; longer term a ZK circuit over the signed raw sensor stream |
| The motion heuristic separates bikes from cars | Thresholds (`median > 32`, `p95 > 45`, gap > 60 s at > 35 km/h, …) are a prototype | Better models, but never "proof"; label it as such |
| lightwalletd tells the truth about mined height | Inclusion is not checked against headers | Run Zebra + lightwalletd, or verify the Merkle path to a block header you trust |
| The sponsor's ledger enforces replay rules | Double-claiming is policy, not cryptography | Enrollment of rider keys; nullifier-style one-claim-per-window tags |
| The sponsor writes an honest memo | `r` is sponsor-asserted | Rider countersigns receipt; or sponsor signs `(txid, r)` in the disclosure bundle |

## What we deliberately did not build

- No server that sees traces, and no map tiles fetched during a ride (tile requests are a location leak too).
- No transparent rewards. The CLI refuses UAs without an Orchard receiver and pays only the Orchard receiver.
- No unreleased consensus features. Uses Orchard-protocol actions, ZIP 302 memos, ZIP 316 UAs and ZIP 212 recovery, all live today.
- No claims of anti-cheat. The motion check says `prototype-v1` everywhere it appears, including inside the signed attestation.
