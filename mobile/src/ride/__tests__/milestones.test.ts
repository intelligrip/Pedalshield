import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLLECTIBLE_INTERVAL_MILES,
  TROPHIES,
  currentStreakDays,
  earnedTrophies,
  milestoneProgress,
  nextTrophy,
  verifiedMiles,
} from '../milestones.ts';
import type { RideRecord } from '../rideHistory.ts';

const DAY = 86400000;

function ride(
  distanceKm: number,
  status: RideRecord['status'] = 'verified',
  completedAt = Date.now(),
): RideRecord {
  return {
    id: Math.random().toString(36).slice(2),
    completedAt,
    distanceKm,
    movingS: 600,
    avgKmh: 18,
    maxKmh: 30,
    elevationGainM: 40,
    integrityScore: 0.8,
    status,
  };
}

describe('verified mileage', () => {
  it('excludes rejected rides', () => {
    // A trophy containing unverified miles is worth nothing — "verified
    // miles" is the whole claim that separates this from a self-reported log.
    const miles = verifiedMiles([ride(16.09344), ride(16.09344, 'rejected')]);
    assert.ok(Math.abs(miles - 10) < 0.01, `got ${miles}`);
  });

  it('counts rides in review — they earned, so they count', () => {
    const miles = verifiedMiles([ride(16.09344, 'review')]);
    assert.ok(Math.abs(miles - 10) < 0.01);
  });

  it('ignores malformed distances without throwing', () => {
    const bad = { ...ride(1), distanceKm: NaN };
    assert.doesNotThrow(() => verifiedMiles([bad, ride(16.09344)]));
    assert.ok(verifiedMiles([bad, ride(16.09344)]) > 9);
  });
});

describe('trophies', () => {
  it('the first is reachable on day one', () => {
    // A first milestone weeks away teaches a new rider the app has nothing
    // for them.
    assert.equal(TROPHIES[0].miles, 1);
  });

  it('thresholds ascend with no duplicates', () => {
    for (let i = 1; i < TROPHIES.length; i++) {
      assert.ok(TROPHIES[i].miles > TROPHIES[i - 1].miles);
    }
  });

  it('awards every tier at or below the total', () => {
    const earned = earnedTrophies(120);
    assert.deepEqual(
      earned.map((t) => t.miles),
      [1, 10, 50, 100],
    );
  });

  it('points at the next unearned tier', () => {
    assert.equal(nextTrophy(120)?.miles, 500);
    assert.equal(nextTrophy(0)?.miles, 1);
  });

  it('returns null once everything is earned', () => {
    assert.equal(nextTrophy(999999), null);
  });
});

describe('progress', () => {
  it('measures from the previous tier, not from zero', () => {
    // 600 miles is 20% of the way from 500 to 1000. Showing 60% of a bar
    // toward 1000 would be true and useless.
    const p = milestoneProgress([ride(600 * 1.609344)]);
    assert.equal(p.next?.miles, 1000);
    assert.ok(Math.abs(p.fraction - 0.2) < 0.01, `got ${p.fraction}`);
    assert.ok(Math.abs(p.milesToNext - 400) < 0.5);
  });

  it('handles a rider with no rides', () => {
    const p = milestoneProgress([]);
    assert.equal(p.earned.length, 0);
    assert.equal(p.next?.miles, 1);
    assert.equal(p.collectibles, 0);
  });

  it('awards a collectible every interval', () => {
    const p = milestoneProgress([ride(120 * 1.609344)]);
    assert.equal(p.collectibles, Math.floor(120 / COLLECTIBLE_INTERVAL_MILES));
    assert.ok(p.milesToNextCollectible > 0);
    assert.ok(p.milesToNextCollectible <= COLLECTIBLE_INTERVAL_MILES);
  });

  it('never reports a fraction outside 0..1', () => {
    for (const m of [0, 0.5, 1, 49, 999, 10001]) {
      const p = milestoneProgress([ride(m * 1.609344)]);
      assert.ok(p.fraction >= 0 && p.fraction <= 1, `fraction ${p.fraction} at ${m}mi`);
    }
  });
});

describe('streaks', () => {
  const now = Date.now();

  it('counts consecutive days', () => {
    const rides = [ride(5, 'verified', now), ride(5, 'verified', now - DAY), ride(5, 'verified', now - 2 * DAY)];
    assert.equal(currentStreakDays(rides, now), 3);
  });

  it('survives one missed day', () => {
    // Resetting to zero on a single bad day punishes the rider who most
    // needs a reason to come back. Grace is cheap.
    const rides = [
      ride(5, 'verified', now),
      // no ride yesterday
      ride(5, 'verified', now - 2 * DAY),
      ride(5, 'verified', now - 3 * DAY),
    ];
    assert.ok(currentStreakDays(rides, now) >= 3, 'one gap should not reset');
  });

  it('ends after two consecutive missed days', () => {
    const rides = [
      ride(5, 'verified', now),
      ride(5, 'verified', now - 3 * DAY),
      ride(5, 'verified', now - 4 * DAY),
    ];
    assert.equal(currentStreakDays(rides, now), 1);
  });

  it('is zero when the last ride is long past', () => {
    assert.equal(currentStreakDays([ride(5, 'verified', now - 30 * DAY)], now), 0);
  });

  it('is zero with no rides', () => {
    assert.equal(currentStreakDays([], now), 0);
  });

  it('ignores rejected rides', () => {
    assert.equal(currentStreakDays([ride(5, 'rejected', now)], now), 0);
  });
});
