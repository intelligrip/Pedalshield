# Pedalshield — Polsia Launch Kit

_Paste-ready brief and copy for Polsia's marketing agents. Drafted June 10, 2026._
_Hold the launch posts until the demo video exists (per TIMELINE.md); landing page work can start now._

---

## Polsia brief (paste into the Orchestrator / business plan)

**Product:** Pedalshield — privacy-first bike-to-earn on Zcash.
**One-liner:** Ride private. Earn shielded.
**What it does:** Cyclists track real rides; the phone verifies them entirely on-device — the GPS route never leaves the phone — and an autonomous backend pays out shielded ZEC. No manual operator, no route database, nothing to leak.
**Status:** Working mainnet prototype (real autonomous Orchard payouts proven, txids on-chain). ZecHub Hackathon 2026 submission, Games track, deadline July 15. Demo video lands ~June 22–28.
**Audience:** privacy-conscious cyclists, Zcash/privacy-tech community, move-to-earn refugees burned by STEPN-style token games, self-quantifiers uneasy about Strava heatmaps.
**Positioning:** "Better than Strava — because Strava sells the map of your life." Strava heatmap doxxing incidents are the hook. Pedalshield is the counterexample: rewards without surveillance.
**Honest-claims rule (hard):** Never claim ZK route proofs are live (roadmap v0.5), never claim FROST signs mainnet payouts yet (Ed25519 ceremony works; RedPallas swap is roadmapped), never imply big earnings — payouts are pegged to carbon value (~$0.006/mile = ~1 lb avoided CO2), small and capped. Privacy is the product, not yield.
**CTAs:** GitHub repo → github.com/intelligrip/Pedalshield · demo video (when live) · ZecHub hackathon entry.

### Tasks for Polsia
1. **Now:** Landing page (single page) from the copy below; collect emails for TestFlight/beta waitlist.
2. **Now:** Competitor/positioning refresh — Strava privacy incidents 2024–2026, STEPN collapse postmortems, current state of move-to-earn.
3. **After demo video:** Launch posts (X thread, Reddit r/zec + r/cycling angle check, Product Hunt draft) using the templates below; embed video.
4. **Ongoing:** Drip content — one privacy-angle post/week ("your heatmap is a confession," "what your fitness app knows").

---

## Landing page copy

**Hero:**
# Ride private. Earn shielded.
Pedalshield pays you ZEC for real bike rides — and your route never leaves your phone. Not encrypted-and-uploaded. Never uploaded.

**[Join the beta waitlist]** · **[Watch the demo]** (placeholder until video)

**Section — The problem:**
Your fitness app is a surveillance device with a leaderboard. Heatmaps have exposed military bases, stalkers' victims, and your home address. The deal was rewards for data. We think that deal is robbery.

**Section — How it works (3 steps):**
1. **Ride.** GPS + motion sensors track your ride locally.
2. **Verify on-device.** An anti-cheat engine scores the ride on your phone. Only the distance claim leaves the device — never the route. Enforced by a unit test, not a privacy policy.
3. **Get paid, shielded.** An autonomous treasury pays shielded ZEC straight to your wallet. No operator approves it. No one watches it.

**Section — Proof, not promises:**
- Real autonomous shielded payouts on Zcash mainnet — verifiable txids.
- Open source, MIT licensed. Every claim in the README maps to the test or code that proves it.
- What we can't catch yet, we say out loud. Read the anti-cheat doc.

**Footer:** ZecHub Hackathon 2026 · Games track · MIT · GitHub

---

## X/Twitter launch thread (post when video is live)

1/ Your cycling app knows where you live, where you sleep, and when you're not home. We built the opposite. Pedalshield: ride your bike, earn shielded ZEC, and the route never leaves your phone. Demo 👇 [video]

2/ Not "we encrypt your data." The route is never transmitted. Verification runs on-device; the only thing that leaves is "X km, verified." There's a unit test that fails if a coordinate ever enters the payload.

3/ Payouts are autonomous shielded Zcash — built on the freshly-upgraded Nu6.2 network. A claim arrives, the treasury pays, a real txid lands on mainnet. No human in the loop.

4/ It's a hackathon prototype, and we're honest about limits: payouts are small, anti-cheat is layered not perfect, ZK route proofs are the roadmap not the present. The code says exactly what it does. [repo link]

5/ Built for @ZecHub Hackathon 2026, Games track. Star it, break it, ride it. [repo + video links]

## Discord/forum post (Zcash Global #hackathon — pairs with submission)

**Pedalshield — privacy-first bike-to-earn (Games track).** Real rides, verified entirely on-device (route never leaves the phone), autonomous shielded Orchard payouts on mainnet — no manual operator. Demo video: [link]. Repo: [link]. Every claim maps to a test or source file; verification instructions take 60 seconds. Feedback welcome before the deadline.
