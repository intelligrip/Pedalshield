# Verified bike trips, without collecting anyone's location

**A free pilot offer — Bend, Oregon**
Pedalshield · hello@pedalshield.app

---

## The problem you already have

Commute programmes are measured with **self-reported data** — a survey at the
end of a quarter, or an app where someone taps "I biked today." It is the
accepted standard because the alternative has always been worse: tracking
people's location.

That leaves programme managers with two bad options:

- **Trust the self-report.** Cheap, and unverifiable. Nobody knows the real
  number, incentives pay out on the honour system, and the data is weak
  evidence for funding requests or climate reporting.
- **Collect location data.** Accurate, and now you are holding a database of
  where your employees or students go. Legal doesn't like it, participants
  like it less, and it is a breach waiting to happen.

## What we do differently

Pedalshield verifies the ride **on the rider's phone**. GPS, accelerometer,
gyroscope and barometer are read on-device and checked against the physics of
actually riding a bicycle — speed envelopes, pedalling cadence, road
vibration, and whether the motion sensors agree with the GPS trace.

What leaves the phone is a **signed verdict**: distance, an integrity score,
nothing else. No coordinates. No route. No map of anyone's life.

**You get the verified number. Nobody has to hold the data.**

## What that gives a programme

- **Verified trip counts** you can put in a report and defend
- **No location data in your systems** — nothing to secure, retain or disclose
- **Higher participation**, because riders aren't asked to be tracked
- **Riders choose their own sharing level.** The default shares nothing but a
  verdict. If a rider opts in to contribute route data for planning, the
  start and end of every ride are removed automatically, with no setting to
  turn that off. Participation is never conditional on sharing more.

## Proof it works

- Running on Zcash mainnet today, paying verified riders autonomously with no
  operator approving anything
- The privacy contract is **open source (MIT)** with a test that fails the
  build if any location or sensor field could appear in a claim
- The anti-cheat **threat model is published**, including what it does not yet
  catch: <https://github.com/intelligrip/Pedalshield/blob/main/docs/ANTI_CHEAT_THREAT_MODEL.md>

## Where we honestly are

Early. The verification engine is real and running, and it has been tuned
against synthetic attacks and a small number of real rides. It has **not** yet
been validated at the scale of a real programme — which is precisely what a
pilot is for, and why the pilot is free.

We would rather tell you that now than have you discover it later.

## The pilot

| | |
|---|---|
| **Who** | 20–50 riders from your programme |
| **How long** | One term / 8–12 weeks |
| **Cost** | None |
| **You provide** | Access to participants and your current self-reported numbers |
| **You get** | Verified trip counts, a comparison against self-report, and a written summary you can use |
| **You keep** | Everything. No lock-in, no data obligation, no contract |

The comparison is the interesting part: **how far apart are the reported
numbers and the verified ones?** Nobody in this field actually knows, and
whoever finds out first has something worth publishing.

## Why Bend

Transportation is **44% of Bend's emissions**, and the Community Climate
Action Plan targets a 270,000 tonne CO₂e reduction. Mode-shift programmes are
part of that plan, and their measurement is currently a survey.

We are based here. We would rather prove this at home first.

---

**hello@pedalshield.app** · <https://pedalshield.app> ·
<https://github.com/intelligrip/Pedalshield>
