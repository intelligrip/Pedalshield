/**
 * Fogline tiles — turn a ride into the set of fog cells it unlocked.
 *
 * Pure module (no RN imports) so it is testable under node and auditable in
 * one place. Runs ON DEVICE ONLY; the polyline it consumes never leaves.
 *
 * ── ORDER OF OPERATIONS (privacy-load-bearing) ───────────────────────────
 *   1. Strip the first and last ENDPOINT_CLIP_METERS of the track, using the
 *      same `clipEndpoints` that guards route export. Stripping happens on
 *      the raw polyline BEFORE any tiling, so stripped geometry cannot
 *      influence which cells unlock — not even a neighbour.
 *   2. Densify the remaining track, refusing to interpolate across gaps.
 *   3. Accumulate path length per cell; unlock cells with enough of it.
 *
 * ── GRID CHOICE (documented, deliberate) ─────────────────────────────────
 * Pointy-top hexagons laid on Web Mercator (EPSG:3857) metres, axial (q, r)
 * coordinates. Not H3, for three reasons:
 *   - No new dependency. h3-js is an emscripten build whose Hermes behaviour
 *     we would have to verify before a deadline; this is ~60 lines of maths.
 *   - The basemap is Mercator, so these cells render as perfectly regular
 *     hexagons on screen. H3 cells do not.
 *   - Tile IDs are namespaced `fl1:` so a later move to H3 is a new
 *     namespace, not a silent reinterpretation of existing atlases.
 * Cost of the choice: ground size varies with latitude (Mercator). With
 * HEX_SIZE_MERCATOR_M = 320 a cell is ~400 m flat-to-flat at Bend (44°N),
 * ~450 m at 35°N, ~555 m at the equator. Comparable to H3 res 9 (~350 m) in
 * the latitudes we care about.
 */

import type { GeoPoint } from '../verification/types.ts';
import { clipEndpoints, ENDPOINT_CLIP_METERS } from '../ride/routeExport.ts';

/** Bump only with a new namespace — atlases store these strings forever. */
export const TILE_NAMESPACE = 'fl1';

/** Hex circumradius in Mercator metres. See header for ground sizes. */
export const HEX_SIZE_MERCATOR_M = 320;

/**
 * Minimum ridden path inside a cell before it unlocks, in ground metres.
 * Stops GPS jitter along a boundary from lighting up the neighbour, and
 * stops a corner-clip from counting as "having been there".
 */
export const MIN_PATH_IN_TILE_M = 40;

/**
 * Never interpolate across a gap longer than this (ground metres). A GPS
 * dropout — or a teleport the verifier did not excise — must not paint a
 * straight line of cells the rider never entered. Only the two real fixes
 * on either side of the gap contribute.
 */
export const MAX_INTERP_GAP_M = 150;

/** Densification step in ground metres; well under a cell width. */
const STEP_M = 20;

/** Hard ceiling on cells one ride may unlock (bounds storage and payloads). */
export const MAX_TILES_PER_RIDE = 400;

export { ENDPOINT_CLIP_METERS };

/* ------------------------------------------------------------------ */
/* Projection + hex maths                                              */
/* ------------------------------------------------------------------ */

const R_MERC = 6378137;
const SQRT3 = Math.sqrt(3);
const MAX_LAT = 85.05112878;

function toMercator(lat: number, lon: number): { x: number; y: number } {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const phi = (clamped * Math.PI) / 180;
  return {
    x: (R_MERC * lon * Math.PI) / 180,
    y: R_MERC * Math.log(Math.tan(Math.PI / 4 + phi / 2)),
  };
}

function fromMercator(x: number, y: number): { lat: number; lon: number } {
  return {
    lat: (Math.atan(Math.sinh(y / R_MERC)) * 180) / Math.PI,
    lon: (x / R_MERC) * (180 / Math.PI),
  };
}

function cubeRound(qf: number, rf: number): { q: number; r: number } {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // Normalise -0 so IDs are stable strings.
  return { q: q + 0, r: r + 0 };
}

function axialFor(lat: number, lon: number): { q: number; r: number } {
  const { x, y } = toMercator(lat, lon);
  const qf = ((SQRT3 / 3) * x - (1 / 3) * y) / HEX_SIZE_MERCATOR_M;
  const rf = ((2 / 3) * y) / HEX_SIZE_MERCATOR_M;
  return cubeRound(qf, rf);
}

function formatId(q: number, r: number): string {
  return `${TILE_NAMESPACE}:${q}:${r}`;
}

/** Parse a tile ID, or null if it is not a well-formed Fogline v1 ID. */
export function parseTileId(id: string): { q: number; r: number } | null {
  const m = /^fl1:(-?\d+):(-?\d+)$/.exec(id);
  if (!m) return null;
  return { q: Number(m[1]), r: Number(m[2]) };
}

export function isTileId(id: unknown): id is string {
  return typeof id === 'string' && parseTileId(id) !== null;
}

