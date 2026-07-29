# Pedal Shield — Private Sales / Marketplace: Architecture & Implementation Plan

*Sell cycling files. Get paid shielded. Deliver private.*

This plan adds a native "Private Sales" feature (sell ride summaries, anonymized
datasets, training plans → paid in shielded ZEC → delivered privately) to the
existing Pedal Shield codebase. It is written against the real repo, not a
greenfield app, and it preserves the product's non-custodial, route-data-never-
leaves-device guarantees.

---

## 0. The one hard problem (read this first)

Everything else is straightforward. The crux is **shielded payment detection in
a non-custodial way**, because the data flow is the *opposite* of what Pedal
Shield does today:

- **Today (rewards):** one **treasury** holds a spending key and *pays out* to
  riders. Detection is easy — the treasury scans its own notes
  (`zcash-service/.../spend/scanner.rs`).
- **Marketplace:** a **buyer pays a seller** directly. To know a payment
  arrived (so we can release the file), *something* must scan the seller's
  incoming shielded notes. Scanning requires the seller's **Incoming Viewing
  Key (IVK / UFVK)** — which today the app never holds (it only stores a
  bring-your-own Unified Address, see `src/wallet/connectedWallet.ts`).

So the central design decision is: **how do we detect a shielded payment to a
seller without custodying funds and without leaking the seller's whole
financial history?** Section 2 and Section 4 answer this; the recommended MVP
uses a **per-listing detection key (a UFVK scoped to one diversified address)**
so the detector can confirm one sale without seeing the seller's other income.

---

## 1. High-Level Architecture

**Recommendation: Hybrid, with a clear privacy boundary — not fully on-device,
not a classic server.**

| Layer | Where | Why |
| --- | --- | --- |
| Listing creation, pricing, file selection, **client-side encryption**, metadata stripping | **On-device (RN)** | Plaintext + keys never leave the phone. This is the non-negotiable privacy core. |
| Ciphertext storage + payment **detection** + key-release-on-payment + **Nym egress** | **Backend "Delivery Agent"** (extend the existing Rust service) | Mobile can't reliably run a long-lived scanner or a Nym mixnet client; a small service can. It is **non-custodial of funds** (never holds a spending key) and **blind to plaintext** (only ever sees ciphertext). |
| Buyer purchase + pay (deep-link to their own wallet) + decrypt | **On-device (RN)** | Buyer keeps their keys; decryption happens locally. |

