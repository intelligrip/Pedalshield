import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { centroidTile, tileDistance, tileIdFor, tilesWithin } from '../tiles.ts';
import { hexCenter, layoutFog } from '../fogLayout.ts';
import { activeQuest } from '../quests.ts';

const C = tileIdFor(44.058, -121.315);

describe('neighbourhoods', () => {
  it('a hex disc of radius R has 3R(R+1)+1 cells', () => {
    for (const R of [0, 1, 2, 6]) {
      const ts = tilesWithin(C, R);
      assert.equal(ts.length, 3 * R * (R + 1) + 1);
      assert.equal(new Set(ts).size, ts.length);
      assert.ok(ts.every((t) => tileDistance(t, C) <= R));
    }
  });

  it('centroid of a symmetric set is its centre', () => {
    assert.equal(centroidTile(tilesWithin(C, 3)), C);
    assert.equal(centroidTile([]), null);
  });

  it('neighbouring hex centres are one width apart on screen', () => {
    const a = hexCenter(0, 0);
    const b = hexCenter(1, 0);
    const c = hexCenter(0, 1);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - Math.sqrt(3)) < 1e-9);
    assert.ok(Math.abs(Math.hypot(c.x - a.x, c.y - a.y) - Math.sqrt(3)) < 1e-9);
  });
});

describe('layoutFog', () => {
  const q = activeQuest();
  const center = centroidTile(q.tiles)!;

  it('frames the whole quest at the default radius', () => {
    const L = layoutFog({ center, radius: 9, unlocked: new Set(), questStops: q.stops });
    const ids = new Set(L.cells.map((c) => c.id));
    assert.ok(q.tiles.every((t) => ids.has(t)), 'a quest stop is off-screen');
    assert.equal(L.cells.filter((c) => c.state === 'quest').length, q.tiles.length);
  });

  it('marks cleared, bloom and cleared-quest cells', () => {
    const near = tilesWithin(center, 1).filter((t) => !q.tiles.includes(t));
    const unlocked = new Set([near[0], near[1], q.tiles[0]]);
    const L = layoutFog({
      center,
      radius: 9,
      unlocked,
      bloom: new Set([near[1]]),
      questStops: q.stops,
    });
    const state = (id: string) => L.cells.find((c) => c.id === id)!.state;
    assert.equal(state(near[0]), 'clear');
    assert.equal(state(near[1]), 'bloom');
    assert.equal(state(q.tiles[0]), 'questClear');
    assert.equal(state(q.tiles[1]), 'quest');
  });

  it('counts cleared tiles that fall outside the view', () => {
    const far = tileIdFor(45.5, -122.6); // Portland
    const L = layoutFog({ center, radius: 4, unlocked: new Set([far]) });
    assert.equal(L.clearOutside, 1);
  });

  it('never needs or emits a coordinate', () => {
    const L = layoutFog({ center, radius: 2, unlocked: new Set() });
    const json = JSON.stringify(L);
    assert.equal(/"(lat|lon)"/.test(json), false);
  });
});
