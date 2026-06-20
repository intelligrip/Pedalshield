/**
 * Unit tests for the RideSession state machine. Pure logic, runs in
 * plain Node - no React Native or device dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RideSession, type RideSessionSnapshot } from '../rideSession.ts';
import type { AttestationToken } from '../../verification/types.ts';

const ATT: AttestationToken = {
  platform: 'android',
  token: 'mock',
  issuedAt: 0,
};

describe('RideSession lifecycle', () => {
  it('starts in idle state', () => {
    const s = new RideSession(ATT);
    assert.equal(s.snapshot().state, 'idle');
  });

  it('start() moves to active and assigns a ride id', () => {
    const s = new RideSession(ATT);
    const snap = s.start();
    assert.equal(snap.state, 'active');
    assert.ok(snap.rideId, 'rideId should be assigned');
    assert.ok(snap.startedAt, 'startedAt should be set');
  });

  it('rejects sample submission while idle', () => {
    const s = new RideSession(ATT);
    assert.throws(
      () =>
        s.addGeoSample({
          lat: 0,
          lon: 0,
          altitude: null,
          accuracy: 5,
          speed: null,
          timestamp: 0,
        }),
      /requires state active/,
    );
  });

  it('accumulates samples and computes live stats', () => {
    const s = new RideSession(ATT);
    s.start();
    const now = Date.now();
    // ~100 m hop in 60 s ~= 6 km/h
    s.addGeoSample({
      lat: 37.7749,
      lon: -122.4194,
      altitude: 10,
      accuracy: 5,
      speed: 1.7,
      timestamp: now,
    });
    s.addGeoSample({
      lat: 37.7758, // ~100 m north
      lon: -122.4194,
      altitude: 10,
      accuracy: 5,
      speed: 1.7,
      timestamp: now + 60_000,
    });
    s.addMotionSample({
      timestamp: now,
      accel: { x: 0, y: 0, z: 9.81 },
      gyro: { x: 0, y: 0, z: 0 },
    });
    const snap = s.snapshot();
    assert.equal(snap.stats.geoSampleCount, 2);
    assert.equal(snap.stats.motionSampleCount, 1);
    assert.ok(snap.stats.liveKm > 0.05 && snap.stats.liveKm < 0.2,
      `liveKm should be ~0.1 km, got ${snap.stats.liveKm}`);
  });

  it('pause() / resume() transitions and drops samples while paused', () => {
    const s = new RideSession(ATT);
    s.start();
    const now = Date.now();
    s.addGeoSample({
      lat: 37.7749, lon: -122.4194, altitude: 10, accuracy: 5,
      speed: 5, timestamp: now,
    });

    const paused = s.pause();
    assert.equal(paused.state, 'paused');

    // A sample arriving while paused is ignored, not an error, and does not
    // accumulate distance.
    const beforeCount = s.snapshot().stats.geoSampleCount;
    s.addGeoSample({
      lat: 37.7999, lon: -122.4194, altitude: 10, accuracy: 5,
      speed: 5, timestamp: now + 1000,
    });
    assert.equal(s.snapshot().stats.geoSampleCount, beforeCount);

    const resumed = s.resume();
    assert.equal(resumed.state, 'active');

    // After resume, samples accumulate again.
    s.addGeoSample({
      lat: 37.7758, lon: -122.4194, altitude: 10, accuracy: 5,
      speed: 5, timestamp: now + 2000,
    });
    assert.equal(s.snapshot().stats.geoSampleCount, beforeCount + 1);
  });

  it('rejects resume() when not paused, and pause() when not active', () => {
    const s = new RideSession(ATT);
    assert.throws(() => s.resume(), /requires state paused/);
    s.start();
    assert.throws(() => s.resume(), /requires state paused/);
    s.pause();
    assert.throws(() => s.pause(), /requires state active/);
  });

  it('stop() works from a paused state', () => {
    const s = new RideSession(ATT);
    s.start();
    s.pause();
    const snap = s.stop();
    assert.equal(snap.state, 'complete');
  });

  it('stop() runs verification and moves to complete', () => {
    const s = new RideSession(ATT);
    s.start();
    const snap = s.stop();
    assert.equal(snap.state, 'complete');
    assert.ok(snap.result, 'verification result should be present');
    assert.ok(snap.endedAt, 'endedAt should be set');
  });

  it('reset() clears state back to idle', () => {
    const s = new RideSession(ATT);
    s.start();
    s.stop();
    const snap = s.reset();
    assert.equal(snap.state, 'idle');
    assert.equal(snap.rideId, null);
    assert.equal(snap.result, null);
    assert.equal(snap.stats.geoSampleCount, 0);
  });

  it('rejects start() while active', () => {
    const s = new RideSession(ATT);
    s.start();
    assert.throws(() => s.start(), /cannot start ride/);
  });

  it('subscribe fires on transitions', () => {
    const s = new RideSession(ATT);
    const snaps: RideSessionSnapshot[] = [];
    const off = s.subscribe((snap) => snaps.push(snap));
    s.start();
    s.stop();
    off();
    assert.ok(snaps.length >= 3, `expected >=3 snapshots, got ${snaps.length}`);
    assert.equal(snaps[snaps.length - 1].state, 'complete');
  });

  it('unsubscribe stops further notifications', () => {
    const s = new RideSession(ATT);
    const snaps: RideSessionSnapshot[] = [];
    const off = s.subscribe((snap) => snaps.push(snap));
    off();
    const before = snaps.length;
    s.start();
    assert.equal(snaps.length, before);
  });
});