/** The tile containing a coordinate. */
export function tileIdFor(lat: number, lon: number): string {
  const { q, r } = axialFor(lat, lon);
  return formatId(q, r);
}

/** Centre of a tile — for drawing fog on device. Never transmitted. */
export function tileCenter(id: string): { lat: number; lon: number } {
  const a = parseTileId(id);
  if (!a) throw new Error(`not a tile id: ${id}`);
  const x = HEX_SIZE_MERCATOR_M * (SQRT3 * a.q + (SQRT3 / 2) * a.r);
  const y = HEX_SIZE_MERCATOR_M * 1.5 * a.r;
  return fromMercator(x, y);
}

/** Six corners, for rendering a fog hole. Closed ring (first == last). */
export function tileBoundary(id: string): { lat: number; lon: number }[] {
  const a = parseTileId(id);
  if (!a) throw new Error(`not a tile id: ${id}`);
  const cx = HEX_SIZE_MERCATOR_M * (SQRT3 * a.q + (SQRT3 / 2) * a.r);
  const cy = HEX_SIZE_MERCATOR_M * 1.5 * a.r;
  const ring: { lat: number; lon: number }[] = [];
  for (let i = 0; i <= 6; i++) {
    const ang = (Math.PI / 180) * (60 * (i % 6) - 30);
    ring.push(
      fromMercator(
        cx + HEX_SIZE_MERCATOR_M * Math.cos(ang),
        cy + HEX_SIZE_MERCATOR_M * Math.sin(ang),
      ),
    );
  }
  return ring;
}

/* ------------------------------------------------------------------ */
/* Ride → tiles                                                        */
/* ------------------------------------------------------------------ */

function groundMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Tiles for an ALREADY-CLIPPED path. Exported for tests and for callers that
 * have clipped themselves; ride code should call `tilesForRide`.
 */
export function tilesForPath(points: readonly { lat: number; lon: number }[]): string[] {
  const pathIn = new Map<string, number>();
  const add = (lat: number, lon: number, metres: number) => {
    const id = tileIdFor(lat, lon);
    pathIn.set(id, (pathIn.get(id) ?? 0) + metres);
  };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!Number.isFinite(a.lat + a.lon + b.lat + b.lon)) continue;
    const len = groundMeters(a, b);
    if (len === 0) continue;

    if (len > MAX_INTERP_GAP_M) {
      // Do not paint across the gap. Credit nothing for it: the rider
      // proved presence at the two fixes, not along the line between them.
      continue;
    }

    // Midpoint sampling: each sub-segment's length is credited to the cell
    // its midpoint falls in. Linear lat/lon interpolation is fine at <150 m.
    const n = Math.max(1, Math.ceil(len / STEP_M));
    const sub = len / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      add(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t, sub);
    }
  }

  const unlocked = [...pathIn.entries()]
    .filter(([, m]) => m >= MIN_PATH_IN_TILE_M)
    .sort((x, y) => y[1] - x[1]) // keep the most-ridden cells if capped
    .slice(0, MAX_TILES_PER_RIDE)
    .map(([id]) => id);

  return unlocked.sort();
}

/**
 * The cells a ride unlocks. Endpoints are stripped first, unconditionally;
 * a ride too short to survive stripping unlocks nothing.
 */
export function tilesForRide(geo: readonly GeoPoint[]): string[] {
  // Drop non-finite fixes BEFORE clipping: one NaN would poison the
  // cumulative distance clipEndpoints relies on and silently drop the rest.
  const clean = geo.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const clipped = clipEndpoints(clean, ENDPOINT_CLIP_METERS);
  if (clipped.length < 2) return [];
  return tilesForPath(clipped);
}

/* ------------------------------------------------------------------ */
/* Neighbourhoods — for drawing the fog field on device               */
/* ------------------------------------------------------------------ */

const AXIAL_DIRS: readonly [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/** Hex distance between two tiles, in cells. */
export function tileDistance(a: string, b: string): number {
  const p = parseTileId(a);
  const q = parseTileId(b);
  if (!p || !q) return Infinity;
  const dq = p.q - q.q;
  const dr = p.r - q.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Every tile within `radius` cells of `center`, centre included. */
export function tilesWithin(center: string, radius: number): string[] {
  const c = parseTileId(center);
  if (!c) return [];
  const out: string[] = [];
  const R = Math.max(0, Math.floor(radius));
  for (let dq = -R; dq <= R; dq++) {
    for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
      out.push(formatId(c.q + dq, c.r + dr));
    }
  }
  return out;
}

/** The tile nearest the centre of mass of a set — for framing a view. */
export function centroidTile(tiles: readonly string[]): string | null {
  let sq = 0;
  let sr = 0;
  let n = 0;
  for (const t of tiles) {
    const a = parseTileId(t);
    if (!a) continue;
    sq += a.q;
    sr += a.r;
    n++;
  }
  if (n === 0) return null;
  const { q, r } = cubeRound(sq / n, sr / n);
  return formatId(q, r);
}

export { AXIAL_DIRS };
