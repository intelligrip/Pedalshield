/**
 * Live fog — what the rider sees DURING a ride.
 *
 * Computes cells from the in-progress route, on the phone, every update. The
 * route is the same on-device buffer the session already holds; nothing here
 * stores or sends it.
 *
 * The start strip applies live: nothing lights in the first 250 m, so the
 * bloom never points at the rider's door. The END strip cannot be known until
 * the ride ends, so live counts can run slightly ahead of the final tally
 * (cells entered in the last 250 m drop out). The UI says "about".
 */

import { ENDPOINT_CLIP_METERS, tileIdFor, tilesForPath } from './tiles.ts';
import { evaluateRule, type ChapterRule, type RuleResult } from './chapters.ts';

type Pt = { lat: number; lon: number };

function metres(a: Pt, b: Pt): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Drop the first `clip` metres of a path (start strip only). */
export function stripStart(points: readonly Pt[], clip = ENDPOINT_CLIP_METERS): Pt[] {
  const clean = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  let run = 0;
  for (let i = 1; i < clean.length; i++) {
    run += metres(clean[i - 1], clean[i]);
    if (run >= clip) return clean.slice(i);
  }
  return [];
}

export interface LiveFog {
  /** Cells this ride has lit so far (start strip applied). */
  rideTiles: string[];
  /** Of those, cells not in the atlas before the ride. */
  newTiles: string[];
  /** Cell the rider is in now — for framing the view only. Null in the start strip. */
  current: string | null;
  /** Live progress on the current chapter, if one is being played. */
  chapter: RuleResult | null;
  /** Metres still inside the start strip (0 once past it). */
  warmupLeftM: number;
}

export function liveFog(
  route: readonly Pt[],
  atlasBefore: ReadonlySet<string>,
  rule: ChapterRule | null,
): LiveFog {
  const kept = stripStart(route);
  const rideTiles = kept.length >= 2 ? tilesForPath(kept) : [];
  const newTiles = rideTiles.filter((t) => !atlasBefore.has(t));

  let ridden = 0;
  for (let i = 1; i < route.length; i++) ridden += metres(route[i - 1], route[i]);
  const warmupLeftM = Math.max(0, Math.round(ENDPOINT_CLIP_METERS - ridden));

  const last = kept.length > 0 ? kept[kept.length - 1] : null;
  return {
    rideTiles,
    newTiles,
    current: last ? tileIdFor(last.lat, last.lon) : null,
    chapter: rule ? evaluateRule(rule, rideTiles, [...atlasBefore]) : null,
    warmupLeftM,
  };
}
