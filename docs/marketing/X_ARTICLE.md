# I built an app that pays you private money to ride your bike — and it's live on Zcash mainnet

---

3 years ago this was an idea. Today, if you finish a bike ride on Pedalshield, an autonomous system pays you real, shielded Zcash — and your route never leaves your phone.

That's not a roadmap promise. It already happened, on mainnet, with a transaction anyone can look up:

`c9d0864c10ed44e011e39716f0fc7cdb1fe913fe0d614129a07961b2578b37a5`

No human approved that payout. No one watched the ride. The phone verified it, the backend built and broadcast a shielded Orchard transaction, and the money landed. That's the whole product in one sentence — but let me back up.

## The problem I couldn't unsee

Your fitness app is a surveillance device with a leaderboard. Strava-style heatmaps have exposed military bases, stalking victims, and people's home addresses. The deal we all accepted was: rewards for your data. Your route, your patterns, where you live, when you're not home — uploaded, stored, monetized.

I think that deal is robbery. So I built the opposite.

## How Pedalshield works

1. **You ride.** GPS and motion are tracked entirely on your device.
2. **Your phone verifies it.** An on-device anti-cheat engine scores the ride. The only thing that ever leaves your phone is an anonymous distance claim — never the route. That's enforced by a unit test, not a privacy policy.
3. **You get paid, shielded.** An autonomous treasury sends real Zcash to a wallet you already control. It's non-custodial — I never hold your keys or your funds.

## What you're actually earning

Here's the part I'm proudest of: the reward isn't an arbitrary handout. It's pegged to **carbon value.**

Every mile you ride instead of drive keeps about one pound of CO2 out of the air. That avoided pound is worth roughly $0.006. So each verified mile pays you that — the dollar value of the carbon you didn't emit, in private money. You're not being paid to farm a token. You're being paid for a real thing you did for the world.

## The honest part

I'm going to tell you the limits out loud, because that's the entire ethos:

- Payouts are small and capped. This is privacy you can feel good about, not a money-printer.
- Anti-cheat is layered, not perfect — and I publish what it doesn't catch.
- Zero-knowledge route proofs are on the roadmap; today's privacy comes from simply never transmitting your route.
- There is no token. Just shielded ZEC, and an app.

## Why this was hard (and why I built it anyway)

The standard Zcash wallet tooling was mid-refactor, so I hand-rolled the shielded spend pipeline myself — tree state, chain scan, note selection, proving, signing, broadcast — directly against the Orchard protocol. The night I got the deployed system to autonomously pay a real ride, I spent two hours convinced I'd lost the treasury's funds. I hadn't; the coins were safe the whole time, sitting in a change note my scanner couldn't see. I fixed it, and the next ride paid out clean.

I'm telling you that because "it works" isn't a slide — it's a thing that broke, and got fixed, on real money.

## Why it matters beyond me

Privacy-preserving digital cash only matters if ordinary people actually use it. Pedalshield gives a regular cyclist a shielded address and a recurring, real-world reason to receive private payments. Every paid ride is genuine demand for shielded money that wouldn't otherwise exist. Mining funds riding; riding funds Zcash.

## Ride private. Earn shielded.

It's in open beta now. If you've got an iPhone and a bike, you can try it:

- Install: **pedalshield.app** (TestFlight)
- Code (it's open source, MIT — read the test that proves your route stays on your phone): **github.com/intelligrip/Pedalshield**

Built for the ZecHub Hackathon 2026. I'd love your feedback — especially the brutal kind.

— Samuel B. Newman, CEO Intelligrip Industries
