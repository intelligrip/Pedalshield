/**
 * Unit tests for the GPS acquisition + gating state machine. These encode
 * the tracking-experience guarantees: don't count distance before a real
 * lock, surface Precise-Location-off, and flag a lost signal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GpsGate,
  DEFAULT_GPS_GATE_CONFIG,
  type GpsGateConfig,
} from '../gpsGate.ts';

const T0 = 1_000_000;
const cfg: GpsGateConfig = DEFAULT_GPS_GATE_CONFIG;

describe('GpsGate - cold start / lock before counting', () => {
  it('does not count noisy cold-start fixes before a lock', () => {
    const g = new GpsGate(T0, cfg);
    const d1 = g.onFix({ accuracy: 48, at: T0 + 500 });
    assert.equal(d1.count, false);
    assert.equal(d1.status, 'acquiring');
    assert.equal(d1.locked, false);

    const d2 = g.onFix({ accuracy: 35, at: T0 + 1500 });
    assert.equal(d2.count, false);
    assert.equal(d2.status, 'acquiring');
  });

  it('locks and starts counting once a tight fix arrives', () => {
    const g = new GpsGate(T0, cfg);
    g.onFix({ accuracy: 40, at: T0 + 500 });
    const lock = g.onFix({ accuracy: 12, at: T0 + 3000 }); // <= 20m
    assert.equal(lock.status, 'locked');
    assert.equal(lock.count, true);
    assert.equal(lock.locked, true);
  });
});

describe('GpsGate - after lock', () => {
  it('counts tight fixes and drops noisy ones without unlocking', () => {
    const g = new GpsGate(T0, cfg);
    g.onFix({ accuracy: 10, at: T0 + 1000 }); // lock
    const good = g.onFix({ accuracy: 18, at: T0 + 2000 });
    assert.equal(good.count, true);
    assert.equal(good.status, 'locked');

    const noisy = g.onFix({ accuracy: 45, at: T0 + 3000 });
    assert.equal(noisy.count, false);
    assert.equal(noisy.status, 'weak');
    assert.equal(noisy.locked, true); // still locked
  });
});

describe('GpsGate - Precise Location off', () => {
  it('declares precise-off after the grace window with only coarse fixes', () => {
    const g = new GpsGate(T0, cfg);
    // Reduced-accuracy iOS fixes: hundreds of metres, never lock.
    g.onFix({ accuracy: 300, at: T0 + 1000 });
    g.onFix({ accuracy: 250, at: T0 + 5000 });
    const d = g.onFix({ accuracy: 280, at: T0 + 9000 }); // past 8s grace
    assert.equal(d.status, 'precise-off');
    assert.equal(d.count, false);
    assert.equal(d.locked, false);
  });

  it('does NOT cry precise-off during normal cold start within grace', () => {
    const g = new GpsGate(T0, cfg);
    const d = g.onFix({ accuracy: 90, at: T0 + 2000 }); // within grace
    assert.equal(d.status, 'acquiring');
  });
});

describe('GpsGate - lost signal', () => {
  it('reports lost when no fix arrives for longer than staleMs', () => {
    const g = new GpsGate(T0, cfg);
    g.onFix({ accuracy: 10, at: T0 + 1000 }); // lock
    const tick = g.onTick(T0 + 1000 + cfg.staleMs + 1);
    assert.equal(tick.status, 'lost');
    assert.equal(tick.count, false);
  });

  it('stays locked while fixes remain fresh', () => {
    const g = new GpsGate(T0, cfg);
    g.onFix({ accuracy: 10, at: T0 + 1000 });
    const tick = g.onTick(T0 + 2000);
    assert.equal(tick.status, 'locked');
  });
});
