/**
 * Fogline claim — the only thing a Fogline ride sends off the device.
 *
 * Extends the Pedalshield privacy boundary (`verification/claim.ts`, MIT)
 * rather than loosening it. Same rule, stated more strictly:
 *
 *   MAY carry:   a quest id, the ride's tiles THAT ARE IN THAT QUEST, a pass
 *                bit, a coarse distance band, the opaque ride id, and the
 *                attestation token the app already sends.
 *   NEVER:       lat, lon, polylines, any sensor stream, place names,
 *                endpoints, timestamps of the ride, engine flags.
 *
 * ── MINIMUM DISCLOSURE ───────────────────────────────────────────────────
 * The rider's full atlas never leaves the phone. The claim carries only the
 * intersection of this ride's tiles with the quest's tile set — tiles that
 * are already public because the quest published them. A ride that touched
 * 40 cells, 3 of them in the quest, discloses those 3 and nothing about the
 * other 37. The server needs no more than that to evaluate the quest.
 *
 * ── WHY SOME "HARMLESS" FIELDS ARE EXCLUDED ──────────────────────────────
 *   - startedAt/endedAt: time + tiles is a fingerprint. The server timestamps
 *     receipt itself, which is all the daily cap needs.
 *   - flags: VerificationFlag.detail is free text produced by the engine.
 *     Free text is a leak waiting to happen; a pass bit carries the decision.
 *   - exact verifiedKm: replaced by a band. The quest pays a flat amount.
 *
 * The builder never receives geometry — only tile IDs computed on device by
 * `tiles.ts`. And `assertFoglineClaimSafe` re-checks every claim before it is
 * returned, so a future edit that smuggles a field in fails loudly.
 */

import type {
  AttestationToken,
  RideVerificationResult,
} from '../verification/types.ts';
import { isTileId } from './tiles.ts';

export const FOGLINE_CLAIM_VERSION = 1;

/** A quest is public: its id and tile set ship inside the app. */
export interface FoglineQuest {
  id: string;
  tiles: readonly string[];
}

export type DistanceBand = 'lt5' | '5to10' | '10to20' | '20plus';

export interface FoglineClaim {
  v: 1;
  /** Opaque random id (see rideSession.newRideId). Server dedupe key. */
  rideId: string;
  questId: string;
  /** Ride tiles ∩ quest tiles, sorted. Never any non-quest tile. */
  questTiles: string[];
  /** Only verified rides produce a claim, so this is always true. */
  pass: true;
  distanceBand: DistanceBand;
  attestation?: AttestationToken;
}

/** Exact top-level keys a Fogline claim may contain. */
export const FOGLINE_CLAIM_KEYS: readonly string[] = [
  'attestation',
  'distanceBand',
  'pass',
  'questId',
  'questTiles',
  'rideId',
  'v',
];

const ATTESTATION_KEYS: readonly string[] = ['issuedAt', 'platform', 'token'];

/**
 * Keys that must never appear at any depth. The allowlist above already
 * blocks them at the top level; this catches nesting (e.g. inside an
 * attestation object) and documents intent for reviewers.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  'lat', 'lon', 'lng', 'latitude', 'longitude',
  'geo', 'points', 'polyline', 'coords', 'coordinates', 'path', 'route', 'track',
  'start', 'end', 'startPoint', 'endPoint', 'origin', 'destination', 'home',
  'place', 'placeName', 'address', 'name',
  'altitude', 'accuracy', 'speed', 'heading', 'bearing',
  'motion', 'accel', 'gyro', 'barometer', 'pressure', 'relativeAltitude',
  'pedometer', 'steps', 'features',
  'startedAt', 'endedAt', 'flags', 'detail',
];

/** Something shaped like a decimal-degree coordinate. */
const COORDINATE_PATTERN = /-?\d{1,3}\.\d{4,}/;

export function distanceBandFor(km: number): DistanceBand {
  if (!(km >= 5)) return 'lt5';
  if (km < 10) return '5to10';
  if (km < 20) return '10to20';
  return '20plus';
}

