/**
 * Tests for the opt-in data co-op client.
 *
 * Two things matter here and are pinned with code:
 *   1. `buildContribution` emits only the coarse, minimal fields — never
 *      anything route-like — and is deterministic.
 *   2. `submitContribution` sends NOTHING unless the rider opted in (default
 *      off), so privacy-by-default can't silently regress.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContribution,
  submitContribution,
  GRAMS_CO2_PER_KM,
} from '../coopClient.ts';
import { DATA_COOP_CONSENT_VERSION, setDataCoopOptIn } from '../../prefs/dataCoop.ts';

const UA =
  'u19r0gg89utgp9kcqtdasfyfc6nds5sc6tgzny2sgvrsuyw3z97kkg45h87gufsamfhmyxfykg6amlk3lp0ynlc9wgxx60v9gdsuap0zk9';

describe('buildContribution — coarse, minimal, deterministic', () => {
  const input = {
    recipientUA: UA,
    verifiedKm: 10,
    startedAt: Date.UTC(2026, 0, 1, 14, 30, 0), // 14:30 UTC
  };
  const c = buildContribution(input);

  it('rounds distance to a whole-km bucket', () => {
    assert.equal(c.distance_bucket_km, 10);
  });

  it('reduces start time to UTC hour-of-day (no date)', () => {
    assert.equal(c.hour_bucket, 14);
  });

  it('derives coarse CO2 grams from distance', () => {
    assert.equal(c.co2_grams, Math.round(10 * GRAMS_CO2_PER_KM));
  });

  it('stamps the current consent version', () => {
    assert.equal(c.consent_version, DATA_COOP_CONSENT_VERSION);
  });

  it('contains ONLY the minimal coarse fields (no route/coords)', () => {
    const keys = Object.keys(c).sort();
    assert.deepEqual(keys, [
      'co2_grams',
      'consent_version',
      'distance_bucket_km',
      'hour_bucket',
      'recipient_ua',
    ]);
    const json = JSON.stringify(c);
    for (const banned of ['lat', 'lon', 'coord', 'geo', 'accel', 'route', 'timestamp']) {
      assert.equal(json.includes(banned), false, `${banned} leaked`);
    }
  });

  it('is deterministic for the same inputs', () => {
    assert.deepEqual(buildContribution(input), c);
  });

  it('omits region unless explicitly provided', () => {
    assert.equal('region' in c, false);
    const withRegion = buildContribution({ ...input, region: '  Brooklyn ' });
    assert.equal(withRegion.region, 'Brooklyn');
  });
});

describe('submitContribution — privacy by default', () => {
  it('sends nothing when the rider has NOT opted in', async () => {
    await setDataCoopOptIn(false);
    const r = await submitContribution({
      recipientUA: UA,
      verifiedKm: 5,
      startedAt: Date.UTC(2026, 0, 1, 9, 0, 0),
    });
    assert.equal(r.submitted, false);
    assert.equal((r as { skipped: string }).skipped, 'not-opted-in');
  });
});
