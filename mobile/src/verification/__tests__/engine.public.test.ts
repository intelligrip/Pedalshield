/**
 * Public verification tests (open source, MIT).
 *
 * These exercise only the OPEN interface layer — the engine resolver/stub and
 * the privacy boundary. The real scoring rubric is tested privately, against
 * the proprietary engine, in `verification-private/__tests__/`.
 *
 * Two guarantees are pinned here for everyone (including forks) to verify:
 *   1. With no proprietary engine present, the open stub never marks a ride
 *      "verified" and never awards verified distance.
 *   2. `toClaimPayload` leaks no raw geo / motion / barometer / pedometer data
 *      and carries exactly the minimal field set.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RawRide, RideVerificationResult } from '../types.ts';
import { toClaimPayload } from '../claim.ts';
import { verifyRide, isProprietaryEngineActive } from '../engine.ts';

// A tiny, self-contained ride so this public test needs no private fixtures.
function sampleRide(): RawRide {
  return {
    rideId: 'ride_public_test',
    startedAt: 1_000,
    endedAt: 1_000 + 60_000,
    geo: [
      { lat: 40.0, lon: -73.0, altitude: 10, accuracy: 5, speed: 5, timestamp: 1_000 },
      { lat: 40.001, lon: -73.001, altitude: 11, accuracy: 5, speed: 5, timestamp: 31_000 },
      { lat: 40.002, lon: -73.002, altitude: 12, accuracy: 5, speed: 5, timestamp: 61_000 },
    ],
    motion: [
      { timestamp: 1_000, accel: { x: 0.1, y: 0.1, z: 9.8 }, gyro: { x: 0, y: 0, z: 0 } },
    ],
    barometer: [{ timestamp: 1_000, pressure: 1012, relativeAltitude: 0 }],
    pedometer: [{ startTime: 1_000, endTime: 61_000, steps: 0 }],
  };
}

describe('open stub engine (no proprietary engine present)', () => {
  const result: RideVerificationResult = verifyRide(sampleRide());

  it('does not load a proprietary engine in the open test env', () => {
    // The private engine is git-ignored and require() is unavailable under the
    // ESM test runner, so the resolver must fall back to the stub.
    assert.equal(isProprietaryEngineActive(), false);
  });

  it('never marks a ride verified', () => {
    assert.notEqual(result.status, 'verified');
  });

  it('awards zero verified distance and a zero score', () => {
    assert.equal(result.verifiedKm, 0);
    assert.equal(result.integrityScore, 0);
  });
});

describe('toClaimPayload — privacy guarantees (public contract)', () => {
  const ride = sampleRide();
  const result = verifyRide(ride);
  const claim = toClaimPayload(ride, result);
  const json = JSON.stringify(claim);

  it('never includes geo coordinates', () => {
    assert.equal(json.includes('"lat"'), false, 'lat key leaked');
    assert.equal(json.includes('"lon"'), false, 'lon key leaked');
  });

  it('never includes raw motion samples', () => {
    assert.equal(json.includes('"accel"'), false, 'accel key leaked');
    assert.equal(json.includes('"gyro"'), false, 'gyro key leaked');
  });

  it('never includes barometer or pedometer data', () => {
    assert.equal(json.includes('"barometer"'), false, 'barometer key leaked');
    assert.equal(json.includes('"pedometer"'), false, 'pedometer key leaked');
    assert.equal(json.includes('"pressure"'), false, 'pressure key leaked');
  });

  it('contains exactly the minimal claim fields', () => {
    const keys = Object.keys(claim).sort();
    assert.deepEqual(keys, [
      'attestation',
      'endedAt',
      'flags',
      'integrityScore',
      'rideId',
      'startedAt',
      'status',
      'verifiedKm',
    ]);
  });
});
