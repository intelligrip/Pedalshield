/**
 * "Spend Nearby" — pure geo + OpenStreetMap helpers.
 *
 * Zecmap (the BTCMap-style Zcash merchant map) is built on OpenStreetMap, so
 * the merchant data lives in OSM as tagged nodes/ways and is queryable for
 * free via the Overpass API — no key, no partnership. This module builds the
 * query, parses the response, and does distance math. Everything here is pure
 * and Node-testable; the network call + device location live in overpass.ts.
 *
 * NOTE: the exact OSM tag convention for "accepts Zcash" is still settling in
 * the community. We query a UNION of the plausible tags and keep the list in
 * one place so it's a one-line fix once the convention is confirmed against
 * live Overpass data (the build sandbox can't reach Overpass; the phone can).
 */

/** Candidate OSM tags that mark a merchant as accepting Zcash. */
export const ZEC_OSM_TAGS = ['currency:ZEC', 'payment:zcash'] as const;

/** Candidate tag keys that might carry a payable Zcash address. */
const PAY_UA_KEYS = [
  'payment:zcash:address',
  'currency:ZEC:address',
  'zcash',
  'contact:zcash',
] as const;

export interface LatLng {
  lat: number;
  lon: number;
}

export interface SpendMerchant {
  /** Stable id: "<type>/<osm id>" (e.g. "node/123"). */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Human-friendly category derived from OSM tags. */
  category: string;
  /** A payable Zcash address if the merchant published one, else null. */
  payUA: string | null;
  /** Metres from the query point; filled in by sortByDistance. */
  distanceM?: number;
}

/** Great-circle distance in metres between two coordinates (haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
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

/** Compact human distance: "320 m" under ~1 km, otherwise "1.2 km". */
export function formatDistance(meters: number): string {
  if (!isFinite(meters) || meters < 0) return '—';
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Build an Overpass QL query for ZEC-accepting merchants within `radiusM`
 * of (lat, lon). Unions every candidate tag and asks for tags + a center
 * point (so ways/relations resolve to a coordinate).
 */
export function buildOverpassQuery(
  center: LatLng,
  radiusM: number,
  tags: readonly string[] = ZEC_OSM_TAGS,
): string {
  const { lat, lon } = center;
  const clauses = tags
    .map((t) => `nwr(around:${radiusM},${lat},${lon})["${t}"];`)
    .join('');
  return `[out:json][timeout:25];(${clauses});out center tags;`;
}

/** Prettify an OSM tag value: "bicycle_shop" -> "Bicycle shop". */
function prettify(v: string): string {
  const s = v.replace(/_/g, ' ').trim();
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Derive a human category from OSM tags. */
export function merchantCategory(tags: Record<string, string>): string {
  const key = ['shop', 'amenity', 'tourism', 'office', 'craft'].find(
    (k) => tags[k],
  );
  return key ? prettify(tags[key]) : 'Merchant';
}

/** Extract a published Zcash address from tags, if it looks like one. */
export function merchantPayUA(tags: Record<string, string>): string | null {
  for (const k of PAY_UA_KEYS) {
    const v = tags[k];
    if (v && /^(u1|zs1|t1|t3)[0-9a-z]{10,}$/i.test(v.trim())) {
      return v.trim();
    }
  }
  return null;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Parse an Overpass JSON response into SpendMerchant[]. Skips entries with
 *  no resolvable coordinate. Unnamed places get a category-based label. */
export function parseOverpass(json: unknown): SpendMerchant[] {
  const elements: OverpassElement[] =
    (json as { elements?: OverpassElement[] })?.elements ?? [];
  const out: SpendMerchant[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const tags = el.tags ?? {};
    const category = merchantCategory(tags);
    out.push({
      id: `${el.type}/${el.id}`,
      name: tags.name?.trim() || category,
      lat,
      lon,
      category,
      payUA: merchantPayUA(tags),
    });
  }
  return out;
}

/** Annotate with distance from `from` and sort nearest-first. */
export function sortByDistance(
  merchants: SpendMerchant[],
  from: LatLng,
): SpendMerchant[] {
  return merchants
    .map((m) => ({ ...m, distanceM: haversineMeters(from, m) }))
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

/** Platform-appropriate "directions to here" URL for Linking.openURL. */
export function directionsUrl(
  m: { lat: number; lon: number; name: string },
  platform: 'ios' | 'android' | string,
): string {
  const label = encodeURIComponent(m.name);
  if (platform === 'ios') {
    return `https://maps.apple.com/?daddr=${m.lat},${m.lon}&q=${label}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}`;
}
