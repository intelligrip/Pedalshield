# Pedalshield ZK Bike Computer — Prototype Bill of Materials (v0.1)

*On-device ZK prover ("Approach B"). The grip can't do this — this is a small, ruggedized Linux computer for the handlebar.*

> Context: `EDGE_NODE_HARDWARE_SPEC.md` recommends **Approach A** (a tiny MCU
> grip that *attests* sensor data; the phone proves). This BOM is the
> deliberate opposite: **Approach B**, computing the zero-knowledge proof on
> the device itself. That is a real, defensible moat, but it changes the
> physics — you are no longer building a sensor grip, you are building a
> battery-powered prover. Read §1 before buying anything.

---

## 1. What "compute ZK proofs on device" actually demands

ZK proving (Halo2 — the system Zcash/Orchard uses) is **memory-bound and
compute-bound**, and the by-products are **heat and battery drain**. The four
constraints that drive every part choice:

1. **RAM is the gate.** Halo2 witness generation + MSM/NTT hold large tables in
   memory. A meaningful circuit wants **multiple GB of RAM** — not the KB of an
   MCU. This alone rules out any microcontroller and forces a Linux-class SoC.
2. **CPU width matters.** The bottlenecks (multi-scalar multiplication, number-
   theoretic transform) are parallel and SIMD-friendly → you want **many fast
   ARM cores with strong NEON**, not one small core.
3. **Heat.** Sustained proving pushes the SoC to several watts; in a sealed,
   waterproof case there is nowhere for it to go. Thermal design is the hardest
   mechanical problem here.
4. **Energy per proof.** A proof can cost real watt-seconds. **Prove once per
   ride (post-ride), not continuously**, and size the battery for that burst.

**Design rule:** log the ride cheaply all ride long; **generate one proof at
ride end** while on the mount (or on the charger). Don't prove mid-ride.

### Proof-system choice (decide before the BOM is final)
| Option | Pros | Cons | Fit |
|---|---|---|---|
| **Halo2 (Orchard-aligned)** | No trusted setup; matches Zcash; small proofs | RAM-hungry proving | ✅ Default — ecosystem alignment |
| **Plonky2/3 (FRI)** | Fast prover, no trusted setup | Larger proofs | Good if proving time hurts |
| **zkVM (RISC Zero / SP1)** | Write the ride circuit in plain Rust | Heaviest proving load | Fastest to build, hardest on HW |
| **Optional FPGA MSM/NTT accelerator** | 5–20× prover speedup | +cost, +power, +complexity | Phase-2 only |

The BOM below is sized for **Halo2 with a modest custom "valid-ride" circuit**,
with headroom to try a zkVM.

---

## 2. Core compute & memory

| # | Component | Recommended part / material | Capacity / spec | Why |
|---|---|---|---|---|
| 1 | **Application SoC (on a SoM)** | Rockchip **RK3588S** module (e.g. Radxa CM5 / Mixtile) — alt: **Raspberry Pi CM5 (BCM2712)** | 8× ARM cores (4×A76 + 4×A55) up to ~2.4 GHz, NEON SIMD | Many fast NEON cores = the prover engine; SoM form factor → easy prototype-to-product path |
| 2 | **RAM** | LPDDR5 on-module | **16 GB** (min 8 GB; 16 GB for zkVM headroom) | The hard gate on circuit size — buy more than you think you need |
| 3 | **Boot/OS storage** | eMMC 5.1 on-module | **64 GB** | OS, prover binaries, proving/verifying keys |
| 4 | **Working/log storage** | microSD (UHS-I) or onboard **NVMe** (M.2 2230) | **128 GB** card / **256 GB** NVMe | Ride buffers, proof artifacts, OTA images; NVMe if proof I/O is a bottleneck |
| 5 | **Secure element / root of trust** | NXP **SE051** or Infineon **OPTIGA SLB9672 TPM 2.0** (+ SoC secure boot/TrustZone) | ECC P-256/Ed25519 keystore, key never leaves chip | **ZK ≠ anti-cheat.** ZK proves the math ran correctly; the SE attests the *sensor inputs are from real hardware*. You need both. |

