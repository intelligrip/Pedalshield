# Why the phone isn't enough

_The answer to "why doesn't the app just do this?" — the first question any
technical investor or licensee asks. Written as an argument, with the
counter-argument kept at the end rather than hidden._

---

## 1. Attestation proves the code is genuine. It does not prove the sensors are.

This is the argument that matters, and it is structural rather than a matter of
engineering effort.

App Attest proves our app is unmodified, running on real Apple hardware. It
says **nothing about whether the GPS feeding that app is real.** iOS location
can be simulated at the OS level — Xcode will push a synthetic location track to
a connected device, and the app receives it through the ordinary CoreLocation
API, indistinguishable from a real fix.

**An attested, unmodified Pedalshield will faithfully verify a completely
fabricated ride.**

No amount of software closes this. The sensor and the code both live on a
platform we do not control, and an attacker can sit between them. A dedicated
device with GNSS and IMU soldered to an MCU that signs at the point of capture
does close it: the measurement is signed before anything can intercept it.

Tier 0 in `ANTI_CHEAT_THREAT_MODEL.md` is not completable on a phone. That is
not a timing argument.

## 2. The physics gets better, and the physics is the product

A phone is a mediocre bicycle sensor, permanently:

- **Antenna position.** A phone sits low, shadowed by the bar, often under the
  rider's hands or in a bag. Poor sky view is a direct cause of the teleport
  spikes and excised segments the engine spends its effort defending against. A
  stem-mounted antenna has a clear view.
- **Dual-band GNSS.** A ZED-F9P-class receiver resists spoofing far better than
  a phone's single-band chip. Spoofing two bands coherently is a different order
  of difficulty from spoofing one.
- **Wheel speed via Hall sensor.** The one signal a phone can never have. A
  magnet on a spoke is near-unspoofable without physically spinning a wheel —
  direct mechanical evidence that a bicycle moved, rather than an inference from
  a radio signal.

Better inputs mean fewer false rejections, higher integrity scores, less
excision. That is not a feature; it is the core product working better.

## 3. Software moats leak. Supply chains don't.

The anti-cheat engine is closed source, but the techniques are reproducible by
any competent team, and a licensee holding our SDK can eventually build their
own. Hardware plus firmware plus a provisioned secure element is genuinely hard
to copy and creates switching costs a library never will.

## 4. It unlocks buyers software cannot reach

An insurer pricing risk on movement data needs a tamper-evident chain of
custody. *"An app reported this"* is not underwritable. Hardware attestation is
the difference between a wellness gimmick and a signal an actuary can use — and
that market is orders of magnitude larger than commute compliance.

**The device is not a product we sell. It is what moves every ride from a cheap
data tier to an expensive one.** That is the ROI case: a price multiplier on
volume we are already generating, not a hardware margin.

## 5. It fixes the product problems that cause churn

- Battery drain is the top complaint about any GPS tracking app
- Riders forget to press start; a device auto-starts on motion
- Phone in a bag means no usable cadence or vibration data
- Continuous background location is the permission that makes iOS users
  uncomfortable — and asking for less of it is on-brand

For a daily commuter, the rider we most need to retain, this is a materially
better product.

## 6. It is the discipline we already have

IntelliGrip scaled a physical bike-goods business to $300K in revenue selling to
cyclists. Hardware for cyclists is not a pivot into an unfamiliar field.

---

## The honest counter-argument

None of the above says **when**. Every point here is about what hardware
accomplishes; not one is about what it costs to get there with zero customers
and a treasury that only drains. Tooling, certification, inventory and COGS are
real, and they all land before revenue does.

The buyer identified in the deck — a program manager filing a compliance report
— does not want hardware. Handing them a device to distribute to employees makes
their job harder, not easier. Hardware serves the *second* buyer (insurers,
higher data tiers), not the first.

**The trigger that moves hardware up the priority list:** a buyer saying *"we'd
need tamper-evidence for that."* At that point it stops being a bet on a thesis
and becomes a spec from a customer, and it should be built immediately.

Until then the sequence stands: attestation (free, closes most of the gap),
then a pilot, then hardware — funded by the pilot rather than by hope.

## Cheapest possible test of the core premise

Before spending anything on hardware, move the phone mount higher on the bike
and ride the same route twice. If GPS quality visibly improves, §2 is validated
for the price of a mount — and that measurement is what justifies the whole
program later.
