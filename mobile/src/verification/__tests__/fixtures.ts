/**
 * Synthetic ride fixtures used by the verifier tests.
 *
 * All randomness is driven by a seeded mulberry32 PRNG so the tests are
 * fully deterministic - no flakiness in CI.
 */

import type {
  BarometerSample,
  GeoPoint,
  MotionSample,
  PedometerWindow,
  RawRide,
} from '../types.ts';

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ULID = (seed: string): string =>
  `01HX${seed.padEnd(22, '0').slice(0, 22)}`;

/** Offset a lat/lon by metres on the local tangent plane. */
function offsetMeters(
  start: { lat: number; lon: number },
  dxMeters: number,
  dyMeters: number,
): { lat: number; lon: number } {
  const dLat = dyMeters / 111320;
  const dLon =
    dxMeters / (111320 * Math.cos((start.lat * Math.PI) / 180));
  return { lat: start.lat + dLat, lon: start.lon + dLon };
}

interface BuildOpts {
  durationS: number;
  avgSpeedKmh: number;
  sampleRateHz?: number;
  motionRateHz?: number;
  vibrationAmplitude?: number;
  cadenceHz?: number;
  gpsAccuracy?: number;
  withCurves?: boolean;
  withAttestation?: boolean;
  pedometerStepsPerMin?: number;
  startedAt?: number;
  rideId?: string;
  seed?: number;
}

const START = { lat: 37.7749, lon: -122.4194 };
const FIXED_START_TIME = 1_756_500_000_000; // deterministic epoch ms

export function buildLegitBikeRide(): RawRide {
  return buildRide({
    durationS: 30 * 60,
    avgSpeedKmh: 18,
    sampleRateHz: 1,
    motionRateHz: 20,
    vibrationAmplitude: 0.6,
    cadenceHz: 1.4, // ~84 rpm
    gpsAccuracy: 8,
    withCurves: true,
    withAttestation: true,
    pedometerStepsPerMin: 2,
    rideId: ULID('legit'),
    seed: 1,
  });
}

export function buildCarRide(): RawRide {
  return buildRide({
    durationS: 30 * 60,
    avgSpeedKmh: 75, // way above cycling band
    sampleRateHz: 1,
    motionRateHz: 20,
    vibrationAmplitude: 0.15, // smooth car suspension
    cadenceHz: 0, // no periodic pedaling signal
    gpsAccuracy: 6,
    withCurves: true,
    withAttestation: true,
    pedometerStepsPerMin: 0,
    rideId: ULID('car'),
    seed: 2,
  });
}

export function buildWalkingRide(): RawRide {
  return buildRide({
    durationS: 30 * 60,
    avgSpeedKmh: 4.5, // walking pace - below cycling band
    sampleRateHz: 1,
    motionRateHz: 20,
    vibrationAmplitude: 0.4,
    cadenceHz: 0, // no pedaling
    gpsAccuracy: 8,
    withCurves: true,
    withAttestation: true,
    pedometerStepsPerMin: 110, // clearly walking
    rideId: ULID('walk'),
    seed: 3,
  });
}

export function buildGpsSpoof(): RawRide {
  const start = START;
  const end = offsetMeters(start, 10_000, 0); // 10 km east instantly
  const t0 = FIXED_START_TIME;
  return {
    rideId: ULID('spoof'),
    startedAt: t0,
    endedAt: t0 + 60_000,
    geo: [
      {
        lat: start.lat,
        lon: start.lon,
        altitude: 10,
        accuracy: 5,
        speed: 0,
        timestamp: t0,
      },
      {
        lat: end.lat,
        lon: end.lon,
        altitude: 10,
        accuracy: 5,
        speed: 0,
        timestamp: t0 + 60_000,
      },
    ],
    motion: [],
    barometer: [],
    pedometer: [],
    deviceAttestation: {
      platform: 'android',
      token: 'mock',
      issuedAt: t0,
    },
  };
}

function buildRide(opts: BuildOpts): RawRide {
  const startedAt = opts.startedAt ?? FIXED_START_TIME;
  const endedAt = startedAt + opts.durationS * 1000;
  const sampleRateHz = opts.sampleRateHz ?? 1;
  const motionRateHz = opts.motionRateHz ?? 20;
  const numGeo = Math.floor(opts.durationS * sampleRateHz);
  const numMotion = Math.floor(opts.durationS * motionRateHz);
  const speedMs = (opts.avgSpeedKmh * 1000) / 3600;
  const rng = mulberry32(opts.seed ?? 0);

  // Geo path
  const geo: GeoPoint[] = [];
  let acc = { ...START };
  let heading = 0;
  for (let i = 0; i <= numGeo; i++) {
    const t = i / sampleRateHz;
    const dt = i === 0 ? 0 : 1 / sampleRateHz;
    if (opts.withCurves && i > 0 && i % 30 === 0) {
      heading += (rng() - 0.5) * 0.8;
    }
    const dxy = speedMs * dt;
    if (i > 0) {
      acc = offsetMeters(
        acc,
        dxy * Math.cos(heading),
        dxy * Math.sin(heading),
      );
    }
    geo.push({
      lat: acc.lat,
      lon: acc.lon,
      altitude: 10 + Math.sin(t / 60) * 3,
      accuracy: opts.gpsAccuracy ?? 8,
      speed: speedMs,
      timestamp: startedAt + Math.floor(t * 1000),
    });
  }

  // Motion samples: gravity baseline + vibration noise + optional cadence
  const motion: MotionSample[] = [];
  for (let i = 0; i < numMotion; i++) {
    const t = i / motionRateHz;
    const noise = (rng() - 0.5) * 2 * (opts.vibrationAmplitude ?? 0.5);
    const cadenceComp = opts.cadenceHz
      ? Math.sin(2 * Math.PI * opts.cadenceHz * t) * 1.2
      : 0;
    const totalAccel = 9.81 + noise + cadenceComp;
    motion.push({
      timestamp: startedAt + Math.floor(t * 1000),
      accel: {
        x: 0.1 * Math.sin(t),
        y: 0.1 * Math.cos(t),
        z: totalAccel,
      },
      gyro: { x: 0, y: 0, z: 0 },
    });
  }

  // Pedometer windows (1-minute buckets)
  const pedometer: PedometerWindow[] = [];
  const stepsPerMin = opts.pedometerStepsPerMin ?? 0;
  for (let m = 0; m < Math.floor(opts.durationS / 60); m++) {
    pedometer.push({
      startTime: startedAt + m * 60_000,
      endTime: startedAt + (m + 1) * 60_000,
      steps: stepsPerMin,
    });
  }

  // Barometer samples - elevation roughly consistent with GPS altitude
  const barometer: BarometerSample[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * opts.durationS;
    barometer.push({
      timestamp: startedAt + Math.floor(t * 1000),
      pressure: 1013 - Math.sin(t / 60) * 0.3,
      relativeAltitude: Math.sin(t / 60) * 3,
    });
  }

  return {
    rideId: opts.rideId ?? ULID('ride'),
    startedAt,
    endedAt,
    geo,
    motion,
    barometer,
    pedometer,
    deviceAttestation: opts.withAttestation
      ? {
          platform: 'android',
          token: 'mock-attestation-jwt',
          issuedAt: startedAt,
        }
      : undefined,
  };
}
