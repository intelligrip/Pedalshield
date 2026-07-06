/**
 * Open-source stub verification engine (MIT).
 *
 * This is what the PUBLIC repo (and any fork) runs when the proprietary
 * anti-cheat engine is not present. It deliberately contains NO scoring
 * rubric, thresholds, cadence/vibration analysis or spoof heuristics — those
 * are the moat and live in the private engine.
 *
 * Behaviour: it returns every ride as `review` with an integrity score of 0
 * and zero verified distance. In other words a fork can build, run and read
 * the whole pipeline and privacy contract — but it cannot decide that a ride
 * is real, which is exactly the point. Real payouts require the private
 * engine.
 */

import type {
  RawRide,
  RideVerificationResult,
  VerificationEngine,
  VerifyOptions,
} from './types.ts';

export const stubEngine: VerificationEngine = {
  verifyRide(ride: RawRide, opts: VerifyOptions = {}): RideVerificationResult {
    const now = opts.now ?? Date.now;
    return {
      rideId: ride.rideId,
      // The open stub never asserts authenticity — it always defers to review.
      status: 'review',
      verifiedKm: 0,
      integrityScore: 0,
      flags: [],
      computedAt: now(),
    };
  },
};
