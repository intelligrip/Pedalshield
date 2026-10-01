/**
 * Fogline backend calls. The request body is a FoglineClaim (no location of
 * any kind — see map/foglineClaim.ts) plus where to pay and the device
 * signature. Nothing else is sent.
 */

import { BACKEND_URL } from '../lib/config.ts';
import { fetchJson } from '../lib/api.ts';
import type { FoglineClaim } from '../map/foglineClaim.ts';
import { assertFoglineClaimSafe } from '../map/foglineClaim.ts';

export type FoglineStatusCode =
  | 'paying'
  | 'paid'
  | 'capped'
  | 'treasury_paused'
  | 'failed';

export interface FoglineRow {
  ride_id: string;
  status: FoglineStatusCode;
  payout_zat: number | null;
  payout_txid: string | null;
  reason: string | null;
}

export interface FoglinePot {
  paused: boolean;
  payout_zat: number;
  fee_estimate_zat: number;
  drops_remaining: number | null;
}

export interface FoglineSubmission {
  claim: FoglineClaim;
  recipient_ua: string;
  signature?: string;
  rider_id?: string;
  signed_at?: number;
}

/** The exact body POSTed — also what "what left your phone" displays. */
export function submissionBody(s: FoglineSubmission): string {
  // Last line of defence: re-check the claim at the network edge.
  assertFoglineClaimSafe(s.claim);
  return JSON.stringify(s);
}

export async function submitFoglineClaim(s: FoglineSubmission): Promise<FoglineRow> {
  return fetchJson<FoglineRow>(`${BACKEND_URL}/fogline/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: submissionBody(s),
  });
}

export async function getFoglineClaim(rideId: string): Promise<FoglineRow> {
  return fetchJson<FoglineRow>(`${BACKEND_URL}/fogline/claim/${encodeURIComponent(rideId)}`);
}

export async function getFoglinePot(): Promise<FoglinePot> {
  return fetchJson<FoglinePot>(`${BACKEND_URL}/fogline/status`);
}

/** Poll until the drop settles (paid/failed/paused) or we give up. */
export async function pollFoglineClaim(
  rideId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<FoglineRow> {
  const interval = opts.intervalMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  let last = await getFoglineClaim(rideId);
  while (last.status === 'paying' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    last = await getFoglineClaim(rideId);
  }
  return last;
}
