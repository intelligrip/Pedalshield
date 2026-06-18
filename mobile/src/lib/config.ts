/**
 * Runtime config for the Pedalshield mobile app.
 *
 * BACKEND_URL must be reachable FROM THE PHONE. On a physical device that
 * means your Mac's LAN IP (System Settings > Network, or run
 * `ipconfig getifaddr en0`), NOT localhost - the phone and Mac are
 * different hosts. The backend binds 0.0.0.0:8787 so it accepts LAN
 * connections. Example: 'http://192.168.1.42:8787'.
 *
 * iOS blocks cleartext HTTP by default; app.json grants an
 * NSAllowsLocalNetworking exception so LAN http:// works for the demo.
 */
/**
 * Production builds inject EXPO_PUBLIC_BACKEND_URL via eas.json (the
 * `production` profile). Dev builds fall back to the Mac's LAN IP.
 */
export const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://192.168.0.136:8787';

/** Block explorer base for surfacing a payout txid. */
export const EXPLORER_TX_BASE = 'https://mainnet.zcashexplorer.app/transactions/';

/**
 * Fallback reward rate in zatoshi per kilometre, used before the live
 * value from GET /treasury/info arrives (or if the backend is offline).
 * Mirrors the backend default (PEDALSHIELD_ZAT_PER_KM = 20_000 =
 * 0.0002 ZEC/km ≈ 0.00032 ZEC/mile).
 */
export const DEFAULT_ZAT_PER_KM = 20_000;

/**
 * Recipient Unified Address = the rider's connected (bring-your-own) Zcash
 * wallet. Source of truth + persistence live in
 * `../wallet/connectedWallet.ts`; these helpers are thin sync accessors so
 * existing call sites (Home, Ride, Leaderboard) keep working unchanged.
 * The address now survives app restarts (AsyncStorage) — no more re-pasting.
 */
import { getConnectedUA, setConnectedUA } from '../wallet/connectedWallet.ts';

export function getRecipientUA(): string {
  return getConnectedUA();
}

/**
 * Persist the rider's recipient UA. Resolves once written; callers that
 * don't await still see the in-memory update synchronously via
 * getRecipientUA(). Rejects (with a human-readable reason) if invalid.
 */
export function setRecipientUA(ua: string): Promise<void> {
  return setConnectedUA(ua);
}
