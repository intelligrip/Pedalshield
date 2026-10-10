# Colosseum Crypto World's Fair: Pedalshield (Zcash track)

**Deadline:** Oct 12, 2026, 11:59 pm PT (rules §5). Submit from the Arena dashboard; the team leader submits.
**Track:** Zcash ($100k across 10 products that integrate with the Zcash blockchain or asset).
**Required:** pitch video (2–3 min), product demo video (≤3 min), repo (public, or private with access for hackathon@colosseum.com), and **disclosure of all prior work**. Only work from Sep 14 to Oct 12 is judged.
**Judged on:** functionality and code quality, impact, novelty, UX, open source and composability, business plan. The team also weighs founder–market fit, traction, insight, market size, communication and viability.

> Placeholders in `[[double brackets]]` need real numbers from Sam. Leave them out rather than guess.

---

## Form copy

**Project name:** Pedalshield

**One-liner:** Employers and cities pay people to bike. Pedalshield verifies the ride on the phone and pays in shielded ZEC, so the sponsor can audit every payout and never learns where anyone lives.

**Short description (≈60 words):**
Commuter-benefit and city mode-shift programs need proof that people actually biked. Today that proof means a GPS trail, which works as a stalking kit with a payroll attached. Pedalshield checks rides on the phone and pays riders in shielded ZEC on mainnet. Sponsors get a one-note audit pack that proves every payout and contains no route, address or schedule.

**Problem:**
Bike-to-work incentives are paid for by people who can't see the rides (HR, insurers, city transport departments), so they ask for GPS proof. Employees refuse tracker apps, honor-system programs get gamed, and paying riders on a public chain makes things worse: "home → office, every weekday" written to a public ledger is a map of someone's life. So privacy and verification look like they're in conflict, and most programs give up one to get the other.

**Solution:**
- **On the phone:** the ride is verified locally. The claim leaves without coordinates, and an open-source unit test enforces that.
- **On chain:** an autonomous treasury pays shielded ZEC with an encrypted memo. Since the July 29 NU6.3 upgrade, payouts land in the Ironwood pool. Explorers see ciphertext.
- **For the sponsor (built this hackathon):** the treasury recovers each of its own payouts with its outgoing viewing key and issues a **one-note disclosure** per payout. An auditor re-opens the note commitment on chain, re-derives the ephemeral key, and decrypts that one memo. They see amount verified, recipient verified, and **route withheld**, because the route was never sent anywhere. `ghost audit pack` and `ghost audit verify` turn a month of payouts into one statement finance can check.

**Why Zcash:** this only works with private payments. Shielded notes hide the sender, receiver and amount. Diversified addresses stop repeat rewards from forming a graph. Outgoing viewing keys let the payer prove its own payments without anyone else's keys. On a transparent chain the payout history *is* the surveillance.

**What we built during the hackathon (Sep 14 – Oct 12):**

Headline: the sponsor audit pack runs on Pedalshield's real mainnet treasury. 7 of 7 published payouts were re-verified on chain from the payer's view-only key, with no route anywhere in the pack.

| | |
|---|---|
| **Ghost Commute sponsor rail** (`ghost-commute/`) | Coordinate-free signed ride attestations (browser + Rust, byte-identical canonical JSON). Orchard-only payout addressing. One-note disclosures as recipient (IVK) or as sender (OVK). Audit packs and statements. Offline mode with a real Halo 2 proof. A web app with rider, sponsor, auditor and wallet views. Plus 9 scripted cheat attempts, each refused |
| **Ironwood support in the treasury** | Detect, then spend, Ironwood (v3) notes. First Ironwood→Ironwood mainnet treasury spend: tx `43f6b8d2…5b81ea` (block 3,504,310) |
| **Encrypted-memo payouts** | `pay_with_memo`: letters and receipts delivered inside the shielded memo |
| **Fogline** | A private exploration game. The fog lifts on device, claims carry no location (not even tiles), and a three-chapter letter chain is delivered as encrypted memos with per-address HMAC codes |
| Size | 16 commits in the main repo (+5.5k / −0.5k lines across 63 files) plus the `ghost-commute/` package |

**Prior work (disclosure):**
Pedalshield started May 28, 2026 and was built before this hackathon. That prior work includes the React Native app (on TestFlight), the on-device verification engine (its anti-cheat scoring is proprietary and not in the public repo), the autonomous Orchard spend pipeline and backend, the first mainnet payouts (June–July 2026), the NU6.2 and NU6.3 re-pins, and the move to Ironwood-pool outputs on activation day (tx `fbf4e134…d16ed8`). It was entered in the ZecHub Hackathon 2026 (Games track) [[and placed: …]]. Everything listed under "What we built during the hackathon" is new since Sep 14 and is shown in the git history.

**Traction:** [[fill from the droplet DB and App Store Connect]]
- Riders: [[`SELECT COUNT(DISTINCT rider_id) FROM claims WHERE status='paid'`]]
- **30 rides verified on-device and paid on mainnet, 83.5 miles** (backend DB, `claims WHERE status='paid'`)
- **Independently verifiable:** `ghost audit verify fixtures/mainnet/audit-pack` re-opens 7 real mainnet payouts (5 Orchard, 2 Ironwood, blocks 3,374,485–3,504,310) against the chain: 7 of 7 verified, routes withheld. Anyone can rerun it; nothing in it is self-reported.
- TestFlight testers: [[n]] · App Store status: [[…]]
- Sponsor conversations: [[Bend employers / bike-commute advocacy org, if any]]

