# App Store listing — copy-paste pack

Everything for the public App Store product page, within Apple's exact
character limits. Honest-claims rule holds throughout. Pair with
`APP_STORE_SCREENSHOTS.md` (visuals) and `TESTFLIGHT_SUBMISSION.md` (review
notes). Character counts are shown so you can edit without overrunning.

---

## Name & subtitle

**App Name** _(max 30 chars)_
```
Pedalshield
```
_(11 chars)_

**Subtitle** _(max 30 chars — shows under the name in search & on the page)_
```
Ride private. Earn shielded.
```
_(28 chars)_

---

## Promotional text _(max 170 chars — editable any time without a new build)_
```
Get paid in private Zcash for real bike rides — and your route never leaves your phone. Non-custodial: your keys, your ZEC. Now in open beta.
```
_(139 chars)_

---

## Keywords _(max 100 chars, comma-separated, NO spaces after commas — wasted characters)_
```
bike,cycling,zcash,zec,crypto,privacy,ride,earn,rewards,fitness,gps,bicycle,web3,shielded,track
```
_(95 chars)_

> Don't repeat the app name or subtitle words here (Apple already indexes
> those). Don't use "free" or competitor names.

---

## Description _(max 4000 chars)_
```
Ride private. Earn shielded.

Most fitness apps are surveillance devices with a leaderboard — they trade you rewards for your location history. Heatmaps from these apps have exposed military bases, stalking victims, and people's home addresses. Pedalshield is the opposite. You get paid for riding, and your route never leaves your phone.

HOW IT WORKS
1. Connect your own Zcash wallet. Paste the Unified Address from a wallet you already control (like Zodl). Pedalshield is non-custodial — we never hold your keys or your funds.
2. Ride. Your GPS and motion sensors track the ride entirely on your device. An on-device anti-cheat engine scores it. Only an anonymous distance claim is ever sent — never your route.
3. Earn. An autonomous treasury sends real shielded ZEC straight to your wallet. No operator approves it. No one watches it.

PRIVACY IS THE PRODUCT
- Your route, GPS coordinates, and raw sensor data are processed only on your phone and are never uploaded. This is enforced in our open-source code and a unit test — not just a privacy policy.
- No account. No sign-in. No email or phone number required to ride and earn.
- No third-party analytics SDKs, no ad trackers.

NON-CUSTODIAL BY DESIGN
You bring a wallet you own. Rewards land in your address on the Zcash network. We never take custody of your money or your private keys, and you can disconnect your wallet any time.

HONEST BY DESIGN
We name our limits out loud:
- Payouts are small and capped — pegged to carbon value (about $0.006 per mile, the worth of ~1 lb of avoided CO2). This is privacy you can feel good about — not a money-printer.
- Anti-cheat is layered, not perfect. We catch cars, walks, and spoofs with defense-in-depth, and we publish what it doesn't catch.
- Zero-knowledge route proofs are on the roadmap; today's privacy comes from simply never transmitting your route.

OPEN SOURCE
Pedalshield is MIT-licensed and built in the open. Read every line, including the test that proves your route stays on your phone, at github.com/intelligrip/Pedalshield.

Ride private. Earn shielded.
```
_(~1,750 chars — well under 4000; room to add a city/launch line later.)_

---

## What's New _(version notes, max 4000 chars — for v1.0)_
```
First public beta of Pedalshield.

- Connect your own Zcash wallet (non-custodial) and earn real shielded ZEC for verified rides.
- On-device ride verification — your route never leaves your phone.
- Autonomous shielded payouts on Zcash mainnet.

This is an early beta. Payouts are small and capped on purpose — privacy is the product. Tell us what breaks: intelligripindustries@gmail.com
```

---

## URLs & category

| Field | Value |
|---|---|
| Support URL | https://pedalshield.app |
| Marketing URL | https://pedalshield.app |
| Privacy Policy URL | https://pedalshield.app/privacy/ |
| Primary category | Health & Fitness |
| Secondary category | Finance |
| Price | Free |

