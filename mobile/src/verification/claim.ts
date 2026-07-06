/**
 * Claim payload builder — the privacy boundary (open source, MIT).
 *
 * This is deliberately PUBLIC: it is the exact, auditable definition of the
 * only thing that ever leaves the device. The scoring engine that decides
 * `verifiedKm` / `integrityScore` is proprietary, but how those results are
 * packaged for transmission is open so anyone can verify no raw GPS, motion,
 * barometer or pedometer data can ride along. `__tests__/engine.public.test.ts`
 * enforces this with a JSON substring assertion.
 */

import type {
  ClaimPayload,
  RawRide,
  RideVerificationResult,
} from './types.ts';

/**
 * Build the minimal payload that may leave the device.
 *
 * NEVER add geo, motion, barometer, pedometer, or features fields here.
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
