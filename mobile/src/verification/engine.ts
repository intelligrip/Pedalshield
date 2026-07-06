/**
 * Verification engine resolver (open source, MIT).
 *
 * The app always calls `verifyRide` from here. At runtime this resolves to:
 *   1. the PROPRIETARY engine in `../verification-private/engine` if it is
 *      present (the real build — the moat), else
 *   2. the open `stubEngine`, so the public repo and any fork still build,
 *      run and test against the published contract without getting the
 *      scoring rubric, thresholds or fraud heuristics.
 *
 * The private module is git-ignored and absent from the public repo. The
 * require below is LITERAL so Metro statically bundles the real engine into
 * real builds — a dynamic specifier is invisible to Metro and silently falls
 * back to the stub in EVERY React Native bundle (that bug shipped build 9
 * with the stub: all rides stuck "in review", zero verified miles). Public
 * forks still build because metro.config.js redirects this exact specifier
 * to the open stub when the private directory is not on disk, and the node
 * test runner (ESM, no `require`) lands in the catch and gets the stub too.
 */

import type {
  RawRide,
  RideVerificationResult,
  VerificationEngine,
  VerifyOptions,
} from './types.ts';
import { stubEngine } from './stub.ts';

let _engine: VerificationEngine | null = null;

function resolveEngine(): VerificationEngine {
  if (_engine) return _engine;
  try {
    // LITERAL specifier on purpose: Metro only bundles modules it can see
    // statically. metro.config.js maps this to the open stub when the
    // private engine is absent, so public forks still build.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../verification-private/engine.ts');
    const candidate: VerificationEngine | undefined = mod?.engine ?? mod?.default;
    if (candidate && typeof candidate.verifyRide === 'function') {
      _engine = candidate;
      return _engine;
    }
  } catch {
    // private engine not present / require unavailable → open stub
  }
  _engine = stubEngine;
  return _engine;
}

/** True when the proprietary engine is loaded (false on the open stub). */
export function isProprietaryEngineActive(): boolean {
  return resolveEngine() !== stubEngine;
}

/**
 * Verify a ride. Delegates to the proprietary engine when present, otherwise
 * the open stub (which never marks a ride verified).
 */
export function verifyRide(
  ride: RawRide,
  opts?: VerifyOptions,
): RideVerificationResult {
  return resolveEngine().verifyRide(ride, opts);
}
