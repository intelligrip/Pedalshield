/**
 * Device signing identity (security v0.7, app side).
 *
 * Every claim the app submits is signed with an Ed25519 key that is
 * generated on this device, stored in the iOS Keychain (hardware-backed,
 * never synced to iCloud, not present in backups), and never leaves the
 * phone. The backend holds only the PUBLIC half plus a random rider id.
 *
 * WHY: before this, `POST /claim` accepted `signature: 'demo-sig'` from
 * anyone with curl — the on-device anti-cheat protected only riders who
 * actually used the app. Signing makes the endpoint non-forgeable and
 * gives spend limits a stable identity to attach to.
 *
 * WHAT THIS IS NOT: identity. The rider id is a random UUID; we store no
 * email, phone, or name, and the key says nothing about who holds it. It
 * makes the *device* accountable, not the person.
 *
 * NEXT STEP (not this module): App Attest, which proves the key lives in
 * a genuine unmodified Pedalshield build on real hardware. Until then a
 * determined attacker can still register their own key and submit claims —
 * bounded by the server's spend limits.
 *
 * Native modules are loaded behind runtime guards (same pattern as the
 * sensor sources), so a client missing them degrades to unsigned claims
 * rather than crashing.
 */

import { BACKEND_URL } from '../lib/config.ts';
import { ensureAttestation } from './appAttest.ts';

declare const require: (m: string) => any;

let SecureStore: any = null;
try {
  SecureStore = require('expo-secure-store');
  if (!SecureStore?.getItemAsync) SecureStore = null;
} catch {
  SecureStore = null;
}

let ed: any = null;
try {
  // @noble/ed25519 — audited, dependency-light, works in Hermes.
  ed = require('@noble/ed25519');
} catch {
  ed = null;
}

const KEY_SECRET = 'pedalshield.device.sk.v1';
const KEY_RIDER_ID = 'pedalshield.device.riderId.v1';

/** Keychain options: device-only, survives restarts, never leaves the phone. */
const STORE_OPTS = SecureStore
  ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
  : undefined;

export interface DeviceIdentity {
  riderId: string;
  publicKeyB64: string;
}

let _cached: DeviceIdentity | null = null;

export function deviceSigningAvailable(): boolean {
  return !!SecureStore && !!ed;
}

/* ------------------------------------------------------------------ */
/* encoding helpers (no Buffer in RN)                                  */
/* ------------------------------------------------------------------ */

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // eslint-disable-next-line no-undef
  return globalThis.btoa(bin);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function utf8(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 3);
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out[n++] = c;
    else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 63);
    } else if (c < 0x10000) {
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    } else {
      out[n++] = 0xf0 | (c >> 18);
      out[n++] = 0x80 | ((c >> 12) & 63);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    }
  }
  return out.slice(0, n);
}

/**
 * The canonical signed message. MUST match the backend's
 * `claim_signing_message` exactly — field order and separators are
 * protocol. Version the prefix if it ever changes.
 */
export function claimSigningMessage(
  claimId: string,
  recipientUa: string,
  distanceMeters: number,
  signedAt: number,
): string {
  return `pedalshield-claim-v1|${claimId}|${recipientUa}|${distanceMeters}|${signedAt}`;
}

/* ------------------------------------------------------------------ */
/* identity lifecycle                                                  */
/* ------------------------------------------------------------------ */

async function loadOrCreateSecretKey(): Promise<Uint8Array | null> {
  if (!deviceSigningAvailable()) return null;
  const existing = await SecureStore.getItemAsync(KEY_SECRET, STORE_OPTS);
  if (existing) return hexToBytes(existing);
  const sk = ed.utils.randomPrivateKey();
  await SecureStore.setItemAsync(KEY_SECRET, bytesToHex(sk), STORE_OPTS);
  return sk;
}

/**
 * Ensure this device has a keypair and is registered with the backend.
 * Idempotent and safe to call on every claim: the key is created once,
 * and re-registering the same public key returns the same rider id.
 * Returns null when signing isn't available (claims then go unsigned,
 * which the backend still accepts during rollout).
 */
export async function ensureDeviceIdentity(): Promise<DeviceIdentity | null> {
  if (_cached) return _cached;
  if (!deviceSigningAvailable()) return null;
  try {
    const sk = await loadOrCreateSecretKey();
    if (!sk) return null;
    const pk: Uint8Array = await ed.getPublicKeyAsync(sk);
    const publicKeyB64 = toBase64(pk);

    let riderId = await SecureStore.getItemAsync(KEY_RIDER_ID, STORE_OPTS);
    if (!riderId) {
      const res = await fetch(`${BACKEND_URL}/rider/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey_b64: publicKeyB64 }),
      });
      if (!res.ok) return null;
      riderId = (await res.json()).rider_id as string;
      await SecureStore.setItemAsync(KEY_RIDER_ID, riderId, STORE_OPTS);
    }
    _cached = { riderId, publicKeyB64 };
    // Hardware attestation (Tier 0) rides along, fire-and-forget. It must
    // never delay or fail identity: a rider with no attestation still earns
    // exactly as before. Phase A is collecting real samples; enforcement
    // happens server-side once the verifier exists.
    void ensureAttestation(riderId).catch(() => {});
    return _cached;
  } catch {
    return null; // never block a payout on signing infrastructure
  }
}

export interface SignedClaimFields {
  signature: string;
  rider_id: string;
  signed_at: number;
}

/**
 * Sign a claim. Returns null if signing is unavailable — the caller then
 * submits the legacy unsigned shape, which the backend accepts until
 * PEDALSHIELD_REQUIRE_SIGNED_CLAIMS is turned on.
 */
export async function signClaim(
  claimId: string,
  recipientUa: string,
  distanceMeters: number,
): Promise<SignedClaimFields | null> {
  const id = await ensureDeviceIdentity();
  if (!id) return null;
  try {
    const sk = await loadOrCreateSecretKey();
    if (!sk) return null;
    const signedAt = Math.floor(Date.now() / 1000);
    const msg = utf8(
      claimSigningMessage(claimId, recipientUa, distanceMeters, signedAt),
    );
    const sig: Uint8Array = await ed.signAsync(msg, sk);
    return {
      signature: toBase64(sig),
      rider_id: id.riderId,
      signed_at: signedAt,
    };
  } catch {
    return null;
  }
}
