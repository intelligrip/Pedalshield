/**
 * Route export — the ONLY path by which route geometry may leave the device.
 *
 * Nothing else in the app is permitted to serialise `GeoPoint[]` for network
 * transmission. Route data leaves here or it does not leave at all, so that
 * the rules below are enforced in one auditable place rather than trusted to
 * every future call site.
 *
 * THE THREE RULES
 *
 * 1. CONSENT. Level 2 or nothing. Level 0 and 1 riders never export a route,
 *    regardless of what any caller asks for.
 *
 * 2. ENDPOINTS ARE ALWAYS CLIPPED. Unconditional, with no user setting to
 *    disable it. The identifiable harm in route data is not the ride — it is
 *    that the start and end are someone's home, workplace, school, clinic or
 *    partner's house. Strava's privacy zones are opt-in, and a rider who
 *    never finds the setting is the rider most exposed by it. Here the
 *    protection applies to everyone by default and cannot be turned off.
 *
 * 3. SHORT RIDES DON'T EXPORT. If clipping both ends leaves too little to be
 *    useful, we export nothing rather than a stub. A 600 m ride minus 2×250 m
 *    of endpoints is not anonymised data, it is a short line segment sitting
 *    between two addresses.
 */

import type { GeoPoint } from '../verification/types.ts';
import { mayShareRoute } from '../prefs/dataCoop.ts';

/**
 * Metres removed from each end. 250 m covers a residential block in most
 * street grids, so the clipped start sits among many plausible origins rather
 * than one. Larger is safer but starts destroying the route's usefulness to a
 * planner, which is the whole reason a rider agreed to share it.
 */
export const ENDPOINT_CLIP_METERS = 250;

/** Below this remaining length, publish nothing at all. */
export const MIN_EXPORTABLE_METERS = 500;

/** Metres between two points (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative along-path distance for each point. */
function cumulative(points: GeoPoint[]): number[] {
  const out = new Array<number>(points.length);
  out[0] = 0;
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + distanceMeters(points[i - 1], points[i]);
  }
  return out;
}

export interface ExportedRoute {
  /** Clipped geometry, rounded to ~11 m. */
  points: { lat: number; lon: number }[];
  /** Metres of the ride NOT included, for honest display to the rider. */
  clippedMeters: number;
}

/**
 * Clip both ends of a track. Exported separately from `exportRoute` so the
 * geometry rule can be tested without stubbing consent state.
 */
export function clipEndpoints(
  points: GeoPoint[],
  clipMeters = ENDPOINT_CLIP_METERS,
): GeoPoint[] {
  if (points.length < 2) return [];
  const cum = cumulative(points);
  const total = cum[cum.length - 1];
  if (total <= clipMeters * 2) return [];

  const startAt = clipMeters;
  const endAt = total - clipMeters;
  const kept = points.filter((_, i) => cum[i] >= startAt && cum[i] <= endAt);
  // Guard against a sparse track where no sample lands inside the window.
  return kept.length >= 2 ? kept : [];
}

/**
 * Produce the route payload, or null when the rider has not consented, the
 * ride is too short to anonymise, or the track is unusable.
 *
 * Coordinates are rounded to 4 decimal places (~11 m). Full GPS precision is
 * pointless for planning use and only makes a track easier to match against
 * an individual.
 */
export function exportRoute(points: GeoPoint[]): ExportedRoute | null {
  if (!mayShareRoute()) return null;
  if (points.length < 2) return null;

  const total = cumulative(points).pop() ?? 0;
  const kept = clipEndpoints(points);
  if (kept.length < 2) return null;

  const keptTotal = cumulative(kept).pop() ?? 0;
  if (keptTotal < MIN_EXPORTABLE_METERS) return null;

  return {
    points: kept.map((p) => ({
      lat: Math.round(p.lat * 1e4) / 1e4,
      lon: Math.round(p.lon * 1e4) / 1e4,
    })),
    clippedMeters: Math.max(0, Math.round(total - keptTotal)),
  };
}
