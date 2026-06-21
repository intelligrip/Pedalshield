# Pedalshield — Scaling to Millions of Rides Globally

_June 11, 2026. Companion to BIZDEV_PLAN.md (the revenue model) — this is the
scale plan: how the architecture, treasury, and go-to-market get from 1 rider
to millions of rides/month without breaking the privacy thesis or the chain.
All ZEC math at $426/ZEC (volatile — every figure is parameterized)._

## The thesis

Privacy is the growth engine; rewards are the acquisition hook. Strava has
~100M+ users and a decade of heatmap-doxxing incidents. Every incident is free
marketing for the counterexample. We don't outspend Strava — we are the only
ride tracker where non-collection is architecturally enforced (unit-tested
payload, open source, verifiable shielded payouts). Rewards exist to convert
curiosity into habit, then the product (a genuinely good private ride tracker)
retains. If retention ever depends on yield, the model is dead — see STEPN.

## 1. Technical scale path

**The current design (1 on-chain tx per ride) does not scale, and doesn't need
to.** The fix is accrual + batched settlement, and it's straightforward:

- **Accrue, don't pay per ride.** Verified km credit a rider balance in the
  backend (sqlite → Postgres). Payout settles monthly or at a threshold
  (e.g. ≥0.001 ZEC), rider-configurable.
- **Batch settlements into multi-output Orchard transactions.** One shielded tx
  carries ~50 recipient outputs. ZIP-317 fees stay trivial: ~0.0025 ZEC per
  50-payout tx (~$0.02/rider/settlement).
- **Capacity math:** 1M rides/mo ≈ 100K riders ≈ 2,000 settlement txs/mo
  (~65/day). 10M rides/mo ≈ 20,000 txs/mo (~650/day). Zcash comfortably
  absorbs this; per-ride payouts (33K txs/day at 1M rides) would not be
  neighborly. Chain throughput is never the bottleneck — treasury funding is.
- **Note management:** treasury maintains a pool of pre-split notes so payout
  txs never contend for the same note (also kills the current mempool race).
  Multiple worker treasuries (derived accounts) for parallelism.
- **Ironwood migration (Q3 2026):** the spend path moves to the Ironwood pool
  when Orchard closes (late July). Budget one consensus-driven rewrite per
  year as a standing platform cost.
- **Verification stays on-device** at any scale — it's the one component with
  zero marginal server cost. Add device attestation (Play Integrity / App
  Attest) at 10K+ riders; ZK proof-of-distance is the v2 trust upgrade that
  makes the public-facing claims trustless.

## 2. Treasury economics & emission schedule

Verified math (per-ride avg 9 km ≈ 5.6 mi, 10 rides/rider/mo, batched
settlement). The reward is now **pegged to carbon value — $0.006/mile
(≈$0.034/ride)** — the same at every tier (no tapering); burn scales linearly
with miles ridden. ZEC figures at ZEC ≈ $470; re-peg as price moves
(`deploy/repeg_carbon_rate.sh`).

| Tier | Riders | Rate | Per ride | Treasury burn/mo | Sub revenue/mo* |
|---|---|---|---|---|---|
| 10K rides/mo | 1K | $0.006/mi (carbon) | $0.034 | ~0.7 ZEC ($335) | $0.3K |
| 100K rides/mo | 10K | $0.006/mi | $0.034 | ~7 ZEC ($3.4K) | $3K |
| 1M rides/mo | 100K | $0.006/mi | $0.034 | ~71 ZEC ($33.5K) | $30K |
| 10M rides/mo | 1M | $0.006/mi | $0.034 | ~713 ZEC ($335K) | $300K |

_*5% premium conversion at $5.99/mo. Honest read: at the carbon rate, payout
burn slightly exceeds sub revenue (~$0.34/rider/mo burn vs ~$0.30 at 5%
conversion), so sponsor-funded pools, grants, or higher conversion close the
gap. The carbon peg trades a larger burn for a real, defensible "we pay you the
value of the CO2 you avoided" story. Settlement fees are noise (≤50 ZEC/mo even
at 10M rides)._

Rules:

