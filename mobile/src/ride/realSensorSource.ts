/**
 * RealSensorSource - feeds a RideSession from the phone's actual sensors.
 *
 * GPS (expo-location) drives distance via addGeoSample; the accelerometer
 * (expo-sensors) drives the cadence/motion verification via
 * addMotionSample. Same contract as SyntheticSensorSource, so it drops
 * into RideTrackerScreen interchangeably.
 *
 * Distance gating + acquisition state live in `gpsGate.ts` (pure, tested):
 * we don't count distance until GPS truly locks (fixing zero-distance cold
 * starts), and we surface a rich status (acquiring / locked / weak / lost /
 * precise-off / denied) so the rider always knows whether the ride is
 * counting. While riding we hold the screen awake so foreground tracking
 * doesn't die when the display would otherwise sleep.
 *
 * Everything stays on device: samples are pushed straight into the
 * in-memory RideSession and never leave the phone.
 */

import type { RideSession } from './rideSession.ts';
import {
  GpsGate,
  DEFAULT_GPS_GATE_CONFIG,
  type GpsStatus,
} from './gpsGate.ts';
import { AutoPauseDetector } from './autoPause.ts';
import { cuePause, cueResume } from './cues.ts';

// NOTE: expo-* are imported lazily inside init() so merely importing this
// module never touches a native module. On a dev client without these
// modules, real GPS simply no-ops while the Demo route keeps working.

const GRAVITY = 9.81;

/** Status the UI cares about: gate statuses plus permission 'denied'. */
export type TrackingStatus = GpsStatus | 'denied';

/**
 * Live GPS / tracking state, published for UI consumption (signal chip and
 * the actionable banner on the ride screen). Stays on device.
 */
export interface GpsQuality {
  /** Acquisition / signal / permission state. */
  status: TrackingStatus;
  /** Horizontal accuracy in metres of the last fix; null = no fix yet. */
  accuracy: number | null;
  /** True when GPS is locked and fixes are counting toward distance. */
  usable: boolean;
  /** Epoch ms of the last fix (0 = none this session). */
  at: number;
}

let lastQuality: GpsQuality = {
  status: 'idle',
  accuracy: null,
  usable: false,
  at: 0,
};
const qualityListeners = new Set<(q: GpsQuality) => void>();

function publishGpsQuality(q: GpsQuality): void {
  lastQuality = q;
  for (const l of qualityListeners) l(q);
}

/** Subscribe to GPS / tracking status; fires immediately with the latest. */
export function subscribeGpsQuality(cb: (q: GpsQuality) => void): () => void {
  cb(lastQuality);
  qualityListeners.add(cb);
  return () => {
    qualityListeners.delete(cb);
  };
}

export class RealSensorSource {
  private session: RideSession | null = null;
  private geoSub: { remove(): void } | null = null;
  private accelSub: { remove(): void } | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private gate: GpsGate | null = null;
  private autoPause = new AutoPauseDetector();
  private autoPaused = false;
  private keepAwakeActive = false;
  private stopped = false;

  start(session: RideSession): void {
    this.session = session;
    this.stopped = false;
    this.gate = new GpsGate(Date.now(), DEFAULT_GPS_GATE_CONFIG);
    this.autoPause = new AutoPauseDetector();
    this.autoPaused = false;
    publishGpsQuality({
      status: 'acquiring',
      accuracy: null,
      usable: false,
      at: 0,
    });
    void this.init();
  }

  stop(): void {
    this.stopped = true;
    this.geoSub?.remove();
    this.geoSub = null;
    this.accelSub?.remove();
    this.accelSub = null;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.releaseKeepAwake();
    this.session = null;
    this.gate = null;
  }

