# TestFlight submission — copy-paste pack

Everything you paste into App Store Connect for **External Testing** + Beta
App Review. Each block is ready to drop into the matching field. Keep the
honest-claims rule intact — it's also your best defense in review.

---

## 1. Beta App Description
_(App Store Connect → TestFlight → Test Information → "Beta App Description".
Public — testers see this on the TestFlight link page.)_

```
Pedalshield pays you private Zcash (ZEC) for real bike rides — and your route never leaves your phone.

Most fitness apps are surveillance devices with a leaderboard: they trade you rewards for your location history. Pedalshield is the opposite. Your GPS route is verified entirely on your device and is never uploaded. Only an anonymous distance claim is sent — enforced in code, not just a privacy policy.

How it works:
1. Connect your own Zcash wallet (Zodl, or any wallet) by pasting its Unified Address. Pedalshield is non-custodial — we never hold your keys or your funds.
2. Ride. GPS and motion sensors track you locally; an on-device anti-cheat engine scores the ride.
3. Earn. An autonomous treasury sends shielded ZEC straight to your wallet — no operator approves it, no one watches it.

Honest by design: payouts are pegged to carbon value (~$0.006/mile, ~1 lb avoided CO2), small and capped. Privacy is the product, not yield. This is a beta — expect rough edges, and tell us about them.

Open source (MIT). Built for the ZecHub Hackathon 2026.
```

---

## 2. What to Test
_(TestFlight → "What to Test" — the note testers see for this build.)_

```
Thanks for testing Pedalshield! Please focus on:

CONNECT YOUR WALLET
- On the Home tab, tap "Connect your Zcash wallet" and paste your wallet's Unified Address (starts with u1). Confirm it saves and shows "Connected."
- Don't have a Zcash wallet? Install the free Zodl app, copy your receive address, and paste it.
- Force-quit and reopen the app — your wallet should still be connected.

RIDE + EARN
- Start a ride from the Ride tab and bike for a few minutes outdoors (enable Precise Location + Motion & Fitness when asked).
- Finish the ride and submit the claim. Confirm a payout appears and "Lifetime rewards" on Home updates.

WHAT WE WANT TO KNOW
- Did your route data ever appear to leave the device? (It shouldn't.)
- Any zero-distance rides, crashes, or screens that won't scroll?
- Was the wallet connection clear and trustworthy-feeling?

Payouts are tiny and capped on purpose — this is about privacy, not income. Send feedback via TestFlight's screenshot/feedback button. Thank you!
```

---

## 3. Notes for Beta App Review (Apple reviewer)
_(TestFlight → Test Information → "Review Notes". Private — only Apple's
reviewer sees this. This is where you get ahead of the crypto guideline.)_

```
WHAT THIS APP IS
Pedalshield rewards verified bike rides with small amounts of Zcash (ZEC). It is non-custodial: the app does not hold user funds or keys. Users connect a wallet they already control by entering its public Unified Address; rewards are sent to that external address by our backend.

HOW TO TEST THE CORE FLOW (no account or sign-up required)
1. Launch the app. On the Home tab, tap "Connect your Zcash wallet."
2. Paste this valid test Unified Address:
   u19r0gg89utgp9kcqtdasfyfc6nds5sc6tgzny2sgvrsuyw3z97kkg45h87gufsamfhmyxfykg6amlk3lp0ynlc9wgxx60v9gdsuap0zk9
   (It will validate and show "Connected." This is a public receive address; pasting it exposes nothing sensitive.)
3. Go to the Ride tab and start a ride. For a quick check in the office, you can confirm the UI flow without biking; for a full test, a short outdoor ride produces a distance claim and a reward.

COMPLIANCE NOTES (Guideline 3.1.5(ii))
- The app facilitates ZEC transmission only on Zcash mainnet, to an address the user controls. There is no in-app currency purchase or sale, no exchange, and no fiat.
- Rewards are funded by us, are small and capped, pegged to carbon value (~$0.006/mile = ~1 lb avoided CO2), and are not a payment for downloads, reviews, or social actions.
- We operate under an Apple organization (company) account, as required for crypto-related apps.
- No login, no personal data collection. GPS route data is processed only on-device and is never transmitted (verifiable in the open-source repo).

CONTACT
intelligripindustries@gmail.com — happy to answer any questions or walk through the flow live.
Source: github.com/intelligrip/Pedalshield
```

---

## 4. Other fields you'll be asked for

| Field | Value |
|---|---|
| Feedback email | intelligripindustries@gmail.com |
| Marketing URL | https://pedalshield.app |
| Privacy Policy URL | https://pedalshield.app/privacy/ (live once you redeploy the site) |
| Sign-in required? | No — no account needed |
| Demo account | Not applicable (no login) |
| Beta App Review contact | Your name + intelligripindustries@gmail.com |

> **Privacy Policy:** Done — a short, honest policy now lives at
> `landing/privacy/index.html` and resolves at `https://pedalshield.app/privacy/`
> once you redeploy the site (Netlify publishes the `landing/` folder). It
> covers on-device route processing, the non-custodial model, no-account use,
> exactly what the backend receives, the waitlist email, and deletion requests.
> Make sure the redeploy is live before you paste the URL into App Store Connect.

---

## 5. Submission order (matches GO_LIVE_ONBOARDING.md)

1. Upload the rebuilt `.ipa` (with the wallet feature) via Transporter or `eas submit -p ios`.
2. Add it to **External Testing**, paste blocks 1–3 above into the matching fields, fill block 4.
3. Submit for **Beta App Review** (1–2 days typical).
4. On approval, enable the **public link** and paste it into `INSTALL_URL` in `landing/beta/index.html`; redeploy. Onboarding is live.
```
