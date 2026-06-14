# Pedalshield — Miner Scale Plan

_How to recruit crypto miners into the roles that scale a privacy-first
ride-to-earn network. Companion to `docs/SCALING_PAYOUTS.md` (payout
architecture) and `docs/ROADMAP.md`. Honest-framing rules from `HANDOFF.md`
apply: every role states what it solves and what it does not. Nothing here is
legal or investment advice — the capital role in particular needs counsel
before it ships (flagged inline)._

## Why miners, specifically

Pedalshield needs three scarce things to reach millions of private rides:
**always-on infrastructure**, **distributed custody of a real treasury**, and
**ZEC to pay riders**. Crypto miners — Zcash miners above all — are unusually
well-matched to supply all three at once:

- They **already hold ZEC** and want utility for it beyond selling block
  rewards into the market.
- They **already run 24/7 infrastructure** (power, uptime, monitoring, key
  hygiene) — the exact muscle a settlement/signing network needs.
- They are **economically aligned with Zcash's survival**: more shielded
  usage and more on-chain demand is good for the asset they produce. As block
  rewards tighten over halvings, miners actively seek protocol-aligned yield
  and utility — Pedalshield is one.
- They **understand keys, custody, and threshold signing** already, so the
  treasury-steward ask is in their wheelhouse, not a stretch.

So the plan treats miners not as one audience but as a **pipeline through four
roles**, from lowest commitment (run a node) to highest (steward the
treasury), with riders' growth as the demand-side flywheel.

| Role | What they give | What they get | Commitment |
|---|---|---|---|
| Infra / node operator | compute + uptime | per-settlement infra fee, reputation | low |
| Treasury steward / FROST signer | custody + availability | signer stipend, governance voice | high |
| Capital / liquidity provider | ZEC into the reward pool | defined, **non-yield** stake (see caveats) | high |
| Rider-growth partner | community + onboarding | referral rewards, cosmetic perks | low |

---

## Role 1 — Infra / node operators

**What they run.** The scale-out backend from `SCALING_PAYOUTS.md`: redundant
`lightwalletd` endpoints, **settlement workers** (drain the accrual queue,
build the batched Orchard tx), and read replicas of the claim/accrual ledger.
None of these hold spend authority — they assemble and broadcast transactions
that only the FROST signers (Role 2) can authorize.

**Why a miner fits.** This is uptime and bandwidth, which miners already sell
to the network. The marginal cost to also run a Pedalshield settlement worker
is near zero.

**The ask / incentive.** A small, transparent **per-settlement infra fee**
paid from the treasury's operating budget (not from rider rewards — effort
still dominates payouts). Operators are ranked on a public uptime/throughput
leaderboard; top operators get first refusal on signer seats (Role 2).

**Onboarding (target: <1 hour to first settlement broadcast).**
1. `docker compose up` a node bundle: lightwalletd + settlement worker +
   ledger replica, pointed at the treasury's read endpoint.
2. Register the node's pubkey; it joins the worker pool and starts claiming
   settlement jobs.
3. Earn infra fees per confirmed settlement; metrics flow to the public board.

**What we must build first:** containerized worker, a job-claim protocol so
workers don't collide (reuses the `begin_settling` reservation), and the
public operator dashboard.

**What this does NOT solve.** Node operators are trust-minimized but not
trustless — they can censor or delay (not steal). Spend authority stays with
Role 2; that separation is the whole security story.

---

## Role 2 — Treasury stewards / FROST signers

**What they do.** Hold one share of the FROST 2-of-3 (later t-of-n) treasury
key and co-sign settlement batches after verifying them against the ledger.
This is the roadmap's **public bootstrapping ceremony** — named community
signers via DKG, replacing the trusted-dealer setup.

**Why a miner fits.** Threshold custody, hardware security, and key ceremonies
are native to serious miners. They are also reputationally accountable, which
is exactly what a named-signer set needs.

**Honest status.** Per `README.md`/`ROADMAP.md`: the FROST ceremony is real
and tested over Ed25519, but **does not yet authorize mainnet Orchard spends**
— the RedPallas/ZIP-312 swap is the gating work. Recruit and rehearse signers
in parallel with that swap; do not market signer custody as live until it is.

**The ask / incentive.** A signer **stipend** from the operating budget, a
governance voice over treasury parameters (floor, rates, infra fees), and
listing in the public signer-rotation history (a v1.0 dashboard item).

**Onboarding (cohort-based, deliberately slow).**
1. Vetting: identity/reputation, hardware attestation, security questionnaire.
2. DKG ceremony over a public, recorded session (no trusted dealer).
3. Signer-client runs in a hardened enclave; first sign on a low-value batch.
4. Quarterly rotation; misbehaving or absent signers are rotated out.

**What we must build first:** RedPallas FROST signing live on mainnet, the
signer client, DKG tooling, and the rotation/slashing policy.

**What this does NOT solve.** 2-of-3 is collusion-resistant, not
collusion-proof. Mitigation is a path to higher thresholds and geographic /
jurisdictional diversity of signers as the set grows.

---

## Role 3 — Capital / liquidity providers

**What they give.** ZEC into the finite reward treasury so payouts can scale
with ride volume without the treasury draining (the runway problem
`SCALING_PAYOUTS.md` exists to manage).

> **Legal caveat, load-bearing — do not skip.** A "fund the pool, get a
> return" structure can be a security in many jurisdictions and risks turning
> the project into the StepN-style tokenomics trap the product explicitly
> rejects. **Get securities counsel before launching this role.** The framing
> below is deliberately structured as funding a public-good reward pool, not
> as an investment product, and even that needs review.

