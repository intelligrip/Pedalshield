/**
 * Fogline tiling. The privacy-critical assertion is the endpoint block:
 * geometry inside the stripped first/last 250 m must not influence which
 * cells unlock — not by a single cell.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENDPOINT_CLIP_METERS,
  MAX_INTERP_GAP_M,
  MIN_PATH_IN_TILE_M,
  isTileId,
  parseTileId,
  tileBoundary,
  tileCenter,
  tileIdFor,
  tilesForPath,
  tilesForRide,
} from '../tiles.ts';
import { distanceMeters } from '../../ride/routeExport.ts';
import type { GeoPoint } from '../../verification/types.ts';

// Downtown Bend.
const BASE = { lat: 44.058, lon: -121.335 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

function pt(lat: number, lon: number, i = 0): GeoPoint {
  return { lat, lon, altitude: null, accuracy: 5, speed: 5, timestamp: 1_000 + i * 2_000 };
}

/** Points every `step` m from `from`, heading east (dir 'E') or north ('N'). */
function leg(
  from: { lat: number; lon: number },
  metres: number,
  dir: 'E' | 'N',
  step = 10,
): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let d = 0; d <= metres; d += step) {
    out.push(
      dir === 'E'
        ? pt(from.lat, from.lon + d / mPerDegLon(from.lat), out.length)
        : pt(from.lat + d / M_PER_DEG_LAT, from.lon, out.length),
    );
  }
  return out;
}

/** A ~6 km fixture ride: 4 km east, then 2 km north. */
function fixtureRide(): GeoPoint[] {
  const east = leg(BASE, 4000, 'E');
  const corner = east[east.length - 1];
  return [...east, ...leg(corner, 2000, 'N').slice(1)];
}

describe('tile ids', () => {
  it('are deterministic and namespaced', () => {
    const a = tileIdFor(BASE.lat, BASE.lon);
    assert.equal(a, tileIdFor(BASE.lat, BASE.lon));
    assert.match(a, /^fl1:-?\d+:-?\d+$/);
    assert.ok(isTileId(a));
    assert.ok(parseTileId(a));
  });

  it('reject malformed ids', () => {
    for (const bad of ['', 'fl1:1', 'fl2:1:2', 'fl1:1.5:2', '44.05,-121.3', 'fl1:a:b']) {
      assert.equal(isTileId(bad), false, bad);
    }
  });

  it('never produce -0 (ids must be stable strings)', () => {
    assert.ok(!tileIdFor(0.0001, 0.0001).includes('-0:'));
    assert.ok(!tileIdFor(0.0001, 0.0001).endsWith(':-0'));
  });

  it('a point lies within one cell radius of its tile centre', () => {
    for (const [dLat, dLon] of [[0, 0], [0.002, 0.003], [-0.004, 0.001], [0.0011, -0.0027]]) {
      const p = { lat: BASE.lat + dLat, lon: BASE.lon + dLon };
      const c = tileCenter(tileIdFor(p.lat, p.lon));
      const d = distanceMeters(pt(p.lat, p.lon), pt(c.lat, c.lon));
      // Circumradius on the ground at 44°N ≈ 320 m × cos(44°) ≈ 230 m.
      assert.ok(d <= 235, `point ${d.toFixed(0)} m from its centre`);
    }
  });

  it('cells are ~400 m across at Bend (documented grid size)', () => {
    // Neighbouring centres are one flat-to-flat width apart.
    const id = tileIdFor(BASE.lat, BASE.lon);
    const { q, r } = parseTileId(id)!;
    const c0 = tileCenter(id);
    const c1 = tileCenter(`fl1:${q + 1}:${r}`);
    const across = distanceMeters(pt(c0.lat, c0.lon), pt(c1.lat, c1.lon));
    assert.ok(across > 370 && across < 430, `cell width ${across.toFixed(0)} m`);
  });

  it('boundary is a closed hexagon around the centre', () => {
    const ring = tileBoundary(tileIdFor(BASE.lat, BASE.lon));
    assert.equal(ring.length, 7);
    assert.deepEqual(ring[0], ring[6]);
  });
});

