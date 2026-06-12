/**
 * Post-ride stats report, computed entirely on-device from the raw
 * sample buffer. This is display-only: nothing here is transmitted,
 * and the buffer is discarded on session reset like always.
 */

import type { RawRide } from '../verification/types.ts';
import { haversineKm } from '../verification/sensorFusion.ts';

export interface KmSplit {
  /** Split length in km (1 for full splits; <1 for the final partial). */
  km: number;
  seconds: number;
  avgKmh: number;
}

export interface RideStatsReport {
  distanceKm: number;
  elapsedS: number;
  /** Time spent above the moving threshold. */
  movingS: number;
  stoppedS: number;
  avgMovingKmh: number;
  maxKmh: number;
  elevationGainM: number;
  elevationLossM: number;
  splits: KmSplit[];
  /** Index into `splits` of the fastest full-km split; -1 if none. */
  bestSplitIndex: number;
}

/** Below this the rider is considered stopped (traffic light, photo op). */
const MOVING_KMH = 3;
/** Altitude jitter below this is ignored when accumulating gain/loss. */
const ELEV_NOISE_M = 1.5;
/** Ignore implausible max-speed spikes from sub-second GPS pairs. */
const MIN_SEGMENT_S = 1;

export function computeRideStats(raw: RawRide): RideStatsReport {
  const geo = raw.geo;
  const elapsedS = Math.max(0, (raw.endedAt - raw.startedAt) / 1000);

  let distanceKm = 0;
  let movingS = 0;
  let maxKmh = 0;
  let gain = 0;
  let loss = 0;

  const splits: KmSplit[] = [];
  let splitStartT = geo.length > 0 ? geo[0].timestamp : raw.startedAt;
  let splitKm = 0;

  let lastAlt: number | null = null;

  for (let i = 1; i < geo.length; i++) {
    const a = geo[i - 1];
    const b = geo[i];
    const dKm = haversineKm(a, b);
    const dtS = Math.max(0.001, (b.timestamp - a.timestamp) / 1000);
    const segKmh = (dKm * 3600) / dtS;

    distanceKm += dKm;
    if (segKmh >= MOVING_KMH) movingS += dtS;
    if (dtS >= MIN_SEGMENT_S && segKmh > maxKmh) maxKmh = segKmh;

    // Elevation: accumulate only deltas above the noise floor.
    if (b.altitude !== null) {
      if (lastAlt === null) {
        lastAlt = b.altitude;
      } else {
        const dAlt = b.altitude - lastAlt;
        if (Math.abs(dAlt) >= ELEV_NOISE_M) {
          if (dAlt > 0) gain += dAlt;
          else loss += -dAlt;
          lastAlt = b.altitude;
        }
      }
    }

    // Splits: close out a 1 km split, interpolating the crossing time
    // inside this segment so split boundaries land on the km, not on
    // whatever GPS fix happened to arrive next.
    splitKm += dKm;
    while (splitKm >= 1) {
      const overshootKm = splitKm - 1;
      const fraction = dKm > 0 ? 1 - overshootKm / dKm : 1;
      const crossT = a.timestamp + (b.timestamp - a.timestamp) * fraction;
      const seconds = Math.max(0.001, (crossT - splitStartT) / 1000);
      splits.push({ km: 1, seconds, avgKmh: 3600 / seconds });
      splitStartT = crossT;
      splitKm -= 1;
    }
  }

  // Final partial split (only if it's a meaningful fraction).
  if (splitKm >= 0.05 && geo.length > 1) {
    const seconds = Math.max(
      0.001,
      (geo[geo.length - 1].timestamp - splitStartT) / 1000,
    );
    splits.push({
      km: splitKm,
      seconds,
      avgKmh: (splitKm * 3600) / seconds,
    });
  }

  let bestSplitIndex = -1;
  let bestSeconds = Infinity;
  for (let i = 0; i < splits.length; i++) {
    if (splits[i].km === 1 && splits[i].seconds < bestSeconds) {
      bestSeconds = splits[i].seconds;
      bestSplitIndex = i;
    }
  }

  return {
    distanceKm,
    elapsedS,
    movingS: Math.min(movingS, elapsedS),
    stoppedS: Math.max(0, elapsedS - movingS),
    avgMovingKmh: movingS > 0 ? (distanceKm * 3600) / movingS : 0,
    maxKmh,
    elevationGainM: gain,
    elevationLossM: loss,
    splits,
    bestSplitIndex,
  };
}
