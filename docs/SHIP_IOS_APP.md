# Ship the free Pedalshield iOS app — checklist

_You have an Apple Developer account, so this is mostly mechanical. Goal: get the free app into TestFlight, then the App Store. Mobile app is `mobile/` (React Native + Expo SDK 50). EAS is already configured (project `b19e40fc…`, owner `sbnewman`, bundle id `com.pedalshield.app`). New icon installed at `mobile/assets/icon.png`._

## ⚠️ Two real blockers — handle these BEFORE you build

**1. The backend isn't deployed.** `eas.json` production sets `EXPO_PUBLIC_BACKEND_URL` to a placeholder (`https://api.pedalshield.example.com`). The app submits ride claims + payouts to that backend — so until it's a real, public HTTPS endpoint, the app does nothing for a reviewer or a user. **Deploy it first** (use the `deploy/` kit: systemd + Caddy on a VPS), get a real URL (e.g. `https://api.pedalshield.app`), and set it in `eas.json` before building.

**2. Apple's crypto rules (Guideline 3.1.5(b)) are a genuine risk to the reward model.** Two parts:
- **(b)(i) Wallets / crypto storage** must come from a developer enrolled as an **Organization**, not an Individual. Confirm your Apple Developer account is an Organization account (needs a D-U-N-S number). If it's Individual, fix this early — it can take days.
- **(b)(iv)** says apps **"may not offer currency for completing tasks."** Apple's examples are referral/download/social tasks, but **"earn ZEC for rides" can be read as offering cryptocurrency for completing a task** — a real rejection risk. Mitigations to plan now: lead with the *privacy ride tracker* (rewards secondary, not "earn money"); pay out to the user's **own external wallet** (reduces in-app wallet exposure); write clear reviewer notes; and be ready to iterate. Worst case, the iOS v1 ships as the private tracker with the reward mechanic handled compliantly. **Not legal advice — verify against the current guidelines / counsel before submitting.**


## 0. Prerequisites
- [ ] Apple Developer Program active ($99/yr) ✅ (you have this)
- [ ] Install EAS CLI: `npm install -g eas-cli` then `eas login`
- [ ] Decide bundle identifier (e.g. `app.pedalshield.ios`) and app name ("Pedalshield")

## 1. Configure the production build (EAS Build)
- [ ] In `mobile/`, run `eas build:configure`
- [ ] Set app icon (1024×1024, no alpha), splash screen, version (1.0.0) and build number in `app.json`/`app.config`
- [ ] Confirm background-location + motion usage strings in `Info.plist` (see §5)
- [ ] `eas build --platform ios --profile production`
- [ ] (EAS can auto-manage signing certs/provisioning — let it, unless you prefer manual)

## 2. App Store Connect record
- [ ] Create the app in App Store Connect (matching bundle id)
- [ ] Category: Health & Fitness (primary), Navigation (secondary)
- [ ] Keywords / subtitle for ASO: "private ride tracker", "bike", "cycling", "no tracking", "Zcash"
- [ ] Support URL: https://pedalshield.app · Marketing URL: https://pedalshield.app
- [ ] Age rating questionnaire

## 3. Privacy labels — your marketing weapon
- [ ] App Privacy section: select **"Data Not Collected"** (truthful — route never leaves the device)
- [ ] Make this a headline in the listing and a screenshot caption, not fine print
- [ ] Have a one-paragraph privacy basis ready in case review asks how rewards work without data

## 4. Store assets
- [ ] Screenshots (6.7" + 6.5" + 5.5" or use a framing tool): hero the privacy promise, the ride flow, and the real shielded payout with txid + explorer link
- [ ] App preview video (optional, strong): the 30–60s demo loop
- [ ] Description: lead with "Ride private. Earn shielded." + the Strava-counterexample framing; be honest (small payouts, ZK roadmap)

## 5. Background tracking + battery (the make-or-break)
- [ ] `NSLocationWhenInUseUsageDescription` + `NSLocationAlwaysAndWhenInUseUsageDescription` with honest copy ("track rides; your route never leaves your phone")
- [ ] `NSMotionUsageDescription` for auto start/stop
- [ ] Enable background modes: location updates
- [ ] Implement/verify: motion-activity auto start/stop, efficient location sampling, graceful behavior when backgrounded — test battery drain on a real ride before submitting

## 6. TestFlight (beta)
- [ ] Upload the production build; complete export-compliance (likely "uses standard encryption" → exempt, but confirm)
- [ ] Add internal testers (you) + external testers (warmest waitlist segment from Formspree)
- [ ] Collect crash + battery telemetry; fix top issues before public release

## 7. Submit for App Store review
- [ ] Provide reviewer notes: explain rewards are small ZEC payouts; no account/data required; how to test a ride
- [ ] Submit; expect possible questions on crypto rewards — respond with the honest, no-token, no-yield framing
- [ ] On approval: release (phased rollout recommended)

## 8. After launch
- [ ] Wire App Store link into pedalshield.app (replace/augment the waitlist CTA with "Download on the App Store")
- [ ] Repoint the QR code to the App Store listing
- [ ] Android next: Google Play Console ($25 one-time), `eas build --platform android`, same listing assets

---
**Critical-path note:** §5 (battery-safe background tracking) is the real risk, not the store paperwork. An always-on tracker that drains the phone gets deleted. This is exactly the load the BLE edge node offloads later — but the phone-only app must nail it first.