/**
 * Throws if `claim` is not a well-formed, leak-free Fogline claim. Called by
 * the builder on every claim; also safe to call at the network edge.
 */
export function assertFoglineClaimSafe(claim: unknown): asserts claim is FoglineClaim {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    throw new Error('fogline claim: not an object');
  }
  const c = claim as Record<string, unknown>;

  for (const k of Object.keys(c)) {
    if (!FOGLINE_CLAIM_KEYS.includes(k)) {
      throw new Error(`fogline claim: key not allowed: ${k}`);
    }
  }

  walk(c, '');

  if (c.v !== FOGLINE_CLAIM_VERSION) throw new Error('fogline claim: bad version');
  if (c.pass !== true) throw new Error('fogline claim: pass must be true');
  if (typeof c.rideId !== 'string' || !c.rideId) throw new Error('fogline claim: rideId');
  if (typeof c.questId !== 'string' || !c.questId) throw new Error('fogline claim: questId');
  if (!Array.isArray(c.questTiles) || !c.questTiles.every(isTileId)) {
    throw new Error('fogline claim: questTiles must be tile ids');
  }
  if (c.attestation !== undefined) {
    const a = c.attestation as Record<string, unknown>;
    for (const k of Object.keys(a ?? {})) {
      if (!ATTESTATION_KEYS.includes(k)) {
        throw new Error(`fogline claim: attestation key not allowed: ${k}`);
      }
    }
  }
}

function walk(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.includes(k)) {
        throw new Error(`fogline claim: forbidden key ${path}.${k}`);
      }
      walk(v, `${path}.${k}`);
    }
    return;
  }
  // A non-integer number has no legitimate place in this claim. Catches a
  // coordinate smuggled in under an innocent-looking key.
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`fogline claim: non-integer number at ${path}`);
  }
  // Same for strings that look like decimal degrees. The opaque attestation
  // token is exempt: it is a signed blob, not something we compose.
  if (
    typeof value === 'string' &&
    path !== '.attestation.token' &&
    COORDINATE_PATTERN.test(value)
  ) {
    throw new Error(`fogline claim: coordinate-like string at ${path}`);
  }
}

/**
 * Build a Fogline claim, or null when there is nothing worth sending: the
 * ride did not verify, or it touched none of the quest's tiles. Null is the
 * common case and sends nothing — the atlas updates locally either way.
 *
 * Takes tile IDs, never geometry. Compute them with `tilesForRide`.
 */
export function buildFoglineClaim(
  result: RideVerificationResult,
  rideTiles: readonly string[],
  quest: FoglineQuest,
  attestation?: AttestationToken,
): FoglineClaim | null {
  if (result.status !== 'verified') return null;

  const questSet = new Set(quest.tiles.filter(isTileId));
  const questTiles = [...new Set(rideTiles)]
    .filter((t) => questSet.has(t))
    .sort();
  if (questTiles.length === 0) return null;

  const claim: FoglineClaim = {
    v: 1,
    rideId: result.rideId,
    questId: quest.id,
    questTiles,
    pass: true,
    distanceBand: distanceBandFor(result.verifiedKm),
    ...(attestation
      ? {
          attestation: {
            platform: attestation.platform,
            token: attestation.token,
            issuedAt: attestation.issuedAt,
          },
        }
      : {}),
  };

  assertFoglineClaimSafe(claim);
  return claim;
}

/**
 * Canonical message the device signs for a Fogline claim. MUST match
 * `fogline::signing_message` in zcash-service byte for byte — both sides pin
 * the same test vector. Binds the quest tiles, so a captured signature
 * cannot be replayed with a different tile set or redirected to another UA.
 */
export function foglineSigningMessage(
  claim: FoglineClaim,
  recipientUa: string,
  signedAt: number,
): string {
  return [
    'fogline-claim-v1',
    claim.rideId,
    recipientUa,
    claim.questId,
    claim.questTiles.join(','),
    String(signedAt),
  ].join('|');
}
