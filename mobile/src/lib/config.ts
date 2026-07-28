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
 * FAIL-SAFE DIRECTION MATTERS: the default is PRODUCTION, and the LAN dev
 * backend is the explicit override. The old inversion (default = dev LAN
 * IP) shipped to riders via `eas update`, because OTA publishes bundle on
 * the local machine where eas.json build-env is NOT applied — phones then
 * tried to reach a MacBook on someone else's WiFi and iOS showed riders a
 * local-network/location-profiling warning inside a privacy app.
 *
 * Dev usage: EXPO_PUBLIC_BACKEND_URL=http://<mac-lan-ip>:8787 npx expo start
 */
export const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? 'https://api.pedalshield.app';

/** Block explorer base for surfacing a payout txid. */
export const EXPLORER_TX_BASE = 'https://mainnet.zcashexplorer.app/transactions/';

/**
 * Fallback reward rate in zatoshi per kilometre, used before the live
 * value from GET /treasury/info arrives (or if the backend is offline).
 * The reward is pegged to CARBON VALUE: ~1 lb CO2 avoided per mile ×
 * the EPA social cost of carbon (~$190/tonne => ~$0.086/lb) = ~$0.09/mile. In ZEC that depends on price, so the live
 * value (re-pegged by deploy/repeg_carbon_rate.sh) is the source of truth;
 * this fallback should track deploy/repeg_carbon_rate.sh output.
 */
export const DEFAULT_ZAT_PER_KM = 793;

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
