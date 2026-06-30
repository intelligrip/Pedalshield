import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZcashPaymentUri,
  base64UrlMemo,
  newOrderId,
} from '../zcashUri.ts';

const UA = 'u1exampleexampleexampleexampleexampleexampleexample';

describe('base64UrlMemo', () => {
  it('encodes ASCII as url-safe base64 without padding', () => {
    // "PSO-ABC123" → base64 "UFNPLUFCQzEyMw==" → url-safe, no padding
    assert.equal(base64UrlMemo('PSO-ABC123'), 'UFNPLUFCQzEyMw');
  });
  it('is url-safe (no + / =)', () => {
    const m = base64UrlMemo('order??//++ memo with spaces & symbols');
    assert.equal(/[+/=]/.test(m), false);
  });
  it('round-trips through Buffer (sanity)', () => {
    const enc = base64UrlMemo('hello world');
    const back = Buffer.from(
      enc.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    assert.equal(back, 'hello world');
  });
});

describe('buildZcashPaymentUri', () => {
  it('builds a ZIP-321 uri with amount + memo', () => {
    const uri = buildZcashPaymentUri(UA, 0.03, 'PSO-ABC123');
    assert.ok(uri.startsWith(`zcash:${UA}?`));
    assert.ok(uri.includes('amount=0.03'));
    assert.ok(uri.includes('memo=UFNPLUFCQzEyMw'));
  });
  it('trims amount to zatoshi precision, no trailing zeros', () => {
    assert.ok(buildZcashPaymentUri(UA, 0.008).includes('amount=0.008'));
    assert.ok(buildZcashPaymentUri(UA, 1).includes('amount=1'));
  });
  it('omits memo when not provided', () => {
    const uri = buildZcashPaymentUri(UA, 0.05);
    assert.equal(uri.includes('memo='), false);
  });
});

describe('newOrderId', () => {
  it('produces a PSO- prefixed id', () => {
    assert.ok(/^PSO-[A-Z0-9]{6}$/.test(newOrderId()));
  });
});
