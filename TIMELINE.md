# Pedalshield — Launch Timeline

_Deadline: ZecHub Hackathon 2026, Games track — **July 15, 2026**. Today: June 11. 34 days. Buffer built in; everything after July 8 is slack._

> **⚠ IRONWOOD RISK (added Jun 11):** Ironwood (Orchard successor pool) targets **late-July 2026 activation**. At activation, Orchard closes to new deposits and intra-pool transfers — funds exit only via turnstile. Our treasury→rider payouts are Orchard→Orchard internal transfers and **stop working at activation**. Hackathon window (submit Jul 5) survives, but: **record the demo video as soon as the device loop works** — a recorded demo + mainnet txids is our proof if activation slips earlier or judges test post-activation. Existing UAs stay valid (auto-land in new pool). Post-hackathon: migrate treasury through turnstile (~0.0096 ZEC, trivial) and rebuild spend path on Ironwood crates.

## Week 1 — June 10–14: Unblock device, prove the loop
- **Jun 10**: Blank-screen fix **verified in `App.tsx`** (boot `.catch` + on-screen boot error — wallet hiccup no longer dead-ends). `/admin` "manual payout" copy fixed → "payouts are autonomous". Polsia launch kit drafted (`docs/marketing/POLSIA_LAUNCH_KIT.md`). Samuel: restart Metro (:8083), connect dev client via **Enter URL manually** `exp://192.168.0.62:8083`, paste Metro output if still blank. Also: `git status` → commit + push (late mobile/backend/marketing edits), `rm -f mobile/assets/icon_*.png` (keep `icon.png`).
- **Jun 11–12**: First **real outdoor ride → verified → autonomous payout → real txid** on device. This is the launch gate.
- **Jun 13–14**: Repeat 2–3 rides for reliability; space claims ~2 min apart (mempool race). Commit + push everything (check `git status` — late mobile/icon edits may be uncommitted). **Record demo footage during these rides** (pulled forward from Week 3 — Ironwood risk).

## Week 2 — June 15–21: Hardening + polish
- Mempool-aware / local note reservation (kills the double-spend window).
- Wire `anomaly` module (daily cap / km-window) into `run_payout`.
- ~~Fix `/admin` "manual payout" copy~~ done Jun 10; remove leftover `mobile/assets/icon_*.png` (needs Samuel's shell).
- Fund treasury only as needed (~0.0096 ZEC remains; ~0.0001 ZEC fee/tx).

## Week 3 — June 22–28: Demo assets
- 2–3 min demo video: ride → verify → autonomous shielded payout → txid in explorer. **Cut/edit from footage recorded Jun 13–14; do not wait until this week to record.**
- README + architecture diagram + submission writeup. Narrative: **autonomous, hand-rolled, Nu6.2-current shielded payouts; route never leaves the phone. No manual operator.** Add Ironwood angle: re-pinned to NU6.2 within days of the emergency fork; Ironwood migration planned post-hackathon.
- Polsia: launch kit ready (`docs/marketing/POLSIA_LAUNCH_KIT.md`). Landing page + waitlist can start in Polsia now; launch posts gated on demo video. Blocked Jun 10: Chrome extension not connected — open Chrome with the Claude extension and the AI drives Polsia from the kit.

## Week 4 — June 29–July 8: Submit early
- **Jul 1–3**: Dry-run the full demo script (`docs/DEMO_SCRIPT.md`) on a clean device.
- **Jul 5**: Submit to ZecHub. Do not wait for the deadline.
- Stretch (only if all above is locked): INTVL-style territory claiming — alias keypair, ~1 km coarse cells, on-device validation. Cut without hesitation.

## July 9–15: Slack
- Bug fixes from judge/early-user feedback only. No new features.

## Hard rules
- No manual-operator fallback. Route never leaves the device.
- Pin `transparent`/`sapling` exactly; lightwalletd = `zec.rocks:443`.
- Demo claims spaced ≥2 min until note reservation lands.
