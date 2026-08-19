/**
 * The coach. Two things under test that are not really "features":
 *
 *  1. SAFETY — nothing is spoken in the opening minutes of a ride, and cues
 *     are rate limited. A rider merging into traffic cannot spare attention.
 *  2. TONE — no output ever frames a gap as a failure. People get injured,
 *     ill and busy; a coach that makes them feel worse is one they delete.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_CUE_INTERVAL_S,
  QUIET_START_S,
  midRideCue,
  postRideNote,
  preRideNudge,
  riderPattern,
} from '../coach.ts';
import type { RideRecord } from '../rideHistory.ts';

const DAY = 86400000;
const NOW = new Date('2026-08-12T18:00:00Z').getTime();

function ride(daysAgo: number, status: RideRecord['status'] = 'verified'): RideRecord {
  return {
    id: `r${daysAgo}-${Math.random()}`,
    completedAt: NOW - daysAgo * DAY,
    distanceKm: 8,
    movingS: 1800,
    avgKmh: 16,
    maxKmh: 30,
    elevationGainM: 40,
    integrityScore: 0.8,
    status,
  };
}

describe('rider pattern', () => {
  it('counts only non-rejected rides', () => {
    const p = riderPattern([ride(1), ride(2, 'rejected'), ride(3)], NOW);
    assert.equal(p.ridesThisWeek, 2);
  });

  it('reports no usual day when there is no pattern', () => {
    // One ride on each of three different weekdays is not a habit.
    assert.equal(riderPattern([ride(1), ride(2), ride(3)], NOW).usualDay, null);
  });

  it('finds a usual day when one clearly dominates', () => {
    const p = riderPattern([ride(7), ride(14), ride(21)], NOW);
    assert.equal(p.usualDay, new Date(NOW).getDay());
  });

  it('is safe on an empty history', () => {
    const p = riderPattern([], NOW);
    assert.equal(p.daysSince, null);
    assert.equal(p.ridesThisWeek, 0);
    assert.equal(p.bestWeek, 0);
  });
});

describe('mid-ride cues — safety', () => {
  const base = {
    liveKm: 20,
    milesBefore: 8,
    sinceLastCueS: null,
    milestones: [10, 50, 250],
  };

  it('says nothing in the opening minutes, even crossing a milestone', () => {
    assert.equal(midRideCue({ ...base, elapsedS: QUIET_START_S - 1 }), null);
  });

  it('speaks a milestone once the quiet period has passed', () => {
    assert.equal(midRideCue({ ...base, elapsedS: QUIET_START_S + 1 }), '10 miles.');
  });

  it('respects the minimum gap between cues', () => {
    assert.equal(
      midRideCue({ ...base, elapsedS: 1200, sinceLastCueS: MIN_CUE_INTERVAL_S - 1 }),
      null,
    );
  });

  it('stays silent when no milestone is crossed', () => {
    // The deliberate absence of pace commentary. Only a rare, real event
    // earns an interruption.
    assert.equal(
      midRideCue({ ...base, elapsedS: 3600, liveKm: 1, milesBefore: 20 }),
      null,
    );
  });

  it('never announces the same milestone twice in one ride', () => {
    const crossed = midRideCue({ ...base, elapsedS: 600 });
    assert.equal(crossed, '10 miles.');
    // Already past it: milesBefore is now above the threshold.
    assert.equal(
      midRideCue({ ...base, elapsedS: 1200, milesBefore: 12, sinceLastCueS: 600 }),
      null,
    );
  });
});

describe('tone — never punish an absence', () => {
  const banned =
    /haven't|hasn't|missed|slack|lazy|failed|lost your|broke your|only \d|disappoint|should have|get back on/i;

  it('a long gap is welcomed, not scolded', () => {
    const msg = preRideNudge([ride(30)], NOW);
    assert.ok(msg && !banned.test(msg), `scolding: "${msg}"`);
    assert.match(msg, /back/i);
  });

  it('no pre-ride line at any gap length is guilt-shaped', () => {
    for (const days of [0, 1, 3, 7, 14, 30, 90, 365]) {
      const msg = preRideNudge([ride(days)], NOW);
      if (msg) assert.ok(!banned.test(msg), `at ${days} days: "${msg}"`);
    }
  });

  it('never mentions a streak that was lost', () => {
    // Riding daily then stopping for a week must not produce a lament.
    const records = [ride(8), ride(9), ride(10), ride(11)];
    const msg = preRideNudge(records, NOW);
    if (msg) assert.ok(!/streak/i.test(msg) || !/lost|broke|end/i.test(msg), msg);
  });

  it('the first ride is framed as a beginning', () => {
    assert.match(preRideNudge([], NOW) ?? '', /first ride/i);
  });
});

describe('pre-ride nudges are sparse', () => {
  it('returns null when there is nothing worth saying', () => {
    // A coach that always speaks is noise. One ride four days ago, no
    // pattern, no streak — say nothing.
    assert.equal(preRideNudge([ride(4)], NOW), null);
  });

  it('offers the rider their own best week as the only competition', () => {
    const records = [
      ride(1), ride(2),               // this week: 2
      ride(9), ride(10), ride(11),    // a previous week: 3
    ];
    const msg = preRideNudge(records, NOW);
    assert.ok(msg && /matches your best/i.test(msg), `got "${msg}"`);
  });
});

describe('post-ride note', () => {
  it('reports consistency, not speed', () => {
    const msg = postRideNote([ride(0), ride(1), ride(2)], NOW);
    assert.ok(msg && /days in a row|rides this week/i.test(msg), `got "${msg}"`);
  });

  it('says nothing after a single isolated ride', () => {
    assert.equal(postRideNote([ride(0)], NOW), null);
  });
});