**Business model:** Riders never pay, and there's no token. Sponsors pay for verified miles without surveillance:
- **Employers:** commuter or wellness benefit. About $6/seat/month SaaS plus a pass-through reward pool. Rewards are pegged to the EPA social cost of carbon (≈$0.09/mile), so a 100-mile/month rider costs ≈$9 in rewards.
- **Cities/DOTs:** verified mode-shift totals by coarse bucket, on a consent-versioned data co-op that's off by default.
- **Insurers and wellness platforms:** on-device behavior features (consistency, rides/week). They never get location.
- The audit pack is the sales artifact. It's the document that clears a privacy review: "we can't give you routes, and here is the proof that every dollar went to a real rider."

**Go-to-market:** one Bend, OR employer pilot (50 seats) → a reference customer → benefits brokers. The consumer app is the distribution and the proof; the business is the verified mile.

**Team:** Samuel B. Newman, solo founder, Bend, OR. Built the hand-rolled, SDK-free Zcash spend pipeline, the mobile app, and the on-device verifier. He kept payouts running through two consensus upgrades in one summer, including paying on NU6.3 activation day.

**Open source:** MIT client, privacy seam and treasury. `ghost-commute/` is MIT. Composes with the standard Zcash stack (librustzcash crates, lightwalletd, zcash-devtool, any wallet that accepts a unified address).

**Links:**
- Repo: github.com/intelligrip/Pedalshield (`ghost-commute/` for the hackathon build)
- Live demo: Ghost Commute web app (share the artifact link, or host `ghost-commute/web/dist/index.html`)
- Backend health: https://api.pedalshield.app/healthz
- Mainnet receipts: README table

---

## Pitch video (2:30, founder on camera with a few cutaways)

| t | Picture | Words |
|---|---|---|
| 0:00 | Founder on a bike, helmet cam, Bend street | "Lots of employers and cities will pay you to bike to work. The catch is they want proof, and proof means your GPS trail." |
| 0:12 | Screen: a heat-map of one person's commute (stylised, fake) | "That's your home, your office and your schedule, sitting in a benefits vendor's database. Put the payment on a public blockchain and it's there forever." |
| 0:25 | Founder to camera | "I'm Sam. I built Pedalshield so you can get paid to bike and nobody learns where you live." |
| 0:33 | Phone: ride → verified on device → payout card with txid | "The phone verifies the ride. The route never leaves it, and an open-source test enforces that. The reward is real ZEC, shielded, paid automatically on Zcash mainnet. We've been paying riders since June, and we paid on the day of the network upgrade in July." |
| 0:55 | Explorer page: ciphertext | "On chain, nobody can see who got paid, how much, or the message we sent them." |
| 1:05 | Terminal: `ghost audit verify` → ALL PAYOUTS VERIFIED, ROUTE WITHHELD | "This month we built the part sponsors pay for. The employer's finance team gets an audit pack. Every payout is proven on chain: amount, recipient, receipt. And they can't see a single route, because we never had one to give them." |
| 1:30 | Founder | "That's what kills privacy reviews for every other commute app: 'how do we know the money went to real riders?' Here the answer is a file you can verify yourself." |
| 1:45 | Slide: business model | "Sponsors pay per seat plus a reward pool pegged to the carbon a biked mile saves, about nine cents. Riders never pay. No token." |
| 2:00 | Slide: traction [[numbers]] | "[[N riders, M verified rides, X ZEC paid, all verifiable on mainnet.]] Next is a 50-seat employer pilot here in Bend." |
| 2:15 | Founder on bike | "Bike-to-work programs exist; the trust layer they need hasn't, until now. Pedalshield: get paid to bike, and nobody learns where you live." |

## Product demo video (2:50, screen recording, voice-over)

1. **0:00 Rider app, real ride** (from the existing Pedalshield demo footage): ride → "verified on device" → payout card → explorer txid.
2. **0:25 What leaves the phone.** Ghost Commute web app, Ride tab. Click *car* and it's rejected. Click *bus teleport* and it's rejected. Click *bike*, then sign. Point at **Stays on this device** next to **Leaves this device**: no coordinates.
3. **0:55 Sponsor tab.** The claim verifies in the browser, with a payout preview. Then the terminal: `ghost claim attestation.json` prints the Orchard-only send with an encrypted memo.
4. **1:20 Public view.** `ghost tx public --txid … --network main`: actions, ciphertext sizes, no amount, no recipient, no memo.
5. **1:40 Rider wallet tab.** The memo only the rider can read.
6. **1:55 Sponsor audit.** `./scripts/pedalshield-mainnet-audit.sh own txids-own.txt`. The pack is built from **real mainnet payouts** with the treasury's outgoing viewing key, then `ghost audit verify` → **ALL PAYOUTS VERIFIED**. Open the Auditor tab and load the statement to show the **ROUTE WITHHELD** stamp.
7. **2:30 Try to cheat.** Edit one amount in the pack and re-verify: ✗ "recovered note differs from disclosed note". End on the line: "Proof of payment, not proof of whereabouts."

---

## Before Sunday night

- [ ] Run `ghost-commute/scripts/pedalshield-mainnet-audit.sh own …` on the Mac; commit `ghost-commute/fixtures/mainnet/` and the rebuilt `web/dist/`
- [ ] Run the `all` mode privately; put the totals in Traction
- [ ] Fill the `[[ ]]` placeholders (riders, rides, miles, TestFlight, ZecHub placing)
- [ ] Record both videos (scripts above)
- [ ] Confirm ZECATHON's rules allow the same work to be entered elsewhere (they're behind its login)
- [ ] Repo public, or grant hackathon@colosseum.com access
- [ ] Submit before **11:59 pm PT Oct 12**; don't leave it to the last hour
