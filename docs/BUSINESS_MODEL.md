# Pedalshield — Business Model

_Written July 2026. The answer to "how will you make money?" Companion to
`Pedalshield_Investor_Plan`, `MINER_SCALE_PLAN.md`, `TREASURY_SUSTAINABILITY.md`._

## The one-sentence answer

Employers, insurers, and cities already pay billions for verified healthy,
green commuting — Pedalshield is the only way to verify it **without
surveilling anyone**, and we charge them for that verification. The consumer
app is our proof and our distribution, not the business.

Paying riders is a cost center. The sellable asset is the **verified mile**:
proof that a real human rode a real bike a real distance — produced by a
proprietary on-device anti-cheat engine, with a privacy seam that makes
over-collection *structurally impossible* (open-source, unit-test enforced).

## Who pays, and for what

| Buyer | What they buy | Why us | Sales cycle |
| --- | --- | --- | --- |
| Employers (wellness / commuter benefits) | Per-seat SaaS + funded reward pool; fraud-proof mileage per enrolled employee | Employees veto tracker apps; ours can't track | Weeks–months |
| Wellness platforms / benefits brokers | Verification API for cycling as a rewarded activity | They add verified activities to stay competitive | Months |
| Insurers (Vitality-model) | Behavior features: consistency, commute substitution — never location | Only verification with zero surveillance liability | Quarters (enter via the platforms above) |
| Cities / DOTs | Aggregate mode-shift dashboards (data co-op): verified bike-miles by corridor bucket, CO2 avoided | Cities already buy Strava Metro; ours is anti-cheat-verified and consent-clean | Quarters |
| Move-to-earn / fitness apps | The anti-cheat engine as an API ("verified-mile API") | The fraud dataset compounds; they can't catch up | Opportunistic |

Not the business, ever: a token, selling routes, subscriptions that gate
rewards, ads.

## How qualification works — the consent ladder

The design problem: buyers want proof about *people*; the product refuses to
know who people are. The bridge: **we verify behavior and issue portable
proof; the rider chooses who sees it, per level, and is paid to climb.**
At every level the buyer-relevant feature is computed ON DEVICE and only the
feature leaves — the same pattern as the integrity score.

| Level | What leaves the phone | Buyer | Rider gets | Status |
| --- | --- | --- | --- | --- |
| 0 (default) | Distance claim for payment only — nothing sellable | — | Base ZEC rewards. **Never contingent on opting in.** | Live |
| 1 Certificate | Signed monthly summary: verified miles, ride count, integrity band, pseudonym | Employer benefit portals | The benefit itself | Buildable in ~1 week (backend already stores everything; sign it) |
| 2 Behavior features | On-device-derived booleans/counts: commute-window consistency, rides/week, active minutes. No times, no places | Insurers, wellness platforms | Buyer-funded earn-rate boost | Design ready (verification engine already extracts ride features) |
| 3 Coarse geography | Metro region + corridor-bucket contributions to AGGREGATE pools (whole-km buckets, no coordinates, no dates) | Cities | Co-op revenue share | Data co-op shipped (off by default, consent-versioned) |
| Never | Routes, coordinates, raw sensor data | Not for sale at any price | — | Enforced by the open-source unit-tested payload seam |

Identity linkage always happens on the buyer's side by the rider's act
(presenting a certificate / redeeming an employer enrollment code), never on
ours. Every toggle: plain-language disclosure, revocable instantly,
forward-only. The contract line that closes privacy reviews: *"we cannot
hand you routes — here is the public test proving the app cannot send them."*

### Employer pilot mechanics (enrollment codes)

Employer buys N seats → gets N codes → employee redeems a code with explicit
consent ("your monthly verified mileage TOTAL — never routes — reports
against this code") → dashboard shows enrolled riders, miles per code, CO2
avoided, pool spent. Employer can pay the benefit; employee was never tracked.

## Unit economics sketch

- Cost per verified mile ≈ $0.086 (EPA-pegged rider reward) + amortized
  network fee (~1% batched). A 100-mile/month rider costs ≈ $9.
- Employer wellness spend runs $10–30/employee/month. Price at
  $6/seat/month SaaS + pass-through reward pool: margin is the SaaS fee
  plus float on the pool, and the reward cost is capped by design.
- The verification API prices per verification or per MAU later; zero
  marginal cost, pure moat rent.
- Treasury sustainability: reward pool becomes buyer-funded (employer/city
  money in, ZEC out) — the treasury shifts from "our money" to "escrow with
  a margin," which is the moment the model stops being philanthropy.
  Miner capital (MINER_SCALE_PLAN Role 3) bridges until then.

## Sequencing

1. **Now:** hackathon credibility; certificates in-app (every certificate a
   rider hands HR is a sales artifact).
2. **This quarter:** one Bend employer pilot (or the local bike-commute
   advocacy org running employer challenges — they know their honor-system
   numbers are mush). 50 seats. Reference customer.
3. **Next:** one wellness-platform integration (they move in months;
   insurers move in years — enter through the platform layer).
4. **Then:** city dashboard from co-op aggregates; verified-mile API.
5. **Roadmap:** ZK credentials ("prove ≥100 miles without revealing more") —
   the existing ZK proof-of-distance roadmap item, now with a named buyer.

## The honest caveats (say them out loud, they build trust)

- Level-2 features reveal *something* (consistency patterns). That's why
  they're opt-in, paid, and computed on-device — but they are disclosures,
  and we say so in plain language.
- Base rewards alone never fund a business; buyer revenue does. Until the
  first pilot, the treasury is finite and payouts pause when it's dry — as
  the app already says publicly.
- Insurance-adjacent products may trigger state-by-state rules; get counsel
  before any insurer contract (not before an employer wellness pilot).
