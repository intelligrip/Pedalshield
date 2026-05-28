/**
 * Sensor fusion - turn raw multi-sensor samples into a small set of
 * scalar features the integrity scorer can reason about.
 *
 * Runs entirely on-device. Never sends raw samples anywhere.
 */

import type { GeoPoint, MotionSample, RawRide, RideFeatures } from './types.ts';
import {
  CADENCE_BAND_HZ,
  CYCLING_SPEED_BAND_KMH,
  MOVING_SPEED_THRESHOLD_MS,
} from './constants.ts';

const EARTH_RADIUS_KM = 6371.0088;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Haversine distance between two GPS points, in km. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rms(xs: number[]): number {
  if (xs.length === 0) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Autocorrelation-based cadence detector.
 *
 * Looks for a strong periodic component in the pedaling-cadence band
 * (CADENCE_BAND_HZ). Returns normalised peak in 0..1.
 *
 * Deliberately simple - no FFT, no external dependency. Robust enough to
 * separate "real pedaling" from "noise only" in our test fixtures, and
 * suitable for shipping inside a phone with no native maths bridge.
 */
function estimateCadenceConfidence(
  deviations: number[],
  samples: MotionSample[],
): number {
  if (deviations.length < 32 || samples.length < 32) return 0;

  const totalS =
    (samples[samples.length - 1].timestamp - samples[0].timestamp) / 1000;
  if (totalS <= 0) return 0;

  const sampleRateHz = (samples.length - 1) / totalS;
  if (sampleRateHz < 4) return 0; // need ~4 Hz to see cadence cleanly

  const minLag = Math.max(1, Math.floor(sampleRateHz / CADENCE_BAND_HZ.max));
  const maxLag = Math.min(
    deviations.length - 1,
    Math.ceil(sampleRateHz / CADENCE_BAND_HZ.min),
  );
  if (maxLag <= minLag) return 0;

  let r0 = 0;
  for (const v of deviations) r0 += v * v;
  if (r0 === 0) return 0;

  let bestPeak = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < deviations.length; i++) {
      s += deviations[i] * deviations[i + lag];
    }
    const norm = s / r0;
    if (norm > bestPeak) bestPeak = norm;
  }
  return clamp01(bestPeak);
}

export function extractFeatures(ride: RawRide): RideFeatures {
  const { geo, motion, pedometer, barometer, startedAt, endedAt } = ride;
  const durationS = Math.max(0, (endedAt - startedAt) / 1000);

  // --- GPS-derived features ---
  let gpsDistanceKm = 0;
  let movingDistanceKm = 0;
  let movingTimeS = 0;
  let inBandTimeS = 0;
  let maxImpliedSpeedKmh = 0;
  const accuracies: number[] = [];
  const speedsKmh: number[] = [];

  for (let i = 1; i < geo.length; i++) {
    const a = geo[i - 1];
    const b = geo[i];
    const dKm = haversineKm(a, b);
    const dtS = Math.max(0.001, (b.timestamp - a.timestamp) / 1000);
    const segSpeedMs = (dKm * 1000) / dtS;
    const segSpeedKmh = segSpeedMs * 3.6;

    gpsDistanceKm += dKm;
    accuracies.push(b.accuracy);
    speedsKmh.push(segSpeedKmh);

    if (segSpeedKmh > maxImpliedSpeedKmh) maxImpliedSpeedKmh = segSpeedKmh;

    if (segSpeedMs >= MOVING_SPEED_THRESHOLD_MS) {
      movingDistanceKm += dKm;
      movingTimeS += dtS;
      if (
        segSpeedKmh >= CYCLING_SPEED_BAND_KMH.min &&
        segSpeedKmh <= CYCLING_SPEED_BAND_KMH.max
      ) {
        inBandTimeS += dtS;
      }
    }
  }

  const avgSpeedKmh =
    movingTimeS > 0 ? (movingDistanceKm * 3600) / movingTimeS : 0;
  const maxSpeedKmh = speedsKmh.length > 0 ? Math.max(...speedsKmh) : 0;
  const speedInBandRatio = movingTimeS > 0 ? inBandTimeS / movingTimeS : 0;

  let straightLineRatio = 0;
  if (geo.length >= 2 && gpsDistanceKm > 0) {
    const displacement = haversineKm(geo[0], geo[geo.length - 1]);
    straightLineRatio = displacement / gpsDistanceKm;
  }

  // --- Motion features ---
  const accelMag = motion.map((m) => {
    const { x, y, z } = m.accel;
    return Math.sqrt(x * x + y * y + z * z);
  });
  const accelMean = mean(accelMag);
  const accelDev = accelMag.map((v) => v - accelMean);
  const vibrationEnergy = rms(accelDev);
  const cadenceConfidence = estimateCadenceConfidence(accelDev, motion);

  // --- Pedometer features ---
  let totalSteps = 0;
  let pedTimeS = 0;
  for (const w of pedometer) {
    totalSteps += w.steps;
    pedTimeS += Math.max(0, (w.endTime - w.startTime) / 1000);
  }
  const stepsPerMin = pedTimeS > 0 ? (totalSteps / pedTimeS) * 60 : 0;
  // ramps from 0 at <=30 steps/min to 1 at >=90 steps/min
  const walkingInterference = clamp01((stepsPerMin - 30) / 60);

  // --- Elevation consistency (barometer vs GPS altitude) ---
  let elevationConsistency = 0.5; // neutral default if data missing
  if (barometer.length >= 2 && geo.length >= 2) {
    const baroDelta =
      barometer[barometer.length - 1].relativeAltitude -
      barometer[0].relativeAltitude;
    const gpsAltStart = geo[0].altitude;
    const gpsAltEnd = geo[geo.length - 1].altitude;
    if (gpsAltStart != null && gpsAltEnd != null) {
      const gpsDelta = gpsAltEnd - gpsAltStart;
      const diff = Math.abs(gpsDelta - baroDelta);
      // diff <=5 m -> 1.0, diff >=30 m -> 0
      elevationConsistency = clamp01(1 - (diff - 5) / 25);
    }
  }

  const gpsAccuracyMedian = accuracies.length > 0 ? median(accuracies) : 9999;
  const sampleDensity =
    durationS > 0 ? (geo.length + motion.length) / durationS : 0;

  return {
    durationS,
    gpsDistanceKm,
    movingDistanceKm,
    avgSpeedKmh,
    maxSpeedKmh,
    maxImpliedSpeedKmh,
    speedInBandRatio,
    vibrationEnergy,
    cadenceConfidence,
    walkingInterference,
    elevationConsistency,
    gpsAccuracyMedian,
    sampleDensity,
    straightLineRatio,
  };
}
