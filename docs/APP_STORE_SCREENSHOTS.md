# App Store / TestFlight screenshots — spec + shot list

What Apple requires, and exactly which Pedalshield screen goes in each slot.
Note: TestFlight itself doesn't require marketing screenshots, but the full
App Store listing does — and capturing them now means step 5 (public App
Store) is ready, not a scramble.

## Sizes Apple requires (2026)

You only have to upload **one iPhone size**: the largest. Apple scales it
down for every smaller iPhone automatically, so a single 6.9" set covers the
whole iPhone lineup.

| Slot | Portrait pixels | Devices it represents |
|---|---|---|
| **6.9" iPhone (required)** | **1320 × 2868** | iPhone 16/17 Pro Max, Plus |
| 6.9" accepted fallbacks | 1290 × 2796, 1260 × 2736 | 6.7" Pro Max / Plus |
| 6.5" (optional) | 1242 × 2688 | older Max phones |
| iPad 13" (only if you ship iPad) | 2064 × 2752 | iPad Pro |

Pedalshield is iPhone-only, so you need just the **1320 × 2868** set.

**Format rules:** PNG or JPEG, RGB color space, **no transparency / no alpha
channel**. 1–10 screenshots per size. The **first 2–3 show in search results**
— lead with your strongest.

## Easiest way to capture at the exact size

Run the app in the **iOS Simulator on "iPhone 16 Pro Max"** (a 6.9" device).
Its screenshots are natively 1320 × 2868 — no resizing needed.

```bash
cd ~/Pedalshield/mobile
npx expo run:ios --device "iPhone 16 Pro Max"
# In the Simulator: Cmd+S saves a PNG to your Desktop at the correct size.
```

Capture on a real device only if you want live GPS in the ride shot; a
physical 6.9" phone screenshot is also 1320 × 2868. Make sure no personal
data (a real wallet balance, your name) is on screen.

## The shot list (6 screens, in order)

Lead with the promise, then prove it. Each maps to a real screen in `mobile/`.

1. **Home — the hook.** `HomeScreen` with a wallet connected and lifetime ZEC
   showing. Caption: **"Ride private. Earn shielded."**
2. **Connect your wallet — the trust moment.** The `ConnectWalletCard`
   "Connect your Zcash wallet" state. Caption: **"Non-custodial. Your keys,
   your ZEC — we never hold either."**
3. **Ride tracker — the privacy claim.** `RideTrackerScreen` mid-ride.
   Caption: **"Your route never leaves your phone."**
4. **Payout pipeline — the proof.** `PayoutCard` showing the autonomous
   Orchard payout stages + a real txid. Caption: **"Real shielded ZEC, paid
   automatically on Zcash mainnet."**
5. **Privacy dashboard — what stays on device.** `PrivacyDashboardScreen`.
   Caption: **"See exactly what leaves your phone. (Spoiler: not your route.)"**
6. **Leaderboard — the community (optional).** `LeaderboardScreen`. Caption:
   **"Compete on distance, not on data."**

Minimum is 3 — shots 1, 2, 4 alone tell the whole story (private → your
wallet → real payout). Add 3, 5, 6 if you have them.

## Captions (optional but worth it)

Apple screenshots are stronger with a short headline bar above the device
frame. The captions above are written to fit. Keep them under ~6 words, high
contrast, same green/ink palette as the website (`--green #12805C`,
`--ink #15201C`). Tools like Screenshots.pro, Previewed, or a quick Figma
frame can add them; or ship raw screens for the beta and add captions for the
public launch.

## Honest-claims check (must hold in every shot)

- Don't show a large/inflated balance — payouts are small and capped by design.
- The txid in shot 4 must be a real one (e.g. `a64f2b15…2db2f1d8`), not a mockup.
- No "get rich" framing. Privacy is the product, not yield.

## Where this fits

This is for the **full App Store listing** (GO_LIVE step 5). For the faster
**TestFlight public link** (step 3), you don't need these — just the build +
the copy-paste pack in `TESTFLIGHT_SUBMISSION.md`. Capture these while review
is pending so the App Store page is ready the moment you submit it.
