# Pedalshield — 100 Riders Earning ZEC (TestFlight Path)

_June 11, 2026. Goal: 100 real riders on iPhones, paid shielded ZEC by ride
length. Fastest legal path is TestFlight external beta, not the public App
Store. Reasons below._

## Why TestFlight first, not the App Store

- **Apple guideline 3.1.5 (cryptocurrency):** apps paying crypto for user
  activity get heavy App Review scrutiny; "rewards for tasks" framing risks
  rejection (3.1.5(b)) and review cycles cost weeks. TestFlight external betas
  ship with a lighter review (usually 24–48h) and support up to 10,000
  testers. 100 riders is exactly what TestFlight is for.
- The public App Store submission is a Q4 project with positioning work
  (wallet-style framing, payouts described as "shielded reward settlement,"
  legal review). Don't let it gate the 100 riders.

## The dependency chain (in order — nothing else matters until each is done)

1. **Device loop proven (TODAY — the existing launch gate).** Real ride →
   verified → autonomous payout → txid on your phone. Blocked on you running
   Metro and riding. Everything below is downstream.
2. **Backend off your laptop.** 100 riders can't hit 192.168.0.62. Deploy
   `backend` binary + sqlite to a small VPS (Hetzner/Fly.io, ~$10/mo), HTTPS
   via Caddy, `PEDALSHIELD_*` env vars as on the Mac. Treasury key on the
   server = hot wallet: keep balance small, top up weekly (cap exposure to
   ~2 ZEC). 1–2 days of work.
3. **Mobile points at production URL** (config.ts), remove
   `NSAllowsLocalNetworking`. Trivial.
4. **EAS production build → App Store Connect → TestFlight.** You have the
   Apple Developer account and registered device already. `eas build
   --profile production --platform ios`, `eas submit`. Beta review: 1–2 days.
5. **Riders from the waitlist.** Polsia landing page collects emails →
   TestFlight public link. First 100 from Zcash community + local cyclists.
6. **Accrual settlement before 100 riders are active** (from SCALE_PLAN):
   per-ride on-chain payouts at 100 riders ≈ 1,000 tx/mo — workable but the
   mempool race bites. Minimum viable fix: per-rider accrual + threshold
   settlement, batched outputs. ~1 week of backend work. Can follow the first
   25 riders; must precede 100.

## Treasury math for 100 riders

- 100 riders × 10 rides/mo × 9 km × 0.0002 ZEC/km ≈ **1.8 ZEC/mo** (~$770 at
  $426) + ~0.1 ZEC fees. Current treasury: 0.0096 ZEC. **Fund ~2 ZEC/mo.**
- Knobs if that's too hot: drop ZAT_PER_KM (env var, no redeploy), lower
  per-ride cap, or cap rides/rider/day via the anomaly module (wire it in —
  it exists).

## Timeline overlay (vs TIMELINE.md)

- Jun 11–14: device loop + demo footage (unchanged — still the gate)
- Jun 15–19: VPS deploy + production build + TestFlight beta review
- Jun 20–28: first 25 riders (friends + Zcash Discord), demo video ships,
  hackathon assets
- Jul: accrual settlement lands → open TestFlight link to waitlist → 100
  riders. Hackathon submitted Jul 5 with *live beta users* — far stronger
  than a solo demo.
- Watch: **Ironwood activation late July** — spend-path rewrite becomes the
  drop-everything item when crates ship.

## TestFlight beta copy (paste into App Store Connect)

**Beta App Description:** Pedalshield is a privacy-first ride tracker. Your
GPS route is verified on your phone and never uploaded — only a verified
distance total leaves the device. Verified rides settle a small shielded
Zcash reward to the wallet address you provide. This beta requires an iPhone
with GPS, outdoor rides, and a Zcash shielded address (we suggest the free
Zashi wallet). Rewards are small and capped — this is a privacy product, not
an income app.

**Beta App Review Notes:** The app tracks bike rides using GPS/motion sensors,
scores ride authenticity entirely on-device, and submits only {distance,
score} to our server, which settles a capped reward (~$0.10–0.80) in Zcash to
the tester's own wallet. No accounts, no personal data collected, no purchases,
no token sale. Source: github.com/intelligrip/Pedalshield.

**What to Test:** Start a ride outdoors, ride ≥1 km, stop, paste your Zcash
address, confirm the payout txid appears and arrives in your wallet.

## Risks specific to this push

- Hot-wallet server key (mitigate: small balance, weekly top-up, withdraw cap)
- Sybil at 100 riders is human-checkable; wire the anomaly daily-cap anyway
- TestFlight rejection risk is low but nonzero: describe the app as a private
  ride tracker with shielded reward settlement; no "earn money" language in
  the beta description
