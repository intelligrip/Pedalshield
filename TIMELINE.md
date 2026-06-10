# Pedalshield — Launch Timeline

_Deadline: ZecHub Hackathon 2026, Games track — **July 15, 2026**. Today: June 10. 35 days. Buffer built in; everything after July 8 is slack._

## Week 1 — June 10–14: Unblock device, prove the loop
- **Jun 10**: Blank-screen fix **verified in `App.tsx`** (boot `.catch` + on-screen boot error — wallet hiccup no longer dead-ends). `/admin` "manual payout" copy fixed → "payouts are autonomous". Polsia launch kit drafted (`docs/marketing/POLSIA_LAUNCH_KIT.md`). Samuel: restart Metro (:8083), connect dev client via **Enter URL manually** `exp://192.168.0.62:8083`, paste Metro output if still blank. Also: `git status` → commit + push (late mobile/backend/marketing edits), `rm -f mobile/assets/icon_*.png` (keep `icon.png`).
- **Jun 11–12**: First **real outdoor ride → verified → autonomous payout → real txid** on device. This is the launch gate.
- **Jun 13–14**: Repeat 2–3 rides for reliability; space claims ~2 min apart (mempool race). Commit + push everything (check `git status` — late mobile/icon edits may be uncommitted).

## Week 2 — June 15–21: Hardening + polish
- Mempool-aware / local note reservation (kills the double-spend window).
- Wire `anomaly` module (daily cap / km-window) into `run_payout`.
- ~~Fix `/admin` "manual payout" copy~~ done Jun 10; remove leftover `mobile/assets/icon_*.png` (needs Samuel's shell).
- Fund treasury only as needed (~0.0096 ZEC remains; ~0.0001 ZEC fee/tx).

## Week 3 — June 22–28: Demo assets
- 2–3 min demo video: ride → verify → autonomous shielded payout → txid in explorer.
- README + architecture diagram + submission writeup. Narrative: **autonomous, hand-rolled, Nu6.2-current shielded payouts; route never leaves the phone. No manual operator.**
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