Why not **fully native/on-device**? Two blockers: (a) reliable shielded
payment detection needs near-continuous lightwalletd scanning, which a
backgrounded mobile app can't guarantee; (b) Nym has **no React Native SDK** —
its clients are Rust and browser-WASM (web-worker), neither of which runs in RN
([Nym TS SDK](https://nym.com/docs/developers/typescript),
[nym-client-wasm](https://www.npmjs.com/package/@nymproject/nym-client-wasm)).

Why not a **classic custodial marketplace**? It would break the product's
identity. The hybrid keeps the agent *funds-non-custodial* and *plaintext-blind*
— it can stall a delivery but can never take a seller's money or read a file.

```
  SELLER PHONE (RN)                 DELIVERY AGENT (Rust svc)            BUYER PHONE (RN)
  ┌───────────────────┐            ┌──────────────────────────┐        ┌───────────────────┐
  │ pick ride/file    │            │ stores: ciphertext blob, │        │ browse listings   │
  │ strip metadata    │  publish   │ price, seller UA+memo id,│ browse │ tap "Buy"         │
  │ encrypt (key K)   │ ─────────► │ per-listing UFVK (view),│ ◄───── │                   │
  │ keep K on device  │            │ wrapped-K (sealed)       │        │ pay ZEC to seller │
  │                   │            │                          │        │ UA w/ memo=order │
  │                   │            │ scans lightwalletd via   │ ◄───── │ (ZIP-321 deeplink │
  │                   │            │ per-listing UFVK →       │  pay   │  to own wallet)   │
  │                   │            │ sees note+memo=order →   │        │                   │
  │                   │            │ releases K to buyer over │ ─────► │ decrypt locally   │
  │                   │            │ Nym SURB / pull          │ deliver│ (gets K + blob)   │
  └───────────────────┘            └──────────────────────────┘        └───────────────────┘
        funds: buyer ─────────────── shielded ZEC ───────────────────► seller (direct, P2P)
```

Funds go **buyer → seller directly** on Zcash mainnet. The agent only moves
*ciphertext and an encrypted key*, never money.

---

## 2. Key Integration Points (where this touches the current code)

### 2.1 Wallet connection / UFVK handling
- **Today:** `src/wallet/connectedWallet.ts` stores a bring-your-own **Unified
  Address** only (validated, persisted, pub/sub). No viewing key, no spend key.
- **Add — seller side:** to *receive and auto-detect* sales, a seller opts in to
  provide a **UFVK** (or better, the app derives a **per-listing diversified
  address + its IVK**). Reuse the storage/validation pattern of
  `connectedWallet.ts` in a new `src/wallet/sellerKeys.ts`. Store the UFVK
  **encrypted at rest** (Expo SecureStore / Keychain), never the spending key.
- **Buyer side:** no new key material — the buyer pays from their own wallet via
  a **ZIP-321 payment URI** deep link (`zcash:<addr>?amount=..&memo=..`), so
  Pedal Shield never touches the buyer's keys.
- **Non-custodial invariant preserved:** app/agent hold at most a *viewing* key
  (read-only); spending always stays in the user's own wallet.

### 2.2 Payment detection & the claim system
- **Reuse:** the backend already scans notes and tracks state. `spend/scanner.rs`
  + `spend/tree.rs` know how to seed a commitment tree from lightwalletd and
  rediscover notes; the `claims` table + state machine
  (`pending → paying → paid`, double-pay guard) in
  `crates/pedalshield-treasury/src/bin/backend.rs` is the template.
- **Add:** an **`orders`** table and an `order` state machine
  (`listed → awaiting_payment → paid → delivered → expired`) mirroring the
  claims pattern. A detection worker (sibling of the settlement sweep loop in
  `backend.rs`) scans each active listing's UFVK for an **incoming note whose
  encrypted memo == the order nonce** and the amount ≥ price; on match it flips
  the order to `paid` and triggers key release.
- **Memo = order binding:** Orchard memos are 512 bytes, encrypted to the
  recipient. Put a random `order_id` in the memo so a payment is
  unambiguously tied to one order without any on-chain linkability.
- **New endpoints (extend the public router in `backend.rs`):**
  `POST /market/listings`, `GET /market/listings`,
  `POST /market/orders` (buyer reserves → gets pay URI),
  `GET /market/orders/:id` (poll, like `pollClaim`),
  `GET /market/orders/:id/deliver` (returns sealed K once `paid`).
- **Frontend:** extend `src/lib/api.ts` (same `fetchJson` + poll pattern as
  `submitClaim`/`pollClaim`) with `createListing`, `listListings`,
  `createOrder`, `pollOrder`, `fetchDelivery`.

### 2.3 On-device file handling & encryption
- **Inputs:** ride history already lives on-device (`src/ride/rideHistory.ts`),
  so "sell this ride" can read straight from it — no new data collection.
- **Encryption:** symmetric **XChaCha20-Poly1305** (libsodium `secretbox`) with
  a per-file random key `K`; use `react-native-libsodium` (or `tweetnacl` for a
  pure-JS MVP). `K` is wrapped for the buyer at delivery (see 4) and otherwise
  never leaves the seller device.
- **Metadata stripping** (cycling-specific, see §3) happens **before**
  encryption, on-device, in a new `src/market/sanitize.ts`.
- **Privacy test parity:** add a unit test like the verification privacy test —
  assert the published listing blob and any uploaded JSON contain **no `lat`/
  `lon`/precise-timestamp keys** (reuse the spirit of
  `src/verification/__tests__/engine.public.test.ts`).

### 2.4 Backend (the Delivery Agent)
- Extend the existing Rust service rather than standing up a new one — it
  already has axum + sqlite + lightwalletd wiring and a deploy kit
  (`deploy/`). Add a `market` module; keep it in a separate router that does
  **not** share the treasury spending key.
- The agent stores: ciphertext blob (or a pointer to object storage/IPFS),
  listing metadata, per-listing UFVK, and the **sealed** key `K`
  (encrypted to the buyer at purchase time, or held as a sealed box only
  openable after `paid` — see §5 trust note).

---

## 3. Bicycle-Specific Adaptations (make it cycling-native)

- **One-tap "Sell this ride"** from `RideTrackerScreen` / ride history: each
  banked ride gets a "Sell summary" action.
- **Pre-built templates** (new `src/market/templates/`):
  - *Ride Summary card* — distance, duration, elevation, avg power/HR *bucketed*,
    integrity score — **no route geometry**.
  - *Anonymized dataset* — per-ride aggregates (the same coarse shape as the
    data co-op in `src/coop/coopClient.ts`: distance buckets, hour-of-day, CO₂),
    multi-ride export as JSON/CSV.
  - *Training plan / coaching* — free-form file (PDF/MD) for coaches.
  - *Segment/effort pack* — power curve, intervals — geometry-free.
- **GPX/JSON metadata stripping** (`src/market/sanitize.ts`): drop `<trkpt lat/
  lon>`, exact timestamps (reduce to relative offsets or coarse buckets), device
  IDs, and any home/work-revealing start/end points. Default to **geometry-off**;
  selling a route is an explicit, scary-warning opt-in.
- **Cycling-native pricing presets** in ZEC (e.g., "summary 0.001, dataset
  0.005, plan 0.02") with live fiat hint from `getTreasuryInfo`-style rate.
- **Reputation reuse:** tie seller standing to the existing leaderboard/handle
  system (`/handle/:ua`) so buyers see a pseudonymous, earned reputation.

---

## 4. Technical Implementation Plan (MVP → Full)

### Phase 0 — Spike (1–2 wks): prove payment detection
Before any UI, validate the riskiest piece: scan a **per-listing UFVK** on
lightwalletd and detect an incoming note with a matching memo.
- **Tech:** extend `spend/scanner.rs` to accept an external UFVK and return
  `{found, amount, memo}`. Test on testnet with a hand-made payment.
- **Deliverable:** a `market_detect` CLI bin (sibling of `treasury_ping`).
- **Challenge:** memo decryption requires the IVK; confirm the UFVK path
  exposes memos. De-risk this first — everything depends on it.

### Phase 1 — MVP (3–5 wks): encrypted sale, manual-ish delivery, no Nym
- **Flow:** seller encrypts on-device → uploads ciphertext + per-listing UFVK +
  price + sealed-K to the agent → buyer reserves order (gets ZIP-321 pay URI) →
  pays from own wallet with memo=order_id → agent detects → buyer pulls
  `{ciphertext, sealed_K}` over plain HTTPS → decrypts locally.
- **Encryption:** `react-native-libsodium` secretbox; `K` sealed to a buyer-
  supplied ephemeral X25519 pubkey (`crypto_box_seal`) at order time, so only
  the buyer can open it.
- **Tech choices:** RN `expo-file-system` + `expo-document-picker` for files;
  `expo-secure-store` for the seller UFVK; sqlite `orders`/`listings` tables in
  the Rust agent.
- **Delivery privacy (MVP):** HTTPS + E2E encryption + minimal metadata. Honest
  limitation: the agent sees buyer/seller IP and timing. Acceptable for MVP
  because **content** is fully E2E encrypted; flag it in-app.
- **Folder structure additions:**
  ```
  mobile/src/market/
    types.ts                 - Listing, Order, DeliveryBlob (public contract)
    sanitize.ts              - GPX/JSON metadata stripping (on-device)
    crypto.ts                - encrypt/seal/unseal wrappers (libsodium)
    marketClient.ts          - createListing/createOrder/pollOrder/fetchDelivery
    payUri.ts                - ZIP-321 builder + wallet deep-link
    templates/               - ride-summary / dataset / plan builders
    __tests__/               - sanitize + crypto + "no-geo-leak" privacy tests
  mobile/src/wallet/sellerKeys.ts   - opt-in UFVK storage (encrypted at rest)
  mobile/src/screens/MarketScreen.tsx
  mobile/src/screens/SellRideScreen.tsx

  zcash-service/.../src/market/      - module: orders.rs, listings.rs, detect.rs
  zcash-service/.../src/bin/backend.rs   - mount /market router (no spend key)
  ```

### Phase 2 — Hardening (3–4 wks)
- Per-listing **diversified addresses** so one UFVK ≠ the seller's whole wallet
  (limits what the agent can see to that listing's income).
- **Object storage** for large blobs (S3-compatible / IPFS) instead of sqlite;
  agent stores only a pointer + sealed K.
- Order **expiry + refunds-by-design** (no refund needed if unpaid orders just
  expire; payment is direct P2P so there's nothing to refund).
- Tighten anti-abuse: listing size caps, rate limits, content-type allowlist.

### Phase 3 — Nym private delivery (4–8 wks, hybrid)
- **Do NOT attempt on-device Nym in RN** — no RN SDK; the WASM client needs a
  browser web-worker ([Nym TS SDK](https://nym.com/docs/developers/typescript)).
- **Pragmatic hybrid:** run a **Nym client in the Rust agent** (Nym Rust SDK /
  self-hosted `nym-client`). Delivery of `{ciphertext, sealed_K}` egresses over
  the **mixnet via a SURB** the buyer supplies, so the agent replies without
  learning the buyer's network identity
  ([SURBs](https://nym.com/docs/developers/typescript)).
- **Buyer side options (pick one, in order of pragmatism):**
  1. Buyer fetches via a **Nym Network Requester / SOCKS5** path bundled with
     the app's networking layer (treat like a privacy proxy).
  2. Buyer runs the Nym **WASM client in a hidden WebView** (works, but heavy/
     battery-hungry — measure before shipping).
  3. Ship NymVPN-style native modules later (Kotlin/Swift) if it becomes core.
- **Challenge:** Nym throughput/latency for multi-MB files; chunk + stream, and
  keep large blobs in object storage with only the *key* over the mixnet.

### Phase 4 — Trust minimization (stretch)
- Reduce the agent from "key releaser" to "blind relay": explore releasing `K`
  via a mechanism gated on a buyer-presentable **payment proof** (e.g., the
  buyer proving note ownership) so the agent can't withhold or front-run. This
  is research-grade; keep Phase 1's simpler model until proven.

---

## 5. Privacy & Non-Custodial Requirements (invariants to hold)

1. **Route data never leaves the device.** Geometry-off by default; metadata
   stripping runs on-device pre-encryption; a unit test asserts no `lat`/`lon`/
   precise-timestamp keys in any published artifact (parity with the existing
   verification privacy test).
2. **Funds are non-custodial.** Buyer → seller **directly**; the agent never
   holds a spending key and never touches money. Payment is a ZIP-321 deep link
   into the user's own wallet.
3. **Plaintext is E2E encrypted.** The agent only ever stores ciphertext + a
   key **sealed to the buyer**; it cannot read files.
4. **Viewing-key scope is minimized.** Prefer per-listing diversified-address
   IVKs over a wallet-wide UFVK, stored encrypted at rest, opt-in, revocable —
   so the detector sees *one sale*, not a financial history.
5. **Metadata minimized in transit.** MVP: E2E + HTTPS (documented limitation).
   Phase 3: Nym mixnet + SURBs remove network-level linkage.
6. **Honest disclosure.** Add a "What this does / doesn't hide yet" section in
   the marketplace UI, exactly like the landing page's *Honest limits* — e.g.,
   "MVP delivery hides file contents, not your IP; Nym delivery is on the
   roadmap."
7. **Trust note (be explicit):** in Phase 1 the agent *could* withhold delivery
   (liveness), but can never steal funds or read content. State this; Phase 4
   targets removing even the liveness trust.

---

## 6. Concrete, Prioritized Next Steps

1. **Decide the detection model** (the one real fork): per-listing diversified
   IVK (recommended) vs wallet UFVK vs buyer-proof. Everything keys off this.
2. **Run the Phase 0 spike** — extend `spend/scanner.rs` to scan an external
   UFVK and return `{found, amount, memo}`; prove memo-bound detection on
   testnet. *(Ask Claude to generate the `market_detect` bin + scanner change.)*
3. **Define the public contract** — `mobile/src/market/types.ts`
   (`Listing`, `Order`, `DeliveryBlob`) + the `orders`/`listings` SQL schema,
   mirroring the claims table. *(Good first code-gen task.)*
4. **Build on-device crypto + sanitize** — `crypto.ts` (libsodium secretbox +
   seal) and `sanitize.ts` (GPX/JSON stripping) with the no-geo-leak tests.
   *(Self-contained, testable with the existing `node --test` setup.)*
5. **Wire the agent endpoints** — `/market/*` router in `backend.rs` (separate
   from the treasury/spend key) + `marketClient.ts` on the app.
6. **MVP UI** — `MarketScreen` + one-tap `SellRideScreen` from ride history with
   the *Ride Summary* template.
7. **Then** layer Phase 2 hardening and the Phase 3 Nym hybrid.

**Suggested first code-gen request to Claude:** "Generate `mobile/src/market/
types.ts`, `crypto.ts`, and `sanitize.ts` with `node --test` tests (including a
no-`lat`/`lon`-leak assertion), plus the `orders`/`listings` sqlite schema and a
stubbed `/market/*` axum router that does not import the treasury spending key."

---

### Sources
- [Nym TypeScript SDK (browser/WASM, web-worker, SURBs)](https://nym.com/docs/developers/typescript)
- [@nymproject/nym-client-wasm (npm)](https://www.npmjs.com/package/@nymproject/nym-client-wasm)
- [Nym Mixnet SDK examples](https://sdk.nymtech.net/examples/mixnet)
- [Nym Rust mixnet module](https://nym.com/docs/developers/rust/mixnet)
