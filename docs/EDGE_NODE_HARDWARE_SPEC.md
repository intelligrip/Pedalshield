# Pedalshield Edge Node — Hardware Specification (v0.1)

_Working spec for the BLE-tethered on-bike edge node (the "IntelliGrip" bar-end grip). Derived from the prototype photo + the product model (free app + premium node). Figures are engineering recommendations, not measurements of your current board — confirm against your firmware needs, target battery life, price, and certification._

## What the photo shows
- Cylindrical **bar-end module** with a **USB-C port** on the end face (charging/data) + a small hole (LED / vent / mic / reset).
- A second **L-shaped module** mounted inboard near the brake lever (display? control? second sensor pod?).
- Bar-end cylindrical form factor → room for a **cylindrical Li-ion cell** + stacked PCB. Not coin-cell constrained.

---

## The decision that drives RAM: attest vs. prove on-device

| Approach | What the grip does | RAM needed | Verdict |
|---|---|---|---|
| **A. Attestation node (recommended)** | Reads sensors, signs the ride data with a hardware key (tamper-evident). **ZK proof runs on the phone** (4–8 GB RAM) or backend. | **256–512 KB on-chip SRAM** | ✅ Cheap, low-power, fits the grip, ships fast |
| **B. On-device ZK prover** | Generates the Halo2 zero-knowledge proof on the grip itself. | **512 MB – 2 GB+ DRAM** + a Linux-class SoC | ❌ Blows up cost, power, heat, size — not a grip anymore |

**Recommendation: build Approach A.** Halo2 proof generation is memory- and compute-hungry — it belongs on the phone, which already has gigabytes of RAM. The grip's job is to make the sensor data **trustworthy** (signed by a key that can't be extracted), then hand it to the phone, which proves and submits. You get hardware-grade anti-cheat without putting a power-hungry computer on the handlebar.

The rest of this spec assumes **Approach A**.

---

## "Private proof of ride" — does ZK solve it, or is the attester enough?

Three separate properties get conflated. Map each to the right primitive:

| Property | What it means | Solved by |
|---|---|---|
| **Route privacy** | The route never leaves the device; only "X km" is emitted | **On-device computation** (no ZK needed) |
| **Integrity / anti-cheat** | The claim came from real, untampered hardware + honest firmware | **Attester** (secure element + secure boot) — *not ZK* |
| **Trustless verifiability** | Outsiders can verify the private claim without trusting Pedalshield's servers | **ZK proof** (the unique thing ZK adds) |

Key facts:
- **ZK does NOT solve anti-cheat.** A ZK proof shows a computation ran correctly on *given* inputs — it cannot tell real sensor data from spoofed data. Garbage in → a valid proof of garbage out. Authenticity of the physical ride must come from the **attester** (hardware-rooted signing) plus layered sensor cross-checks.
- **ZK is not needed for route privacy.** Computing distance on-device and emitting only the km claim already keeps the route private. The attester signs that claim.
- **So for launch — private payouts that resist cheating — the attester is sufficient.** It gives you route privacy + hardware-rooted integrity, which is what you need to pay rewards safely.
- **ZK's real value is removing trust in Pedalshield.** It lets sponsors, institutions, the chain, or the public verify "this km claim was computed correctly and privately" *without trusting our backend.* That matters for big sponsors, decentralization, and public stats — a Tier-2 upgrade, run **on the phone**, not the grip.

**Gold standard (combine them):** the secure element attests the (committed) sensor inputs as coming from real hardware; later, a ZK proof *over that attestation* proves the distance privately **and** trustlessly — "a valid hardware-signed measurement exists and yields distance D, without revealing the route or the signature." Hardware makes the inputs real; ZK makes the verification trustless + private.

Honest limit: even the combo can't fully prove a *human* pedaled outdoors (someone could spin the wheel by hand or carry the grip in a car). Layered anti-cheat mitigates; it never reaches 100%. Say so.

---

## Recommended core specification (Approach A)

