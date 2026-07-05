/**
 * Offline map region packs.
 *
 * A region pack is a single PMTiles file (vector tiles, protomaps schema)
 * covering one metro area. The rider downloads it ONCE, explicitly, over
 * WiFi — after that every map in the app renders 100% locally. The only
 * thing a pack download reveals is "someone in <metro>" at download time;
 * never a route, never a position, never per-ride traffic.
 *
 * Packs are built with the pmtiles CLI from the public Protomaps daily
 * build (see docs/OFFLINE_MAPS.md) and hosted as static files.
 *
 * This module is pure (no RN imports) so it's unit-testable under node.
 */

/** [west, south, east, north] in degrees. */
export type BBox = readonly [number, number, number, number];

export interface RegionPack {
  id: string;
  name: string;
  bbox: BBox;
  /** Approximate download size, for the UI. */
  approxMB: number;
}

/** Static host for the .pmtiles packs (see deploy/ Caddyfile). */
export const PACK_BASE_URL = 'https://packs.pedalshield.app';

export function packUrl(pack: RegionPack): string {
  return `${PACK_BASE_URL}/${pack.id}.pmtiles`;
}

/** Local filename a downloaded pack is stored under. */
export function packFilename(pack: RegionPack): string {
  return `map-pack-${pack.id}.pmtiles`;
}

/**
 * Launch-city packs. Order matters only for display. Keep bboxes generous —
 * a ride that leaves the bbox just falls back to the tileless renderer.
 */
export const REGION_PACKS: readonly RegionPack[] = [
  {
    id: 'sf-bay',
    name: 'SF Bay Area',
    bbox: [-123.05, 36.95, -121.20, 38.35],
    approxMB: 42,
  },
  {
    id: 'nyc',
    name: 'New York City metro',
    bbox: [-74.55, 40.35, -73.35, 41.15],
    approxMB: 55,
  },
  {
    id: 'la',
    name: 'Los Angeles metro',
    bbox: [-118.95, 33.55, -117.45, 34.45],
    approxMB: 48,
  },
  {
    id: 'london',
    name: 'Greater London',
    bbox: [-0.75, 51.20, 0.45, 51.75],
    approxMB: 38,
  },
  {
    id: 'berlin',
    name: 'Berlin–Brandenburg',
    bbox: [12.85, 52.20, 13.95, 52.75],
    approxMB: 30,
  },
] as const;

export function coversPoint(bbox: BBox, lat: number, lon: number): boolean {
  const [w, s, e, n] = bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

function bboxArea(bbox: BBox): number {
  const [w, s, e, n] = bbox;
  return Math.max(0, e - w) * Math.max(0, n - s);
}

/**
 * The best (smallest) pack covering a point, or null. Smallest-area wins so
 * a city pack beats a hypothetical country pack.
 */
export function packCovering(
  lat: number,
  lon: number,
  packs: readonly RegionPack[] = REGION_PACKS,
): RegionPack | null {
  let best: RegionPack | null = null;
  for (const p of packs) {
    if (!coversPoint(p.bbox, lat, lon)) continue;
    if (!best || bboxArea(p.bbox) < bboxArea(best.bbox)) best = p;
  }
  return best;
}
