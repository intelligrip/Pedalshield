/**
 * Unit tests for the on-device ride verifier.
 *
 * Covers four ride scenarios (legit bike, car, GPS spoof, walk) and a
 * privacy assertion that ClaimPayload never leaks geo / motion / barometer
 * / pedometer data.
 *
 * Uses Node's built-in test runner via tsx:
 *   npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { toClaimPayload, verifyRide } from '../rideVerifier.ts';
import {
  buildCarRide,
  buildGpsSpoof,
  buildLegitBikeRide,
  buildWalkingRide,
} from './fixtures.ts';

describe('verifyRide - legit bike ride', () => {
  const ride = buildLegitBikeRide();
  const result = verifyRide(ride);

  it('marks ride as verified', () => {
    assert.equal(
      result.status,
      'verified',
      `flags: ${JSON.stringify(result.flags)}, score: ${result.integrityScore}`,
    );
  });

  it('reports integrity score above the verify threshold', () => {
    assert.ok(
      result.integrityScore >= 0.65,
      `score=${result.integrityScore}`,
    );
  });

  it('reports plausible verified distance (within 2 km of expected 9 km)', () => {
    // 18 km/h * 0.5 h = 9 km
    assert.ok(
      result.verifiedKm > 7 && result.verifiedKm < 11,
      `verifiedKm=${result.verifiedKm}`,
    );
  });

  it('has no hard-fail flags', () => {
    const hard = result.flags.filter((f) => f.severity === 'hard');
    assert.equal(hard.length, 0, `hard flags: ${JSON.stringify(hard)}`);
  });
});

describe('verifyRide - car ride (must be rejected)', () => {
  const ride = buildCarRide();
  const result = verifyRide(ride);

  it('does NOT mark a car ride as verified', () => {
    assert.notEqual(
      result.status,
      'verified',
      `flags: ${JSON.stringify(result.flags)}`,
    );
  });

  it('flags speed envelope violation', () => {
    assert.ok(
      result.flags.some((f) => f.code === 'SPEED_OUT_OF_BAND'),
      `flags: ${JSON.stringify(result.flags)}`,
    );
  });

  it('awards zero verifiedKm on hard fail', () => {
    assert.equal(result.verifiedKm, 0);
  });
});

describe('verifyRide - GPS spoof (must be rejected)', () => {
  const ride = buildGpsSpoof();
  const result = verifyRide(ride);

  it('marks spoof as rejected', () => {
    assert.equal(result.status, 'rejected');
  });

  it('flags TELEPORT and NO_MOTION_DATA', () => {
    const codes = result.flags.map((f) => f.code);
    assert.ok(
      codes.includes('TELEPORT'),
      `flags: ${JSON.stringify(result.flags)}`,
    );
    assert.ok(
      codes.includes('NO_MOTION_DATA'),
      `flags: ${JSON.stringify(result.flags)}`,
    );
  });
});

describe('verifyRide - walking (must not be a "ride")', () => {
  const ride = buildWalkingRide();
  const result = verifyRide(ride);

  it('does NOT mark a walk as a verified ride', () => {
    assert.notEqual(
      result.status,
      'verified',
      `flags: ${JSON.stringify(result.flags)}, score: ${result.integrityScore}`,
    );
  });

  it('flags walking detection', () => {
    assert.ok(
      result.flags.some((f) => f.code === 'WALKING_DETECTED'),
      `flags: ${JSON.stringify(result.flags)}`,
    );
  });
});

describe('toClaimPayload - privacy guarantees', () => {
  const ride = buildLegitBikeRide();
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
    assert.equal(
      json.includes('"barometer"'),
      false,
      'barometer key leaked',
    );
    assert.equal(
      json.includes('"pedometer"'),
      false,
      'pedometer key leaked',
    );
    assert.equal(
      json.includes('"pressure"'),
      false,
      'pressure key leaked',
    );
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
