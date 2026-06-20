/**
 * Tunable thresholds for the ride verification rubric.
 *
 * These are intentionally explicit (not an opaque ML model) so the
 * security write-up can defend them. An ML classifier is on the roadmap
 * once we collect labelled ride data; the rubric stays as a fallback and
 * as a guard for hard fails.
 */

/**
 * Realistic average speed range for casual / commuter cycling. Min raised
 * to 8 km/h so brisk-walking speed (~5-7 km/h) no longer counts as "in
 * band" — walking was scoring cycling credit at the old 5 km/h floor.
 */
export const CYCLING_SPEED_BAND_KMH = { min: 8, max: 50 };

/** Implied speed between consecutive GPS samples above this = teleport. */
export const HARD_FAIL_MAX_SPEED_KMH = 90;

/** Sustained average speed above this is not a bike. */
export const HARD_FAIL_AVG_SPEED_KMH = 65;

/**
 * Walking-pace hard fail (lower-bound counterpart to HARD_FAIL_AVG_SPEED_KMH).
 * A ride whose moving average is below MIN_CYCLING_AVG_SPEED_KMH *and* whose
 * fastest segment never reaches CYCLING_BURST_MIN_KMH is walking, not cycling.
 * This test is deliberately pedometer-INDEPENDENT: step data is often missing
 * (Motion & Fitness permission off), and we must still reject a walk. A real
 * cyclist, even a slow one, breaks ~15 km/h at least briefly; a walker never
 * does. Requires a minimum moving distance so GPS jitter on a near-stationary
 * phone can't trip it.
 */
export const MIN_CYCLING_AVG_SPEED_KMH = 9;
export const CYCLING_BURST_MIN_KMH = 15;
export const WALKING_GATE_MIN_DISTANCE_KM = 0.2;

/** Below this segment speed we treat the rider as stationary. */
export const MOVING_SPEED_THRESHOLD_MS = 1.0;

/** Median GPS accuracy above this is considered noisy. */
export const MAX_GPS_ACCURACY_METERS = 50;

/** Combined sensor samples per second below this is sparse. */
export const MIN_SAMPLE_DENSITY_HZ = 0.2;

/** Accel-magnitude RMS deviation; below this means no road vibration. */
export const MIN_VIBRATION_ENERGY = 0.05;

/** Sustained pedometer steps above this rate suggests walking. */
export const MAX_WALKING_STEPS_PER_MIN = 40;

/** Pedaling cadence band in Hz (~48 - 120 rpm). */
export const CADENCE_BAND_HZ = { min: 0.8, max: 2.0 };

/** Below this autocorrelation peak we flag "no cadence". */
export const MIN_CADENCE_CONFIDENCE = 0.15;

/** Default verifier thresholds. */
export const DEFAULT_VERIFY_THRESHOLD = 0.65;
export const DEFAULT_REJECT_THRESHOLD = 0.40;
