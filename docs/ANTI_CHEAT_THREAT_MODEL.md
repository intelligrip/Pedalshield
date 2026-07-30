# Pedalshield — Anti-Cheat Threat Model

_Public document. Describes WHAT we defend and WHY, not the tuned
thresholds — those live in the proprietary engine
(`mobile/src/verification-private/`, gitignored). Publishing the model
without the parameters is deliberate: the design should be auditable, the
calibration should not be free to attackers._

Last updated: July 30, 2026 (engine v6).

## What we are actually defending

A rider claims "I rode N miles." We pay real money for that claim. Every
defence answers one question: **is this claim backed by a human on a
bicycle moving through the world?**

Three properties, in dependency order. Each is worthless without the one
above it:

| # | Property | Question | Status |
|---|---|---|---|
| 0 | **Provenance** | Did this claim come from our unmodified app on real hardware? | **Partial** — claims are signed by a device key (v0.7); App Attest is NOT yet implemented |
| 1 | **Physics** | Is this motion possible for a bicycle? | Shipped, v6 |
| 2 | **Identity economics** | Is it worth inventing riders to farm this? | Server-side caps shipped; progressive trust is roadmap |

### The honest headline

**Tier 0 is incomplete, and that bounds everything else.** The scoring
engine runs as JavaScript inside an app the attacker controls. An
attacker who patches the bundle to emit a perfect score defeats every
heuristic below, because they never run them. Claim signing proves a
claim came from *a registered device*; only App Attest / Play Integrity
proves it came from *our genuine binary on real hardware*.

Until then, the honest security claim is: **Pedalshield's anti-cheat
raises the cost of casual and moderate cheating to well above the reward,
and server-side spend limits bound the loss from a sophisticated attacker
to a fixed daily ceiling.** Not "unbeatable." We would rather say this
plainly than be caught overstating it.

## Attacks, and what answers them

| Attack | Defence | Tier |
|---|---|---|
| Sit still, let GPS jitter accumulate | Minimum verifiable ride; stationarity check (path vs bounding box) | 1 |
| Drive a car | Speed envelope; road-vibration energy; pedalling cadence absent | 1 |
| Walk / run | Pedometer-independent walking gate (avg pace + never reaching a cycling burst) | 1 |
| Teleport / stitched GPS | Physics-impossible joints excised, not paid; ride rejected when mostly excision | 1 |
| Generated straight-line route | Straightness AND metronome-constant speed together (either alone is a normal ride) | 1 |
| GPS spoofing app | Spike ratio, accuracy realism, and cross-sensor coherence | 1 |
| **Replay a real GPS track while shaking the phone** | **Cross-sensor coherence (v6): turn-vs-gyro and speed-vs-vibration time alignment** | 1 |
| Anonymous `curl` claims | Ed25519 claim signatures over a canonical message binding address, distance and timestamp | 0 |
| Replayed / redirected claim | Signature binds recipient address and signing time; stale signatures refused | 0 |
| Many fake identities (Sybil) | Per-device cooldown, per-rider daily allowance, global daily budget | 2 |
| **Patched app emitting a perfect score** | **NOT SOLVED — requires App Attest.** Loss bounded by spend limits | 0 |

## Cross-sensor coherence (v6) — the current frontier

Single-sensor checks fall to single-sensor fakes: replay real GPS, or
shake the phone for vibration. What resists forgery is the **time
relationship between independent sensors**, because an attacker must
synthesise two streams that stay coherent with each other:

- **Turn ↔ gyroscope.** The phone rotates when the bike turns. A replayed
  route paired with an idle or randomly-shaken phone shows no alignment.
- **Speed ↔ road buzz.** Vibration scales with speed and dies at stops.
  Constant-amplitude shaking does not.

Both are correlations over short time windows, computed on-device, on the
**eligible segments only** (excised teleport joints would otherwise
manufacture phantom turns).

Two safeguards against false accusations, both load-bearing:

1. **Insufficient evidence scores neutral, never guilty.** No gyro, too
   few windows, or a ride with no turns yields "no evidence" — honest
   riders with unusual mounts are not punished for what their hardware
   didn't record.
2. **A dynamic-range gate.** A correlation over a nearly-flat series is
   noise dressed as evidence. A steady pace down a straight rail trail
   produces no variation to correlate, so we decline to judge it.

When both couplings *are* measurable and both are flat, the ride is
flagged and penalised into **review** — reduced, score-scaled payout and
a second look — rather than rejected outright. It is not a hard fail
because the real-world distribution of these correlations is unmeasured;
we have synthetic fixtures and one rider. Hard-failing on an uncalibrated
signal is precisely how July's false rejections of genuine rides
happened.

## Design principles (learned the hard way)

1. **Absence of evidence is not evidence of fraud.** Missing sensors,
   short rides, and odd mounts score neutral.
2. **Pay the clean miles.** Impossible stretches are excised and earn
   nothing; one bad GPS quarter-mile costs that quarter-mile, not the
   whole ride. Rejection is reserved for rides with nothing real in them.
3. **Hard fails must be physics, not heuristics.** Only impossibility
   zeroes a ride. Everything statistical reduces the score.
4. **Never promote a signal to a hard fail without calibration data.**
5. **Bound the loss instead of assuming detection.** Server-side caps
   mean a perfect bypass still cannot drain the treasury.

## Roadmap, in priority order

1. **App Attest / Play Integrity (Tier 0).** The single highest-value
   item; everything else is advisory without it.
2. **Real labelled data.** Every threshold today is tuned against
   synthetic fixtures and one rider. Real rides and real spoof attempts
   are what turn a rulebook into a moat — and the strongest reason to get
   ten riders that has nothing to do with revenue.
3. **Progressive trust.** New devices earn at a reduced rate until they
   accrue history, so a fresh Sybil identity is never worth the effort.
4. **Self-consistency baselines.** Per-device speed/cadence signatures;
   flag departures from a rider's own history (computed on-device).
5. **Population-level Sybil detection.** Device-fingerprint and payout
   address clustering, server-side.
6. **Promote coherence to a hard fail** once the honest false-positive
   rate is measured and near zero.