> Why a SoM, not a bare SoC: the RK3588S/CM5 module bundles the SoC + RAM +
> eMMC + power sequencing on a tested board, so the prototype carrier PCB is
> simple and you can swap to a higher-RAM module without a respin.

---

## 3. Sensors (anti-cheat input — feeds the circuit)

| # | Component | Recommended part | Capacity / spec | Why |
|---|---|---|---|---|
| 6 | **GNSS** | u-blox **NEO-M10** (single-band) — anti-spoof upgrade: **ZED-F9P** (dual-band RTK) | Multi-constellation (GPS/GAL/BDS/GLO), ~10 Hz | Distance + spoof resistance; dual-band resists GNSS spoofing far better |
| 7 | **GNSS antenna** | Active patch antenna + LNA | 28 dB gain active | Reliable lock under tree cover |
| 8 | **IMU (6-axis)** | TDK **ICM-42688-P** | Low-noise accel+gyro, up to 32 kHz | Cadence, vibration, motion cross-checks |
| 9 | **Magnetometer** | MEMSIC **MMC5983MA** | 3-axis | Heading sanity / dead-reckoning |
| 10 | **Barometer** | Bosch **BMP581** | ±0.06 hPa | Elevation/grade vs GPS consistency (anti-spoof) |
| 11 | **ANT+ / BLE sensor radio** | Nordic **nRF52840** module (pre-certified) | BLE 5.x + ANT+ | Talk to power meters, HR straps, speed/cadence — power data is killer anti-cheat |

---

## 4. Connectivity, display, controls

| # | Component | Recommended part | Capacity / spec | Why |
|---|---|---|---|---|
| 12 | **Wi-Fi/BT module** | AzureWave/AMPAK **AP6275P** (on most RK3588 SoMs) | Wi-Fi 6 + BT 5 | OTA, phone sync, off-bike proof upload |
| 13 | **Cellular (optional, standalone)** | Quectel **EG25-G** LTE Cat-4 (or BG95 LPWA) | Global LTE | Only if going phone-free; big power/cert cost — Phase 3 |
| 14 | **Display** | **2.4–2.8" transflective sunlight-readable TFT** (e.g. Sharp/J-Display) — low-power alt: **Sharp Memory LCD LS027B7DH01** | 320×240+, sunlight-readable | Outdoor visibility; transflective stays readable in direct sun |
| 15 | **Touch/buttons** | 3–4 sealed tactile buttons (IP-rated) | — | Gloves + rain; avoid relying on touch |
| 16 | **Status LED** | 1–2 RGB | — | Recording / proving / charge state |

---

## 5. Power & thermal (the make-or-break subsystem)

| # | Component | Recommended part / material | Capacity / spec | Why |
|---|---|---|---|---|
| 17 | **Battery** | Li-ion (2× 18650 or LiPo pouch) | **5000 mAh / ~18.5 Wh** (min 3500 mAh) | Sized for all-ride logging **+ one proving burst**; bigger if proving more often |
| 18 | **PMIC / charger** | TI **BQ25792** (buck-boost, 1S/2S, up to 5 A) | USB-C PD input, 3–5 A charge | Handles proving current spikes + fast charge |
| 19 | **Fuel gauge** | TI **BQ27427** | Coulomb-counting | Accurate %; lets firmware refuse to prove below threshold |
| 20 | **USB-C PD port** | USB-C w/ PD sink controller (**TUSB320**) | PD 15–30 W | Charge fast; prove on wall power without battery wear |
| 21 | **Heat spreader** | Copper shim + graphite pad → **aluminum chassis as heatsink** | — | Conducts SoC heat into the enclosure body; no fan (waterproofing) |
| 22 | **Thermal sensors** | On-SoC + 1 external NTC | — | Throttle/defer proving when hot |
| 23 | **Supercap (optional)** | 1–2 F supercap | — | Rides out current spikes during MSM bursts |

