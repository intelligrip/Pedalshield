/**
 * Is the map ready BEFORE the ride starts?
 *
 * The problem this solves: a pack is tens of megabytes. Discovering it is
 * missing at the trailhead — or worse, mid-ride — means either riding with a
 * blank map or standing on a roadside burning cellular data. The download has
 * to happen at home, on WiFi, before it matters.
 *
 * ── A WARNING, NOT A GATE ────────────────────────────────────────────────
 * This never blocks starting a ride, and that is deliberate. Verification
 * does not need tiles: the sensors, the integrity score and the payout all
 * work with no map at all. A rider clipped in at the trailhead with one bar
 * of signal must be able to press Start. Refusing would trade the app's
 * actual job for a cosmetic one.
 *
 * ── PRIVACY ──────────────────────────────────────────────────────────────
 * Matching a position to a pack is arithmetic against a hardcoded table.
 * Nothing is requested, logged or sent. The coordinate stays in this
 * function's arguments and is never persisted — the point is to avoid a
 * network call, not to make one.
 *
 * Pure module (no RN imports) so it is testable under node.
 */

import { METRO_PACKS, type RegionPack } from './regions.ts';

export type ReadinessStatus =
  /** A downloaded pack covers where the rider is. Nothing to say. */
  | 'ready'
  /** A pack exists for this area and is not downloaded. Worth prompting. */
  | 'missing'
  /** No pack covers this area at all — nothing the rider can do about it. */
  | 'uncovered'
  /** Position unknown; fall back to "have they downloaded anything". */
  | 'unknown';

export interface Readiness {
  status: ReadinessStatus;
  /** The pack they should get, when there is one. */
  pack: RegionPack | null;
  /** One line for the rider, or null when there is nothing worth saying. */
  message: string | null;
}

/** Does this pack's bbox contain the point? bbox is [w, s, e, n]. */
export function packCovers(pack: RegionPack, lat: number, lon: number): boolean {
  const [w, s, e, n] = pack.bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

/**
 * The smallest pack covering a point. Smallest, because metro bboxes overlap
 * at the edges and the tighter pack is the better-detailed one — and the
 * cheaper download.
 */
export function packForPoint(lat: number, lon: number): RegionPack | null {
  let best: RegionPack | null = null;
  let bestArea = Infinity;
  for (const p of METRO_PACKS) {
    if (!packCovers(p, lat, lon)) continue;
    const [w, s, e, n] = p.bbox;
    const area = (e - w) * (n - s);
    if (area < bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return best;
}

export interface ReadinessInput {
  /** Pack ids already downloaded on this device. */
  downloadedIds: readonly string[];
  /** Rough current position, if one is already known. Never fetched here. */
  point?: { lat: number; lon: number } | null;
}

export function mapReadiness(input: ReadinessInput): Readiness {
  const downloaded = new Set(input.downloadedIds);

  if (!input.point) {
    // No position to reason from. Only speak up if they have nothing at all —
    // guessing at a region from an empty input would be worse than silence.
    if (downloaded.size > 0) {
      return { status: 'unknown', pack: null, message: null };
    }
    return {
      status: 'unknown',
      pack: null,
      message: 'No offline map downloaded. Maps will be blank on this ride.',
    };
  }

  const pack = packForPoint(input.point.lat, input.point.lon);

  if (!pack) {
    // Nothing to offer, so say nothing. Telling a rider their city is
    // unsupported right as they are about to leave helps no one.
    return { status: 'uncovered', pack: null, message: null };
  }

  if (downloaded.has(pack.id)) {
    return { status: 'ready', pack, message: null };
  }

  return {
    status: 'missing',
    pack,
    message: `Download the ${pack.name} map (~${pack.approxMB} MB) before you go — it needs WiFi.`,
  };
}

/**
 * Should the rider be prompted right now? Separated from the message so the
 * UI never has to interpret a string to decide whether to render.
 */
export function shouldPromptDownload(r: Readiness): boolean {
  return r.message !== null;
}
