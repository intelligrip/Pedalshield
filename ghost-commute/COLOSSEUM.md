# Colosseum Crypto World's Fair: Ghost Commute by Pedalshield (Zcash track)

**Deadline:** Oct 12, 2026, 11:59 pm PT. Submit from the Arena dashboard.
**Required:** pitch video (2–3 min), product demo video (≤3 min), public repo, prior-work disclosure. Only work from Sep 14 to Oct 12 is judged.

Every answer below is checked against the **fact sheet**. If you edit an answer, check it against the fact sheet first.

---

## Fact sheet (source of truth, checked against the code on Oct 10)

**Names**
- **Pedalshield** is the company and the iOS app riders install.
- **Ghost Commute** is the sponsor audit layer built this hackathon (`ghost-commute/` in the repo).
- **Entry name:** Ghost Commute by Pedalshield.

**Live in production (Pedalshield)**
- Rides are verified on the phone by the on-device engine (proprietary, not in the public repo). The claim sent to the server has no coordinates, enforced by an open-source unit test.
- An autonomous treasury pays verified rides in shielded ZEC on mainnet, with a spend pipeline hand-built on librustzcash. Payouts have gone to the Ironwood pool since NU6.3 (July 29), and Ironwood spending was verified on mainnet (tx `43f6b8d2…`).
- Riders connect their own wallet (e.g. Zodl). Payouts go to that wallet's shielded receiver, and the same address is used each time.
- **Regular payouts carry no memo.** The memo payout code (`pay_with_memo`) exists but is used only by Fogline, which is excluded.
- The backend enforces per-ride and daily caps and rejects duplicates. App Attest tokens are **collected but not yet verified**.
- The data co-op is opt-in and off by default, and sends **coarse aggregates only** (distance band, hour, CO2, region). The client cannot send a route.

**Numbers (backend DB + chain, Oct 10)**
- 30 rides paid on mainnet, 83.5 mi, first May 31, latest Sep 28.
- 9 distinct payout addresses (riders, founder included).
- 3 claims rejected and never paid.
- 5 rides / 12.2 mi inside the hackathon window.
- 7 of 7 real mainnet payouts re-verified by the Ghost Commute audit (5 Orchard, 2 Ironwood). The 2 earliest payouts predate viewing-key recovery and can't be audited.

**Built this hackathon (Sep 14 – Oct 12)**
- **Ghost Commute, working on mainnet:** sender-side one-note disclosures from the treasury's outgoing viewing key, audit packs and statements, and the web demo.
- **Ghost Commute, prototype (CLI, testnet and offline only, not in the app yet):** coordinate-free signed ride attestations, a fresh shielded-only address per payout, encrypted memo receipts bound to the attestation, and an offline mode with a real Halo 2 proof.
- **Treasury:** Ironwood note detection and spending, and the memo payout path.