> **Power budget, rough:** idle logging ~0.5–1.5 W; GNSS+display active ~2–3 W;
> **proving burst 5–10 W for seconds–minutes.** A 5000 mAh/18.5 Wh cell gives
> many hours of logging and dozens of proofs per charge if you prove once per
> ride. Continuous proving would drain it in ~2–3 hours and cook the case —
> don't.

---

## 6. Mechanical / enclosure

| # | Component | Recommended material | Capacity / spec | Why |
|---|---|---|---|---|
| 24 | **Enclosure** | **Aluminum core (heat path) + UV-stable polycarbonate window** | **IP67**, UV-stable | Waterproof + the metal doubles as the heatsink |
| 25 | **Mount** | Garmin-compatible quarter-turn out-front mount | 20 N·m vibration rated | Standard, stiff, vibration-tolerant |
| 26 | **Seals** | Silicone gaskets, IP67 USB-C boot | — | Rain/sweat ingress |
| 27 | **Carrier PCB** | 4–6 layer FR-4, controlled impedance | — | SoM connector, sensors, PMIC, radios |
| 28 | **Vibration damping** | Thermal pads + conformal coat | — | Road buzz protects solder joints + sensors |

---

## 7. Realistic expectations to set with the team

- **Proving time:** seconds for a tiny circuit; **tens of seconds to minutes**
  for a real one on ARM CPU. Measure on the actual SoM in Phase 0 before
  promising "instant."
- **Thermals throttle proofs**, especially in a sealed case in summer. Plan to
  prove at ride-end on the mount, and allow "prove on charger" as a fallback.
- **This is a Garmin-Edge-class device** (size, weight ~90–130 g, price), not a
  bar-end grip. Be honest in marketing/roadmap about that shift.
- **You still need the secure element.** Without hardware-attested inputs, an
  on-device ZK proof just proves "garbage in → valid proof of garbage." The SE
  + sensor cross-checks are what make the inputs real.

---

## 8. Prototype shopping list (fastest path to a working prover)

To validate proving on real hardware in ~2–3 weeks, off-the-shelf:
1. **Radxa Rock 5B/5C or Orange Pi 5 Plus** (RK3588, **16 GB**) — dev board to
   benchmark Halo2/zkVM proving time + RAM today.
2. **u-blox M10 USB GNSS dongle** + **ICM-42688 breakout** + **BMP581 breakout**
   — sensor capture over USB/I²C.
3. **nRF52840 dev kit** — ANT+/BLE power-meter ingest.
4. **USB-C PD bench supply + 5000 mAh pack + BQ25792 eval board** — power/thermal
   profiling under proving load.
5. **SE050/SE051 eval kit** — attestation key + signing flow.

Benchmark first; the proving time + RAM + watts you measure decide the final SoM
and battery size.

---

## 9. Next steps (prioritized)
1. **Phase 0 benchmark:** run your candidate proof (Halo2 valid-ride circuit *or*
   a RISC Zero/SP1 ride program) on an RK3588 16 GB dev board. Record proving
   time, peak RAM, watt-seconds, and SoC temp. *(This decides everything.)*
2. **Lock the proof system** (Halo2 vs zkVM) from those numbers.
3. **Pick the SoM** (RK3588S 8 vs 16 GB; CM5) based on measured RAM headroom.
4. **Prototype the thermal path** — SoC → copper → aluminum chassis; prove in a
   closed case and watch the throttle.
5. **Design the attestation message** the SE signs (what inputs the ZK circuit
   consumes) so phone + backend can verify the proof.
6. **Get a contract-manufacturer BOM/assembly quote** at 100 / 1k / 10k units
   for crowdfunding unit economics.
