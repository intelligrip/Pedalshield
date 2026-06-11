/**
 * RealSensorSource - feeds a RideSession from the phone's actual sensors.
 *
 * GPS (expo-location) drives distance via addGeoSample; the accelerometer
 * (expo-sensors) drives the cadence/motion verification via
 * addMotionSample. Same contract as SyntheticSensorSource, so it drops
 * into RideTrackerScreen interchangeably.
 *
 * Everything stays on device: samples are pushed straight into the
 * in-memory RideSession and never leave the phone.
 */

import type { RideSession } from './rideSession.ts';

// NOTE: expo-location / expo-sensors are imported lazily inside init() so
// merely importing this module never touches a native module. That keeps
// the app from crashing on a dev client that wasn't built with these
// modules - real GPS simply no-ops with a warning until the native build
// is installed, while the Demo route keeps working everywhere.

const GRAVITY = 9.81;

/**
 * Live GPS fix quality, published for UI consumption (signal chip on the
 * ride screen). Stays on device like everything else here.
 */
export interface GpsQuality {
  /** Horizontal accuracy in metres of the last fix; null = no fix yet. */
  accuracy: number | null;
  /** True when the fix passed the verifier's 30 m gate and was counted. */
  usable: boolean;
  /** Epoch ms of the last fix (0 = none this session). */
  at: number;
}

let lastQuality: GpsQuality = { accuracy: null, usable: false, at: 0 };
const qualityListeners = new Set<(q: GpsQuality) => void>();

function publishGpsQuality(q: GpsQuality): void {
  lastQuality = q;
  for (const l of qualityListeners) l(q);
}

/** Subscribe to GPS fix quality; fires immediately with the latest value. */
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
  private stopped = false;

  start(session: RideSession): void {
    this.session = session;
    this.stopped = false;
    publishGpsQuality({ accuracy: null, usable: false, at: 0 });
    void this.init();
  }

  stop(): void {
    this.stopped = true;
    this.geoSub?.remove();
    this.geoSub = null;
    this.accelSub?.remove();
    this.accelSub = null;
    this.session = null;
  }

  private async init(): Promise<void> {
    try {
      const Location = await import('expo-location');
      const { Accelerometer } = await import('expo-sensors');

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // eslint-disable-next-line no-console
        console.warn('Pedalshield: location permission not granted');
        return;
      }
      if (this.stopped) return;

      // GPS -> geo samples (distance).
      this.geoSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 3, // metres
        },
        (loc) => {
          if (!this.session) return;
          const c = loc.coords;
          // Drop low-confidence fixes. Raw GPS (especially the cold-start
          // fix) can jump tens of metres, which the verifier reads as a
          // >90 km/h "teleport" hard-fail. Only feed tight fixes so a real
          // ride doesn't get rejected by GPS noise.
          const acc = c.accuracy ?? 999;
          publishGpsQuality({
            accuracy: acc === 999 ? null : acc,
            usable: acc <= 30,
            at: Date.now(),
          });
          if (acc > 30) return;
          try {
            this.session.addGeoSample({
              lat: c.latitude,
              lon: c.longitude,
              altitude: c.altitude ?? 0,
              accuracy: c.accuracy ?? 10,
              speed: c.speed && c.speed > 0 ? c.speed : 0,
              timestamp: loc.timestamp ?? Date.now(),
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
}
