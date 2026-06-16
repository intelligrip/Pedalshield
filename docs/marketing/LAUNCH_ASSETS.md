# Pedalshield — Launch Assets Pack

_Copy-paste ready. Honest-claims rule applies everywhere: payouts are small, ZK route proofs are roadmap, no token, privacy is the product not yield. Live site: **https://pedalshield.app** · Repo: github.com/intelligrip/Pedalshield_

> **Order of operations for the 30-day sprint:** Demo video first → Zcash Community Forum + Discord + r/zec (Week 2) → Product Hunt + cycling/privacy communities (Week 3) → beta invites + ZCG + zodler outreach (Week 4).

---

## 1. Zcash Community Forum — intro thread (your #1 channel for zodlers)

**Title:** Pedalshield — bike-to-earn that pays shielded ZEC, with the route never leaving your phone (ZecHub Hackathon, Games)

**Body:**

Hi all — I'm building **Pedalshield**: a privacy-first bike-to-earn app on Zcash. You ride, your phone verifies the ride **entirely on-device** (the GPS route is never uploaded — enforced by a unit test, not a privacy policy), and an **autonomous backend pays real shielded ZEC on mainnet**. No operator in the loop, no route database, no token.

Why I think this matters for Zcash specifically: it manufactures **recurring, real-world shielded transactions** from ordinary people. Every paid ride is shielded demand that wouldn't otherwise exist. "Mining funds riding; riding funds Zcash."

What's real today (with receipts in the README):
- Autonomous Orchard shielded payouts proven on mainnet (real txids), NU6.2-current.
- Open source (MIT), hand-rolled spend pipeline against librustzcash — no wallet SDK.
- Honest about limits: payouts are small (0.0002 ZEC/km, capped), anti-cheat is layered not perfect, ZK route proofs are roadmap.

Waitlist + demo: **https://pedalshield.app** · Code: github.com/intelligrip/Pedalshield

Would love feedback from this community — especially on the spend pipeline and the treasury/FROST path. And if you're a zodler who wants Zcash to have flagship consumer demand, I'd like to talk.

---

## 2. X / Twitter — launch thread

