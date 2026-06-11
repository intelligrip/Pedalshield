# Pedalshield — Business Development & Economics Plan (v2, corrected)

_June 11, 2026. Derived from a Grok draft; rewritten to honor the privacy thesis,
the honest-claims rule (POLSIA_LAUNCH_KIT.md), and Zcash reality post-Orchard-bug.
Company: IntelliGrip Industries. Product: Pedalshield._

## Hard constraints (everything below obeys these)

1. **The route never leaves the phone.** No route database exists. Therefore: no
   data sales, no "anonymized" location insights, no insurer telemetry, no city
   commuting-data deals. Ever. This is the product.
2. **Payouts are direct shielded ZEC.** No $GRIP token. Zcash has no smart
   contracts; ZSAs are not live; post-Orchard/Ironwood nobody ships a new asset
   layer soon. A bridged token adds securities + bridge risk and abandons the
   working differentiator: autonomous shielded mainnet payouts, proven by txid.
3. **Honest-claims rule:** ZK route proofs are roadmap, not present. Payouts are
   small (~0.0002 ZEC/km, capped). Privacy is the product, not yield.

## Positioning

"Better than Strava — because Strava sells the map of your life." Audience:
privacy-conscious cyclists, the Zcash/privacy community, M2E refugees, and
self-quantifiers spooked by heatmap doxxing. Moat: the only ride-to-earn where
non-collection is architecturally enforced (unit-tested payload, open source),
not promised in a policy.

## Revenue (privacy-compatible only)

1. **Premium subscription (primary)** — $4.99–7.99/mo: on-device AI ride
   analytics, training insights, route suggestions computed locally, higher
   earn caps, priority support. Strava charges $11.99/mo *and* takes the data;
   undercutting on price while keeping data on-device is the wedge.
2. **Gear partnerships / redemption** — riders redeem ZEC earnings (or get
   member discounts) with bike brands; Pedalshield takes an affiliate margin.
   Brands get privacy-positive association, zero rider data.
3. **Corporate wellness white-label** — employers pay per-seat for verified-km
   wellness programs; employer sees aggregate verified km per opted-in employee
   (the claim payload they already chose to submit), never routes.
4. **Treasury funding experiments** — sponsor-funded reward pools (a brand
   funds "June commuter month"); explore miner/pool-directed coinbase donations
   to the treasury UA as a "mining funds riding" dividend narrative. Research
   track, not a Year-1 dependency.

Explicitly rejected: ads of any kind, data insights products, insurer
integrations, token launches, NFT marketplaces.

## Unit economics (honest version)

- Payout cost: 0.0002 ZEC/km, capped 0.005 ZEC/ride (~$0.09/km, ~$2.13 cap at
  $426/ZEC — recheck at current price; ZEC moved 50% this month).
- A 9 km ride costs the treasury ~0.0018 ZEC + 0.0001 fee. 10K rides/mo ≈ ~19
  ZEC/mo treasury burn at current parameters. Emission knobs are env vars —
  rates drop without redeploying.
- Treasury risk: denominated in ZEC, so reward liability is volatile. Mitigate
  with low caps (already built), dynamic ZAT_PER_KM repricing, and sponsor
  pools. Do not promise dollar-stable earnings.
- Retention assumption: 15–25% M3 retention (realistic for fitness apps), not
  40–60%. The retention driver is the product being a good private ride
  tracker; earnings are a bonus. If retention requires yield, the model is
  already dead (see: STEPN).
- Break-even: subscription-led. ~2K subscribers covers a 100K-rides/mo reward
  pool at current rates. Crypto rewards are a CAC tool, not the business.

## Phases

- **Now → Jul 15:** ZecHub Hackathon submission (Games track). Demo video,
  waitlist landing page (Polsia), open-source credibility.
- **Post-hackathon (Q3 2026):** Ironwood migration of the spend path (Orchard
  closes to intra-pool transfers at activation, late July). TestFlight beta from
  waitlist. Hardening: note reservation, anomaly caps.
- **Q4 2026:** Premium tier MVP (on-device analytics). First gear partner.
  Measure retention before spending on growth.
- **2027:** Corporate wellness pilot; ZK proof-of-distance research (the v2
  trust upgrade); treasury funding experiments incl. miner-directed donations.

## Risks

- **Zcash platform risk:** Orchard→Ironwood proves the spend path can be
  forcibly deprecated; budget for one consensus-driven rewrite per year.
- **ZEC volatility:** treasury and payout value swing; caps + repricing.
- **Sybil/fraud:** layered on-device verification today (honest about limits);
  device attestation next; ZK later.
- **Regulatory:** paying ZEC for activity is cleaner than issuing a token, but
  monitor money-transmission angles per jurisdiction; privacy-first design is a
  GDPR asset.

## What changed from the Grok draft

Removed: $GRIP token, all data-sales revenue (cities, insurers, urban planners),
ads, NFT marketplace, ZKP-as-current-feature claims, $0.50–2/ride promises,
40–60% retention, IntelliGrip-as-product naming. Kept: subscription, gear
partnerships, corporate wellness, decreasing-emission discipline, phased
rollout.
