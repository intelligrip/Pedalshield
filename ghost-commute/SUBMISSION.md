# ZECATHON submission: Ghost Commute

**One line:** Get paid to bike. Nobody learns where you live.
**Track:** Shielded Payments (secondary: Wildcard)

## Blurb (150 words)

A public payment for "biked from home to work" is a stalking kit: two addresses, a schedule, a wallet graph. Ghost Commute pays riders anyway, without building the kit.

The phone checks the ride locally and signs an attestation with no coordinates: distance to 100 m, a 15-minute window, a city, and a salted commitment to the trace. The sponsor (employer, city, insurer) pays shielded ZEC to a fresh diversified address, with an encrypted memo carrying a receipt hash and a roast only the rider reads. Explorers see ciphertext.

The demo moment: an auditor gets a one-note disclosure. It rebuilds the note commitment, derives the ephemeral key, decrypts that single memo, and checks the receipt against the rider's signature. Amount verified. Recipient verified. Route withheld, because it was never sent.

Real Orchard-protocol crypto, zcash-devtool on testnet, offline fallback with a real Halo 2 proof. The bike detector is labelled prototype.

## 60-second demo script

*For a judge who has seen too many "private Venmo" clones. Screen: the web app on the left, a terminal on the right. Have `demo-out/` (or a real testnet `disclosure.json`) ready.*

| t | Screen | Say |
|---|---|---|
| 0:00 | Ride tab, nothing loaded | "Private Venmo hides who paid whom. This hides something worse: where you live. Pay someone in public for 'biked to work' and you've published their address and their schedule." |
| 0:08 | Click **car "commute"** → CAR ✗. Click **bus teleport** → TELEPORT ✗ | "The check runs on the phone. Car speeds get rejected, and so does a GPS gap that crosses 2.5 km in two minutes. It's a prototype and the UI says so." |
| 0:18 | Click **bike commute** → BIKE ✓, **Sign attestation**. Point at the two panels | "Left: what stays on the phone, which is 271 GPS points and the route. Right: what leaves, which is 7.3 km, a 15-minute window, 'Bend', and a signature. No coordinates anywhere." |
| 0:28 | Terminal: `ghost tx public …` | "The sponsor pays shielded ZEC to a fresh one-time address. Here's what the chain shows: two actions and 580 bytes of ciphertext each. No amount, no recipient, no memo." |
| 0:36 | Rider wallet tab: memo card | "The rider's viewing key opens the memo: 'A car would have been faster. A car would also have been a snitch.'" |
| 0:42 | Terminal: `ghost disclose verify disclosure.json --attestation attestation.json` → PAYOUT VERIFIED box | "Now the auditor, say the city's finance office. They get one note's opening. The CLI rebuilds the commitment, re-derives the ephemeral key, decrypts that one memo, and matches it to the rider's signed claim. Amount: verified. Recipient: verified." |
| 0:52 | Auditor tab: **ROUTE WITHHELD** stamp. Hand over the laptop | "Route: withheld, and not by policy. It was never sent anywhere. Try to inflate the amount and it fails. Try to slip a latitude into the claim and it's refused. Get paid to bike. Nobody learns where you live." |
| 1:00 | — | — |

**Backup line if asked "isn't the phone trusted?"** "Yes, and the README says so. The motion check is labelled a prototype. The money, the memo and the disclosure don't rely on trusting anyone; the ride check does."

## Before submitting (TODO for Sam)

- [ ] Run `./scripts/testnet.sh` end to end once and commit the real `txid`, `disclosure.json`, `attestation.json` to `fixtures/testnet/` so judges can run `ghost disclose verify fixtures/testnet/disclosure.json --attestation fixtures/testnet/attestation.json` against live testnet without a wallet.
- [ ] Add the explorer link for that txid to the README.
- [ ] Record the 60-second video from the script above.