**Not true yet (don't claim)**
- No paying sponsor or employer. Dollar funding and per-seat pricing are the plan.
- No memos on regular payouts.
- No fresh address per payout in the app.
- App Attest is not verified.
- No route sharing.
- FROST threshold signing is roadmap only.

---

## Portal fields (paste-ready)

**Project name:** Ghost Commute by Pedalshield

**Tagline:** Proof of payment, never proof of whereabouts.

**Brief description:**
> Employers and cities already pay people to bike to work, but to prove the rides they collect GPS trails: home, office and schedule, sitting in a vendor's database. Pedalshield verifies the ride on the phone and pays riders in shielded ZEC on mainnet. Ghost Commute, built this hackathon, gives sponsors an audit pack that proves every payout on chain and contains no route. Live: 30 rides paid, 7 of 7 payouts audited.

**Project website:** https://pedalshield.app/ghost-commute/ (check it loads after the push)

**What are you building, and who is it for?**
> A way to pay people to bike without tracking them. Pedalshield verifies each ride on the rider's phone and pays them in shielded ZEC on Zcash mainnet. The route never leaves the phone. Ghost Commute, built this hackathon, gives the sponsor an audit pack: proof on chain that every payout happened, for what amount and to whom, with no route, address or schedule in it.
> - **Sponsors:** employers with commuter and wellness benefits, cities funding mode shift, and insurers rewarding active habits. They need proof the money bought real bike miles, without the liability of holding employees' location data.
> - **Riders:** commuters who'd take the incentive but won't install a tracker. They get paid privately, and nobody, including us, can map their life.

**Why did you build this?**
> I ride, and I live in Bend, where cycling is part of daily life. I also build on Zcash. Pedalshield started as a bike anti-theft and tracking product, and the deeper I got into tracking, the clearer the problem was: every ride app and incentive program asks you to hand over a map of your life to get a reward. Then I saw the second trap. Pay riders on a transparent blockchain and the payout history becomes that map, permanently. Zcash is the only place I could build this honestly, because shielded payments make privacy the structure of the system rather than a policy. I also think cycling is how Zcash reaches normal people: nobody downloads a privacy wallet for its own sake, but people will to get paid to ride.

**Why does cycling data need to be qualified? (WA / OR / CA)**
> Washington, Oregon and California all push employers to cut drive-alone commutes. Washington's Commute Trip Reduction law and Oregon's Employee Commute Options rule require large employers to survey commutes, and California's parking cash-out law pays non-drivers. The same states treat the proof as regulated data. California covers employees' precise geolocation under the CCPA, Oregon requires opt-in consent for it and has banned its sale, and Washington's My Health My Data Act can reach fitness and location data, with a private right of action. Pedalshield verifies the ride on the phone and sends only a minimal claim, never coordinates. Sponsors get proof without holding regulated data.

**Why now?**
> The law just closed the tracking option. Oregon banned selling precise geolocation in January 2026. California's privacy law has covered employees' location data since 2023. Washington's My Health My Data Act lets individuals sue over fitness and location data. Meanwhile, Washington and Oregon still require large employers to measure commute mode shift. And shielded payments are production-ready: Zcash's Ironwood upgrade went live in July, and we've paid real riders through it on mainnet.

**How does Ghost Commute use Zcash? (≤500 characters)**
> A public payout for "biked home to work" maps someone's life, so every Pedalshield reward is shielded ZEC on mainnet, paid by an autonomous treasury built on librustzcash, in the Ironwood pool since NU6.3. Riders are paid only at their wallet's shielded receiver. Ghost Commute adds sponsor audits: the treasury's viewing key proves each payout's amount and recipient on chain without revealing the route. 7 of 7 real payouts verified; the encrypted-memo receipts are next.

**Category:** Payments (secondary: Consumer, if allowed).

**Mobile-focused dapp?** Yes.
> Mobile-first: rides are verified on the phone and paid in shielded ZEC to the rider's own wallet. No smart contracts. Payouts run through an autonomous treasury on Zcash mainnet.

**Biggest threat / risk (≤500 characters)**
> Biggest threat: fake rides. A phone can be spoofed, and paying for miles invites cheating. Our answer is layered: an on-device verification engine, server-side caps and duplicate checks, and App Attest (rolling out). 3 claims already rejected in production. Next: ZK proof of distance. Other risks: slow employer sales cycles (we start with one 50-seat Bend pilot), privacy-coin perception (sponsors can fund in USD), and a solo founder; the treasury runs autonomously.

**Anything else judges should know? (≤500 characters)**
> Pedalshield (May 2026) already paid riders in shielded ZEC on mainnet. New this hackathon: Ghost Commute's sponsor audit layer, Ironwood spending and the memo payout path (commits from Sep 30). Verify in 5 min: ghost audit verify ghost-commute/fixtures/mainnet/audit-pack re-checks 7 real payouts on chain. Anti-cheat engine is proprietary, not in the repo; Fogline in the repo isn't part of this entry. Web demo uses a simplified ride check. Solo founder, Bend OR.

**How will governments interact with the data?**
> As funders, they get audit packs proving every payout without routes. As planners, they get opt-in aggregate data (distance band, hour, region, CO2), never individual traces. As regulators, employers can report verified commute counts instead of self-reported surveys. Legal process can reach payout records, but never routes, because the route never leaves the phone.

**Logo:** Ghost Commute icon (`ghost-commute-logo-1024.png`), or the Pedalshield icon if you want it to match the installed app.

**Repo:** https://github.com/intelligrip/Pedalshield (hackathon work: https://github.com/intelligrip/Pedalshield/tree/main/ghost-commute)

**App access:** Pedalshield on TestFlight, build 25 (`production` profile). [[public TestFlight link]]

**Prior work (disclosure):**
> Pedalshield started May 28, 2026. Built before this hackathon: the iOS app, the on-device verification engine (proprietary), the autonomous Orchard payout pipeline and backend, the first mainnet payouts, and the NU6.2/NU6.3 upgrades, including Ironwood-pool outputs on activation day (tx `fbf4e134…`). It was entered in the ZecHub Hackathon 2026. Built during this hackathon: the Ghost Commute sponsor audit layer, Ironwood spending and the memo payout path. All of it is visible in commits from Sep 30 onward.

**Traction:**
- 30 rides verified on the phone and paid on mainnet, 83.5 mi (May 31 – Sep 28)
- 9 distinct payout addresses (riders, founder included)
- 3 claims rejected by the verifier and never paid
- 7 of 7 real payouts re-verified on chain by the Ghost Commute audit. Anyone can rerun it.
- TestFlight testers: [[n]]

**Business model (plan):** Riders never pay, and there's no token. Sponsors pay for verified miles: employers at about $6/seat/month plus a reward pool pegged to the EPA social cost of carbon (≈$0.09/mile); cities get aggregate mode-shift reports; insurers and wellness platforms get on-device behavior features. No paying sponsor yet. First target: a 50-seat Bend employer pilot.

**Team:** Samuel B. Newman, solo founder, Bend, OR. Built the SDK-free Zcash payout pipeline, the iOS app and the on-device verifier. Kept payouts running through two consensus upgrades in one summer.

**Progress update to post now:**
> Mainnet audit: 7 of 7 real Pedalshield payouts re-verified on chain from the treasury's view-only key. Amounts and recipients proven, routes withheld. Rerun it: `ghost audit verify ghost-commute/fixtures/mainnet/audit-pack`.

---

## Pitch video (2:30)

| t | Picture | Words |
|---|---|---|
| 0:00 | Riding in Bend | "Lots of employers and cities will pay you to bike to work. The catch is they want proof, and proof means your GPS trail." |
| 0:12 | Stylised commute heat-map (fake data) | "That's your home, your office and your schedule in a vendor's database. Put the payment on a public blockchain and it's there forever." |
| 0:25 | To camera | "I'm Sam. I built Pedalshield so you can get paid to bike and nobody learns where you live." |
| 0:33 | Pedalshield app: ride → verified → payout card with txid | "The phone verifies the ride, and the route never leaves it. The reward is real ZEC, shielded, paid automatically on Zcash mainnet. We've paid thirty rides since May." |
| 0:55 | Explorer page showing a shielded tx | "On chain, nobody can see who got paid or how much." |
| 1:05 | Terminal: `ghost audit verify` → ALL PAYOUTS VERIFIED | "This month I built Ghost Commute, the part sponsors pay for. Finance gets an audit pack: every payout proven on chain, amount and recipient. And no route, because we never had one to give them." |
| 1:30 | To camera | "That's the question that kills privacy reviews: how do we know the money went to real riders? Here the answer is a file you can verify yourself." |
| 1:45 | Slide: business model | "Sponsors pay per seat plus a reward pool pegged to the carbon a biked mile saves, about nine cents. Riders never pay. No token." |
| 2:00 | Slide: 30 rides · 83.5 mi · 3 rejected · 7/7 audited | "Thirty verified rides, eighty-three miles, every payout shielded on mainnet, and three claims the verifier refused to pay. Next is a 50-seat employer pilot here in Bend." |
| 2:15 | Riding | "Proof of payment, never proof of whereabouts. Ghost Commute by Pedalshield." |

## Demo video (2:50)

1. **0:00 Pedalshield app, real ride:** ride → "verified on device" → payout card → explorer txid.
2. **0:25 Web demo, Ride tab** (label on screen: "Ghost Commute prototype flow"): car rejected, bus teleport rejected, bike signed. "Stays on this device" vs "Leaves this device".
3. **0:55 Sponsor tab:** the claim verifies in the browser.
4. **1:15 Public view:** `ghost tx public --network main --txid <a real payout>`: no amount, no recipient.
5. **1:35 Mainnet audit:** `ghost audit verify fixtures/mainnet/audit-pack` → ALL PAYOUTS VERIFIED. Auditor tab → "Real mainnet audit" → ROUTE WITHHELD stamp.
6. **2:20 Try to cheat:** change one amount in the pack, re-verify → ✗ "recovered note differs from disclosed note".
7. **2:40 Close:** "Proof of payment, never proof of whereabouts."

---

## Before 11:59 pm PT Oct 12

- [ ] Push to main; check https://pedalshield.app/ghost-commute/ loads
- [ ] `eas build -p ios --profile production --auto-submit` (build 25, Pedalshield); public TestFlight link
- [ ] Fill [[ ]]: TestFlight link and tester count
- [ ] Record both videos
- [ ] Post the progress update
- [ ] Check ZECATHON rules on entering the same work elsewhere
- [ ] Submit early
