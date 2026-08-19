/**
 * Pre-ride map readiness.
 *
 * The load-bearing assertion is the last describe block: readiness NEVER
 * blocks a ride. If that ever changes, a rider at a trailhead with no signal
 * loses the ability to earn — trading the app's real job for a cosmetic one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapReadiness,
  packCovers,
  packForPoint,
  shouldPromptDownload,
} from '../readiness.ts';
import { METRO_PACKS } from '../regions.ts';

// Downtown Bend, and a point in the Pacific that no pack covers.
const BEND = { lat: 44.058, lon: -121.315 };
const OCEAN = { lat: 35.0, lon: -140.0 };

describe('point to pack', () => {
  it('finds the pack containing a point', () => {
    assert.equal(packForPoint(BEND.lat, BEND.lon)?.id, 'bend');
  });

  it('returns null outside every pack', () => {
    assert.equal(packForPoint(OCEAN.lat, OCEAN.lon), null);
  });

  it('does not confuse latitude and longitude', () => {
    // A swapped pair must not accidentally match — this is the classic bug.
    assert.equal(packForPoint(BEND.lon, BEND.lat), null);
  });

  it('bbox containment is inclusive of its own corners', () => {
    for (const p of METRO_PACKS) {
      const [w, s, e, n] = p.bbox;
      assert.ok(packCovers(p, s, w), `${p.id} SW corner`);
      assert.ok(packCovers(p, n, e), `${p.id} NE corner`);
      assert.ok(!packCovers(p, n + 1, e), `${p.id} north of bbox`);
    }
  });
});

describe('readiness', () => {
  it('prompts when the local pack is not downloaded', () => {
    const r = mapReadiness({ downloadedIds: [], point: BEND });
    assert.equal(r.status, 'missing');
    assert.equal(r.pack?.id, 'bend');
    assert.match(r.message ?? '', /Bend/);
    // The prompt must say what it costs and that it needs WiFi, or the rider
    // taps it on cellular at the trailhead — the exact failure being avoided.
    assert.match(r.message ?? '', /MB/);
    assert.match(r.message ?? '', /WiFi/i);
    assert.ok(shouldPromptDownload(r));
  });

  it('says nothing when the local pack is already downloaded', () => {
    const r = mapReadiness({ downloadedIds: ['bend'], point: BEND });
    assert.equal(r.status, 'ready');
    assert.equal(r.message, null);
    assert.ok(!shouldPromptDownload(r));
  });

  it('having the wrong pack is not being ready', () => {
    const r = mapReadiness({ downloadedIds: ['nyc'], point: BEND });
    assert.equal(r.status, 'missing');
    assert.equal(r.pack?.id, 'bend');
  });

  it('stays quiet where no pack exists — the rider cannot act on it', () => {
    const r = mapReadiness({ downloadedIds: [], point: OCEAN });
    assert.equal(r.status, 'uncovered');
    assert.equal(r.message, null);
    assert.ok(!shouldPromptDownload(r));
  });
});

describe('readiness without a position', () => {
  it('warns only when nothing at all is downloaded', () => {
    const r = mapReadiness({ downloadedIds: [], point: null });
    assert.equal(r.status, 'unknown');
    assert.ok(shouldPromptDownload(r));
  });

  it('does not nag a rider who already has a pack', () => {
    const r = mapReadiness({ downloadedIds: ['bend'] });
    assert.equal(r.message, null);
  });
});

describe('readiness never blocks a ride', () => {
  it('exposes no blocking signal of any kind', () => {
    // Deliberately structural: the module returns advice, not permission.
    // Adding a `blocked`/`canRide` field should fail this and force a
    // conversation about whether a missing map may stop a rider earning.
    const r = mapReadiness({ downloadedIds: [], point: BEND });
    for (const key of Object.keys(r)) {
      assert.ok(
        !/block|deny|prevent|canRide|allow/i.test(key),
        `readiness gained a blocking field: "${key}"`,
      );
    }
    assert.deepEqual(Object.keys(r).sort(), ['message', 'pack', 'status']);
  });
});