- **Emission tapers ~20x between launch and 1M rides/mo**, published as a
  schedule up front (Sweatcoin-style credibility, no rug). Rates are already
  env knobs (`PEDALSHIELD_ZAT_PER_KM`) — repriced without redeploys.
- **Reward burn must trend toward ≤100% of recurring revenue** by the 1M tier.
  Gap closers: sponsor-funded reward pools (a brand funds "bike-to-work
  month"), corporate wellness seats, and the miner-directed treasury
  experiment (pools donate coinbase % to the treasury UA — "mining funds
  riding" is a strong Zcash-native narrative; research track, not a plan
  dependency).
- **Volatility:** liabilities are ZEC-denominated and caps are tight, so a 50%
  ZEC move (it happened this month) changes reward attractiveness, not
  solvency. Dynamic repricing reviews monthly.

## 3. Go-to-market: ride the privacy wedge, city by city

- **Phase 0 — now → Jul 15 2026:** ZecHub Hackathon submission. Demo video,
  open-source credibility, waitlist (Polsia landing page). Target: 500–2K
  waitlist from Zcash/privacy community.
- **Phase 1 — Q3–Q4 2026 (1K riders, ~10K rides/mo):** TestFlight/closed beta
  from waitlist. Single metro to start. Obsess over D30 retention and fraud
  telemetry, not growth. Ironwood migration lands here.
- **Phase 2 — 2027 (10K riders, ~100K rides/mo):** Public launch in 2–3
  privacy×cycling beachhead markets — Germany and the Netherlands first
  (strongest bike-commute culture × strongest privacy culture; GDPR is a
  moat, not a cost), then US privacy-conscious metros (Portland, SF, NYC).
  Channels: cycling clubs and advocacy orgs (sponsorships, not data deals),
  bike-shop partnerships, every Strava privacy incident answered within 24h,
  referral bonuses paid in ZEC. Premium tier ships.
- **Phase 3 — 2028 (100K+ riders, 1M+ rides/mo):** Corporate wellness
  white-label (employers buy seats; they see opted-in aggregate km, never
  routes). City bike-to-work programs as sponsors (they fund pools; they get
  participation counts, never data). E-bike/commuter OEM bundles. Localized
  emission rates by market.
- **Phase 4 — 10M rides/mo:** multi-modal (e-bike, scooter), federation of
  sponsor pools, ZK proof-of-distance live → trustless public stats unlock
  bigger institutional sponsors.

## 4. What we never do at any scale

No route database. No data sales (cities, insurers, planners, advertisers —
all rejected in BIZDEV_PLAN.md). No token launch. No yield promises. Growth
that requires breaking these is growth we refuse; the constraint *is* the
brand, and it compounds with every competitor data scandal.

## 5. Funding & milestones

- **Seed (~$1.5–2.5M, post-hackathon):** 18 months runway. Team: 2 mobile, 1
  protocol/Rust, 1 growth, founder. Treasury seeding ~$100K (phase 1–2 burn is
  small). Milestones: Ironwood migration, beta retention ≥20% D30, 10K riders.
- **Series A (2027, if metrics):** beachhead-market scale-up, premium tier
  revenue, corporate wellness pilots. Raise against retention + revenue per
  rider, never against token mechanics.
- **KPIs:** D30/D90 retention, rides/rider/mo, fraud rejection rate, treasury
  burn vs recurring revenue ratio, premium conversion, CAC by channel.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Zcash platform churn (Orchard→Ironwood proves it) | Annual rewrite budget; spend path already hand-rolled, no SDK dependency |
| ZEC volatility | Tight caps, monthly repricing, sponsor pools in fiat |
| Sybil/GPS spoofing at scale | Layered: on-device verifier (car/walk/spoof all rejected in testing) + attestation + anomaly caps + emission caps per device |
| M2E stigma | Never market yield; market privacy. Earnings framed as "your data dividend, paid to you instead of taken from you" |
| Regulatory (paying crypto for activity) | No token issuance; ZEC payouts with per-ride caps; jurisdiction review at Phase 2 |
| Strava ships "private mode" | They can't ship "we never had your route" — architecture vs settings toggle |
