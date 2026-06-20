# Go live: turn the website into real onboarding

The website now has a full onboarding funnel (Install → Connect your Zcash
wallet → Ride & earn). It runs in **waitlist mode** until an installable
build exists. Flipping it to **install mode** is one line of code once your
iOS build is public. Here is the whole path, in order.

## The one thing only you can do

Everything below runs on **your Mac** (EAS build + Apple submission need
your signing identity and Apple account). Budget ~1 day of mostly-waiting.

## 1. Rebuild the app with the wallet feature

The connect-your-wallet flow added a native module (AsyncStorage), so the
app must be rebuilt — a JS-only update won't link it.

```bash
cd ~/Pedalshield/mobile
git checkout sdk-upgrade
git pull
npx expo install @react-native-async-storage/async-storage expo-keep-awake   # link native modules
npm install
eas build --platform ios --profile production                 # ~20–40 min in the cloud
```

When it finishes, EAS gives you an `.ipa` URL.

## 2. Smoke-test on your phone (don't skip)

Install the build (TestFlight internal, or the `.ipa` via the EAS link) and
check the wallet flow end to end:

- Home shows **"Connect your Zcash wallet"** (not `u1mock…`).
- Paste a real Unified Address from Zashi → it saves, shows "Connected".
- Force-quit and reopen → the address is still there (persistence works).
- Do a short ride → it pays out to that address; Home shows lifetime ZEC.

If the address forgets itself on restart, AsyncStorage didn't link — rerun
`npx expo install @react-native-async-storage/async-storage` and rebuild.

## 3. Get a public TestFlight link (the fast lane)

In App Store Connect → your app → **TestFlight**:

1. Upload the build (Transporter or `eas submit -p ios`).
2. Add it to **External Testing** and submit for **Beta App Review**
   (usually 1–2 days; this is lighter than full App Store review).
3. Once approved, enable the **public link** — a URL like
   `https://testflight.apple.com/join/XXXXXXXX`. Anyone who taps it installs
   (up to 10,000 testers). This is how you onboard real riders first.

> Crypto note: the same Guideline 3.1.5(b) considerations from the App Store
> submission apply. Keep the framing honest — rewards are small/capped,
> privacy is the product, riders bring their own wallet (non-custodial).

## 4. Flip the website to install mode (1 line)

Open `landing/beta/index.html`, find this near the bottom:

```js
var INSTALL_URL = ''; // e.g. 'https://testflight.apple.com/join/XXXXXXXX'
```

Paste your public TestFlight link between the quotes and redeploy. That
single change automatically:

- turns every **"Get the app"** button (nav, hero, onboarding) into
  **"Install on iPhone"** linking straight to TestFlight,
- updates the onboarding copy from "opening soon" to "tap to install",
- re-points the QR code at the install link.

Deploy: the site is on Netlify — push `landing/` (or drag the folder into
the Netlify deploy box) and `pedalshield.app` updates in ~1 minute.

## 5. (Later) Full App Store listing

Submit the same build for normal App Review for a public App Store page
(typically 3–10 days; budget 1–3 weeks if they ask crypto questions). When
it's live, swap `INSTALL_URL` to the App Store URL — same one-line flip.

## Where things stand

| Piece | Status |
|---|---|
| Connect-wallet code + tests | Done (`sdk-upgrade`, 51/51 tests, tsc clean) |
| Website onboarding funnel | Done — live in waitlist mode, one line from install mode |
| Rebuild with AsyncStorage | **You — step 1** |
| Device smoke test | **You — step 2** |
| TestFlight public link | **You — step 3** (1–2 day review) |
| Flip `INSTALL_URL` + redeploy | **You — step 4** (1 minute) |

Net: real riders can be onboarding via TestFlight **within roughly a week**,
gated almost entirely on Beta App Review turnaround.
