# Pedalshield, Colosseum Crypto World's Fair (Zcash track)

**Deadline:** Oct 12, 2026, 11:59 pm PT. The team leader submits from the Arena dashboard.
**Team / company:** Intelligrip Inc. (Samuel B. Newman, solo founder, Bend, OR)
**Product name everywhere:** Pedalshield. `ghost-commute/` in the repo is the codename for the audit work built this hackathon; we don't use it as a product name.

---

## Fact sheet (every claim below must match this)

| Status | Fact |
|---|---|
| Live | iOS app on TestFlight. The ride is verified on the phone; the claim carries no coordinates |
| Live | Automatic shielded ZEC payouts on Zcash mainnet since June 2026, paid through NU6.3 (Ironwood pool) |
| Live | 9 riders · 30 paid rides · 83.5 miles (5 rides / 12.2 mi during the hackathon) |
| Live | Payout audit: 7 of 7 payouts to the founder's own wallet verified against mainnet, routes withheld |
| Live (deployed, first payout pending) | Encrypted memo receipts on each payout |
| Not yet | App Attest is collected but not verified server-side |
| Not yet | Each rider is paid at the same address (fresh address per payout is roadmap) |
| Plan | Miner-funded treasury (Intelligrip-operated Zcash ASICs) |
| Plan | Outside funders (cities, local businesses, employers) topping up reward pools |

---

## Portal fields (paste-ready)

**Project name:** Pedalshield

**One-liner:**
Get paid to ride your bike, in private money. The phone verifies the ride, the route never leaves it, and rewards arrive as shielded ZEC.

**Description:**
Pedalshield pays people to ride their bikes. The app checks each ride on the phone, so the route, home and schedule never leave the device. Riders are paid automatically in shielded ZEC on Zcash mainnet: no one can see who earned what. This hackathon we built the proof side: an audit that verifies every payout on chain without revealing a single rider or route. Next, Zcash miners run by Intelligrip fund the reward treasury: proof-of-work funds proof-of-ride.

**How does it use Zcash?**
Every reward is a shielded Zcash payment, sent automatically by our treasury on mainnet (Orchard/Ironwood since NU6.3). On a public chain, a payout history is a record of someone's riding habits. Shielded notes hide sender, receiver, amount and memo. The treasury uses its outgoing viewing key to prove its own payouts, one note at a time, against the chain, with no rider keys needed. Next, Zcash mining funds the treasury.

**The problem:**
Paying people to ride needs proof the ride happened. Today proof means a GPS trail: home, work and schedule in someone's database, and location data is legally sensitive in California, Oregon and Washington. Pay on a public blockchain and the record is permanent. So privacy and proof look like they conflict.

**The solution:**
- **On the phone:** the ride is verified on the device. The claim leaves without coordinates, and an open-source test enforces that.
- **On chain:** the treasury pays shielded ZEC automatically. Explorers see only ciphertext.
- **Proof (built this hackathon):** `ghost audit pack` and `ghost audit verify` turn the treasury's payouts into one statement anyone can check against Zcash mainnet: every amount and recipient verified, every route withheld, because no route was ever sent.

**Business model:**
Proof-of-work funds proof-of-ride. Intelligrip Inc. will operate Zcash ASIC miners (Antminer Z15 Pro: about $3.5k, 2.8 kW, about 14 ZEC/year each). Mined ZEC is shielded into the treasury that already pays riders. A published policy splits it: 50% to rider rewards, 50% to company revenue and reserves. Rewards follow mining output, so the program never promises more than it earns. One miner funds 400+ miles of riding a day at about $0.09/mile. Riders never pay; there's no token. Later, cities, local businesses and employers can top up reward pools for a fee, and the audit shows where every coin went.

**Business model (500 characters):**
Pedalshield pays people to ride their bikes, in shielded ZEC. Our plan: proof-of-work funds proof-of-ride. We will run Zcash ASIC miners (Antminer Z15 Pro, ~$3.5k, ~14 ZEC/yr each) whose rewards go straight into the shielded treasury. A fixed policy splits mined ZEC: half to rider rewards, half to company revenue and reserves. One miner can fund 400+ miles of riding a day. Riders never pay. Sponsors can top up pools later; our audit proves every payout.

**Risks and how we handle them:**
- **ZEC price and mining difficulty:** rewards are a share of output, not a fixed promise.
- **Energy use:** renewable power where possible, reuse the miners' heat in Bend winters, and publish energy used against car miles replaced.
- **Zcash's planned hybrid proof-of-stake (Crosslink):** add staking as a second treasury source.
- **Fake rides:** the on-device verifier is the core asset; server-side App Attest verification is next.

**Go-to-market:**
Bend, OR first: local riders, bike shops and the cycling community. The app is free and the rewards are the hook. Grow city by city, then bring in outside funders once the rider base and audit record exist.

**Traction:**
Live on Zcash mainnet since June 2026. 9 riders, 30 paid rides, 83.5 miles. Payouts continued through the NU6.3 upgrade (paid on activation day). The audit verifies 7 of 7 sample payouts against mainnet; anyone can rerun it from the repo.

