/**
 * Network + device-location layer for "Spend Nearby".
 *
 * Pulls ZEC-accepting merchants from OpenStreetMap via the public Overpass
 * API (no key) and gets the rider's one-shot position from expo-location.
 * Kept apart from geo.ts so all the parsing/maths stays pure + testable.
 */

import {
  buildOverpassQuery,
  parseOverpass,
  sortByDistance,
  type LatLng,
  type SpendMerchant,
} from './geo.ts';

// Public Overpass mirrors. We try them in order so a single overloaded
// instance doesn't break the feature.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export type LocationState =
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'ok'; coords: LatLng };

/** One-shot foreground location request (same permission as ride tracking). */
export async function getDeviceLocation(): Promise<LocationState> {
  try {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return { status: 'denied' };
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: 'ok',
      coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Fetch ZEC-accepting merchants within `radiusM` of `center`, nearest-first.
 * Throws on total network failure so the screen can show a retry.
 */
export async function fetchNearbyMerchants(
  center: LatLng,
  radiusM = 5000,
): Promise<SpendMerchant[]> {
  const query = buildOverpassQuery(center, radiusM);
  let lastErr: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status}`);
        continue;
      }
      const json = await res.json();
      return sortByDistance(parseOverpass(json), center);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('Could not reach the merchant map');
}
