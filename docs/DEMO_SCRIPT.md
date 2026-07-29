 # Pedalshield — demo video script

Target length: **3:30 to 4:30**. Hackathon rules ask for a short walkthrough; we leave headroom and stay under 5 minutes. Shoot vertical-friendly so we can also clip a 60-second teaser for socials.

## Pre-roll prep

- App launched on a real device or recent simulator. `MockWallet` pre-seeded with 0.0142 ZEC; `Privacy`, `Home`, and `Ride` tabs reachable.
- Terminal panes ready in two windows:
  - **Pane A:** `cd Pedalshield/mobile`
  - **Pane B:** `cd Pedalshield/zcash-service`
- Block explorer tab open (zcashblockexplorer.com or equivalent) on the treasury's mainnet shielded outgoing transaction.

## Shot list

### 0:00 — 0:15 · Hook + pitch (15 s)

**Title card:** PEDALSHIELD · Ride private. Earn shielded.

**Voiceover:**
> Move-to-earn fitness apps either sell your data — or collapse. Pedalshield is the first that does neither. Shielded ZEC for verified miles, with a route that never leaves your phone.

### 0:15 — 0:45 · The anti-Strava manifesto (30 s)

**Show:** the **Privacy** tab. Slowly scroll the "WHAT WE NEVER COLLECT" list — five red ×s. Then "WHAT LEAVES YOUR DEVICE" — four green ✓s.

**Voiceover:**
> Strava monetises your routes. We can't, because we never see them. The on-device verifier produces a single number — your verified distance — and that's all the network ever sees. We prove this in code.

### 0:45 — 1:30 · The ride loop (45 s)

**Show:** Tab to **Home**. Vault balance visible, streak card. Tap into **Ride**. Hit "Start ride."

**Voiceover:**
> Open the app. Tap Start.

**Hold on the live screen** for ~10 seconds — distance climbing, time counting, "Route held on device only" indicator green.

**Tap Stop.**

**Voiceover:**
> When you stop, the phone verifies the ride locally. Watch — verified, 0.18 kilometers, integrity score 0.97. Real signal from the sensors. Real anti-cheat.

### 1:30 — 2:15 · The payout (45 s)

**Show:** the post-ride card. The "Shielded payout — FROST 2-of-3 ceremony queued" line appears. Tap **Done**. Back on **Home**, vault balance has increased.

**Voiceover:**
> Behind that line, a FROST 2-of-3 ceremony threshold-signs a shielded transaction. No single party can pay you. No single party can drain the treasury. And the payout lands as Orchard shielded ZEC — amount and recipient private on-chain.

### 2:15 — 2:55 · Proof in tests (40 s)

**Cut to Pane A.** Run:

```bash
node --test src/verification/__tests__/*.test.ts \
              src/wallet/__tests__/*.test.ts \
              src/ride/__tests__/*.test.ts
```

**Zoom on the final block:**
```
# tests 34
# pass 34
# fail 0
```

**Highlight one test name on screen:** `toClaimPayload - privacy guarantees > never includes geo coordinates`.

**Voiceover:**
> Thirty-four tests. The most important one asserts, with JSON substring checks, that the outgoing claim payload cannot contain latitude, longitude, accelerometer, or barometer keys. The privacy guarantee is enforced by code.

### 2:55 — 3:30 · Proof in cryptography (35 s)

**Cut to Pane B.** Run:

```bash
cargo run --bin treasury_demo
```

**Zoom on the output:** keygen line → ceremony line → "external verification passed".

**Voiceover:**
> Treasury demo. Real FROST 2-of-3 keygen. Real round-one commitments. Real round-two signature shares. Real aggregation. Real external verification against the group key. Today on Ed25519; we swap the ciphersuite for FROST-over-RedPallas to finalise ZIP-312 Zcash spend auth.

### 3:30 — 4:00 · Mainnet receipt (30 s)

**Cut to the block explorer tab.** Show the shielded transaction.

**Voiceover:**
> Here it is on Zcash mainnet. Amount: private. Recipient: private. Treasury custody: FROST. Hackathon rule one — interact with Zcash mainnet — satisfied.

### 4:00 — 4:30 · Close (30 s)

**Show:** GitHub repo URL on screen + project tagline.

**Voiceover:**
> Pedalshield. Joyful, fair, private. Built for the ZecHub Hackathon 2026, Games track. Repo and submission at github.com/ZecHub/zechub/tree/main/Hackathon/2026/Pedalshield. Ride private. Earn shielded.

**End card:** Pedalshield logo + tagline + repo URL.

## Filming notes

- Screen recordings: prefer device-real recordings over simulator; the gyro / battery indicator give it credibility. Simulator is acceptable as fallback.
- Voiceover: friendly, not breathless. Casual cyclists are the audience — not crypto traders.
- Music: dark synth, minimal beat, low volume under VO. Royalty-free; Kevin MacLeod's *Inspired* or similar.
- Subtitles burned in for accessibility.
- Export 1080×1920 (vertical) and 1920×1080 (landscape). The 1080×1920 cut becomes the 60-second teaser.

## Teaser cut (60s)

Re-cut from the master:
- 0:00–0:10 — Title + tagline
- 0:10–0:25 — Privacy tab
- 0:25–0:40 — Ride start → stop → verified
- 0:40–0:50 — `# pass 34` test screen
- 0:50–1:00 — Repo URL + "Ride private. Earn shielded."

## Thumbnail directions

Three options, pick the one with strongest contrast on the platform thumbnail row:

1. **Vault hero** — close crop of the Home `SHIELDED VAULT` card, the magenta balance number filling 2/3 of the frame, Pedalshield wordmark above. Caption: "Your routes vanish."
2. **Privacy wall** — three of the red × items from the Privacy tab, stacked, with the green ✓ "Verified distance" item at the bottom. Caption: "What we don't collect."
3. **Terminal proof** — split screen: phone showing the Ride tab, terminal showing `# pass 34`. Caption: "Tested. Private. Mainnet."

My pick: **3 (terminal proof)** for the judge audience, **1 (vault hero)** for the social teaser.
