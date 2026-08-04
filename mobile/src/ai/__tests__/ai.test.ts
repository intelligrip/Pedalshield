/**
 * Tests for the DETERMINISTIC half of src/ai.
 *
 * The model layer is untestable in CI (it needs Apple Intelligence hardware)
 * and, by design, optional. What must be tested is that the fallback path is
 * complete and correct — because on most devices it is the only path, and a
 * missing flag explanation means a rider stares at a reduced payout with no
 * reason given.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { explainVerdict } from '../explainVerdict.ts';
import { FLAG_COPY } from '../verdictCopy.ts';
import {
  characteriseRide,
  companionLine,
  type CompanionState,
  type RideDigest,
} from '../companionVoice.ts';
import type {
  FlagCode,
  RideVerificationResult,
} from '../../verification/types.ts';

/** Every code the engine can emit. Keep in sync with FlagCode in types.ts. */
const ALL_FLAGS: FlagCode[] = [
  'TELEPORT',
  'SPEED_OUT_OF_BAND',
  'NO_VIBRATION',
  'NO_CADENCE',
  'WALKING_DETECTED',
  'GPS_NOISY',
  'SPARSE_SAMPLES',
  'TOO_STRAIGHT',
  'NO_ATTESTATION',
  'NO_MOTION_DATA',
  'GPS_SYNTHETIC',
  'RIDE_TOO_SHORT',
  'STATIONARY',
  'SENSOR_INCOHERENT',
];

const result = (
  status: RideVerificationResult['status'],
  flags: { code: FlagCode; severity: 'soft' | 'hard' }[] = [],
): RideVerificationResult => ({
  rideId: 'r1',
  status,
  verifiedKm: 5,
  integrityScore: 0.7,
  flags,
  computedAt: 0,
});

describe('verdict copy completeness', () => {
  it('every flag code the engine can emit has rider-facing copy', () => {
    for (const code of ALL_FLAGS) {
      const copy = FLAG_COPY[code];
      assert.ok(copy, `missing copy for ${code}`);
      assert.ok(copy.what.length > 10, `${code}: 'what' too short`);
      assert.ok(copy.why.length > 10, `${code}: 'why' too short`);
    }
  });

  it('never accuses the rider of cheating', () => {
    // Tone is a product requirement, not a preference: almost every flag has
    // an innocent cause, and two of the founder's own genuine rides were
    // rejected before the engine learned that.
    const banned = /cheat|fraud|fake|liar|dishonest|suspicious/i;
    for (const code of ALL_FLAGS) {
      const c = FLAG_COPY[code];
      const all = `${c.what} ${c.why} ${c.fix ?? ''}`;
      assert.ok(!banned.test(all), `${code} uses accusatory language`);
    }
  });
});

describe('explainVerdict', () => {
  it('a clean verified ride has no reasons to explain', () => {
    const e = explainVerdict(result('verified'));
    assert.equal(e.reasons.length, 0);
    assert.equal(e.hasActionableFix, false);
    assert.match(e.title, /verified/i);
  });

  it('lists hard failures before soft ones', () => {
    const e = explainVerdict(
      result('rejected', [
        { code: 'NO_CADENCE', severity: 'soft' },
        { code: 'SPEED_OUT_OF_BAND', severity: 'hard' },
      ]),
    );
    assert.equal(e.reasons[0].what, FLAG_COPY.SPEED_OUT_OF_BAND.what);
  });

  it('surfaces an actionable fix when one exists', () => {
    const e = explainVerdict(
      result('review', [{ code: 'NO_MOTION_DATA', severity: 'soft' }]),
    );
    assert.equal(e.hasActionableFix, true);
  });

  it('review reads as reduced, not refused', () => {
    const e = explainVerdict(result('review'));
    assert.match(e.summary, /reduced|unclear/i);
  });

  it('handles an unknown flag code without throwing', () => {
    // Defensive: the private engine can add a code before this file learns
    // about it. A missing explanation must degrade, never crash a screen.
    const e = explainVerdict(
      result('review', [
        { code: 'NOT_A_REAL_CODE' as FlagCode, severity: 'soft' },
      ]),
    );
    assert.equal(e.reasons.length, 0);
  });
});

describe('companion voice', () => {
  const state: CompanionState = {
    name: 'Osprey',
    chain: 0.9,
    tires: 0.5,
    spirit: 0.7,
    streakDays: 12,
  };
  const base: RideDigest = {
    distanceKm: 8,
    durationS: 30 * 60,
    elevationGainM: 40,
    avgSpeedKmh: 16,
    daysSinceLastRide: 1,
  };

  it('recognises a first ride', () => {
    assert.equal(
      characteriseRide({ ...base, daysSinceLastRide: null }),
      'first',
    );
  });

  it('treats a long gap as a return, not a failure', () => {
    assert.equal(characteriseRide({ ...base, daysSinceLastRide: 30 }), 'return');
  });

  it('recognises climbing by metres per km', () => {
    assert.equal(
      characteriseRide({ ...base, distanceKm: 10, elevationGainM: 400 }),
      'climb',
    );
  });

  it('is deterministic for the same ride', () => {
    assert.equal(companionLine(base, state), companionLine(base, state));
  });

  it('uses the companion name', () => {
    assert.match(companionLine(base, state), /Osprey/);
  });

  it('never guilts the rider after a gap', () => {
    // The whole point of the design rule. A companion that shames someone
    // for a month off the bike is a companion they delete.
    const banned = /miss|lonely|sad|abandon|forgot|neglect|disappoint|where were you/i;
    for (let days = 7; days <= 90; days += 7) {
      const line = companionLine({ ...base, daysSinceLastRide: days }, state);
      assert.ok(!banned.test(line), `guilt-shaped line at ${days} days: ${line}`);
    }
  });

  it('does not divide by zero on a zero-distance ride', () => {
    assert.doesNotThrow(() =>
      companionLine({ ...base, distanceKm: 0, elevationGainM: 0 }, state),
    );
  });
});
