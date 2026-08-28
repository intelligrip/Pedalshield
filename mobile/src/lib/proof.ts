/**
 * Public proof-page helpers.
 *
 * The receipt is hosted on pedalshield.app and keyed by the payout txid.
 * Average speed is derived from ClaimPayload timestamps (endedAt −
 * startedAt) without adding a duration key to the payload itself — the
 * privacy unit tests pin that key set.
 */
import { PROOF_PAGE_BASE } from './config.ts';

/** Absolute URL the app opens for `proof ›`. */
export function proofPageUrl(txid: string): string {
  const id = txid.trim().toLowerCase();
  return `${PROOF_PAGE_BASE}${encodeURIComponent(id)}`;
}

/**
 * Wall-clock duration in seconds from ClaimPayload `startedAt`/`endedAt`
 * (epoch ms). Returns undefined instead of sending timestamps — those
 * would fingerprint time of day on a public page.
 */
export function durationSecondsFromClaim(
  startedAt: number,
  endedAt: number,
): number | undefined {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return undefined;
  const s = Math.round((endedAt - startedAt) / 1000);
  if (s <= 0 || s > 24 * 60 * 60) return undefined;
  return s;
}
