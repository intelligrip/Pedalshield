/**
 * Unit tests for the auto-pause detector.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AutoPauseDetector,
  DEFAULT_AUTO_PAUSE_CONFIG,
} from '../autoPause.ts';

const T0 = 1_000_000;
const cfg = DEFAULT_AUTO_PAUSE_CONFIG;

describe('AutoPauseDetector', () => {
  it('pauses after a sustained stop', () => {
    const d = new AutoPauseDetector(cfg);
    assert.equal(d.onSpeed(0, T0), null); // just stopped
    assert.equal(d.onSpeed(0, T0 + 4000), null); // still within window
    const ev = d.onSpeed(0, T0 + cfg.pauseAfterMs + 1);
    assert.equal(ev, 'pause');
    assert.equal(d.isPaused(), true);
  });

  it('does NOT pause for a brief stop', () => {
    const d = new AutoPauseDetector(cfg);
    d.onSpeed(0, T0);
    d.onSpeed(0, T0 + 3000);
    const ev = d.onSpeed(20, T0 + 4000); // rolling again before timeout
    assert.equal(ev, null);
    assert.equal(d.isPaused(), false);
  });

  it('resumes when clearly moving again', () => {
    const d = new AutoPauseDetector(cfg);
    d.onSpeed(0, T0);
    d.onSpeed(0, T0 + cfg.pauseAfterMs + 1); // -> pause
    assert.equal(d.isPaused(), true);
    const ev = d.onSpeed(15, T0 + 20000);
    assert.equal(ev, 'resume');
    assert.equal(d.isPaused(), false);
  });

  it('emits only edges, not repeats', () => {
    const d = new AutoPauseDetector(cfg);
    d.onSpeed(0, T0);
    assert.equal(d.onSpeed(0, T0 + cfg.pauseAfterMs + 1), 'pause');
    assert.equal(d.onSpeed(0, T0 + cfg.pauseAfterMs + 2000), null); // still paused
  });

  it('respects external manual pause state', () => {
    const d = new AutoPauseDetector(cfg);
    d.setPaused(true); // user manually paused
    // A low speed should not emit anything; we're already paused.
    assert.equal(d.onSpeed(0, T0 + 1000), null);
    // Movement triggers a single resume edge.
    assert.equal(d.onSpeed(18, T0 + 2000), 'resume');
  });
});
