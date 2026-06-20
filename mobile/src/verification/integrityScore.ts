/**
 * Integrity scoring - turn `RideFeatures` into an integrityScore in 0..1
 * plus a list of explanatory flags.
 *
 * The rubric is intentionally transparent (weighted sub-scores + a small
 * set of hard fails) so the security write-up can defend every threshold.
 */

import type { RawRide, RideFeatures, VerificationFlag } from './types.ts';
import {
  CYCLING_BURST_MIN_KMH,
  HARD_FAIL_AVG_SPEED_KMH,
  HARD_FAIL_MAX_SPEED_KMH,
  MAX_GPS_ACCURACY_METERS,
  MIN_CADENCE_CONFIDENCE,
  MIN_CYCLING_AVG_SPEED_KMH,
  MIN_SAMPLE_DENSITY_HZ,
  MIN_VIBRATION_ENERGY,
  WALKING_GATE_MIN_DISTANCE_KM,
} from './constants.ts';

export interface ScoringResult {
  integrityScore: number;
  flags: VerificationFlag[];
}

interface Subscore {
  weight: number;
  /** 0..1 */
  value: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function scoreRide(
  features: RideFeatures,
  ride: RawRide,
): ScoringResult {
  const flags: VerificationFlag[] = [];

  // --- Hard fails -----------------------------------------------------
  if (features.maxImpliedSpeedKmh > HARD_FAIL_MAX_SPEED_KMH) {
    flags.push({
      code: 'TELEPORT',
      severity: 'hard',
      detail: `${features.maxImpliedSpeedKmh.toFixed(1)} km/h between samples`,
    });
  }
  if (features.avgSpeedKmh > HARD_FAIL_AVG_SPEED_KMH) {
    flags.push({
      code: 'SPEED_OUT_OF_BAND',
      severity: 'hard',
      detail: `avg ${features.avgSpeedKmh.toFixed(1)} km/h exceeds cycling envelope`,
    });
  }
  // Walking-pace hard fail — pedometer-INDEPENDENT, so it still catches a
  // walk when Motion & Fitness (step) data is missing. Moving average below
  // the cycling floor AND a peak segment that never reaches a cycling burst
  // = walking, not riding. The distance floor keeps GPS jitter on a parked
  // phone from tripping it.
  if (
    features.movingDistanceKm >= WALKING_GATE_MIN_DISTANCE_KM &&
    features.avgSpeedKmh > 0 &&
    features.avgSpeedKmh < MIN_CYCLING_AVG_SPEED_KMH &&
    features.maxSpeedKmh < CYCLING_BURST_MIN_KMH
  ) {
    flags.push({
      code: 'WALKING_DETECTED',
      severity: 'hard',
      detail: `avg ${features.avgSpeedKmh.toFixed(1)} km/h, peak ${features.maxSpeedKmh.toFixed(1)} km/h — walking pace, never reached cycling speed`,
    });
  }
  if (ride.motion.length === 0) {
    flags.push({
      code: 'NO_MOTION_DATA',
      severity: 'hard',
      detail: 'no accelerometer samples collected',
    });
  }
  if (!ride.deviceAttestation) {
    flags.push({
      code: 'NO_ATTESTATION',
      severity: 'soft',
      detail: 'device attestation missing - reduces trust',
    });
  }

  const hardFail = flags.some((f) => f.severity === 'hard');
  if (hardFail) {
    return { integrityScore: 0, flags };
  }

  // --- Soft sub-scores -------------------------------------------------
  const subs: Subscore[] = [];

  // Speed-in-band: fraction of moving time within cycling envelope
  subs.push({ weight: 0.2, value: features.speedInBandRatio });

  // Vibration: ramps up above MIN_VIBRATION_ENERGY
  const vibScore = clamp01(
    (features.vibrationEnergy - MIN_VIBRATION_ENERGY) / 0.5,
  );
  subs.push({ weight: 0.2, value: vibScore });
  if (features.vibrationEnergy < MIN_VIBRATION_ENERGY) {
    flags.push({
      code: 'NO_VIBRATION',
      severity: 'soft',
      detail: `vibration energy ${features.vibrationEnergy.toFixed(3)} m/s^2`,
    });
  }

  // Cadence confidence
  subs.push({ weight: 0.15, value: features.cadenceConfidence });
  if (features.cadenceConfidence < MIN_CADENCE_CONFIDENCE) {
    flags.push({ code: 'NO_CADENCE', severity: 'soft' });
  }

  // Inverse of walking interference. When step (pedometer) data is missing
  // we must NOT grant full "not walking" credit — absence of evidence isn't
  // evidence of cycling. Fall back to a neutral 0.5 so a walk with Motion &
  // Fitness off can't ride a free 1.0 here (the speed hard fail above is the
  // primary guard; this is defense-in-depth).
  const hasPedometer = ride.pedometer.length > 0;
  const noWalk = hasPedometer ? 1 - features.walkingInterference : 0.5;
  subs.push({ weight: 0.15, value: noWalk });
  if (hasPedometer && features.walkingInterference > 0.5) {
    flags.push({ code: 'WALKING_DETECTED', severity: 'soft' });
  }

  // GPS quality - good <=10 m, falls off to 0 at MAX_GPS_ACCURACY_METERS
  const gpsScore = clamp01(
    1 - (features.gpsAccuracyMedian - 10) / (MAX_GPS_ACCURACY_METERS - 10),
  );
  subs.push({ weight: 0.1, value: gpsScore });
  if (features.gpsAccuracyMedian > MAX_GPS_ACCURACY_METERS) {
    flags.push({
      code: 'GPS_NOISY',
      severity: 'soft',
      detail: `median accuracy ${features.gpsAccuracyMedian.toFixed(0)} m`,
    });
  }

  // Sample density - 2 samples/s = full credit
  const densScore = clamp01(features.sampleDensity / 2);
  subs.push({ weight: 0.05, value: densScore });
  if (features.sampleDensity < MIN_SAMPLE_DENSITY_HZ) {
    flags.push({ code: 'SPARSE_SAMPLES', severity: 'soft' });
  }

  // Elevation consistency
  subs.push({ weight: 0.05, value: features.elevationConsistency });

  // Anti "perfectly straight constant-speed" pattern
  const straightnessPenalty = features.straightLineRatio > 0.95 ? 0 : 1;
  subs.push({ weight: 0.1, value: straightnessPenalty });
  if (features.straightLineRatio > 0.95 && features.movingDistanceKm > 1) {
    flags.push({ code: 'TOO_STRAIGHT', severity: 'soft' });
  }

  const totalWeight = subs.reduce((a, s) => a + s.weight, 0);
  const weighted = subs.reduce((a, s) => a + s.weight * s.value, 0);
  const integrityScore = totalWeight > 0 ? clamp01(weighted / totalWeight) : 0;

  return { integrityScore, flags };
}
