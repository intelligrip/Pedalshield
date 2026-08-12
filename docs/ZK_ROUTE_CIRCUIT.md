# The ZK Route Circuit — what we prove, and what it costs

_The missing spec. `EDGE_NODE_HARDWARE_SPEC.md` decides attest-vs-prove;
`ZK_BIKE_COMPUTER_BOM.md` lists parts. Neither says **what statement the
circuit proves** — and until that exists, every RAM and proving-time number is
a guess. This document defines the statement, the Zcash-specific constraints
that follow, and the hardware requirement derived from them rather than
assumed._

---

## 1. The statement

**Public inputs (what the verifier sees):**

| Input | Why public |
|---|---|
| `commitment` | Merkle root of the recorded track, signed by the device's secure element |
| `distance_m` | The claim being paid |
| `lat_scale` | Per-ride cosine-of-latitude scale factor (see §3) |
| `params` | Circuit version, max speed bound, sample-rate bound |

**Private witness (never revealed):**

- The GPS samples themselves — `(lat_i, lon_i, t_i)` — and their Merkle paths
- Derived per-sample deltas

**What the circuit proves:**

> There exists a sequence of samples opening to `commitment` such that, walking
> them in order, every step is physically possible for a bicycle, and the
> accumulated distance equals `distance_m`.

Two properties fall out. The verifier learns the distance and **nothing about
the route**. And because `commitment` is signed by the secure element, the
proof is over data a real device recorded — which is the join between this
document and the attester.

**What it does NOT prove**, and must never be claimed: that a human pedalled.
A ZK proof shows a computation ran correctly on given inputs. Feed it spoofed
inputs and you get a valid proof of a spoofed ride. Authenticity comes from the
attester plus the sensor-coherence engine, exactly as the hardware spec says.

---

## 2. Why this circuit does not exist yet

Zcash's Halo 2 circuits prove statements about **note commitments and
nullifiers**. Nothing in the Orchard circuit resembles geospatial arithmetic.
We would be writing a new circuit against `halo2_proofs` — reusing the proving
stack, the Pallas/Vesta curves, and the ecosystem, but none of the circuit.

That is the honest scope: **this is a research build, not an integration.** No
one has shipped a geospatial Halo 2 circuit on a handlebar.

---

## 3. The two optimisations that decide the hardware

Circuit cost is dominated by how distance is computed. Naive haversine is
catastrophic in-circuit — trigonometric functions over a 255-bit prime field
mean lookup tables or polynomial approximations, thousands of constraints per
sample.

**Optimisation 1 — local tangent plane instead of trigonometry.** Over a single
ride, the Earth is flat enough. Pass `cos(latitude)` in as a *public input*
computed outside the circuit, and the per-step delta becomes plain
multiplication:

```
dx = (lon_i - lon_{i-1}) * lat_scale * METERS_PER_DEGREE
dy = (lat_i - lat_{i-1}) * METERS_PER_DEGREE
```

No trig in-circuit. The verifier can sanity-check `lat_scale` against the
claimed region without learning the route.

**Optimisation 2 — never take a square root.** A square root in-circuit is
expensive and mostly unnecessary, because every check we care about is a
*comparison*:

- Speed bound: prove `dx² + dy² ≤ (v_max · Δt)²` — squares on both sides
- Distance: accumulate `dx² + dy²` and range-check the total

Both sides squared, so the root disappears. Where a true metric distance is
required for payment, prove the squared sum and do one square root **outside**
the circuit on a value that is already public.

Together these take the per-sample cost from thousands of constraints to
roughly **tens**.

---

## 4. Sizing, honestly

A 30-minute ride logged at 1 Hz is ~1,800 samples. At ~50–200 constraints per
sample (delta, squares, range checks, Merkle path verification):

| Ride length | Samples | Rough constraints | Halo 2 `k` |
|---|---|---|---|
| 30 min @ 1 Hz | 1,800 | ~10⁵–10⁶ | 17–20 |
| 2 h @ 1 Hz | 7,200 | ~10⁶ | 20–21 |

Merkle-path verification usually dominates — each sample opening against the
committed root costs a hash per tree level. **Batch samples into leaves** (e.g.
64 samples per leaf) and the path count drops by that factor. Do this before
anything else.

Peak proving memory scales with `2^k`. At `k = 20` that is **multiple GB** —
which is precisely why the existing spec rules out any MCU and calls for a
Linux-class SoC.

---

## 5. The Halo 2 property that changes the BOM

Halo 2 is an **accumulation scheme**: proofs can be folded into one another
without a trusted setup. Zcash chose it for recursion, and recursion is worth
more here than it looks.

Instead of one enormous end-of-ride proof:

1. Prove each **segment** (say, 5 minutes) as a small circuit — low `k`, low RAM
2. **Fold** each new segment proof into the running accumulator
3. At ride end, produce one proof attesting to the whole ride

The consequence for hardware is direct: **peak RAM is set by the segment
circuit, not the whole ride.** A `k = 15` segment needs a fraction of a `k = 20`
ride. Proving becomes a steady trickle instead of a burst that cooks a sealed
enclosure — which was the hardest mechanical problem in the BOM.

This is the single most important architectural decision in this document, and
it is Zcash-specific: it exists because Halo 2 was designed for recursion.

**Consequence:** re-run the BOM's memory line after a segment-circuit prototype
exists. 16 GB may be over-specified by a wide margin if folding works. Do not
buy 16 GB modules until that is measured.

---

## 6. Where the proof should run

Unchanged from `EDGE_NODE_HARDWARE_SPEC.md`, and worth restating because the ZK
excitement pulls the other way:

- **The grip attests.** Secure element signs the committed track at source. This
  is the part that is genuinely hard to fake and the part that closes the Tier 0
  gap in `ANTI_CHEAT_THREAT_MODEL.md` — better than App Attest, because the
  sensor data is signed where it is captured rather than by an app that could be
  patched.
- **The phone proves.** It already has the RAM, the cores, and a charger. A
  handlebar prover is a research goal, not a launch requirement.
- **On-device proving earns its place** only when the value is "no phone
  required" or "the device is the whole product" — a bike-computer market, not
  the commute-verification business.

---

## 7. What to build first — in order

1. **Define the leaf format.** Samples per leaf, field encoding, hash choice
   (Poseidon over Pallas — cheapest in-circuit, and Zcash-native).
2. **Write the segment circuit** in `halo2_proofs`. One segment, no folding.
   Measure `k`, prover RAM, and wall time on a laptop.
3. **Measure before speccing.** Those three numbers replace every estimate in
   this document and re-open the BOM's memory decision.
4. **Add folding.** Prove segment N+1, accumulate into N. Measure peak RAM
   again — this is where the hardware requirement is actually decided.
5. **Port to ARM.** Same circuit on an RK3588S or CM5 dev board. Only now does
   the enclosure and thermal work mean anything.
6. **Attester in parallel** — and this ships first regardless, because it is
   what makes the inputs trustworthy and the proofs meaningful.

**Do not order hardware before step 3.** Every RAM figure in the BOM is derived
from an unmeasured circuit; a measured `k` from a laptop prototype costs
nothing and could change the module choice entirely.
