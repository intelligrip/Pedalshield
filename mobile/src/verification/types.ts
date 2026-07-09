/**
 * Pedalshield - on-device ride verification types.
 *
 * Privacy contract:
 *   - `RawRide`, `RideFeatures`, and any geo / motion / barometer / pedometer
 *     data MUST stay on the device. They are inputs to verification only.
 *   - Only `ClaimPayload` is allowed to leave the device.
 *   - A unit test (`rideVerifier.test.ts`) enforces this with a JSON
 *     substring assertion.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
  /** meters above sea level; null if not available */
  altitude: number | null;
  /** horizontal accuracy in meters */
  accuracy: number;
  /** m/s from GPS; null if not available */
  speed: number | null;
  /** epoch ms */
  timestamp: number;
}

export interface MotionSample {
  /** epoch ms */
  timestamp: number;
  /** m/s^2; includes gravity */
  accel: { x: number; y: number; z: number };
  /** rad/s */
  gyro: { x: number; y: number; z: number };
}

export interface BarometerSample {
  timestamp: number;
  /** hPa */
  pressure: number;
  /** meters relative to session start */
  relativeAltitude: number;
}

export interface PedometerWindow {
  startTime: number;
  endTime: number;
  steps: number;
}

export interface AttestationToken {
  platform: 'android' | 'ios';
  /** JWT or assertion blob from Play Integrity / App Attest */
  token: string;
  issuedAt: number;
}

export interface RawRide {
  /** ULID-style ride identifier */
  rideId: string;
  startedAt: number;
  endedAt: number;
  geo: GeoPoint[];
  motion: MotionSample[];
  barometer: BarometerSample[];
  pedometer: PedometerWindow[];
  deviceAttestation?: AttestationToken;
}

export interface RideFeatures {
  durationS: number;
  gpsDistanceKm: number;
  movingDistanceKm: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  /** largest implied speed between consecutive GPS samples */
  maxImpliedSpeedKmh: number;
  /** fraction of moving time within the cycling speed band */
  speedInBandRatio: number;
  /** RMS of accel magnitude after removing mean (road buzz proxy) */
  vibrationEnergy: number;
  /** 0..1 - autocorrelation-based periodicity in pedaling cadence band */
  cadenceConfidence: number;
  /** 0..1 - 1 = clearly walking based on pedometer */
  walkingInterference: number;
  /** 0..1 - barometer vs GPS altitude agreement */
  elevationConsistency: number;
  /** median horizontal GPS accuracy in meters */
  gpsAccuracyMedian: number;
  /**
   * Fraction of raw GPS fixes discarded as isolated teleport spikes during
   * track cleaning (0..1). A couple of glitches is GPS reality; a track
   * riddled with them is synthetic.
   */
  gpsSpikeRatio: number;
  /** combined samples per second */
  sampleDensity: number;
  /** displacement / pathLength; 1 = perfectly straight */
  straightLineRatio: number;
}

export type FlagCode =
  | 'TELEPORT'
  | 'SPEED_OUT_OF_BAND'
  | 'NO_VIBRATION'
  | 'NO_CADENCE'
  | 'WALKING_DETECTED'
  | 'GPS_NOISY'
  | 'SPARSE_SAMPLES'
  | 'TOO_STRAIGHT'
  | 'NO_ATTESTATION'
  | 'NO_MOTION_DATA'
  | 'GPS_SYNTHETIC';

export interface VerificationFlag {
  code: FlagCode;
  /** 'hard' = zero score; 'soft' = reduces score */
  severity: 'soft' | 'hard';
  detail?: string;
}

export type RideStatus = 'verified' | 'rejected' | 'review';

export interface RideVerificationResult {
  rideId: string;
  status: RideStatus;
  /** distance that counts for earning, in km */
  verifiedKm: number;
  /** 0..1 */
  integrityScore: number;
  flags: VerificationFlag[];
  computedAt: number;
}

export interface VerifyOptions {
  /** Minimum integrity score to mark VERIFIED. */
  verifyThreshold?: number;
  /** Below this score the ride is REJECTED. Between = REVIEW. */
  rejectThreshold?: number;
  /** Override for testing; defaults to Date.now(). */
  now?: () => number;
}

/**
 * The pluggable verification engine contract.
 *
 * This interface is public (MIT). The *implementation* that satisfies it —
 * the real scoring rubric, thresholds and feature extraction — is the moat
 * and ships privately (see `engine.ts` resolver). The open repo provides a
 * stub implementation so it still builds and tests against this contract.
 */
export interface VerificationEngine {
  verifyRide(ride: RawRide, opts?: VerifyOptions): RideVerificationResult;
}

/**
 * Minimal payload that may leave the device.
 * NEVER add geo, motion, barometer, pedometer, or features fields here.
 */
export interface ClaimPayload {
  rideId: string;
  startedAt: number;
  endedAt: number;
  verifiedKm: number;
  integrityScore: number;
  status: RideStatus;
  flags: VerificationFlag[];
  attestation?: AttestationToken;
}
