import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { liveFog, stripStart } from '../liveFog.ts';
import { tilesForRide } from '../tiles.ts';

const BASE = { lat: 44.058, lon: -121.335 };
const k = 111_320 * Math.cos((BASE.lat * Math.PI) / 180);
const east = (m: number) => {
  const out: { lat: number; lon: number }[] = [];
  for (let d = 0; d <= m; d += 10) out.push({ lat: BASE.lat, lon: BASE.lon + d / k });
  return out;
};

describe('live fog', () => {
  it('lights nothing inside the first 250 m', () => {
    const f = liveFog(east(200), new Set(), null);
    assert.deepEqual(f.rideTiles, []);
    assert.equal(f.current, null, 'no current cell shown near the start');
    assert.ok(f.warmupLeftM > 0 && f.warmupLeftM <= 60);
  });

  it('lights cells once past the start strip', () => {
    const f = liveFog(east(2000), new Set(), null);
    assert.ok(f.rideTiles.length >= 3);
    assert.equal(f.warmupLeftM, 0);
    assert.ok(f.current);
  });

  it('counts only cells new to the atlas', () => {
    const all = liveFog(east(2000), new Set(), null).rideTiles;
    const f = liveFog(east(2000), new Set(all.slice(0, 2)), null);
    assert.equal(f.newTiles.length, all.length - 2);
  });

  it('never shows fewer cells than the final ride, never cells from the start strip', () => {
    const route = east(3000).map((p, i) => ({ ...p, altitude: null, accuracy: 5, speed: 5, timestamp: i }));
    const live = new Set(liveFog(route, new Set(), null).rideTiles);
    for (const t of tilesForRide(route)) assert.ok(live.has(t), `final cell ${t} missing live`);
    const startOnly = new Set(liveFog(east(240), new Set(), null).rideTiles);
    assert.equal(startOnly.size, 0);
  });

  it('tracks chapter progress live', () => {
    const f = liveFog(east(2000), new Set(), { kind: 'newCells', n: 3 });
    assert.ok(f.chapter);
    assert.equal(f.chapter!.done, true);
  });

  it('stripStart drops non-finite points', () => {
    const r = [...east(400)];
    r.splice(5, 0, { lat: Number.NaN, lon: Number.NaN });
    assert.ok(stripStart(r).every((p) => Number.isFinite(p.lat)));
  });
});