**What we built during the hackathon (Sep 14 – Oct 12):**
- **Payout audit** (`ghost-commute/`, MIT): one-note disclosures as recipient (IVK) or sender (OVK), audit packs and statements, verified against lightwalletd, plus a tamper test.
- **Mainnet audit:** 7 of 7 real payouts verified, published on the website.
- **Ironwood support in the treasury:** first Ironwood→Ironwood mainnet treasury spend (block 3,504,310).
- **Encrypted memo receipts on every payout:** deployed to the live backend.
- **Website:** pedalshield.app/ghost-commute, with the live audit and a clickable prototype.

**Prior work (disclosure):**
Pedalshield started May 28, 2026, before this hackathon. Prior work: the React Native app (TestFlight), the on-device verifier (its scoring is proprietary and not in the public repo), the automatic Orchard payout pipeline and backend, the first mainnet payouts (June–July), the NU6.2/NU6.3 updates, and the move to Ironwood on activation day. It was entered in the ZecHub Hackathon 2026. Everything under "built during the hackathon" is new since Sep 14 and visible in the git history.

**Repo context (500 characters):**
The repo is the full Pedalshield product: mobile app (mobile/), Zcash treasury and backend (zcash-service/), website (landing/). The hackathon work is in ghost-commute/: the payout audit CLI (ghost audit pack/verify) and the mainnet audit fixtures. The on-device verifier's scoring engine is proprietary and excluded; the app falls back to an open stub that marks rides "in review". "Ghost Commute" is an internal codename, not a separate product.

**Anything else judges should know (500 characters):**
Everything shown is live on Zcash mainnet, not testnet: real riders, real shielded payouts, through two network upgrades. You can verify our payouts yourself: clone the repo and run ghost audit verify on ghost-commute/fixtures/mainnet. Built solo by a founder who rides. The next step is self-funding: Zcash miners that pay riders, so the program grows without investors or a token.

**Category:** Consumer app / Payments (mobile, Zcash)

**Team:** Samuel B. Newman, founder of Intelligrip Inc., Bend, OR. Solo builder of the app, the on-device verifier and a hand-built Zcash payout pipeline that kept paying through two consensus upgrades in one summer.

**Links:**
- Product: https://pedalshield.app/ghost-commute/
- App: https://testflight.apple.com/join/2JmfCjuH
- Repo: https://github.com/intelligrip/Pedalshield
- Backend health: https://api.pedalshield.app/healthz

---

## Demo video (about 2:00, screen recording + voice)

| t | Screen | Say |
|---|---|---|
| 0:00 | Phone: open a paid ride | "Pedalshield pays you to ride your bike. The app checks the ride on my phone." |
| 0:20 | Phone: the "what leaves your phone" screen | "This is everything that gets sent: distance and time. Never the route." |
| 0:40 | Phone: payout card | "I'm paid in shielded Zcash, automatically, on mainnet." |
| 0:55 | Explorer: the payout tx | "On the blockchain, nobody can see who got paid or how much." |
| 1:10 | MAC terminal: `ghost audit verify fixtures/mainnet/audit-pack` | "And we can still prove every payout is real. Seven of seven verified against mainnet. Routes withheld, because we never had them." |
| 1:40 | MAC terminal: verify the tampered pack | "Change one amount and the proof breaks." |
| 1:55 | Website hero | "Pedalshield. Proof of payment, never proof of whereabouts." |

## Pitch video (about 2:30, founder on camera)

| t | Say |
|---|---|
| 0:00 | "I'm Sam, founder of Intelligrip. I built Pedalshield: get paid to ride your bike, and nobody learns where you went." |
| 0:15 | "Paying people to ride needs proof. Today proof means a GPS trail: your home, your work, your schedule. On a public blockchain, that's permanent." |
| 0:35 | "Pedalshield checks the ride on your phone. The route never leaves it. You're paid in shielded Zcash: private by default." |
| 0:55 | "It's live on mainnet: 9 riders, 30 paid rides, and it kept paying through two network upgrades." |
| 1:10 | "This hackathon I built the proof: an audit anyone can run that verifies every payout on chain, without exposing a single rider." |
| 1:35 | "Next, proof-of-work funds proof-of-ride. We'll run Zcash miners; what they earn goes to riders, half and half with the company. No investors needed to keep paying, no token." |
| 2:00 | "Then cities and local businesses can add to the pool, and the audit shows where every coin went." |
| 2:15 | "Pedalshield. Proof of payment, never proof of whereabouts." |

---

## Before 11:59 pm PT Oct 12

- [x] Public TestFlight link: https://testflight.apple.com/join/2JmfCjuH
- [ ] Record the demo video, then the pitch video
- [ ] Paste the fields above into the portal
- [ ] Optional: one paid ride with a memo receipt → add it to the audit, mark receipts Live
- [ ] Submit early, not in the last hour
