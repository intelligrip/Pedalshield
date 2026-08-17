/**
 * Crash reports are the one place a route can leak by accident.
 *
 * Everything else about the route is RAM-only and dies with the process. A
 * crash record is persisted to AsyncStorage and shown on the next launch — so
 * if an error thrown inside the verification pipeline embeds sample values in
 * its message, the route outlives the ride. These tests pin the redaction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { redactCoordinates } from '../crashLog.ts';

describe('crash log redaction', () => {
  it('removes bare coordinate pairs', () => {
    const out = redactCoordinates(
      'verify failed at 44.0582, -121.3153 during segment 3',
    );
    assert.ok(!out.includes('44.0582'), out);
    assert.ok(!out.includes('-121.3153'), out);
  });

  it('removes labelled fields even at low precision', () => {
    const out = redactCoordinates('bad fix lat=44.05 lon=-121.31');
    assert.ok(!out.includes('44.05'), out);
    assert.ok(!out.includes('-121.31'), out);
  });

  it('handles the shapes a serialised GeoPoint would produce', () => {
    const out = redactCoordinates(
      'TypeError: {"lat":44.058173,"lon":-121.315308,"accuracy":5}',
    );
    assert.ok(!/44\.058/.test(out), out);
    assert.ok(!/121\.315/.test(out), out);
  });

  it('keeps the trace debuggable', () => {
    // Redaction is worthless if it destroys the reason we keep crash logs.
    const out = redactCoordinates(
      'TypeError: undefined is not a function\n  at verifyRide (engine.ts:42:9)',
    );
    assert.match(out, /TypeError/);
    assert.match(out, /verifyRide/);
    assert.match(out, /engine\.ts/);
  });

  it('leaves ordinary numbers alone', () => {
    // Distances, scores and timestamps must survive — 0.71 is an integrity
    // score, not a location.
    const out = redactCoordinates('score 0.71 over 3.07 km in 1680 s');
    assert.match(out, /0\.71/);
    assert.match(out, /3\.07/);
    assert.match(out, /1680/);
  });

  it('is safe on empty and malformed input', () => {
    assert.equal(redactCoordinates(''), '');
    assert.doesNotThrow(() => redactCoordinates('no numbers here at all'));
  });
});
