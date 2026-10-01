/**
 * The private atlas. Two properties matter: it only ever holds tile IDs, and
 * it never loses tiles or double-counts them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_ATLAS,
  clearAtlas,
  getAtlas,
  mergeRide,
  parseAtlas,
  recordRideTiles,
} from '../atlas.ts';

const A = 'fl1:-30062:11405';
const B = 'fl1:-30061:11405';
const C = 'fl1:-30060:11405';

describe('mergeRide', () => {
  it('reports only first-time tiles as newly unlocked', () => {
    const r1 = mergeRide(EMPTY_ATLAS, [A, B]);
    assert.deepEqual(r1.newlyUnlocked, [A, B].sort());
    const r2 = mergeRide(r1.atlas, [B, C]);
    assert.deepEqual(r2.newlyUnlocked, [C]);
    assert.deepEqual(r2.atlas.tiles, [A, B, C].sort());
    assert.equal(r2.atlas.rides, 2);
  });

  it('a re-ride of known ground blooms nothing but still counts as a ride', () => {
    const r1 = mergeRide(EMPTY_ATLAS, [A]);
    const r2 = mergeRide(r1.atlas, [A]);
    assert.deepEqual(r2.newlyUnlocked, []);
    assert.equal(r2.atlas.rides, 2);
  });

  it('an empty ride changes nothing', () => {
    const r = mergeRide(EMPTY_ATLAS, []);
    assert.deepEqual(r.atlas, EMPTY_ATLAS);
  });

  it('drops anything that is not a tile id', () => {
    const r = mergeRide(EMPTY_ATLAS, [A, '44.0581,-121.335', 'fl1:1', '']);
    assert.deepEqual(r.atlas.tiles, [A]);
  });

  it('does not mutate its input', () => {
    const before = mergeRide(EMPTY_ATLAS, [A]).atlas;
    const snapshot = JSON.stringify(before);
    mergeRide(before, [B]);
    assert.equal(JSON.stringify(before), snapshot);
  });
});

describe('parseAtlas', () => {
  it('survives empty, garbage and tampered storage', () => {
    assert.deepEqual(parseAtlas(null), EMPTY_ATLAS);
    assert.deepEqual(parseAtlas('not json'), EMPTY_ATLAS);
    const p = parseAtlas(JSON.stringify({ tiles: [B, A, A, { lat: 44 }, '44.05'], rides: -3 }));
    assert.deepEqual(p.tiles, [A, B].sort());
    assert.equal(p.rides, 0);
  });

  it('stores nothing but v, tiles and rides', () => {
    const p = parseAtlas(JSON.stringify({ v: 1, tiles: [A], rides: 1, polyline: 'xyz', lat: 44 }));
    assert.deepEqual(Object.keys(p).sort(), ['rides', 'tiles', 'v']);
  });
});

describe('stored atlas (in-memory adapter under node)', () => {
  it('persists across a merge and can be wiped', async () => {
    await clearAtlas();
    const r = await recordRideTiles([A, B]);
    assert.deepEqual(r.newlyUnlocked, [A, B].sort());
    assert.deepEqual(getAtlas().tiles, [A, B].sort());
    await clearAtlas();
    assert.deepEqual(getAtlas(), EMPTY_ATLAS);
  });
});