> Apple often routes crypto-reward apps toward Finance scrutiny. Leading with
> **Health & Fitness** (it is, fundamentally, a cycling app) is both accurate
> and the cleaner positioning.

> ⚠️ **BLOCKER — these URLs must actually resolve before you submit.** As of
> now they don't, and Apple rejects listings with a dead Privacy Policy URL:
>
> 1. **`https://pedalshield.app`** — was offline during the DNS propagation we
>    just fixed. Confirm both the bare domain and `www` load before relying on it.
> 2. **`https://pedalshield.app/privacy/`** — **not live yet.** The privacy
>    page exists only on the `sdk-upgrade` branch; your live Netlify deploy is
>    still the older version (last deployed Jun 13) and has no `/privacy/`
>    page. You must **redeploy the site** with the current `landing/` folder
>    for this URL to work.
>
> **To make `/privacy/` live**, do ONE of these:
> - Merge `sdk-upgrade` → your Netlify production branch (likely `main`) and
>   let Netlify auto-deploy — this also brings the new onboarding funnel live; or
> - In Netlify → Deploys, drag-and-drop the `landing/` folder for a manual deploy; or
> - Trigger a deploy of the `sdk-upgrade` branch from the Netlify dashboard.
>
> After deploying, open `https://pedalshield.app/privacy/` yourself and confirm
> it loads. Only then paste it into App Store Connect.

---

## App Privacy questionnaire (the "nutrition label")

Apple makes you declare what you collect. Answer truthfully — it must match
the privacy policy and the actual `ClaimPayload`. Based on what the app
really sends:

**Do you or your partners collect data from this app?** → **Yes** (minimal).

Declare these, all linked to delivering the reward, **not** used for tracking:

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Location (precise) | **Not collected off-device** | — | No | Route is processed on-device only and never transmitted. Do NOT declare Location collection — you don't receive it. |
| Coarse/other location | No | — | No | — |
| Financial info (wallet address) | **Yes** | No | No | App Functionality (where to send the reward). A public receive address. |
| Identifiers | No | — | No | No account, no device ID collected. |
| Usage data | No | — | No | No analytics SDK. |
| Contact info | No | — | No | Email only on the website waitlist, not in the app. |
| Diagnostics | No | — | No | — |

Key declarations:
- **App Tracking Transparency:** No tracking. You do not need an ATT prompt.
- **Location:** Because the route is verified on-device and never leaves the
  phone, you are **not** "collecting" location data under Apple's definition
  (you never receive it). The app still requests the iOS Location permission
  to *measure* the ride — that's a permission, not data collection. Be ready
  to explain this in review notes (already covered in TESTFLIGHT_SUBMISSION.md).
- The one thing you DO collect is the **Zcash Unified Address the user
  chooses to share** so you can pay them — declare it under Financial Info,
  linked to App Functionality, not used for tracking.

> If unsure on any row, declare conservatively and explain in review notes.
> The honest framing ("we deliberately don't collect your route") is a
> strength in App Review, not a liability.

---

## Permission prompt strings (Info.plist usage descriptions)

✅ Already set in `mobile/app.json` (iOS `infoPlist`), and they're good —
each says *why* and reinforces the privacy story, which helps in review:

- **NSLocationWhenInUseUsageDescription:** "Pedalshield uses GPS only
  on-device to verify your ride distance. Your route never leaves the phone."
- **NSMotionUsageDescription:** "Pedalshield uses motion sensors on-device to
  verify pedaling cadence. No motion data is uploaded."
- **NSLocalNetworkUsageDescription:** "Pedalshield connects to your local
  Pedalshield treasury backend over the local network to submit ride claims."

> Note: the local-network string mentions a *local* backend (from dev
> builds). In production the app talks to `api.pedalshield.app` over HTTPS,
> not the LAN — harmless, but you may want to soften that string to avoid a
> reviewer question. Low priority.

---

## Where this fits

This is for the **full public App Store listing** (GO_LIVE step 5). The
faster **TestFlight public link** (step 3) doesn't need most of it. Have this
ready so that when you submit for full App Review, the product page is
already written — just paste, attach the screenshots, and answer the privacy
questionnaire from the table above.
```
