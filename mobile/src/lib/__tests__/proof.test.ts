import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { durationSecondsFromClaim, proofPageUrl } from '../proof.ts';

describe('proofPageUrl', () => {
  it('builds the pedalshield receipt URL, not the raw explorer', () => {
    const txid = '2a849aca04f9b9661ec826c22db97edfb988a22fc7ce7432a651abbc08b264ab';
    const url = proofPageUrl(txid);
    assert.equal(url, `https://pedalshield.app/proof/${txid}`);
    assert.equal(url.includes('zcashexplorer'), false);
  });

  it('normalises case so the same ride has one URL', () => {
    const mixed = '2A849ACA04F9B9661EC826C22DB97EDFB988A22FC7CE7432A651ABBC08B264AB';
    assert.equal(
      proofPageUrl(mixed),
      'https://pedalshield.app/proof/2a849aca04f9b9661ec826c22db97edfb988a22fc7ce7432a651abbc08b264ab',
    );
  });
});

describe('durationSecondsFromClaim', () => {
  it('derives duration from existing ClaimPayload timestamps', () => {
    assert.equal(durationSecondsFromClaim(1_000, 1_000 + 180_000), 180);
  });

  it('omits rather than inventing a duration', () => {
    assert.equal(durationSecondsFromClaim(5_000, 4_000), undefined);
    assert.equal(durationSecondsFromClaim(Number.NaN, 1), undefined);
    assert.equal(durationSecondsFromClaim(0, 25 * 60 * 60 * 1000), undefined);
  });
});
