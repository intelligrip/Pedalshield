import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SplitTracker } from '../splitTracker.ts';

describe('SplitTracker', () => {
  it('emits each whole-unit milestone once', () => {
    const t = new SplitTracker();
    assert.deepEqual(t.update(0.4), []);
    assert.deepEqual(t.update(0.9), []);
    assert.deepEqual(t.update(1.0), [1]);
    assert.deepEqual(t.update(1.6), []);
    assert.deepEqual(t.update(2.05), [2]);
  });

  it('catches up multiple milestones on a big jump', () => {
    const t = new SplitTracker();
    assert.deepEqual(t.update(3.2), [1, 2, 3]);
  });

  it('never re-announces and ignores backward drift', () => {
    const t = new SplitTracker();
    assert.deepEqual(t.update(2.0), [1, 2]);
    assert.deepEqual(t.update(1.9), []); // GPS jitter backward
    assert.deepEqual(t.update(2.4), []); // still within 2
    assert.deepEqual(t.update(3.0), [3]);
  });

  it('resets', () => {
    const t = new SplitTracker();
    t.update(5);
    t.reset();
    assert.deepEqual(t.update(1.0), [1]);
  });
});
