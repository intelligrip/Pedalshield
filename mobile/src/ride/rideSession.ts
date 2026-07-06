/**
 * RideSession - on-device state machine for an in-progress bike ride.
 *
 * Buffers sensor samples in memory, computes live stats, and on
 * stop() invokes the verifier to produce a `RideVerificationResult`.
 * Raw samples are kept in RAM only and discarded on reset().
 *
 * This is the seam the React hook (useRideSession) wraps and the
 * platform-specific sensor source (real / synthetic) feeds.
 */

import type {
  AttestationToken,
  BarometerSample,
  GeoPoint,
  MotionSample,
  PedometerWindow,
  RawRide,
  RideVerificationResult,
} from '../verification/types.ts';
import { verifyRide } from '../verification/engine.ts';
import { haversineKm } from '../verification/geo.ts';

export type RideSessionState =
  | 'idle'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'complete'
  | 'error';

export interface RideSessionStats {
  elapsedS: number;
  liveKm: number;
  liveAvgKmh: number;
  liveMaxKmh: number;
  geoSampleCount: number;
  motionSampleCount: number;
}

export interface RideSessionSnapshot {
  state: RideSessionState;
  rideId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  stats: RideSessionStats;
  /**
   * Live polyline points. Sliced from the internal `geo` buffer so React
   * sees a new array reference each notify() and the map re-renders. The
   * route never leaves the device - this array is consumed only by the
   * on-device map and discarded on reset().
   */
  liveRoute: ReadonlyArray<{ lat: number; lon: number }>;
  result: RideVerificationResult | null;
  errorMessage: string | null;
}

const EMPTY_STATS: RideSessionStats = {
  elapsedS: 0,
  liveKm: 0,
  liveAvgKmh: 0,
  liveMaxKmh: 0,
  geoSampleCount: 0,
  motionSampleCount: 0,
};

export type SessionListener = (snapshot: RideSessionSnapshot) => void;

function newRideId(): string {
  const noise = Math.random().toString(36).slice(2, 12).toUpperCase();
  return `01HX${noise.padEnd(10, '0').slice(0, 10)}`;
}

export class RideSession {
  private state: RideSessionState = 'idle';
  private rideId: string | null = null;
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private geo: GeoPoint[] = [];
  private motion: MotionSample[] = [];
  private barometer: BarometerSample[] = [];
  private pedometer: PedometerWindow[] = [];
  private attestation: AttestationToken | undefined;
  private liveMaxKmh = 0;
  private pausedAccumMs = 0;
  private pausedAt: number | null = null;
  private result: RideVerificationResult | null = null;
  private errorMessage: string | null = null;
  private listeners = new Set<SessionListener>();

  constructor(attestation?: AttestationToken) {
    this.attestation = attestation;
  }

  start(): RideSessionSnapshot {
    if (
      this.state !== 'idle' &&
      this.state !== 'complete' &&
      this.state !== 'error'
    ) {
      throw new Error(`cannot start ride from state ${this.state}`);
    }
    this.rideId = newRideId();
    this.startedAt = Date.now();
    this.endedAt = null;
    this.geo = [];
    this.motion = [];
    this.barometer = [];
    this.pedometer = [];
    this.liveMaxKmh = 0;
    this.pausedAccumMs = 0;
    this.pausedAt = null;
    this.result = null;
    this.errorMessage = null;
    this.state = 'active';
    return this.notify();
  }

  /** Pause the ride: freezes the clock and ignores incoming samples. */
  pause(): RideSessionSnapshot {
    this.requireState('active', 'pause');
    this.pausedAt = Date.now();
    this.state = 'paused';
    return this.notify();
  }

