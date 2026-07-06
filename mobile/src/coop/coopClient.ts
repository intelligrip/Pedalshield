/**
 * Data co-op contribution client (OPT-IN, privacy-preserving).
 *
 * This is the pipeline behind the Privacy-screen opt-in toggle. It turns a
 * finished ride into a COARSE, non-identifying aggregate and submits it — but
 * only when the rider has explicitly opted in (`isDataCoopOptedIn()`), and
 * never the route.
 *
 * Privacy guarantees enforced structurally here:
 *   - The contribution type has NO field for coordinates, raw samples, or a
 *     precise timestamp. `buildContribution` only ever sees a distance, a
 *     start time (reduced to hour-of-day), and an optional coarse area name.
 *   - Distance and CO2 are rounded to coarse buckets on-device.
 *   - Time is reduced to UTC hour-of-day (0-23) with no date.
 * The backend independently re-validates all of this and rejects anything
 * finer-grained (see `/coop/contribute`).
 */

import { BACKEND_URL } from '../lib/config.ts';
import {
  DATA_COOP_CONSENT_VERSION,
  isDataCoopOptedIn,
} from '../prefs/dataCoop.ts';

/** ~1 lb of CO2 avoided per mile → grams per km. (453.592 g / 1.60934 km) */
export const GRAMS_CO2_PER_KM = 281.9;

const TIMEOUT_MS = 12_000;

/** The exact, coarse payload that may be contributed. No route, ever. */
export interface CoopContribution {
  recipient_ua: string;
  consent_version: number;
  /** Whole-km bucket. */
  distance_bucket_km: number;
  /** UTC hour of day, 0-23 (no date). */
  hour_bucket: number;
  /** Coarse grams of CO2 saved. */
  co2_grams: number;
  /** Optional coarse area NAME (e.g. a city). Never coordinates. */
  region?: string;
}

export interface BuildInput {
  recipientUA: string;
  /** Verified distance for the ride, in km. */
  verifiedKm: number;
  /** Ride start epoch ms — used only to derive UTC hour-of-day. */
  startedAt: number;
  /** Optional coarse area name the rider chose to share. */
  region?: string;
}

/**
 * Build the coarse aggregate on-device. Pure + deterministic so it is fully
 * unit-testable and easy to audit: given the same inputs it always produces
 * the same minimal payload, and it cannot emit anything route-like.
 */
export function buildContribution(input: BuildInput): CoopContribution {
  const km = Math.max(0, input.verifiedKm);
  const contribution: CoopContribution = {
    recipient_ua: input.recipientUA,
    consent_version: DATA_COOP_CONSENT_VERSION,
    distance_bucket_km: Math.round(km),
    hour_bucket: new Date(input.startedAt).getUTCHours(),
    co2_grams: Math.round(km * GRAMS_CO2_PER_KM),
  };
  const region = input.region?.trim();
  if (region) contribution.region = region;
  return contribution;
}

export type SubmitResult =
  | { submitted: true; contributionId: number }
  | { submitted: false; skipped: 'not-opted-in' }
  | { submitted: false; skipped: 'error'; error: string };

/**
 * Submit a contribution — ONLY if the rider is opted in. If they are not (the
 * default), this is a no-op that returns `skipped: 'not-opted-in'` and sends
 * nothing. Network/HTTP failures are swallowed into `skipped: 'error'` so a
 * co-op hiccup never blocks the core ride/payout flow.
 */
export async function submitContribution(
  input: BuildInput,
): Promise<SubmitResult> {
  if (!isDataCoopOptedIn()) {
    return { submitted: false, skipped: 'not-opted-in' };
  }

  const body = buildContribution(input);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/coop/contribute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { submitted: false, skipped: 'error', error: `${res.status}: ${text.slice(0, 200)}` };
    }
    const ack = text ? (JSON.parse(text) as { contribution_id?: number }) : {};
    return { submitted: true, contributionId: ack.contribution_id ?? -1 };
  } catch (e) {
    return { submitted: false, skipped: 'error', error: String((e as Error)?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}
