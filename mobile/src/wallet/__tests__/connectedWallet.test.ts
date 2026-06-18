/**
 * Unit tests for the connected (bring-your-own) wallet validation +
 * persistence. The validator is the seam that stops a rider's ZEC from
 * being sent to a typo'd / wrong-network / placeholder address, so it gets
 * exercised hard here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateZcashUA,
  isValidUA,
  setConnectedUA,
  getConnectedUA,
  clearConnectedUA,
  isConnected,
  onConnectedUAChange,
} from '../connectedWallet.ts';

// A realistic-length mainnet Unified Address (starts u1, bech32m charset,
// long enough to pass the structural checks). Treasury UA from the deploy
// config — a real mainnet UA, ideal as a known-good fixture.
const REAL_UA =
  'u19r0gg89utgp9kcqtdasfyfc6nds5sc6tgzny2sgvrsuyw3z97kkg45h87gufsamfhmyxfykg6amlk3lp0ynlc9wgxx60v9gdsuap0zk9';

describe('validateZcashUA', () => {
  it('accepts a real mainnet Unified Address', () => {
    const r = validateZcashUA(REAL_UA);
    assert.equal(r.ok, true, r.reason);
    assert.equal(isValidUA(REAL_UA), true);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(validateZcashUA(`  ${REAL_UA}\n`).ok, true);
  });

  it('rejects empty input', () => {
    assert.equal(validateZcashUA('').ok, false);
    assert.equal(validateZcashUA('   ').ok, false);
  });

  it('rejects the demo mock address', () => {
    const mock = 'u1mock' + 'x'.repeat(120);
    assert.equal(validateZcashUA(mock).ok, false);
  });

  it('rejects testnet / regtest UAs', () => {
    assert.equal(validateZcashUA('utest1' + 'a'.repeat(120)).ok, false);
    assert.equal(validateZcashUA('uregtest1' + 'a'.repeat(120)).ok, false);
  });

  it('rejects legacy Sapling (z...) and transparent (t...) addresses', () => {
    assert.equal(validateZcashUA('zs1' + 'a'.repeat(120)).ok, false);
    assert.equal(validateZcashUA('t1' + 'a'.repeat(120)).ok, false);
    assert.equal(validateZcashUA('t3' + 'a'.repeat(120)).ok, false);
  });

  it('rejects truncated (too short) addresses', () => {
    assert.equal(validateZcashUA('u1abcdef').ok, false);
  });

  it('rejects addresses with non-bech32m characters', () => {
    // 'b', 'i', 'o', '1' (after hrp) are not in the bech32m data charset.
    const bad = 'u1' + 'b'.repeat(120);
    assert.equal(validateZcashUA(bad).ok, false);
  });

  it('gives a human-readable reason on failure', () => {
    const r = validateZcashUA('t1' + 'a'.repeat(120));
    assert.equal(r.ok, false);
    assert.ok((r.reason ?? '').length > 0);
  });
});

describe('connected wallet state', () => {
  it('persists, reads back, and clears the connected address', async () => {
    await clearConnectedUA();
    assert.equal(isConnected(), false);
    assert.equal(getConnectedUA(), '');

    await setConnectedUA(REAL_UA);
    assert.equal(getConnectedUA(), REAL_UA);
    assert.equal(isConnected(), true);

    await clearConnectedUA();
    assert.equal(getConnectedUA(), '');
    assert.equal(isConnected(), false);
  });

  it('rejects setting an invalid address', async () => {
    await assert.rejects(() => setConnectedUA('not-a-zcash-address'));
  });

  it('notifies subscribers on change', async () => {
    await clearConnectedUA();
    const seen: string[] = [];
    const off = onConnectedUAChange((ua) => seen.push(ua));
    await setConnectedUA(REAL_UA);
    await clearConnectedUA();
    off();
    // initial '' + connect + clear
    assert.deepEqual(seen, ['', REAL_UA, '']);
  });
});
