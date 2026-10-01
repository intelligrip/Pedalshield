/**
 * Fogline claim — privacy contract. Mirrors and tightens the public
 * `toClaimPayload` tests in verification/__tests__/engine.public.test.ts.
 *
 * If one of these fails, a change is trying to send something off the phone
 * that the Fogline promise says never leaves. Fix the change, not the test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FOGLINE_CLAIM_KEYS,
  FORBIDDEN_KEYS,
  assertFoglineClaimSafe,
  buildFoglineClaim,
  distanceBandFor,
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

const geo = fixtureGeo();
const rideTiles = tilesForRide(geo);

// Quest: two cells on the ride, one far away. Public by construction.
const ON_A = rideTiles[2];
const ON_B = rideTiles[5];
const OFF = tileIdFor(BASE.lat + 0.05, BASE.lon);
const QUEST: FoglineQuest = { id: 'q-bend-001', tiles: [ON_A, ON_B, OFF] };

const ATTEST = { platform: 'ios' as const, token: 'eyJhbGciOi.payload.sig', issuedAt: 1_700_000_000_000 };

describe('fogline claim — shape', () => {
  const claim = buildFoglineClaim(verified(), rideTiles, QUEST, ATTEST)!;

  it('is built for a verified ride that touched the quest', () => {
    assert.ok(claim);
  });

  it('contains exactly the allowed keys', () => {
    assert.deepEqual(Object.keys(claim).sort(), [...FOGLINE_CLAIM_KEYS].sort());
  });

  it('omits attestation cleanly when there is none', () => {
    const c = buildFoglineClaim(verified(), rideTiles, QUEST)!;
    assert.deepEqual(
      Object.keys(c).sort(),
      FOGLINE_CLAIM_KEYS.filter((k) => k !== 'attestation').sort(),
    );
  });

  it('discloses only ride ∩ quest tiles — never the rest of the atlas', () => {
    assert.deepEqual(claim.questTiles, [ON_A, ON_B].sort());
    assert.ok(rideTiles.length > claim.questTiles.length + 3, 'fixture sanity');
    const json = JSON.stringify(claim);
    for (const t of rideTiles) {
      if (t !== ON_A && t !== ON_B) assert.ok(!json.includes(t), `leaked atlas tile ${t}`);
    }
  });

  it('never claims a quest tile the ride did not touch', () => {
    assert.ok(!claim.questTiles.includes(OFF));
  });

  it('reports a distance band, not exact distance', () => {
    assert.equal(claim.distanceBand, 'lt5');
    assert.ok(!JSON.stringify(claim).includes('4.0'));
  });
});

describe('fogline claim — nothing forbidden, at any depth', () => {
  const claim = buildFoglineClaim(verified(), rideTiles, QUEST, ATTEST)!;
  const json = JSON.stringify(claim);

  it('no forbidden key appears anywhere in the JSON', () => {
    for (const k of FORBIDDEN_KEYS) {
      assert.equal(json.includes(`"${k}"`), false, `forbidden key "${k}" leaked`);
    }
  });

  it('no fixture coordinate digits appear anywhere', () => {
    assert.equal(json.includes('44.05'), false);
    assert.equal(json.includes('121.3'), false);
    assert.equal(/-?\d{1,3}\.\d{4,}/.test(json.replace(ATTEST.token, '')), false);
  });

  it('carries no ride timestamps, engine flags or free-text detail', () => {
    for (const k of ['startedAt', 'endedAt', 'computedAt', 'flags', 'detail', 'integrityScore']) {
      assert.equal(json.includes(`"${k}"`), false, k);
    }
    assert.equal(json.includes('drift'), false, 'engine flag detail leaked');
  });
});

describe('fogline claim — the guard rejects tampering', () => {
  const good = () => buildFoglineClaim(verified(), rideTiles, QUEST, ATTEST)!;

  it('accepts a built claim', () => {
    assert.doesNotThrow(() => assertFoglineClaimSafe(good()));
  });

  for (const k of ['lat', 'lon', 'polyline', 'accel', 'gyro', 'barometer', 'pedometer', 'pressure', 'placeName', 'startedAt']) {
    it(`rejects a top-level "${k}"`, () => {
      assert.throws(() => assertFoglineClaimSafe({ ...good(), [k]: 1 }));
    });
  }

  it('rejects a forbidden key nested inside attestation', () => {
    const c = good() as unknown as Record<string, unknown>;
    c.attestation = { ...ATTEST, lat: 44 };
    assert.throws(() => assertFoglineClaimSafe(c));
  });

  it('rejects a coordinate hidden in an innocent field', () => {
    assert.throws(() => assertFoglineClaimSafe({ ...good(), questId: 'q 44.0581,-121.3350' }));
    assert.throws(() => assertFoglineClaimSafe({ ...good(), questTiles: ['44.0581'] }));
  });

  it('rejects any non-integer number (smuggled coordinate)', () => {
    const c = good() as unknown as Record<string, unknown>;
    c.attestation = { ...ATTEST, issuedAt: 44.0581 };
    assert.throws(() => assertFoglineClaimSafe(c));
  });

  it('rejects malformed tile ids', () => {
    assert.throws(() => assertFoglineClaimSafe({ ...good(), questTiles: ['fl1:1'] }));
  });
});

describe('fogline claim — sends nothing when there is nothing to send', () => {
  it('no claim for a rejected or review ride', () => {
    assert.equal(buildFoglineClaim(verified({ status: 'rejected' }), rideTiles, QUEST), null);
    assert.equal(buildFoglineClaim(verified({ status: 'review' }), rideTiles, QUEST), null);
  });

  it('no claim when the ride missed every quest tile', () => {
    assert.equal(
      buildFoglineClaim(verified(), rideTiles, { id: 'q-far', tiles: [OFF] }),
      null,
    );
  });

  it('no claim when the ride unlocked nothing', () => {
    assert.equal(buildFoglineClaim(verified(), [], QUEST), null);
  });
});

describe('distance bands', () => {
  it('bucket coarsely and handle junk', () => {
    assert.equal(distanceBandFor(0), 'lt5');
    assert.equal(distanceBandFor(Number.NaN), 'lt5');
    assert.equal(distanceBandFor(5), '5to10');
    assert.equal(distanceBandFor(12.3), '10to20');
    assert.equal(distanceBandFor(80), '20plus');
  });
});
