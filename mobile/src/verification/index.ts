/**
 * Public verification surface (open source, MIT).
 *
 * This barrel intentionally exposes ONLY the open interface layer:
 *   - the data/contract types (`types.ts`)
 *   - the privacy-boundary claim builder (`claim.ts`)
 *   - generic geo helpers (`geo.ts`)
 *   - the engine resolver entrypoint (`engine.ts`)
 *
 * It does NOT re-export the scoring rubric, thresholds or feature extraction:
 * those are proprietary and live in `../verification-private/` (git-ignored).
 */

export * from './types.ts';
export { haversineKm } from './geo.ts';
export { toClaimPayload } from './claim.ts';
export { verifyRide, isProprietaryEngineActive } from './engine.ts';