describe('tilesForRide — endpoint stripping (privacy)', () => {
  it('uses the shared 250 m clip', () => {
    assert.equal(ENDPOINT_CLIP_METERS, 250);
  });

  it('a cell entered only in the first 250 m never unlocks', () => {
    // Walk east from BASE until the tile changes; that is a cell boundary.
    let boundaryM = 0;
    const startTile = tileIdFor(BASE.lat, BASE.lon);
    for (let d = 0; d < 1000; d += 1) {
      if (tileIdFor(BASE.lat, BASE.lon + d / mPerDegLon(BASE.lat)) !== startTile) {
        boundaryM = d;
        break;
      }
    }
    assert.ok(boundaryM > 0);

    // Start 120 m before the boundary and ride 3 km east, never returning.
    const startLon = BASE.lon + (boundaryM - 120) / mPerDegLon(BASE.lat);
    const ride = leg({ lat: BASE.lat, lon: startLon }, 3000, 'E');
    const homeCell = tileIdFor(ride[0].lat, ride[0].lon);

    // Unclipped, 120 m of riding in the home cell would unlock it…
    assert.ok(tilesForPath(ride).includes(homeCell), 'fixture sanity');
    // …but stripping happens first, so it must not.
    assert.ok(!tilesForRide(ride).includes(homeCell), 'home cell leaked into atlas');
  });

  it('the same holds at the end of the ride', () => {
    const ride = fixtureRide();
    const reversed = [...ride].reverse();
    assert.deepEqual(tilesForRide(ride), tilesForRide(reversed));
  });

  it('a ride too short to survive stripping unlocks nothing', () => {
    assert.deepEqual(tilesForRide(leg(BASE, 480, 'E')), []);
    assert.deepEqual(tilesForRide([]), []);
    assert.deepEqual(tilesForRide([pt(BASE.lat, BASE.lon)]), []);
  });
});

describe('tilesForRide — what unlocks', () => {
  it('unlocks a corridor of cells for the fixture ride', () => {
    const tiles = tilesForRide(fixtureRide());
    // ~5.5 km after stripping through ~400 m cells.
    assert.ok(tiles.length >= 10 && tiles.length <= 30, `got ${tiles.length}`);
    assert.ok(tiles.every(isTileId));
    assert.deepEqual(tiles, [...tiles].sort(), 'output is sorted');
    assert.equal(new Set(tiles).size, tiles.length, 'output is unique');
  });

  it('does not paint across a GPS gap (tile teleport)', () => {
    const a = leg(BASE, 600, 'E');
    const farStart = { lat: BASE.lat, lon: BASE.lon + 3000 / mPerDegLon(BASE.lat) };
    const b = leg(farStart, 600, 'E');
    const tiles = tilesForPath([...a, ...b]);

    // A cell squarely between the two legs (1.8 km east) must stay dark.
    const between = tileIdFor(BASE.lat, BASE.lon + 1800 / mPerDegLon(BASE.lat));
    assert.ok(!tiles.includes(between), 'gap was interpolated');
    assert.ok(MAX_INTERP_GAP_M < 400, 'gap limit must be under a cell width');
  });

  it('a corner-clip shorter than the minimum does not unlock a cell', () => {
    // 15 m of path entirely inside one cell.
    const tiles = tilesForPath(leg(BASE, 15, 'E', 5));
    assert.deepEqual(tiles, []);
    assert.ok(MIN_PATH_IN_TILE_M > 15);
  });

  it('a NaN fix is dropped, not allowed to poison the ride', () => {
    const ride = fixtureRide();
    const clean = tilesForRide(ride);
    ride.splice(100, 0, pt(Number.NaN, Number.NaN));
    assert.deepEqual(tilesForRide(ride), clean);
  });
});
