/**
 * Top-level ride verification orchestrator.
 *
 * Usage on the phone:
 *
 *   const result = verifyRide(rawRide);
 *   if (result.status === 'verified' || result.status === 'review') {
 *     const claim = toClaimPayload(rawRide, result);
 *     await api.submitClaim(claim); // only this leaves the device
 *   }
 */

import type {
  ClaimPayload,
  RawRide,
  RideStatus,
  RideVerificationResult,
} from './types.ts';
import { extractFeatures } from './sensorFusion.ts';
import { scoreRide } from './integrityScore.ts';
import {
  DEFAULT_REJECT_THRESHOLD,
  DEFAULT_VERIFY_THRESHOLD,
} from './constants.ts';

export interface VerifyOptions {
  /** Minimum integrity score to mark VERIFIED. */
  verifyThreshold?: number;
  /** Below this score the ride is REJECTED. Between = REVIEW. */
  rejectThreshold?: number;
  /** Override for testing; defaults to Date.now(). */
  now?: () => number;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function verifyRide(
  ride: RawRide,
  opts: VerifyOptions = {},
): RideVerificationResult {
  const verifyThreshold = opts.verifyThreshold ?? DEFAULT_VERIFY_THRESHOLD;
  const rejectThreshold = opts.rejectThreshold ?? DEFAULT_REJECT_THRESHOLD;
  const now = opts.now ?? Date.now;

  const features = extractFeatures(ride);
  const { integrityScore, flags } = scoreRide(features, ride);

  let status: RideStatus;
  if (integrityScore >= verifyThreshold) status = 'verified';
  else if (integrityScore < rejectThreshold) status = 'rejected';
  else status = 'review';

  let verifiedKm: number;
  if (status === 'rejected') {
    verifiedKm = 0;
  } else if (status === 'verified') {
    verifiedKm = round3(features.movingDistanceKm);
  } else {
    // REVIEW: scale by integrity score; rider sees a smaller payout while
    // the server (or a human) takes a second look.
    verifiedKm = round3(features.movingDistanceKm * integrityScore);
  }

  return {
    rideId: ride.rideId,
    status,
    verifiedKm,
    integrityScore: round3(integrityScore),
    flags,
    computedAt: now(),
  };
}

/**
 * Build the minimal payload that may leave the device.
 *
 * NEVER add geo, motion, barometer, pedometer, or features fields here.
 * `rideVerifier.test.ts` enforces this with a JSON substring assertion.
 */
export function toClaimPayload(
  ride: RawRide,
  result: RideVerificationResult,
): ClaimPayload {
  return {
    rideId: ride.rideId,
    startedAt: ride.startedAt,
    endedAt: ride.endedAt,
    verifiedKm: result.verifiedKm,
    integrityScore: result.integrityScore,
    status: result.status,
    flags: result.flags,
    attestation: ride.deviceAttestation,
  };
}
