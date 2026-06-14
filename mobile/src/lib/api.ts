/**
 * Pedalshield backend client.
 *
 * Submits ride claims to the autonomous payout backend and polls the
 * claim until the shielded payout settles. The backend builds, proves,
 * signs, and broadcasts a real Orchard transaction with no operator in
 * the loop - this client just reports its progress to the rider.
 */

import { BACKEND_URL } from './config.ts';

export interface ClaimSubmission {
  claim_id: string;
  recipient_ua: string;
  distance_meters: number;
  signature: string;
  attestation?: string;
}

export interface ClaimAck {
  status: string; // "paying" (auto per-claim) | "queued" | "duplicate" | "accrued" (accrual mode)
  claim_id: string;
}

export interface AccrualBalance {
  recipient_ua: string;
  pending_zatoshi: number;
  lifetime_zatoshi: number;
  rides_count: number;
}

export interface ClaimRow {
  id: string;
  recipient_ua: string;
  distance_meters: number;
  status: string; // pending | paying | paid | rejected
  payout_txid: string | null;
  rejection_reason: string | null;
  created_at: number;
  updated_at: number;
}

const TIMEOUT_MS = 12_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timer);
  }
}

/** Submit a ride claim. The backend auto-fires the payout in the background. */
export async function submitClaim(claim: ClaimSubmission): Promise<ClaimAck> {
  return fetchJson<ClaimAck>(`${BACKEND_URL}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(claim),
  });
}

/** Fetch the current state of a claim. */
export async function getClaim(id: string): Promise<ClaimRow> {
  return fetchJson<ClaimRow>(`${BACKEND_URL}/claims/${encodeURIComponent(id)}`);
}

/**
 * Poll a claim until it reaches a terminal state (`paid` or `rejected`)
 * or the timeout elapses (returns the last observed state, usually still
 * `paying`). Calls `onUpdate` on each observed state for live UI.
 */
export async function pollClaim(
  id: string,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    onUpdate?: (row: ClaimRow) => void;
  } = {},
): Promise<ClaimRow> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const start = Date.now();
  let last: ClaimRow | null = null;
  // small delay so the backend has reserved the claim before first poll
  await sleep(1_000);
  while (true) {
    try {
      last = await getClaim(id);
      opts.onUpdate?.(last);
      if (last.status === 'paid' || last.status === 'rejected') {
        return last;
      }
    } catch {
      // transient network blip during polling; keep trying until timeout
    }
    if (Date.now() - start > timeoutMs) {
      if (last) return last;
      throw new Error('timed out waiting for payout');
    }
    await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch current off-chain accrued balance for a UA (accrual mode). */
export async function getAccrualBalance(ua: string): Promise<AccrualBalance> {
  return fetchJson<AccrualBalance>(`${BACKEND_URL}/balance/${encodeURIComponent(ua)}`);
}