**1/** Your cycling app knows where you live, where you sleep, and when you're not home. We built the opposite. **Pedalshield**: ride your bike, earn shielded ZEC, and your route never leaves your phone. 🚲🛡️ Live → pedalshield.app

**2/** Not "we encrypt your data." The route is **never transmitted**. Verification runs on-device; the only thing that leaves is "X km, verified." There's a unit test that fails if a single coordinate ever enters the payload.

**3/** Payouts are **real autonomous shielded Zcash** on mainnet — built on the freshly-upgraded NU6.2 network. A claim arrives, the treasury pays, a real txid lands on-chain. No human in the loop.

**4/** Why Zcash? Because every paid ride is a private payment that grows real demand for shielded ZEC. Mining funds riding; riding funds Zcash.

**5/** Honest about limits: payouts are small and capped, anti-cheat is layered (not perfect), ZK route proofs are the roadmap not the present. The code says exactly what it does — it's open source (MIT). [repo link]

**6/** Join the beta waitlist 👉 **pedalshield.app**  · Built for @ZecHub Hackathon 2026 (Games). #Zcash #ZEC #privacy

---

## 3. Reddit

**r/zec** — Title: *Pedalshield: autonomous shielded ZEC payouts for verified bike rides (open source, mainnet-proven)*

Body: Built a privacy-first bike-to-earn app on Zcash. On-device ride verification (route never uploaded), autonomous Orchard shielded payouts on mainnet, no token. It's a small but real new source of shielded demand. Honest about limits (small payouts, ZK is roadmap). Waitlist + code: pedalshield.app · github.com/intelligrip/Pedalshield. Feedback welcome.

**r/cycling / r/bicycling** — Title: *A ride tracker that never uploads your route (and pays you a little for riding)*

Body: If you've seen the Strava heatmap stories, you know the problem: ride trackers store the map of your life. I built Pedalshield — it verifies rides **on your phone** and never uploads your route. It also pays a small reward for verified rides. Privacy is the point; the reward is a bonus. Beta waitlist: pedalshield.app. (Honest: rewards are small — this isn't a money-maker, it's a private tracker.)

---

## 4. Product Hunt

**Tagline:** Ride private. Earn shielded. The bike tracker that never uploads your route.

**Description:** Pedalshield is a privacy-first bike-to-earn app. Your phone verifies each ride on-device — your GPS route is never uploaded — and you earn small, real shielded ZEC payouts automatically. No route database, no data sales, no token. Open source. Better than Strava, because Strava sells the map of your life.

**First comment:** Maker here 👋 I built Pedalshield because every fitness app is a surveillance device with a leaderboard. The privacy property is enforced by a unit test, not a policy, and the payouts are real autonomous shielded transactions on Zcash mainnet. Happy to answer anything — and I'm honest about what's still roadmap (ZK route proofs, community-signed treasury).

---

## 5. Launch email (to the waitlist, when beta opens)

**Subject:** You're in — Pedalshield beta is opening 🚲

Hi {first_name},

Thanks for joining the Pedalshield waitlist. We're opening the beta in {city/region} soon and you're on the early list.

Quick reminder of the deal: you ride, your phone verifies the ride **on-device** (your route never leaves your phone), and you earn small, real shielded ZEC — automatically, with no one watching. Privacy is the product; the reward is a bonus.

We'll send your invite shortly. In the meantime:
- See how it works: https://pedalshield.app
- It's open source if you're curious: github.com/intelligrip/Pedalshield

Ride private. Earn shielded.
— The Pedalshield team

---

## 6. Zodler investor outreach — short DM / email

**Subject:** Backing the demand engine for Zcash (and your ZEC)

Hi {name} — I'm building Pedalshield, a privacy-first bike-to-earn app that pays **autonomous shielded ZEC on mainnet** for verified rides (route never leaves the phone). It's live at pedalshield.app and open source.

The reason I'm reaching out to ZEC holders specifically: Pedalshield manufactures **recurring shielded demand** — every rider is real-world utility for ZEC. Backing it is one of the few ways to invest in a company *and* the utility of the asset you already hold. No token, no yield promises — equity/SAFE only.

We're opening a small community pre-seed and applying to Zcash Community Grants. I'd love to share the plan (30-day launch sprint + path to a self-funding node/oracle and miner flywheel). 15 minutes this week?

— Sam, IntelliGrip Industries

---

## 7. Zcash Community Grants (ZCG) — application outline

_Apply at zcashcommunitygrants.org (rolling; reviewed ~biweekly; grants > $50K require KYC, can stay pseudonymous publicly). Frame the public-good, open-source ecosystem value._

- **Project:** Pedalshield — open-source, privacy-first consumer app generating shielded ZEC demand.
- **Value to Zcash (lead with this):** the highest-value contribution is **onboarding ordinary, non-crypto people into holding and using shielded ZEC** — each rider gets a shielded address and a recurring reason to receive private payments. That grows the shielded *user base* and demonstrates real-world utility — the metric Zcash most needs and can least manufacture. (Quality of adoption — real riders — not dust-transaction count.)
- **Public-good deliverables (what the grant funds):**
  1. Hardening + documenting the hand-rolled, SDK-free Orchard spend pipeline (reusable reference for the ecosystem).
  2. Batched multi-output settlement (neighborly high-volume payouts) as a reusable pattern.
  3. Public FROST treasury bootstrapping ceremony (community signers via DKG).
  4. **Hardware-attested ZK proof-of-distance R&D** — a novel real-world ZK use case on Zcash: the edge node *attests* rides (integrity + privacy); ZK makes the private claim *trustlessly verifiable* without trusting our servers.
  5. Ironwood pool migration of the spend path.
- **Why it's ecosystem value:** drives real shielded usage + new shielded users; produces reusable open-source tooling; pioneers hardware-rooted ZK on Zcash; recruits miners into protocol-aligned roles.
- **Honest scope:** name what is shipped vs roadmap; small payouts; layered (not perfect) anti-cheat; ZK proves correct private computation, not that inputs are real (the attester + sensor cross-checks handle authenticity).
- **Amount/milestones:** tie to the deliverables above; reference mainnet txids and the open repo as proof of execution.

---

## Channels checklist (Zcash-native first)

- [ ] Zcash Community Forum (forum.zcashcommunity.com) — intro thread
- [ ] Zcash Global Discord — #hackathon
- [ ] r/zec, then r/cycling / r/bicycling
- [ ] X thread (tag @ZecHub)
- [ ] ZecHub Hackathon 2026 submission (Games)
- [ ] Product Hunt (Week 3)
- [ ] Zcash Community Grants application (Week 4)
- [ ] Zodler investor DMs (Week 4)
- [ ] Answer every Strava-privacy news cycle within 24h
