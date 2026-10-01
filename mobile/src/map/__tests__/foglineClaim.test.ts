/**
 * Fogline claim — privacy contract. Nothing about where you rode leaves the
 * phone: no coordinates, no sensors, no timestamps, no distance, and no
 * tiles. If one of these fails, fix the change, not the test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOGLINE_CLAIM_KEYS,
  FORBIDDEN_KEYS,
  assertFoglineClaimSafe,
  buildFoglineClaim,
  foglineSigningMessage,
  questTilesHit,
  type FoglineQuest,
} from '../foglineClaim.ts';
import { tileIdFor, tilesForRide } from '../tiles.ts';
import type { GeoPoint, RideVerificationResult } from '../../verification/types.ts';

const BASE = { lat: 44.058, lon: -121.335 };
const mPerDegLon = 111_320 * Math.cos((BASE.lat * Math.PI) / 180);

function fixtureGeo(): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (let d = 0; d <= 4000; d += 10) {
    out.push({
      lat: BASE.lat,
      lon: BASE.lon + d / mPerDegLon,
      altitude: 1100,
      accuracy: 5,
      speed: 5,
      timestamp: 1_000 + d * 200,
    });
  }
  return out;
}

function verified(over: Partial<RideVerificationResult> = {}): RideVerificationResult {
  return {
    rideId: '01HXPUBLICTEST',
    status: 'verified',
    verifiedKm: 4.0,
    integrityScore: 0.91,
    flags: [{ code: 'GPS_NOISY', severity: 'soft', detail: 'lat 44.0581 drift' }],
    computedAt: 1_700_000_000_000,
    ...over,
  };
}

const rideTiles = tilesForRide(fixtureGeo());
const OFF = tileIdFor(BASE.lat + 0.05, BASE.lon);

// Three of four quest tiles lie on the ride.
const QUEST: FoglineQuest = {
  id: 'q-bend-001',
  tiles: [rideTiles[1], rideTiles[3], rideTiles[5], OFF],
  need: 3,
};
const ATTEST = { platform: 'ios' as const, token: 'eyJhbGciOi.payload.sig', issuedAt: 1_700_000_000_000 };

describe('fogline claim — shape', () => {
  const claim = buildFoglineClaim(verified(), rideTiles, QUEST, ATTEST)!;

  it('is built for a verified ride that completed the quest', () => {
    assert.ok(claim);
    assert.equal(questTilesHit(QUEST, rideTiles), 3);
  });

  it('contains exactly the allowed keys', () => {
    assert.deepEqual(Object.keys(claim).sort(), [...FOGLINE_CLAIM_KEYS].sort());
    assert.deepEqual([...FOGLINE_CLAIM_KEYS].sort(), ['attestation', 'pass', 'questId', 'rideId', 'v']);
  });

  it('omits attestation cleanly when there is none', () => {
    const c = buildFoglineClaim(verified(), rideTiles, QUEST)!;
    assert.deepEqual(Object.keys(c).sort(), ['pass', 'questId', 'rideId', 'v']);
  });
});

describe('fogline claim — no location of any kind leaves the phone', () => {
  const claim = buildFoglineClaim(verified(), rideTiles, QUEST, ATTEST)!;
  const json = JSON.stringify(claim);

  it('no tile id appears anywhere — not even quest tiles', () => {
    for (const t of [...rideTiles, ...QUEST.tiles]) {
      assert.equal(json.includes(t), false, `tile ${t} left the phone`);
    }
    assert.equal(/fl\d+:-?\d+:-?\d+/.test(json), false);
  });

  it('no forbidden key appears anywhere', () => {
    for (const k of FORBIDDEN_KEYS) {
      assert.equal(json.includes(`"${k}"`), false, `forbidden key "${k}"`);
    }
  });

  it('no coordinate digits appear anywhere', () => {
    assert.equal(json.includes('44.05'), false);
    assert.equal(json.includes('121.3'), false);
    assert.equal(/-?\d{1,3}\.\d{4,}/.test(json.replace(ATTEST.token, '')), false);
  });

  it('no timestamps, distance, score or engine flags', () => {
    for (const k of ['startedAt', 'endedAt', 'computedAt', 'flags', 'detail', 'integrityScore', 'verifiedKm', 'distanceBand']) {
      assert.equal(json.includes(`"${k}"`), false, k);
    }
    assert.equal(json.includes('drift'), false);
  });
});

describe('fogline claim — the guard rejects tampering', () => {
  const good = () => buildFoglineClaim(verified(), rideTiles, QUEST, ATTEST)!;

  it('accepts a built claim', () => {
    assert.doesNotThrow(() => assertFoglineClaimSafe(good()));
  });

  for (const k of ['lat', 'lon', 'polyline', 'questTiles', 'tiles', 'accel', 'gyro', 'barometer', 'pedometer', 'pressure', 'placeName', 'startedAt', 'distanceBand']) {
    it(`rejects a top-level "${k}"`, () => {
      assert.throws(() => assertFoglineClaimSafe({ ...good(), [k]: 1 }));
    });
  }

  it('rejects a forbidden key nested inside attestation', () => {
    const c = good() as unknown as Record<string, unknown>;
    c.attestation = { ...ATTEST, tiles: 'x' };
    assert.throws(() => assertFoglineClaimSafe(c));
  });

  it('rejects a tile or coordinate hidden in an innocent field', () => {
    assert.throws(() => assertFoglineClaimSafe({ ...good(), questId: `q ${rideTiles[0]}` }));
    assert.throws(() => assertFoglineClaimSafe({ ...good(), rideId: 'r 44.0581,-121.3350' }));
  });

  it('rejects any array (where a route would hide)', () => {
    const c = good() as unknown as Record<string, unknown>;
    c.attestation = { ...ATTEST, token: ['a', 'b'] };
    assert.throws(() => assertFoglineClaimSafe(c));
  });

  it('rejects any non-integer number', () => {
    const c = good() as unknown as Record<string, unknown>;
    c.attestation = { ...ATTEST, issuedAt: 44.0581 };
    assert.throws(() => assertFoglineClaimSafe(c));
  });
});

describe('fogline claim — nothing is sent unless the quest is complete', () => {
  it('no claim for a rejected or review ride', () => {
    assert.equal(buildFoglineClaim(verified({ status: 'rejected' }), rideTiles, QUEST), null);
    assert.equal(buildFoglineClaim(verified({ status: 'review' }), rideTiles, QUEST), null);
  });

  it('no claim below the threshold — partial progress stays on the phone', () => {
    const twoOnly = rideTiles.filter((t) => t !== rideTiles[5]);
    assert.equal(questTilesHit(QUEST, twoOnly), 2);
    assert.equal(buildFoglineClaim(verified(), twoOnly, QUEST), null);
  });

  it('no claim when the ride unlocked nothing', () => {
    assert.equal(buildFoglineClaim(verified(), [], QUEST), null);
  });

  it('duplicate tiles do not pad the count', () => {
    assert.equal(questTilesHit(QUEST, [rideTiles[1], rideTiles[1], rideTiles[1]]), 1);
  });
});

describe('signing message (cross-language protocol)', () => {
  it('matches the vector pinned in zcash-service fogline.rs', () => {
    const msg = foglineSigningMessage(
      { v: 1, rideId: '01HXVECTOR0001', questId: 'q-bend-river-line', pass: true },
      'u1vector',
      1800000000,
    );
    assert.equal(msg, 'fogline-claim-v1|01HXVECTOR0001|u1vector|q-bend-river-line|1800000000');
  });
});
