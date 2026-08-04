/**
 * Consent tiers + route export.
 *
 * These tests encode promises made to riders, not implementation details. If
 * one fails, the app is about to share something someone did not agree to —
 * treat a failure here as a privacy incident, not a broken test.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getCoopLevel,
  isDataCoopOptedIn,
  isSocialSharingOn,
  mayShareRoute,
  setCoopLevel,
  setDataCoopOptIn,
  setSocialSharing,
} from '../dataCoop.ts';
import {
  clipEndpoints,
  distanceMeters,
  exportRoute,
  ENDPOINT_CLIP_METERS,
  MIN_EXPORTABLE_METERS,
} from '../../ride/routeExport.ts';
import type { GeoPoint } from '../../verification/types.ts';

/** Straight eastward track of `n` points spaced `stepM` metres apart. */
function track(n: number, stepM = 50): GeoPoint[] {
  const out: GeoPoint[] = [];
  // ~0.00001 deg lon ≈ 0.82 m at 44°N (Bend). Derive the step from that.
  const degPerM = 1 / (111320 * Math.cos((44 * Math.PI) / 180));
  for (let i = 0; i < n; i++) {
    out.push({
      lat: 44.0582,
      lon: -121.3153 + i * stepM * degPerM,
      altitude: 1100,
      accuracy: 5,
      speed: 5,
      timestamp: 1_700_000_000_000 + i * 5000,
    });
  }
  return out;
}

describe('consent tiers', () => {
  beforeEach(async () => {
    await setCoopLevel(0);
    await setSocialSharing(false);
  });

  it('defaults to fully private', () => {
    assert.equal(getCoopLevel(), 0);
    assert.equal(isDataCoopOptedIn(), false);
    assert.equal(mayShareRoute(), false);
    assert.equal(isSocialSharingOn(), false);
  });

  it('level 1 shares aggregates but never route geometry', async () => {
    await setCoopLevel(1);
    assert.equal(isDataCoopOptedIn(), true);
    assert.equal(mayShareRoute(), false);
  });

  it('only level 2 permits route export', async () => {
    await setCoopLevel(2);
    assert.equal(mayShareRoute(), true);
  });

  it('social sharing is independent of commercial level', async () => {
    await setSocialSharing(true);
    // Visible to other riders, still selling nothing.
    assert.equal(isSocialSharingOn(), true);
    assert.equal(getCoopLevel(), 0);
    assert.equal(isDataCoopOptedIn(), false);
  });

  it('the legacy boolean opt-in lands at level 1, never level 2', async () => {
    // Consent to coarse buckets is not consent to share a route. Inferring
    // the stronger permission from the weaker one is the bait-and-switch this
    // redesign exists to prevent.
    await setDataCoopOptIn(true);
    assert.equal(getCoopLevel(), 1);
    assert.equal(mayShareRoute(), false);
  });

  it('revoking returns to fully private', async () => {
    await setCoopLevel(2);
    await setCoopLevel(0);
    assert.equal(mayShareRoute(), false);
    assert.equal(isDataCoopOptedIn(), false);
  });
});

describe('endpoint clipping', () => {
  it('removes at least the clip distance from both ends', () => {
    const t = track(80); // ~3.95 km
    const kept = clipEndpoints(t);
    assert.ok(kept.length > 0, 'expected geometry to survive');
    assert.ok(
      distanceMeters(t[0], kept[0]) >= ENDPOINT_CLIP_METERS - 60,
      'start not clipped far enough',
    );
    assert.ok(
      distanceMeters(t[t.length - 1], kept[kept.length - 1]) >=
        ENDPOINT_CLIP_METERS - 60,
      'end not clipped far enough',
    );
  });

  it('drops a ride too short to anonymise', () => {
    assert.equal(clipEndpoints(track(6)).length, 0); // ~250 m total
  });

  it('handles degenerate input without throwing', () => {
    assert.equal(clipEndpoints([]).length, 0);
    assert.equal(clipEndpoints(track(1)).length, 0);
  });
});

describe('exportRoute', () => {
  beforeEach(async () => {
    await setCoopLevel(0);
  });

  it('returns nothing below level 2, however long the ride', async () => {
    await setCoopLevel(1);
    assert.equal(exportRoute(track(200)), null);
  });

  it('exports clipped geometry at level 2', async () => {
    await setCoopLevel(2);
    const out = exportRoute(track(200)); // ~9.9 km
    assert.ok(out, 'expected an export');
    assert.ok(out.points.length > 2);
    assert.ok(out.clippedMeters >= ENDPOINT_CLIP_METERS);
  });

  it('never exports the true first or last fix', async () => {
    await setCoopLevel(2);
    const t = track(200);
    const out = exportRoute(t);
    assert.ok(out);
    const first = out.points[0];
    const last = out.points[out.points.length - 1];
    assert.notEqual(first.lon, Math.round(t[0].lon * 1e4) / 1e4);
    assert.notEqual(
      last.lon,
      Math.round(t[t.length - 1].lon * 1e4) / 1e4,
    );
  });

  it('refuses a ride that is too short once clipped', async () => {
    await setCoopLevel(2);
    // ~1.0 km total: 500 m of endpoints removed leaves under the floor.
    assert.equal(exportRoute(track(21)), null);
  });

  it('rounds coordinates to ~11 m', async () => {
    await setCoopLevel(2);
    const out = exportRoute(track(200));
    assert.ok(out);
    for (const p of out.points) {
      assert.equal(p.lat, Math.round(p.lat * 1e4) / 1e4);
      assert.equal(p.lon, Math.round(p.lon * 1e4) / 1e4);
    }
  });

  it('MIN_EXPORTABLE_METERS is above zero — no stub routes', () => {
    assert.ok(MIN_EXPORTABLE_METERS > 0);
  });
});
