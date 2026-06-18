# Pedalshield — 30-Day Polish & Launch Plan

_Owner of the plan: Claude (driving). Goal: a polished, reliable, secure Pedalshield + a strong ZecHub Hackathon 2026 submission (deadline **July 15**), with first real riders onboarding. Today: June 17._

> **Legend of owners:** 🤖 = Claude does it · 🚴 = Sam (device/accounts/funds) · 🛠️ = React Native dev (recommended, ~10–20 hrs) · ⚙️ = backend/infra

## Guiding principle
You already have the hard, rare thing — **a real autonomous shielded mainnet payout from a deployed, funded backend.** The month is about making the experience around it **reliable, secure, and trustworthy**, then getting it in front of people. We optimize for the hackathon's true win condition: a working mainnet loop + the privacy thesis + honest execution — shown in a demo video and a clean submission.

---

## Week 1 (Jun 17–23): Stabilize the core + plug the security hole
**Theme: nothing leaks, nothing breaks, and one real ride pays a live txid.**

- ⚙️🤖 **SECURE THE BACKEND (do first).** `/approve`, `/claims`, `/claims/:id`, `/admin`, `/settle`, `/withdraw` are currently **public**. Add an operator auth token (header check) so only you can trigger payouts or read claims. Real money is on the line. *(Claude writes; Sam redeploys.)*
- ⚙️🚴 **Lock the live-payout proof.** Fire the pending claim via `/approve` on the funded backend → confirm a fresh mainnet txid from the deployed system. This is the hackathon's core evidence, banked.
- 🛠️🤖 **Fix the SDK-56 runtime bugs** (Claude writes fixes; dev/Sam rebuild + test on device):
  - GPS distance = 0 → confirm Precise Location; verify `expo-location` v56 `watchPositionAsync` flow; loosen/instrument the 30 m accuracy gate during cold-start.
  - Ride not saving / not submitting (no claim reached backend) → trace ride-finish → claim POST; fix the break.
  - Privacy screen won't scroll → ScrollView/layout fix for RN 0.85.
- 🚴 **Decision:** engage a React Native dev for the device-side debugging (biggest velocity unlock). Claude prepares the scoped task brief.
- ✅ **Week-1 done = ** secured backend + one clean end-to-end ride (verified, distance, payout, txid) on a working build.

## Week 2 (Jun 24–30): Polish + demo
**Theme: it feels real and trustworthy; capture the proof on film.**

- 🛠️🤖 **App polish:** clean ride flow, the payout card with real txid + explorer link, honest empty/error states, permission priming (explain *why* location is on-device before asking), the privacy screen, the new icon, onboarding.
- 🤖 **Anti-cheat tuning:** review verify/reject thresholds (0.65/0.40) against real outdoor rides; make sure a genuine ride reliably clears 0.65; keep the honest "what it catches / doesn't" doc accurate.
- 🤖⚙️ **Backend hardening:** mempool-aware note reservation (kills the double-select race), pre-split note pool, basic rate limiting, monitoring/logs.
- 🎬🚴🤖 **Record the demo video** (real outdoor ride → on-device verify → shielded payout → txid in explorer). Script in `docs/DEMO_SCRIPT.md`; Claude tightens the script + edits guidance.

## Week 3 (Jul 1–7): Submit + launch awareness
**Theme: ship the submission early; bring in the first riders.**

- 🤖🚴 **Submit to the hackathon** (well before the 15th): PR to the ZecHub repo (`SUBMISSION.md` is ready), post in Zcash Global Discord #hackathon with the video.
- 🤖🚴 **Release the launch posts** (Polsia-staged: Zcash forum, X, Reddit) → drive waitlist + first beta riders.
- 🚴 **TestFlight beta** to the warmest waitlist segment; obsess over: does a real rider's loop work end-to-end on their phone.
- 🤖 **Apply to Zcash Community Grants** (open-source public-good framing).

## Week 4 (Jul 8–14): Iterate + App Store + buffer
**Theme: respond to real usage; line up the public release; keep buffer before the deadline.**

- 🛠️🤖 **Fix what real riders hit;** retention + fraud telemetry review.
- 🍎🚴 **App Store listing** (screenshots, description, **"Data Not Collected"** privacy label) → submit for App Review.
- 🤖 **Polish the submission** with real-rider traction numbers; final demo cut.
- ⏳ **Buffer** for hackathon-week surprises. Don't schedule to the deadline.

---

## The few things that actually decide whether this is "world-changing"
1. **The loop works for a stranger** — a real person, on their own phone, rides and gets paid in shielded ZEC without thinking about crypto. Onboarding-to-shielded-ZEC is the unique value (see `docs/marketing/LAUNCH_ASSETS.md` Value-to-Zcash).
2. **It's trustworthy** — secured backend, honest anti-cheat, route truly never leaves the phone (unit-tested), small honest payouts. Privacy is the product.
3. **It's reliable** — no zero-distance rides, no crashes, battery-safe. This is the RN engineering investment.
4. **The story is on film** — the demo video is the asset that travels.

## Standing risks (watch all month)
- **Security** (public endpoints — fixing week 1; keep ≤2 ZEC hot).
- **App reliability** post-upgrade (RN dev recommended).
- **ZEC volatility / treasury solvency** (tight caps, top up from cold).
- **Ironwood pool migration** (~late July) — budget a spend-path rewrite.
- **Apple crypto-rewards review** (3.1.5(b)(iv)) — org account ✓, frame carefully.

_This plan is the source of truth for the month. Claude updates it as we execute._