| Subsystem | Recommendation | Notes |
|---|---|---|
| **MCU / SoC** | Nordic **nRF5340** (dual Cortex-M33) or **nRF52840** | BLE 5.x built in; Arm TrustZone + CryptoCell; huge ecosystem |
| **RAM (on-chip SRAM)** | **512 KB** (nRF5340) or 256 KB (nRF52840) | Ample for sensor fusion + BLE + buffering. **No external RAM needed.** |
| **Flash (program)** | **1 MB on-chip** | Dual-bank for safe OTA (MCUboot) |
| **Flash (storage)** | **8–16 MB external QSPI** | Buffers rides offline (phone absent) → sync later; stores OTA images |
| **Secure element** | **Microchip ATECC608B** or **NXP SE050** (or use nRF TrustZone+CryptoCell) | Stores the per-device signing key; this is what makes rides *hardware-attested* and un-spoofable |
| **IMU (6-axis)** | Bosch **BMI270** or TDK **ICM-42688-P** | Accel + gyro for cadence, motion, anti-cheat |
| **Barometer (optional)** | Bosch **BMP390** | Elevation / grade for ride quality + anti-spoof |
| **Connectivity** | **BLE 5.x** (in the nRF) | Phone does GPS + upload in the tethered model |
| **Power cell** | **Li-ion ~500–1000 mAh** (cylindrical fits the bar-end) | At ~5–15 mA active draw, that's many long rides + weeks of standby |
| **Charging** | USB-C + charger IC (**TI BQ24074**) + fuel gauge (**MAX17048**) | Matches the USB-C in the photo |
| **Firmware** | **Zephyr RTOS** + **MCUboot** secure boot + signed OTA | First-class on Nordic; secure-boot is essential for attestation integrity |
| **Indicators** | 1–2 RGB LEDs (the end-face hole) | Pairing / charge / recording status |

### Why these numbers
- **RAM:** sensor sampling, a ring buffer for a ride, a BLE stack, and crypto signing all fit comfortably in 256–512 KB. You only need megabytes/gigabytes of RAM if you prove ZK on-device — which you shouldn't.
- **External flash:** lets the grip record rides even when the phone is dead or out of Bluetooth range, then sync — a real differentiator vs. a phone-only tracker.
- **Secure element:** the heart of the value. It signs each ride with a key that never leaves the chip, so the backend can trust "this ride came from a real, untampered Pedalshield node" — the hardware anti-cheat the app alone can't offer.

---

## If you later go standalone (no phone)
Add a **GNSS module** (u-blox MAX-M10) and a **cellular/LoRa** radio. This raises cost, power, and certification burden significantly — keep it as a Phase-3+ roadmap, not the first product. The tethered design ships first.

---

## Certification & compliance (budget for these)
- **FCC / IC / CE** radio certification (BLE intentional radiator) — use a **pre-certified BLE module** (e.g., a Nordic-based module) to slash cost/time vs. certifying a bare chip.
- **Battery:** UN 38.3 transport test; consider PSE/UL for the cell.
- **USB-C** compliance for the charging port.

## Suggested next steps
1. Lock the **attest-not-prove** decision (Approach A) — it sets RAM/SoC/cost.
2. Pick a **pre-certified nRF module** to cut certification time.
3. Define the **attestation message format** (what the grip signs) so the phone app + backend can verify it.
4. Get a **BOM + assembly quote** from a contract manufacturer at 100 / 1k / 10k units → feeds the crowdfunding unit economics.
5. Spec the **L-shaped lever module's** role (control/display/second sensor) — it may share the same MCU over a short cable or be a separate BLE peripheral.

> Bottom line on your RAM question: **for a proper edge node that attests rides, 256–512 KB of on-chip SRAM is the right answer — not megabytes or gigabytes.** Gigabytes of RAM only enter the picture if you insist on generating the zero-knowledge proof on the grip, which I'd strongly advise against — run that on the phone.
