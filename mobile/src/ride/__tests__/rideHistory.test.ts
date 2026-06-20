/**
 * Unit tests for ride history persistence + aggregation. Runs against the
 * in-memory storage fallback (AsyncStorage isn't linked in Node), which
 * exercises the real add/get/update/summarize paths.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeHistory,
  addRide,
  getRides,
  getSummary,
  updateRideTxid,
  clearRideHistory,
  type RideRecord,
} from '../rideHistory.ts';

function rec(over: Partial<RideRecord> = {}): RideRecord {
  return {
    id: Math.random().toString(36).slice(2),
    completedAt: Date.now(),
    distanceKm: 10,
    movingS: 1800,
    avgKmh: 20,
    maxKmh: 35,
    elevationGainM: 100,
    integrityScore: 0.9,
    status: 'verified',
    ...over,
  };
}

const JAN_2026 = new Date('2026-01-10T12:00:00Z').getTime();
const NOW_2026 = new Date('2026-06-20T12:00:00Z').getTime();
const DEC_2025 = new Date('2025-12-20T12:00:00Z').getTime();

describe('summarizeHistory (pure)', () => {
  it('separates year-to-date from all-time', () => {
    const records = [
      rec({ distanceKm: 5, completedAt: JAN_2026 }),
      rec({ distanceKm: 15, completedAt: NOW_2026 }),
      rec({ distanceKm: 100, completedAt: DEC_2025 }), // last year
    ];
    const s = summarizeHistory(records, NOW_2026);
    assert.equal(s.ytdKm, 20); // 5 + 15
    assert.equal(s.ytdRides, 2);
    assert.equal(s.totalKm, 120);
    assert.equal(s.totalRides, 3);
    assert.equal(s.lastRide?.completedAt, NOW_2026);
  });

  it('handles empty history', () => {
    const s = summarizeHistory([], NOW_2026);
    assert.equal(s.ytdKm, 0);
    assert.equal(s.totalRides, 0);
    assert.equal(s.lastRide, null);
  });
});

describe('ride history store', () => {
  it('banks rides, sorts newest-first, and summarizes', async () => {
    await clearRideHistory();
    await addRide(rec({ id: 'a', distanceKm: 8, completedAt: 1000 }));
    await addRide(rec({ id: 'b', distanceKm: 12, completedAt: 2000 }));

    const rides = getRides();
    assert.equal(rides.length, 2);
    assert.equal(rides[0].id, 'b'); // newest first

    const s = getSummary(2000);
    assert.equal(s.totalKm, 20);
    assert.equal(s.totalRides, 2);
  });

  it('is idempotent on re-save by id (no duplicates)', async () => {
    await clearRideHistory();
    await addRide(rec({ id: 'x', distanceKm: 5 }));
    await addRide(rec({ id: 'x', distanceKm: 5 })); // same id
    assert.equal(getRides().length, 1);
  });

  it('attaches a payout txid to a banked ride', async () => {
    await clearRideHistory();
    await addRide(rec({ id: 'ride1' }));
    await updateRideTxid('ride1', 'deadbeef');
    assert.equal(getRides()[0].txid, 'deadbeef');
  });

  it('clears history', async () => {
    await addRide(rec());
    await clearRideHistory();
    assert.equal(getRides().length, 0);
  });
});
