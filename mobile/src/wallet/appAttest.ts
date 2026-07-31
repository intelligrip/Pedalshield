/**
 * App Attest — hardware proof that this is a genuine Pedalshield build
 * (security v0.8, app side. Tier 0 of docs/ANTI_CHEAT_THREAT_MODEL.md).
 *
 * WHY THIS EXISTS
 * ---------------
 * The anti-cheat engine runs as JavaScript inside an app the attacker
 * controls. Every physics check in the engine — speed envelopes, cadence,
 * cross-sensor coherence — is defeated by an attacker who patches the
 * bundle to emit a perfect score, because they never run our code at all.
 * Claim signing (deviceIdentity.ts) proves a claim came from *a registered
 * device*; it cannot prove the device is running *our unmodified binary*.
 *
 * App Attest closes that. Apple's Secure Enclave generates a keypair whose
 * private half no process can read, and Apple signs a statement binding it
 * to our App ID on genuine hardware. A patched build, a simulator, or a
 * script cannot produce one.
 *
 * ROLLOUT (deliberately two-phase, mirroring the claim-signing rollout)
 * --------------------------------------------------------------------
 * Phase A (this build): generate the key, attest it, register the
 *   attestation with the backend, which STORES it. Nothing is enforced.
 *   This exists to capture real attestation objects from real hardware, so
 *   the Rust verifier can be written and unit-tested against actual bytes
 *   rather than against my reading of Apple's spec.
 * Phase B (next build): backend verifies the attestation object and
 *   per-claim assertions; PEDALSHIELD_REQUIRE_ATTESTATION flips it on.
 *
 * FAIL-OPEN, ON PURPOSE — FOR NOW
 * -------------------------------
 * Every failure path returns null and lets the ride proceed unattested.
 * That is correct during phase A (an attestation outage must never cost a
 * rider their earnings) and WRONG once phase B is enforced, at which point
 * the server — not this file — becomes the thing that says no. Enforcement
 * belongs on the server precisely because this file is what an attacker
 * gets to edit.
 *
 * PRIVACY: the key identifier is an opaque random handle. It carries no
 * account, hardware serial, or advertising identifier, and Apple's
 * attestation reveals nothing about the person holding the phone.
 */

import { BACKEND_URL } from '../lib/config.ts';

declare const require: (m: string) => any;

let SecureStore: any = null;
try {
  SecureStore = require('expo-secure-store');
  if (!SecureStore?.getItemAsync) SecureStore = null;
} catch {
  SecureStore = null;
}

let AppIntegrity: any = null;
try {
  // Official Expo module (Play Integrity on Android, App Attest on iOS).
  // Currently alpha upstream — hence the runtime guards on every symbol
  // rather than trusting the surface to stay put across versions.
  AppIntegrity = require('@expo/app-integrity');
  if (!AppIntegrity?.generateKeyAsync) AppIntegrity = null;
} catch {
  AppIntegrity = null;
}

const KEY_ID = 'pedalshield.attest.keyId.v1';
const KEY_ATTESTED = 'pedalshield.attest.registered.v1';

const STORE_OPTS = SecureStore
  ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
  : undefined;

/**
 * True when this device can produce hardware attestations. False on the
 * simulator, on iOS < 14, and whenever the native module is absent — all
 * of which are normal, none of which are evidence of cheating.
 */
export function attestationAvailable(): boolean {
  return !!SecureStore && !!AppIntegrity && AppIntegrity.isSupported === true;
}

/**
 * Ask the backend for a one-time challenge. The challenge is what stops an
 * attacker replaying a captured attestation: it is generated server-side,
 * bound into the signed object by Apple, and accepted exactly once.
 */
async function fetchChallenge(riderId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${BACKEND_URL}/attest/challenge?rider_id=${encodeURIComponent(riderId)}`,
    );
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.challenge === 'string' ? body.challenge : null;
  } catch {
    return null;
  }
}

/**
 * Ensure this device holds an App Attest key and that the backend has its
 * attestation on file. Idempotent and cheap after the first success: the
 * Secure Enclave key survives app updates, so we attest once per install.
 *
 * Apple's keys do NOT survive reinstall, device migration, or restore from
 * backup. When that happens the stored key id is stale and attestation has
 * to start over — handled by clearing both keys and returning null, so the
 * next call generates a fresh one rather than retrying a dead handle.
 */
export async function ensureAttestation(riderId: string): Promise<boolean> {
  if (!attestationAvailable()) return false;
  try {
    const already = await SecureStore.getItemAsync(KEY_ATTESTED, STORE_OPTS);
    if (already === '1') return true;

    let keyId = await SecureStore.getItemAsync(KEY_ID, STORE_OPTS);
    if (!keyId) {
      keyId = await AppIntegrity.generateKeyAsync();
      if (!keyId) return false;
      // Persist BEFORE attesting: the key exists in the Secure Enclave the
      // moment it's generated, and there is no way to enumerate it later.
      // Losing the identifier means orphaning a key we can never use.
      await SecureStore.setItemAsync(KEY_ID, keyId, STORE_OPTS);
    }

    const challenge = await fetchChallenge(riderId);
    if (!challenge) return false;

    const attestation = await AppIntegrity.attestKeyAsync(keyId, challenge);
    if (!attestation) return false;

    const res = await fetch(`${BACKEND_URL}/rider/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rider_id: riderId,
        key_id: keyId,
        challenge,
        attestation,
        platform: 'ios',
      }),
    });
    if (!res.ok) {
      // A rejected attestation may mean a stale key (reinstall/restore).
      // Drop the handle so the next attempt starts clean.
      if (res.status === 400 || res.status === 409) {
        await SecureStore.deleteItemAsync(KEY_ID, STORE_OPTS);
      }
      return false;
    }
    await SecureStore.setItemAsync(KEY_ATTESTED, '1', STORE_OPTS);
    return true;
  } catch {
    return false; // never block a ride on attestation
  }
}

/**
 * Sign a claim message with the attested Secure Enclave key.
 *
 * This is the per-request half: attestation proves the key is genuine
 * once, assertions prove *this specific claim* came from that same genuine
 * app. Apple increments a counter inside each assertion, so the server can
 * also reject replays.
 *
 * Returns null when unattested or unavailable; phase A treats that as
 * "no evidence", phase B will treat it as grounds to refuse the claim.
 */
export async function assertClaim(message: string): Promise<string | null> {
  if (!attestationAvailable()) return null;
  try {
    const attested = await SecureStore.getItemAsync(KEY_ATTESTED, STORE_OPTS);
    const keyId = await SecureStore.getItemAsync(KEY_ID, STORE_OPTS);
    if (attested !== '1' || !keyId) return null;
    const assertion = await AppIntegrity.generateAssertionAsync(keyId, message);
    return typeof assertion === 'string' ? assertion : null;
  } catch {
    return null;
  }
}

/** Key identifier, for diagnostics on the privacy dashboard. Never sent
 *  anywhere except to our own backend during attestation. */
export async function attestationKeyId(): Promise<string | null> {
  if (!SecureStore) return null;
  try {
    return await SecureStore.getItemAsync(KEY_ID, STORE_OPTS);
  } catch {
    return null;
  }
}
