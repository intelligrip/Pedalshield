/**
 * Fogline claim — the only thing a Fogline ride sends off the device.
 *
 * THE RULE: nothing about where you rode leaves the phone. Not coordinates,
 * not a polyline, not sensors — and not tiles either. Tiles are coarse
 * location; a set of them is a coarse route. They stay in the atlas, on the
 * device, full stop.
 *
 *   The claim carries:  claim version, opaque ride id, quest id, pass bit,
 *                       the code from the previous letter (letter chain),
 *                       and the attestation token the app already sends.
 *   It never carries:   lat/lon, polylines, any sensor stream, place names,
 *                       endpoints, ride timestamps, distance, engine flags,
 *                       or any tile id.
 *
 * ── WHERE THE QUEST IS CHECKED ───────────────────────────────────────────
 * On the phone. `buildFoglineClaim` evaluates the quest against this ride's
 * tiles and produces a claim only if it is complete. The server learns that
 * a verified ride completed quest X — which the prize itself discloses —
 * and nothing about which cells, which route, or when.
 *
 * This loses no security. Quest tiles are public, so a tampered app could
 * have sent them whether it rode there or not; sending them was a privacy
 * cost with no anti-cheat benefit. The real gate is the same as for every
 * Pedalshield claim: the on-device verifier, the device signature, App
 * Attest, and server-side caps.
 *
 * `assertFoglineClaimSafe` re-checks every claim before it is returned and
 * rejects anything tile-shaped or coordinate-shaped at any depth, so a later
 * edit that smuggles location back in fails loudly.
 */

import type {
  AttestationToken,
  RideVerificationResult,
} from '../verification/types.ts';

export const FOGLINE_CLAIM_VERSION = 1;

/** A quest is public: its id, tiles and threshold ship inside the app. */
export interface FoglineQuest {
  id: string;
  tiles: readonly string[];
  /** Distinct quest tiles one ride must touch. */
  need: number;
}

export interface FoglineClaim {
  v: 1;
  /** Opaque random id (see rideSession.newRideId). Server dedupe key. */
  rideId: string;
  questId: string;
  /** Only a verified ride that completed the quest produces a claim. */
  pass: true;
  /** Code from the previous chapter's letter (chapters 2+). Not location. */
  code?: string;
  attestation?: AttestationToken;
}

/** Exact top-level keys a Fogline claim may contain. */
export const FOGLINE_CLAIM_KEYS: readonly string[] = [
  'attestation',
  'code',
  'pass',
  'questId',
  'rideId',
  'v',
];

const ATTESTATION_KEYS: readonly string[] = ['issuedAt', 'platform', 'token'];

/**
 * Keys that must never appear at any depth. The allowlist already blocks
 * them at the top level; this catches nesting and documents intent.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  'lat', 'lon', 'lng', 'latitude', 'longitude',
  'geo', 'points', 'polyline', 'coords', 'coordinates', 'path', 'route', 'track',
  'tile', 'tiles', 'questTiles', 'cells', 'atlas',
  'start', 'end', 'startPoint', 'endPoint', 'origin', 'destination', 'home',
  'place', 'placeName', 'address', 'name',
  'altitude', 'accuracy', 'speed', 'heading', 'bearing',
  'motion', 'accel', 'gyro', 'barometer', 'pressure', 'relativeAltitude',
  'pedometer', 'steps', 'features',
  'startedAt', 'endedAt', 'distance', 'distanceBand', 'verifiedKm',
  'flags', 'detail',
];

/** Something shaped like a decimal-degree coordinate. */
const COORDINATE_PATTERN = /-?\d{1,3}\.\d{4,}/;
/** Letter-chain code — mirrors CODE_PATTERN in chapters.ts and is_code in Rust. */
const CODE_FORMAT = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** Something shaped like a Fogline tile id. */
const TILE_PATTERN = /fl\d+:-?\d+:-?\d+/;

/**
 * Throws if `claim` is not a well-formed Fogline claim, or carries anything
 * location-shaped. Called by the builder on every claim.
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
  if (c.code !== undefined && (typeof c.code !== 'string' || !CODE_FORMAT.test(c.code))) {
    throw new Error('fogline claim: code is malformed');
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
    // No field in this claim is a list. A list is where a route would hide.
    throw new Error(`fogline claim: arrays are not allowed (${path})`);
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
  // A non-integer number has no legitimate place in this claim.
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`fogline claim: non-integer number at ${path}`);
  }
  // Strings that look like coordinates or tiles. The attestation token is an
  // opaque signed blob we do not compose, so it is exempt.
  if (typeof value === 'string' && path !== '.attestation.token') {
    if (COORDINATE_PATTERN.test(value)) {
      throw new Error(`fogline claim: coordinate-like string at ${path}`);
    }
    if (TILE_PATTERN.test(value)) {
      throw new Error(`fogline claim: tile-like string at ${path}`);
    }
  }
}

/** Distinct quest tiles this ride touched. Pure; runs on device only. */
export function questTilesHit(quest: FoglineQuest, rideTiles: readonly string[]): number {
  const ride = new Set(rideTiles);
  return new Set(quest.tiles.filter((t) => ride.has(t))).size;
}

/**
 * Build a Fogline claim, or null when there is nothing to send: the ride did
 * not verify, or it did not complete the quest. Null is the common case and
 * sends nothing — the atlas updates locally either way.
 *
 * Takes tile IDs (computed on device by `tilesForRide`), never geometry, and
 * puts none of them in the result.
 */
export function buildFoglineClaim(
  result: RideVerificationResult,
  rideTiles: readonly string[],
  quest: FoglineQuest,
  attestation?: AttestationToken,
): FoglineClaim | null {
  if (result.status !== 'verified') return null;
  const need = Math.max(1, Math.min(quest.tiles.length, Math.floor(quest.need)));
  if (questTilesHit(quest, rideTiles) < need) return null;

  const claim: FoglineClaim = {
    v: 1,
    rideId: result.rideId,
    questId: quest.id,
    pass: true,
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
 * the same test vector. Binds the UA so a captured signature cannot be
 * redirected to another wallet.
 */
export function foglineSigningMessage(
  claim: FoglineClaim,
  recipientUa: string,
  signedAt: number,
): string {
  return ['fogline-claim-v1', claim.rideId, recipientUa, claim.questId, String(signedAt)].join('|');
}

/**
 * Claim for a letter-chain chapter. The chapter's rule is location-free and
 * has already been evaluated on the phone (chapters.ts); this only packages
 * the result. `code` is the one from the previous letter, absent for the
 * first chapter.
 */
export function buildChapterClaim(
  result: RideVerificationResult,
  chapterId: string,
  code: string | null,
  attestation?: AttestationToken,
): FoglineClaim | null {
  if (result.status !== 'verified') return null;
  const claim: FoglineClaim = {
    v: 1,
    rideId: result.rideId,
    questId: chapterId,
    pass: true,
    ...(code ? { code } : {}),
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
