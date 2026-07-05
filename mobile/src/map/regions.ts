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
 * Launch-city metro packs — small, fast downloads. Order matters only for
 * display. Keep bboxes generous — a ride that leaves the bbox just falls
 * back to the tileless renderer.
 */
export const METRO_PACKS: readonly RegionPack[] = [
  {
    id: 'bend',
    name: 'Bend, Oregon',
    bbox: [-121.60, 43.80, -121.05, 44.30],
    approxMB: 8,
  },
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

/**
 * All 50 US states — statewide coverage as a fallback where no metro pack
 * exists. Because packCovering() prefers the SMALLEST covering pack, a
 * rider in San Francisco is still offered the 42 MB sf-bay pack, not the
 * multi-GB California pack; states serve everyone outside the metros.
 *
 * Bboxes are generous rectangles (they overlap neighbors a little — that's
 * fine and even useful at borders). approxMB values are rough estimates at
 * maxzoom 15; update with real sizes after extraction
 * (docs/OFFLINE_MAPS.md). Alaska's bbox stops short of the antimeridian,
 * so the far western Aleutians are not covered.
 */
export const US_STATE_PACKS: readonly RegionPack[] = [
  { id: 'us-al', name: 'Alabama', bbox: [-88.5, 30.1, -84.9, 35.1], approxMB: 280 },
  { id: 'us-ak', name: 'Alaska', bbox: [-170.0, 51.2, -129.9, 71.4], approxMB: 450 },
  { id: 'us-az', name: 'Arizona', bbox: [-114.9, 31.3, -109.0, 37.05], approxMB: 380 },
  { id: 'us-ar', name: 'Arkansas', bbox: [-94.7, 33.0, -89.6, 36.6], approxMB: 220 },
  { id: 'us-ca', name: 'California', bbox: [-124.5, 32.5, -114.1, 42.05], approxMB: 1800 },
  { id: 'us-co', name: 'Colorado', bbox: [-109.1, 36.9, -102.0, 41.05], approxMB: 420 },
  { id: 'us-ct', name: 'Connecticut', bbox: [-73.75, 40.95, -71.75, 42.1], approxMB: 160 },
  { id: 'us-de', name: 'Delaware', bbox: [-75.8, 38.4, -74.9, 39.9], approxMB: 70 },
  { id: 'us-fl', name: 'Florida', bbox: [-87.7, 24.4, -79.9, 31.05], approxMB: 900 },
  { id: 'us-ga', name: 'Georgia', bbox: [-85.7, 30.3, -80.8, 35.05], approxMB: 450 },
  { id: 'us-hi', name: 'Hawaii', bbox: [-160.3, 18.8, -154.7, 22.3], approxMB: 90 },
  { id: 'us-id', name: 'Idaho', bbox: [-117.3, 41.9, -111.0, 49.05], approxMB: 260 },
  { id: 'us-il', name: 'Illinois', bbox: [-91.6, 36.9, -87.0, 42.6], approxMB: 550 },
  { id: 'us-in', name: 'Indiana', bbox: [-88.1, 37.7, -84.7, 41.8], approxMB: 320 },
  { id: 'us-ia', name: 'Iowa', bbox: [-96.7, 40.3, -90.1, 43.6], approxMB: 260 },
  { id: 'us-ks', name: 'Kansas', bbox: [-102.1, 36.9, -94.5, 40.1], approxMB: 240 },
  { id: 'us-ky', name: 'Kentucky', bbox: [-89.6, 36.4, -81.9, 39.2], approxMB: 280 },
  { id: 'us-la', name: 'Louisiana', bbox: [-94.1, 28.8, -88.7, 33.1], approxMB: 280 },
  { id: 'us-me', name: 'Maine', bbox: [-71.1, 42.9, -66.9, 47.5], approxMB: 180 },
  { id: 'us-md', name: 'Maryland', bbox: [-79.5, 37.8, -74.9, 39.8], approxMB: 260 },
  { id: 'us-ma', name: 'Massachusetts', bbox: [-73.6, 41.2, -69.9, 42.95], approxMB: 300 },
  { id: 'us-mi', name: 'Michigan', bbox: [-90.5, 41.6, -82.1, 48.3], approxMB: 550 },
  { id: 'us-mn', name: 'Minnesota', bbox: [-97.3, 43.4, -89.4, 49.4], approxMB: 380 },
  { id: 'us-ms', name: 'Mississippi', bbox: [-91.7, 30.1, -88.0, 35.05], approxMB: 220 },
  { id: 'us-mo', name: 'Missouri', bbox: [-95.8, 35.9, -89.1, 40.7], approxMB: 380 },
  { id: 'us-mt', name: 'Montana', bbox: [-116.1, 44.3, -104.0, 49.05], approxMB: 300 },
  { id: 'us-ne', name: 'Nebraska', bbox: [-104.1, 39.9, -95.3, 43.05], approxMB: 220 },
  { id: 'us-nv', name: 'Nevada', bbox: [-120.05, 35.0, -114.0, 42.05], approxMB: 260 },
  { id: 'us-nh', name: 'New Hampshire', bbox: [-72.6, 42.6, -70.6, 45.4], approxMB: 120 },
  { id: 'us-nj', name: 'New Jersey', bbox: [-75.6, 38.8, -73.85, 41.4], approxMB: 320 },
  { id: 'us-nm', name: 'New Mexico', bbox: [-109.1, 31.3, -103.0, 37.05], approxMB: 280 },
  { id: 'us-ny', name: 'New York', bbox: [-79.8, 40.4, -71.8, 45.05], approxMB: 700 },
  { id: 'us-nc', name: 'North Carolina', bbox: [-84.4, 33.75, -75.4, 36.6], approxMB: 480 },
  { id: 'us-nd', name: 'North Dakota', bbox: [-104.1, 45.9, -96.5, 49.05], approxMB: 140 },
  { id: 'us-oh', name: 'Ohio', bbox: [-84.9, 38.4, -80.5, 42.0], approxMB: 480 },
  { id: 'us-ok', name: 'Oklahoma', bbox: [-103.1, 33.6, -94.4, 37.05], approxMB: 300 },
  { id: 'us-or', name: 'Oregon', bbox: [-124.6, 41.9, -116.4, 46.3], approxMB: 340 },
  { id: 'us-pa', name: 'Pennsylvania', bbox: [-80.6, 39.7, -74.6, 42.3], approxMB: 550 },
  { id: 'us-ri', name: 'Rhode Island', bbox: [-71.95, 41.1, -71.1, 42.05], approxMB: 60 },
  { id: 'us-sc', name: 'South Carolina', bbox: [-83.4, 32.0, -78.5, 35.25], approxMB: 280 },
  { id: 'us-sd', name: 'South Dakota', bbox: [-104.1, 42.4, -96.4, 45.95], approxMB: 150 },
  { id: 'us-tn', name: 'Tennessee', bbox: [-90.4, 34.9, -81.6, 36.7], approxMB: 360 },
  { id: 'us-tx', name: 'Texas', bbox: [-106.7, 25.8, -93.5, 36.55], approxMB: 1600 },
  { id: 'us-ut', name: 'Utah', bbox: [-114.1, 36.9, -109.0, 42.05], approxMB: 280 },
  { id: 'us-vt', name: 'Vermont', bbox: [-73.5, 42.7, -71.4, 45.05], approxMB: 90 },
  { id: 'us-va', name: 'Virginia', bbox: [-83.7, 36.5, -75.2, 39.5], approxMB: 450 },
  { id: 'us-wa', name: 'Washington', bbox: [-124.85, 45.5, -116.9, 49.05], approxMB: 420 },
  { id: 'us-wv', name: 'West Virginia', bbox: [-82.7, 37.2, -77.7, 40.7], approxMB: 200 },
  { id: 'us-wi', name: 'Wisconsin', bbox: [-92.9, 42.4, -86.7, 47.1], approxMB: 340 },
  { id: 'us-wy', name: 'Wyoming', bbox: [-111.1, 40.9, -104.0, 45.05], approxMB: 160 },
] as const;

/** Every downloadable pack. Metros first (smallest, most relevant). */
export const REGION_PACKS: readonly RegionPack[] = [
  ...METRO_PACKS,
  ...US_STATE_PACKS,
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
