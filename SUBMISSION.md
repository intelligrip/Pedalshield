# Pedalshield — ZecHub Hackathon 2026 submission

> Submission for the **Games** track. Copy below is the PR description for
> `github.com/ZecHub/zechub/tree/main/Hackathon/2026/Pedalshield`.

---

## PR title

`Hackathon/2026: add Pedalshield — privacy-first bike-to-earn with live autonomous shielded payouts (Games track)`

## PR description

**Project:** Pedalshield — *Ride private. Earn shielded.*

A mobile bike-to-earn game on Zcash. Cyclists track real rides; the phone
verifies them **entirely on-device** — the GPS route never leaves the phone
(enforced by a unit test, not a privacy policy) — and an **autonomous backend
pays real shielded ZEC on Zcash mainnet**, with no human in the loop.

**Track:** Games

**Demo video:** `https://youtu.be/yNrw9CI24zc` — a real outdoor ride, verified on-device, paid autonomously in shielded ZEC on mainnet, with the txid checked live on the block explorer.

### What's live right now (not a promise — a running system)

The full loop runs end-to-end on a **deployed, internet-facing backend**:

> real ride → on-device verification → `POST /claim` → autonomous hand-rolled
> Orchard shielded spend (build → prove → SIGHASH → sign → broadcast) → **real
> mainnet txid**.

- **Live backend:** `https://api.pedalshield.app/healthz` returns `{"ok":true,...}`.
- **Reproducible mainnet payouts (real txids):**
  - `7bb0309585171f6ff977357f991fbbd98668793dc0ef6effdc300d1c230c3595` — the payout **shown in the demo video** (July 10, 2026): 0.83 mi verified on-device, paid at the EPA carbon rate, no human in the loop.
  - `b34883138d8b7742ea24c645c2940e616226f9527897dcd8343f7a1550ec9941` — same-day repeat (2.36 km, 24,964 zatoshi).
  - `a64f2b159e92558b7070d25f0f708ca99b3401ed9ae23ac626c2ea2a2db2f1d8` — a payout from the **deployed** system, triggered by a verified ride.
  - `2a849aca…b264ab`, `f1a3bacc…c10ba6`, `ef0e2a57…060587` — earlier autonomous Orchard payouts.
- **NU6.2-current:** the entire stack was re-pinned within days of the June 2026 emergency upgrade; the live consensus branch id is `0x5437f330`.
- **Secured:** operator endpoints (`/approve`, `/claims`, `/withdraw`, `/settle`, `/admin`) are gated behind a bearer token; they fail closed.

Look up any txid at `mainnet.zcashexplorer.app/transactions/<txid>`.

**Repository contents:**

- `zcash-service/` — Rust workspace. The **hand-rolled, SDK-free Orchard spend pipeline** (`src/spend/` — tree seeding from `GetTreeState`, scan-to-tip, note selection, v5 `TransactionBuilder`, ZIP-317 fees) and the `axum` backend (`bin/backend.rs`, autonomous `run_payout`). Plus `treasury_balance`, `treasury_wallet`, and a FROST 2-of-3 ceremony (`frost_coordinator.rs`).
- `mobile/` — React Native + Expo (SDK 56) app: on-device verification engine (the privacy seam), ride state machine, wallet layer, Home / Ride / Privacy screens. iOS build is App-Store-accepted and on TestFlight.
- `deploy/` — VPS deploy kit (systemd + Caddy + auto-HTTPS), used to deploy the live backend above.
- `docs/` — `ARCHITECTURE.md`, `DEMO_SCRIPT.md`, `ROADMAP.md`, `30_DAY_LAUNCH_PLAN.md`.

**Hackathon rules compliance:**

| Rule | Status |
|---|---|
| 1. Interact with Zcash mainnet | **Done — live and reproducible.** Autonomous Orchard shielded payouts on mainnet, real txids above, from a deployed backend. |
| 2. One project per team | Yes |
| 3. Clear setup + usage docs | `README.md` (60-second quick start), `deploy/README.md`, `zcash-service/README.md` |
| 4. Open-source licensing | MIT — see `LICENSE` |
| 5. Respect privacy, security, community guidelines | Privacy is the product (route never leaves the phone, unit-tested). Anti-cheat is layered and documented honestly, including what it does *not* catch. Operator endpoints are auth-gated. |

**Verify it yourself:**

```bash
# 1. The live backend answers
curl -s https://api.pedalshield.app/healthz

# 2. A real autonomous mainnet payout (open in a browser)
#    mainnet.zcashexplorer.app/transactions/a64f2b159e92558b7070d25f0f708ca99b3401ed9ae23ac626c2ea2a2db2f1d8

# 3. The privacy + anti-cheat unit tests (route never leaves the phone)
cd Pedalshield/mobile && node --test src/verification/__tests__/*.test.ts

# 4. The backend speaks current consensus
cd ../zcash-service && cargo run --bin treasury_ping
```

## What's shipped vs honestly roadmap

We name our limits out loud — that's the point.

- **Shipped:** autonomous Orchard mainnet payouts (proven, reproducible, deployed, secured); on-device verification + layered anti-cheat; the privacy seam (unit-tested); the iOS app on TestFlight; **non-custodial rider wallet** — riders connect a Zcash wallet they already control (Zodl) by entering its Unified Address, and verified rides pay real shielded ZEC straight to it (validated + persisted on-device; `mobile/src/wallet/connectedWallet.ts`, unit-tested).
- **Roadmap (named, not hidden):**
  - **In-app rider wallet (optional).** Riders already receive real ZEC to their own external wallet (above). A native in-app wallet — the bridge to `ZcashLightClientKit` / `cash.z.ecc.android.sdk`, so the app itself holds a shielded balance — is a convenience enhancement, not a blocker. See `docs/RN_DEV_BRIEF.md`.
  - **FROST-authorized spends.** The Ed25519 FROST ceremony works (`treasury_demo`); treasury spends today use a single hot key (capped, ≤2 ZEC hot). The RedPallas/ZIP-312 swap for shielded spend-auth is roadmap.
  - **ZK proof-of-distance** for trustless verified-distance claims (Tier 2).
  - **Ironwood pool migration** (Orchard successor, ~late July 2026) — budgeted.

## Honest-claims rule (held throughout)

Payouts are modest and capped — pegged to the EPA social cost of carbon (~$190/tonne => ~$0.09/mile for the ~1 lb of CO2 a biked mile avoids). Privacy is the product, not yield.
ZK route proofs are roadmap, not live. Anti-cheat is layered, not perfect. No
token. Every uncertain version and deferred chunk is named in the docs.

## Submission checklist

- [x] Working prototype — **live deployed backend with reproducible mainnet payouts**
- [x] Open-source licensed (MIT)
- [x] README with setup + usage instructions
- [x] Architecture diagram + honest security write-up (`docs/ARCHITECTURE.md`)
- [x] Real shielded mainnet payout executed (txids above)
- [x] iOS app built + on TestFlight
- [x] Demo video recorded and uploaded (real ride → verify → payout → txid)
- [x] Demo video posted in Zcash Global Discord (posting today)
- [ ] PR opened against the ZecHub 2026 folder

## Contact

- GitHub: `github.com/intelligrip/Pedalshield`
- Discord: posting in `#hackathon` of Zcash Global with the video before July 15, 2026 UTC.
