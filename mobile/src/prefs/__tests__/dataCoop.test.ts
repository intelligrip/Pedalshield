/**
 * Unit tests for the data co-op opt-in.
 *
 * The whole point of this module is "privacy by default": a rider only ever
 * contributes if they take a deliberate action, and can take it back. These
 * tests lock that behaviour in with code so a future refactor can't silently
 * flip the default to ON.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_COOP_CONSENT_VERSION,
  getDataCoopPrefs,
  isDataCoopOptedIn,
  loadDataCoopPrefs,
  onDataCoopChange,
  setDataCoopOptIn,
} from '../dataCoop.ts';

describe('data co-op opt-in (privacy default)', () => {
  it('defaults to OFF before any opt-in', async () => {
    await setDataCoopOptIn(false);
    assert.equal(isDataCoopOptedIn(), false);
    assert.equal(getDataCoopPrefs().optedIn, false);
    assert.equal(getDataCoopPrefs().consentedAt, 0);
    assert.equal(getDataCoopPrefs().consentVersion, 0);
  });

  it('loading with nothing stored keeps the rider opted out', async () => {
    const prefs = await loadDataCoopPrefs();
    assert.equal(prefs.optedIn, false);
    assert.equal(isDataCoopOptedIn(), false);
  });

  it('opting in stamps consent time + current version', async () => {
    const before = Date.now();
    const prefs = await setDataCoopOptIn(true);
    assert.equal(prefs.optedIn, true);
    assert.equal(prefs.consentVersion, DATA_COOP_CONSENT_VERSION);
    assert.ok(prefs.consentedAt >= before);
    assert.equal(isDataCoopOptedIn(), true);
  });

  it('opting out clears consent completely', async () => {
    await setDataCoopOptIn(true);
    const prefs = await setDataCoopOptIn(false);
    assert.equal(prefs.optedIn, false);
    assert.equal(prefs.consentedAt, 0);
    assert.equal(prefs.consentVersion, 0);
    assert.equal(isDataCoopOptedIn(), false);
  });

  it('notifies subscribers on opt-in and opt-out', async () => {
    await setDataCoopOptIn(false);
    const seen: boolean[] = [];
    const off = onDataCoopChange((p) => seen.push(p.optedIn));
    await setDataCoopOptIn(true);
    await setDataCoopOptIn(false);
    off();
    // initial false (fires immediately) + opt-in true + opt-out false
    assert.deepEqual(seen, [false, true, false]);
  });
});
