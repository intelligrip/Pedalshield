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
export const BACKEND_URL = 'http://192.168.0.62:8787';

/** Block explorer base for surfacing a payout txid. */
export const EXPLORER_TX_BASE = 'https://mainnet.zcashexplorer.app/transactions/';

/**
 * Session-scoped recipient Unified Address. The rider pastes their Zashi
 * UA once; subsequent rides prefill it. Not persisted to disk (paste
 * again after an app restart) to keep the demo simple and key-free.
 */
let _recipientUA = '';
export function getRecipientUA(): string {
  return _recipientUA;
}
export function setRecipientUA(ua: string): void {
  _recipientUA = ua.trim();
}
