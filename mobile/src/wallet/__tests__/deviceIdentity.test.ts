/**
 * The signed-message format is PROTOCOL: the backend recomputes this
 * exact string and verifies the signature against it. If this test and
 * the Rust `claim_signing_message` ever disagree, every claim silently
 * fails verification — so pin the format here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { claimSigningMessage } from '../deviceIdentity.ts';

describe('claim signing message (must match backend byte for byte)', () => {
  it('uses the versioned pipe-delimited layout', () => {
    assert.equal(
      claimSigningMessage('ride-1', 'u1abc', 3000, 1753900000),
      'pedalshield-claim-v1|ride-1|u1abc|3000|1753900000',
    );
  });

  it('binds the recipient address, so a signature cannot be redirected', () => {
    const a = claimSigningMessage('r', 'u1alice', 100, 5);
    const b = claimSigningMessage('r', 'u1mallory', 100, 5);
    assert.notEqual(a, b);
  });

  it('binds the distance, so a signature cannot be inflated', () => {
    assert.notEqual(
      claimSigningMessage('r', 'u1a', 3000, 5),
      claimSigningMessage('r', 'u1a', 40000, 5),
    );
  });

  it('binds the timestamp, so an old signature cannot be replayed', () => {
    assert.notEqual(
      claimSigningMessage('r', 'u1a', 3000, 1),
      claimSigningMessage('r', 'u1a', 3000, 2),
    );
  });
});
