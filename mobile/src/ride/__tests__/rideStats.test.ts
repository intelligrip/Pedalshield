import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRideStats } from '../rideStats.ts';
import type { GeoPoint, RawRide } from '../../verification/types.ts';

/** Build a due-north ride at constant speed with optional altitude ramp. */
function buildRide(opts: {
  kmh: number;
  km: number;
  stepS?: number;
  climbM?: number;
  pauseAfterKm?: number;
  pauseS?: number;
}): RawRide {
  const stepS = opts.stepS ?? 5;
  const startT = 1_700_000_000_000;
  const mPerStep = (opts.kmh / 3.6) * stepS;
  const steps = Math.round((opts.km * 1000) / mPerStep);
  const degPerM = 1 / 111_190; // approx for latitude
  const geo: GeoPoint[] = [];
  let t = startT;
  let lat = 40.0;
  let traveledKm = 0;
  let paused = false;
  for (let i = 0; i <= steps; i++) {
    geo.push({
      lat,
      lon: -105.0,
      altitude:
        opts.climbM !== undefined ? 1600 + (opts.climbM * i) / steps : null,
      accuracy: 5,
      speed: opts.kmh / 3.6,
      timestamp: t,
    });
    if (
      !paused &&
      opts.pauseAfterKm !== undefined &&
      traveledKm >= opts.pauseAfterKm
    ) {
      t += (opts.pauseS ?? 60) * 1000; // stand still: time passes, no move
      paused = true;
    }
    lat += mPerStep * degPerM;
    traveledKm += mPerStep / 1000;
    t += stepS * 1000;
  }
  return {
    rideId: '01HXSTATSTEST0000000000000',
    startedAt: startT,
    endedAt: geo[geo.length - 1].timestamp,
    geo,
    motion: [],
    barometer: [],
    pedometer: [],
  };
}

describe('computeRideStats', () => {
  it('computes distance, moving time, and avg speed for a steady ride', () => {
    const r = computeRideStats(buildRide({ kmh: 20, km: 2 }));
    assert.ok(Math.abs(r.distanceKm - 2) < 0.05, `distance ${r.distanceKm}`);
    assert.ok(Math.abs(r.avgMovingKmh - 20) < 1, `avg ${r.avgMovingKmh}`);
    assert.ok(Math.abs(r.movingS - 360) < 15, `moving ${r.movingS}`);
    assert.ok(r.maxKmh >= 19 && r.maxKmh <= 22, `max ${r.maxKmh}`);
  });

  it('produces one split per km plus a partial', () => {
    const r = computeRideStats(buildRide({ kmh: 24, km: 2.5 }));
    const full = r.splits.filter((s) => s.km === 1);
    assert.equal(full.length, 2);
    assert.ok(r.splits.length >= 2 && r.splits.length <= 3);
    for (const s of full) {
      assert.ok(Math.abs(s.seconds - 150) < 10, `split ${s.seconds}s`);
    }
    assert.ok(r.bestSplitIndex >= 0);
  });

  it('accumulates elevation gain above the noise floor', () => {
    const r = computeRideStats(buildRide({ kmh: 18, km: 3, climbM: 30 }));
    assert.ok(
      r.elevationGainM > 20 && r.elevationGainM <= 32,
      `gain ${r.elevationGainM}`,
    );
    assert.ok(r.elevationLossM < 3, `loss ${r.elevationLossM}`);
  });

  it('separates stopped time from moving time', () => {
    const r = computeRideStats(
      buildRide({ kmh: 20, km: 2, pauseAfterKm: 1, pauseS: 120 }),
    );
    assert.ok(r.stoppedS > 100, `stopped ${r.stoppedS}`);
    assert.ok(Math.abs(r.avgMovingKmh - 20) < 2.5, `avg ${r.avgMovingKmh}`);
  });

  it('handles an empty ride without exploding', () => {
    const r = computeRideStats({
      rideId: 'x',
      startedAt: 0,
      endedAt: 0,
      geo: [],
      motion: [],
      barometer: [],
      pedometer: [],
    });
    assert.equal(r.distanceKm, 0);
    assert.equal(r.splits.length, 0);
    assert.equal(r.bestSplitIndex, -1);
  });
});
