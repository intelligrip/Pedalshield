/**
 * computePayoutZat must mirror the backend's `compute_payout` exactly —
 * the app displays this as "ZEC earned", so any drift would show riders a
 * number different from what the treasury actually paid.
 *
 * Backend formula (backend.rs):
 *   raw = (distance_meters * zat_per_km) / 1000   (integer division)
 *   amount = min(raw, max_payout_zat)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computePayoutZat } from '../api.ts';

const INFO = { zat_per_km: 793, max_payout_zat: 500_000 };

describe('computePayoutZat — mirrors backend compute_payout', () => {
  it('pays rate × km with integer division', () => {
    // 1 km = 1000 m → exactly zat_per_km
    assert.equal(computePayoutZat(1000, INFO), 793);
    // 492 m ride (the mainnet receipt) → floor(492*793/1000) = 390
    assert.equal(computePayoutZat(492, INFO), 390);
  });

  it('clamps to the per-ride cap', () => {
    // 1000 km would be 793,000 raw — capped at 500,000
    assert.equal(computePayoutZat(1_000_000, INFO), 500_000);
  });

  it('zero and negative distances pay nothing', () => {
    assert.equal(computePayoutZat(0, INFO), 0);
    assert.equal(computePayoutZat(-5, INFO), 0);
  });

  it('handles a demo-rate config without overflow', () => {
    const demo = { zat_per_km: 1_000_000, max_payout_zat: 5_000_000 };
    assert.equal(computePayoutZat(3000, demo), 3_000_000); // 3 km demo ride
    assert.equal(computePayoutZat(10_000, demo), 5_000_000); // capped
  });
});

describe('payoutUsd / formatUsd — peg-derived USD display', () => {
  // Real payout from July 10: 24,964 zat at 10,596 zat/km should be
  // ≈ $0.13 at the EPA peg ($0.086/mi = $0.053438/km).
  it('derives USD from the pegged rate (no price API)', async () => {
    const { payoutUsd } = await import('../api.ts');
    const usd = payoutUsd(24_964, { zat_per_km: 10_596 });
    if (usd == null) throw new Error('expected a value');
    if (Math.abs(usd - 0.1259) > 0.005) throw new Error(`got ${usd}`);
  });

  it('returns null on missing/zero rate and dust formats as <$0.01', async () => {
    const { payoutUsd, formatUsd } = await import('../api.ts');
    if (payoutUsd(1000, { zat_per_km: 0 }) !== null) throw new Error('rate 0');
    if (payoutUsd(0, { zat_per_km: 10_596 }) !== null) throw new Error('zat 0');
    if (formatUsd(0.001) !== '<$0.01') throw new Error('dust');
    if (formatUsd(0.126) !== '$0.13') throw new Error('rounding');
    if (formatUsd(null) !== null) throw new Error('null');
  });
});
