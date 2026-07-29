/**
 * Claim-signing end-to-end check (security v0.7).
 *
 * Run from the Mac:   node scripts/test-claim-signing.mjs
 * Against local:      BACKEND=http://localhost:8787 node scripts/test-claim-signing.mjs
 *
 * Proves three things in one pass:
 *   1. POST /rider/register issues a pseudonymous rider_id for a pubkey;
 *   2. a correctly signed claim is ACCEPTED;
 *   3. a claim that reuses that signature with a TAMPERED distance is
 *      REJECTED — which is the entire point of claim signing.
 *
 * This is also the reference implementation for the app side: the message
 * format and base64 encodings here are the protocol. The app will do the
 * same thing with a key held in the Secure-Enclave-protected keychain
 * instead of an ephemeral one.
 */

import crypto from 'node:crypto';

const BACKEND = process.env.BACKEND ?? 'https://api.pedalshield.app';
const UA =
  process.env.TEST_UA ??
  'u18trzr50p9xpevrpplsgh4w9ddac2h6fagx5lhtd9zus4rxm0qy3vcekmlnywwvnuvnaqd7c48djetjsnhwydars8y3fggc23kt7t3vjtpzqgt0zf2cp52m76vy2q7zy4hfeua4zxzrm0lq5y5kc0fjztnv3etgkvyn3z9a06quefctj8';

/** The canonical signed message — must match backend claim_signing_message. */
function signingMessage(claimId, ua, distanceMeters, signedAt) {
  return `pedalshield-claim-v1|${claimId}|${ua}|${distanceMeters}|${signedAt}`;
}

async function post(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
// Raw 32-byte Ed25519 public key = final 32 bytes of the DER SPKI encoding.
const pubkeyB64 = publicKey
  .export({ type: 'spki', format: 'der' })
  .subarray(-32)
  .toString('base64');

console.log(`backend: ${BACKEND}`);

const reg = await post('/rider/register', { pubkey_b64: pubkeyB64 });
console.log(`\n1. register        -> ${reg.status} ${reg.text}`);
if (reg.status === 404) {
  console.log('\n   /rider/register is 404: the v0.7 backend is not deployed yet.');
  process.exit(1);
}
if (reg.status !== 200) process.exit(1);

const { rider_id: riderId } = JSON.parse(reg.text);
const claimId = `signtest-${Date.now()}`;
const distance = 3000;
const signedAt = Math.floor(Date.now() / 1000);
const signature = crypto
  .sign(null, Buffer.from(signingMessage(claimId, UA, distance, signedAt)), privateKey)
  .toString('base64');

const good = await post('/claim', {
  claim_id: claimId,
  recipient_ua: UA,
  distance_meters: distance,
  signature,
  rider_id: riderId,
  signed_at: signedAt,
});
console.log(`2. signed claim    -> ${good.status} ${good.text}`);

// Negative control: same signature, different distance. Must be refused.
const tampered = await post('/claim', {
  claim_id: `${claimId}-tampered`,
  recipient_ua: UA,
  distance_meters: 40000,
  signature,
  rider_id: riderId,
  signed_at: signedAt,
});
console.log(`3. tampered claim  -> ${tampered.status} ${tampered.text}`);

const pass =
  good.status === 200 &&
  tampered.status !== 200 &&
  /signature/i.test(tampered.text);
console.log(
  `\n${pass ? 'PASS' : 'CHECK'}: signed accepted, tampered ${
    tampered.status !== 200 ? 'rejected' : 'ACCEPTED (!)'
  }`,
);
if (!pass && good.status !== 200) {
  console.log(
    '  note: a "too soon" rejection on step 2 is the cooldown, not a signing failure — rerun in 10 min or lower PEDALSHIELD_MIN_CLAIM_INTERVAL_S.',
  );
}