**Defensible structures to evaluate (with counsel), least-risky first.**
- **Grant / sponsorship.** Miners or mining pools donate ZEC to the reward
  pool for ecosystem/brand reasons (named sponsor of a season, a region, a
  leaderboard). No financial return — cleanest path, ship this first.
- **Earmarked treasury.** A sponsor funds a ring-fenced pool (e.g. "Pool X
  riders in city Y"); unspent funds return to the sponsor on a fixed
  schedule. Custody/return mechanics, no yield.
- **Revenue-share on operating fees only (high scrutiny).** If/when the
  network charges optional operating fees (not minted tokens, not rider
  rewards), a capped share could route to funders. This is the structure most
  likely to be regulated; treat as research, not roadmap.

**Hard invariants regardless of structure (from `ROADMAP.md`).** No minting,
ever. ZEC is the only currency. Effort (km pedaled) always dominates earning
over money spent. Anything that lets capital out-earn pedaling is a no.

**What we must build first:** transparent on-chain (or attested) accounting of
the reward pool — balance in, rewards out, fees — so any funder can audit
runway without trusting an operator. This is also the public treasury
dashboard from v1.0.

---

## Role 4 — Rider-growth partners

**What they do.** The demand side: crypto-native communities, mining
Discords/Telegrams, and local cycling clubs who drive real ride volume and
onboarding. Without rides, the infra and treasury have nothing to do.

**Why a miner fits.** Mining communities are large, engaged, ZEC-holding, and
already comfortable installing wallets and managing keys — a low-friction
first cohort of riders and evangelists.

**The ask / incentive.** Referral rewards (capped, effort-gated so they can't
be farmed), cosmetic Garage perks for partner communities, and early access
to seasonal events. Rewards come from the same finite pool and obey the same
caps — growth never breaks the economics.

**Onboarding:** a partner kit (referral codes, brand assets, a one-paragraph
privacy pitch — "better than Strava, your route never leaves your phone"), and
a partner leaderboard.

**What we must build first:** referral attribution that is Sybil-resistant and
**privacy-preserving** (no deanonymizing riders to credit referrers), plus the
partner kit.

---

## How the four roles compound

```
Rider-growth (4) ── more rides ──▶ more settlements
        ▲                                   │
        │                                   ▼
   demand flywheel                 Infra operators (1) do the work
        │                                   │
        │                                   ▼
   funded rewards ◀── Capital (3) ── authorized by ── Signers (2)
```

Riders create work; operators do it; signers authorize it; capital keeps the
pool full; healthy rewards bring more riders. Miners can enter at any node and
graduate inward — a node operator who proves uptime becomes a candidate signer;
a sponsor community becomes a growth partner.

---

## Phased rollout (cohorts, not a big-bang launch)

| Phase | Who we recruit | Gate to advance |
|---|---|---|
| **P0 — Testnet operators** | 5–10 miners run nodes + settlement workers on testnet | workers settle reliably; dashboard live |
| **P1 — Signer rehearsal** | same cohort runs DKG + signs low-value mainnet batches | RedPallas FROST signs mainnet; rotation policy works |
| **P2 — Sponsored pool** | 1–2 mining pools grant ZEC to a ring-fenced reward pool | transparent pool accounting audited externally |
| **P3 — Growth partners** | mining + cycling communities drive ride volume | Sybil-resistant referral; rider retention holds |
| **P4 — Open operator set** | permissionless node operators, t-of-n signer set | slashing/rotation battle-tested; public treasury dashboard |

Each phase is independently valuable and independently abortable. P0–P1 are the
load-bearing technical gates (they depend on the FROST-RedPallas swap); P2
onward are go-to-market.

---

## KPIs

- **Operators:** active worker nodes, settlement success rate, p95 settlement
  latency, uptime distribution.
- **Signers:** signer count, threshold, geographic/jurisdictional spread,
  rotation cadence, time-to-sign per batch.
- **Treasury:** reward-pool balance, days-of-runway at current ride volume,
  fee overhead as % of rewards (target ≤0.5%, per `SCALING_PAYOUTS.md`).
- **Growth:** new riders/week, referral-attributed share, 4-week rider
  retention, rides/day.

---

## Risks & honest caveats

- **Signer custody isn't live yet.** Recruiting signers ahead of the
  RedPallas swap is fine for rehearsal, but do not represent mainnet
  threshold custody as shipped until it is. (`README.md` already says this out
  loud; keep it that way.)
- **The capital role is a legal minefield.** Ship grants/sponsorship first;
  anything resembling yield needs securities counsel. Don't let funding
  pressure erode the "effort dominates, never mint" invariants.
- **Operator centralization.** Early on, a few miners run most nodes. Mitigate
  with the permissionless open-operator phase (P4) and by keeping spend
  authority strictly separated from node operators.
- **Ironwood migration overlaps recruitment.** Orchard closes to new
  deposits/transfers around late-July 2026 activation (`HANDOFF.md`). Keep the
  settlement layer pool-agnostic so operators and signers don't need to
  re-tool when the bundle builder swaps Orchard → Ironwood.
- **Sybil on the growth side.** Cheaper batched payouts raise the value of
  faking rides; referral rewards add another farming surface. The layered
  anti-cheat + attestation carry this load — growth incentives must not
  outrun it.

---

## The ask (what a recruited miner sees first)

> Run a Pedalshield node and you help pay real cyclists shielded ZEC for real
> rides — privately, with no route data ever leaving their phones. Start by
> running a settlement worker (an hour to set up, earns per-settlement infra
> fees). Prove your uptime and you're first in line to become a treasury
> signer. Bring your community and earn referral rewards. It's protocol-aligned
> work for ZEC you already believe in — and it scales the most credible answer
> to "what is shielded ZEC actually for."
