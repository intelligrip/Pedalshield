/**
 * Generic geographic helpers (open source, MIT).
 *
 * This is plain, well-known geometry — deliberately NOT part of the
 * proprietary anti-cheat engine. The ride UI and stats use it directly, and
 * the private engine imports it too, so it lives in the open interface layer.
 */

import type { GeoPoint } from './types.ts';

const EARTH_RADIUS_KM = 6371.0088;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Haversine distance between two GPS points, in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