  private async init(): Promise<void> {
    try {
      const Location = await import('expo-location');
      const { Accelerometer } = await import('expo-sensors');

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        publishGpsQuality({
          status: 'denied',
          accuracy: null,
          usable: false,
          at: 0,
        });
        return;
      }
      if (this.stopped) return;

      // Keep the screen awake so foreground GPS keeps flowing during the ride.
      await this.acquireKeepAwake();

      // Periodic tick lets the gate flip to 'lost' / 'precise-off' even when
      // no fixes are arriving (tunnel, lock screen, reduced accuracy).
      this.tickTimer = setInterval(() => {
        if (!this.gate || this.stopped) return;
        const d = this.gate.onTick(Date.now());
        publishGpsQuality({
          status: d.status,
          accuracy: d.accuracy,
          usable: d.status === 'locked',
          at: lastQuality.at,
        });
      }, 1500);

      // GPS -> geo samples (distance), gated by the acquisition state machine.
      this.geoSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 3, // metres
        },
        (loc) => {
          if (!this.session || !this.gate) return;
          const c = loc.coords;
          const at = loc.timestamp ?? Date.now();
          const decision = this.gate.onFix({
            accuracy: c.accuracy ?? 999,
            at,
          });
          publishGpsQuality({
            status: decision.status,
            accuracy: decision.accuracy,
            usable: decision.status === 'locked',
            at,
          });

          // Auto-pause / resume from instantaneous GPS speed (when the OS
          // reports it). Manual pause always wins: we only auto-resume a
          // pause we ourselves started.
          if (typeof c.speed === 'number' && c.speed >= 0) {
            const kmh = c.speed * 3.6;
            const st = this.session.getState();
            if (st === 'active') {
              if (this.autoPause.onSpeed(kmh, at) === 'pause') {
                this.session.pause();
                this.autoPaused = true;
                cuePause();
              }
            } else if (st === 'paused' && this.autoPaused) {
              if (this.autoPause.onSpeed(kmh, at) === 'resume') {
                this.session.resume();
                this.autoPaused = false;
                cueResume();
              }
            } else if (st === 'paused') {
              // Manually paused — keep the detector in sync, don't resume.
              this.autoPause.setPaused(true);
            }
          }

          // Only feed counted fixes: pre-lock cold-start noise and post-lock
          // weak fixes are skipped so a real ride isn't undercounted OR
          // polluted with jumpy positions.
          if (!decision.count) return;
          try {
            this.session.addGeoSample({
              lat: c.latitude,
              lon: c.longitude,
              altitude: c.altitude ?? 0,
              accuracy: c.accuracy ?? 10,
              speed: c.speed && c.speed > 0 ? c.speed : 0,
              timestamp: at,
            });
          } catch {
            this.stop();
          }
        },
      );

      // Accelerometer -> motion samples (cadence). expo reports in g; the
      // verifier expects m/s^2 like the synthetic source, so scale up.
      Accelerometer.setUpdateInterval(50); // ~20 Hz
      this.accelSub = Accelerometer.addListener((d) => {
        if (!this.session) return;
        try {
          this.session.addMotionSample({
            timestamp: Date.now(),
            accel: { x: d.x * GRAVITY, y: d.y * GRAVITY, z: d.z * GRAVITY },
            gyro: { x: 0, y: 0, z: 0 },
          });
        } catch {
          this.stop();
        }
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Pedalshield: sensor init failed', e);
    }
  }

  private async acquireKeepAwake(): Promise<void> {
    try {
      const KeepAwake = await import('expo-keep-awake');
      await KeepAwake.activateKeepAwakeAsync('pedalshield-ride');
      this.keepAwakeActive = true;
    } catch {
      // expo-keep-awake not linked (e.g. bare dev client) — non-fatal.
    }
  }

  private releaseKeepAwake(): void {
    if (!this.keepAwakeActive) return;
    this.keepAwakeActive = false;
    void (async () => {
      try {
        const KeepAwake = await import('expo-keep-awake');
        await KeepAwake.deactivateKeepAwake('pedalshield-ride');
      } catch {
        /* non-fatal */
      }
    })();
  }
}
