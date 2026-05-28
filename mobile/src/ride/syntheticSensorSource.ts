/**
 * SyntheticSensorSource - demo-only sample generator.
 *
 * Pumps a believable bike ride (~18 km/h, gentle curves, ~84 rpm cadence)
 * into a RideSession on a setInterval. Lets the UI be filmed on a
 * simulator without real GPS / accelerometer.
 *
 * Replace at integration time with a `RealSensorSource` that subscribes
 * to expo-location (GPS), expo-sensors (Accelerometer / Gyroscope /
 * Barometer), and expo-sensors Pedometer; the contract is the same.
 */

import type { RideSession } from './rideSession.ts';

export class SyntheticSensorSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lat = 37.7749;
  private lon = -122.4194;
  private heading = 0;
  private startMs = 0;
  private session: RideSession | null = null;
  private speedMs = 5.0; // ~18 km/h

  start(session: RideSession): void {
    this.session = session;
    this.startMs = Date.now();
    this.lat = 37.7749;
    this.lon = -122.4194;
    this.heading = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 200);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.session = null;
  }

  private tick(): void {
    if (!this.session) return;
    const now = Date.now();
    const t = (now - this.startMs) / 1000;

    // Gentle heading wander every ~6s
    if (Math.floor(t) % 6 === 0 && Math.random() < 0.2) {
      this.heading += (Math.random() - 0.5) * 0.4;
    }

    const dxy = this.speedMs * 0.2; // 200ms tick
    const cosLat = Math.cos((this.lat * Math.PI) / 180);
    const dLat = (dxy * Math.sin(this.heading)) / 111320;
    const dLon = (dxy * Math.cos(this.heading)) / (111320 * cosLat);
    this.lat += dLat;
    this.lon += dLon;

    try {
      this.session.addGeoSample({
        lat: this.lat,
        lon: this.lon,
        altitude: 10 + Math.sin(t / 60) * 3,
        accuracy: 6 + Math.random() * 4,
        speed: this.speedMs,
        timestamp: now,
      });
    } catch {
      // session may have transitioned out of 'active'; stop pumping
      this.stop();
      return;
    }

    // Pump 4 motion samples per tick (~20 Hz)
    for (let i = 0; i < 4; i++) {
      const ts = now - 50 * (3 - i);
      const cadence = Math.sin(2 * Math.PI * 1.4 * (ts / 1000)) * 1.2;
      const noise = (Math.random() - 0.5) * 1.2;
      try {
        this.session.addMotionSample({
          timestamp: ts,
          accel: { x: 0.1, y: 0.1, z: 9.81 + cadence + noise },
          gyro: { x: 0, y: 0, z: 0 },
        });
      } catch {
        this.stop();
        return;
      }
    }
  }
}