  /** Resume a paused ride: clock and sampling continue. */
  resume(): RideSessionSnapshot {
    this.requireState('paused', 'resume');
    if (this.pausedAt !== null) {
      this.pausedAccumMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.state = 'active';
    return this.notify();
  }

  addGeoSample(point: GeoPoint): RideSessionSnapshot {
    // Samples that arrive while paused are dropped, not errors — a paused
    // rider standing at a light shouldn't accumulate distance or throw.
    if (this.state === 'paused') return this.snapshot();
    this.requireState('active', 'addGeoSample');
    if (this.geo.length > 0) {
      const prev = this.geo[this.geo.length - 1];
      const dKm = haversineKm(prev, point);
      const dtS = Math.max(0.001, (point.timestamp - prev.timestamp) / 1000);
      const segKmh = (dKm * 3600) / dtS;
      if (segKmh > this.liveMaxKmh) this.liveMaxKmh = segKmh;
    }
    this.geo.push(point);
    return this.notify();
  }

  addMotionSample(sample: MotionSample): RideSessionSnapshot {
    if (this.state === 'paused') return this.snapshot();
    this.requireState('active', 'addMotionSample');
    this.motion.push(sample);
    return this.notify();
  }

  addBarometerSample(sample: BarometerSample): RideSessionSnapshot {
    if (this.state === 'paused') return this.snapshot();
    this.requireState('active', 'addBarometerSample');
    this.barometer.push(sample);
    return this.notify();
  }

  addPedometerWindow(window: PedometerWindow): RideSessionSnapshot {
    if (this.state === 'paused') return this.snapshot();
    this.requireState('active', 'addPedometerWindow');
    this.pedometer.push(window);
    return this.notify();
  }

  stop(): RideSessionSnapshot {
    if (this.state !== 'active' && this.state !== 'paused') {
      throw new Error(`stop requires state active or paused, currently ${this.state}`);
    }
    // Finalise any open pause interval so paused time is excluded cleanly.
    if (this.state === 'paused' && this.pausedAt !== null) {
      this.pausedAccumMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.state = 'stopping';
    this.endedAt = Date.now();
    try {
      const raw: RawRide = {
        rideId: this.rideId as string,
        startedAt: this.startedAt as number,
        endedAt: this.endedAt,
        geo: this.geo,
        motion: this.motion,
        barometer: this.barometer,
        pedometer: this.pedometer,
        deviceAttestation: this.attestation,
      };
      this.result = verifyRide(raw);
      this.state = 'complete';
    } catch (e) {
      this.errorMessage = (e as Error).message;
      this.state = 'error';
    }
    return this.notify();
  }

  reset(): RideSessionSnapshot {
    this.state = 'idle';
    this.rideId = null;
    this.startedAt = null;
    this.endedAt = null;
    this.geo = [];
    this.motion = [];
    this.barometer = [];
    this.pedometer = [];
    this.liveMaxKmh = 0;
    this.pausedAccumMs = 0;
    this.pausedAt = null;
    this.result = null;
    this.errorMessage = null;
    return this.notify();
  }

  getRawRide(): RawRide | null {
    if (this.startedAt === null) return null;
    return {
      rideId: this.rideId as string,
      startedAt: this.startedAt,
      endedAt: this.endedAt ?? Date.now(),
      geo: this.geo,
      motion: this.motion,
      barometer: this.barometer,
      pedometer: this.pedometer,
      deviceAttestation: this.attestation,
    };
  }

  snapshot(): RideSessionSnapshot {
    return {
      state: this.state,
      rideId: this.rideId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      stats: this.computeStats(),
      liveRoute: this.geo.map((p) => ({ lat: p.lat, lon: p.lon })),
      result: this.result,
      errorMessage: this.errorMessage,
    };
  }

  /** Lightweight current-state read (no snapshot allocation). */
  getState(): RideSessionState {
    return this.state;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private computeStats(): RideSessionStats {
    if (this.state === 'idle' || this.startedAt === null) {
      return EMPTY_STATS;
    }
    const now = this.endedAt ?? Date.now();
    // Exclude paused time so the live clock and average speed reflect actual
    // riding. While currently paused, also subtract the open pause interval.
    const openPauseMs =
      this.state === 'paused' && this.pausedAt !== null
        ? now - this.pausedAt
        : 0;
    const activeMs = now - this.startedAt - this.pausedAccumMs - openPauseMs;
    const elapsedS = Math.max(0, activeMs / 1000);
    let liveKm = 0;
    for (let i = 1; i < this.geo.length; i++) {
      liveKm += haversineKm(this.geo[i - 1], this.geo[i]);
    }
    const liveAvgKmh = elapsedS > 0 ? (liveKm * 3600) / elapsedS : 0;
    return {
      elapsedS,
      liveKm,
      liveAvgKmh,
      liveMaxKmh: this.liveMaxKmh,
      geoSampleCount: this.geo.length,
      motionSampleCount: this.motion.length,
    };
  }

  private requireState(expected: RideSessionState, op: string): void {
    if (this.state !== expected) {
      throw new Error(
        `${op} requires state ${expected}, currently ${this.state}`,
      );
    }
  }

  private notify(): RideSessionSnapshot {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
    return snap;
  }
}
