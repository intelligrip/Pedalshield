# Pedalshield — Treasury Sustainability Model

_How the reward treasury stops being a pure cost center and becomes self-funding — without taxing riders or breaking privacy. Honest-claims rule applies: what exists today vs. what's roadmap is named explicitly._

## The problem, stated plainly

Today the treasury is **pure outflow**. Per verified ride it pays:

- the rider's reward = **carbon value, ~$0.006/mile** (793 zat/km), plus
- the Zcash network fee (~5,000–10,000 zatoshi, today paid to third-party miners — but see engine 6: by running our own node and, later, hosting mining, we recapture this outflow instead of donating it).

There is **no income**. Left alone, the treasury drains. Accrual/batching reduces the *fee* waste (one fee covers many rides) but doesn't add revenue. We need engines that refill it.

Design guardrails (non-negotiable):
1. **Riders keep the full carbon value** — don't tax the reward; that kills the incentive and the honesty of "we pay you the carbon you saved."
2. **Privacy preserved** — any revenue mechanism uses *aggregate* verified distance/CO2, never routes.
3. **No token** — equity/grants/real revenue only.

## The revenue engines (ranked by fit)

### 1. Carbon-credit monetization — the closed loop (biggest, most aligned, hardest)
The reward is *already* defined as the dollar value of avoided CO2 (1 lb/mile × $0.006). So the natural revenue source is **selling that same avoided CO2** to buyers who need offsets (companies, voluntary carbon market).

> Riders avoid CO2 → treasury pays them its value → treasury aggregates the **verified, privacy-preserving** avoided emissions → sells them as credits → revenue refills the treasury.

This is the flywheel that makes Pedalshield self-funding *and* makes the carbon framing literal, not marketing. It's also the strongest fundraising/story angle.

**Honest hurdles (real, not trivial):** carbon credits require MRV (measurement, reporting, verification), **additionality** (proving the ride replaced a drive), avoidance of **double-counting**, and a registry/certifier. On-device verification + anti-cheat is a head start on the "M" and "V", but certification is a build + partnerships. Treat as the durable engine, ~12-month arc.

### 2. Sponsored & corporate reward pools (best near-term, direct)
Money goes *into* the treasury earmarked for rewards:
- **Sponsored challenges** — a brand/city funds "June commuter month"; their funds top up the pool. Privacy-positive brand association, zero rider data.
- **Corporate wellness** — employers pay per-seat for verified-km programs (employer sees only aggregate opted-in km). Recurring B2B revenue that directly funds payouts.

Buildable now, no protocol change. This is the realistic first real revenue.

### 3. Premium subscriptions → treasury top-up (scales with users)
$4.99–7.99/mo (on-device analytics, higher caps, etc.). Route a share to the treasury. Per the scale model, sub revenue roughly tracks payout burn at the carbon rate — so subs can largely self-fund rewards at scale, with sponsors/credits covering the gap.

### 4. Grants — the bootstrap (now, finite)
Zcash Community Grants (ZCG) and similar fund Pedalshield as an open-source public good that drives shielded adoption. Not perpetual, but funds the treasury + dev while engines 1–3 mature. (This is also where the ZODL relationship helps.)

### 5. (Optional, later) small treasury reserve
A tiny protocol reserve from sponsor/credit revenue — never from the rider's reward — to smooth ZEC price swings (the reward is USD-pegged to carbon, so a rising ZEC price lowers the ZEC cost; a reserve buffers the reverse).

### 6. Run the node → mine — recapture the outflow ("mining funds riding")
Two stages, near-term then strategic:

- **Run our own node first (near-term, cheap).** Stand up a Pedalshield Zcash full node + lightwalletd so the backend stops depending on third-party infra (zec.rocks). This buys operational independence, reliability, privacy, and control of the payout path — and it's the foundation mining is built on. Low cost, do it soon.
- **Host mining later (capital-intensive, strategic).** Mining earns **coinbase = block subsidy + the transaction fees in blocks we mine.** Mined ZEC funds the reward treasury directly — the literal "mining funds riding; riding funds Zcash" flywheel, and the way we stop *donating* our payout fees to other miners and start capturing them.

**Honest caveats:** Zcash mining is proof-of-work (Equihash) — real capital, electricity, and ops, with returns that swing on network difficulty and ZEC price. You only recapture *your own* tx fees in proportion to your **hashrate share**, so at small scale this is general mining revenue (mostly block subsidy) topping up the treasury, not literal per-fee recapture. The node is a now move; mining is a "once scale/capital justify it" move — but it's the most vertically-integrated, self-reinforcing engine, and it's uniquely on-brand for a Zcash-native company.

## The recommended path (phased, honest)

- **Phase 0 — now:** accrual + batching (live) to stop fee bleed; bootstrap the treasury with grants + founder funding; keep payouts small/capped.
- **Phase 1 — infra + first revenue:** stand up our **own Zcash node + lightwalletd** (operational independence, foundation for mining), and land 1–2 **sponsored pools / corporate-wellness** pilots — the fastest real money into the treasury.
- **Phase 2 — recurring:** launch **premium subscriptions**, route a share to the treasury.
- **Phase 3 — the carbon engine:** build **carbon MRV + certification** and sell aggregated, privacy-preserving avoided-CO2 credits — the self-sustaining flywheel and flagship story.
- **Phase 4 — vertical integration:** host **mining infrastructure** so coinbase (block subsidy + the fees on blocks we mine) funds the treasury — "mining funds riding," and we stop donating payout fees to other miners. Capital-gated; pursue once scale justifies it.

## What makes this defensible
- The reward and the revenue are the **same unit** (carbon), so the model is coherent, not bolted-on.
- Every engine uses **aggregate** data — privacy survives.
- Riders are never taxed; the treasury is funded by people who *value the outcome* (sponsors, offset buyers, members), not by skimming the rider.

## Honest limits
Carbon-credit certification is the hard, unproven part — don't promise credit revenue until MRV + a registry path exist. Near-term sustainability rests on sponsors + grants + subscriptions. The carbon flywheel is the destination, not today's reality.
