/**
 * Auto-pause detector (pure, on-device).
 *
 * Watches the rider's speed and decides when to auto-pause (stopped at a
 * light, a break) and auto-resume (rolling again) — like a real bike
 * computer. Pure and deterministic so it's unit-testable: feed it speed
 * readings with timestamps, it emits 'pause' / 'resume' transitions.
 *
 * Manual pause always wins: the UI tracks whether a pause was auto-initiated
 * and only auto-resumes pauses that it started.
 */

export interface AutoPauseConfig {
  /** At or below this speed (km/h) the rider counts as stopped. */
  stoppedSpeedKmh: number;
  /** Above this speed (km/h) the rider counts as moving again. */
  movingSpeedKmh: number;
  /** Must be stopped continuously this long (ms) before auto-pausing. */
  pauseAfterMs: number;
}

export const DEFAULT_AUTO_PAUSE_CONFIG: AutoPauseConfig = {
  stoppedSpeedKmh: 3, // walking-ish / stationary
  movingSpeedKmh: 6, // clearly rolling again (hysteresis vs stoppedSpeedKmh)
  pauseAfterMs: 8000, // ~8s stopped before we pause
};

export type AutoPauseEvent = 'pause' | 'resume' | null;

export class AutoPauseDetector {
  private cfg: AutoPauseConfig;
  private paused = false;
  /** When the rider first dropped to a stop (null = currently moving). */
  private stoppedSince: number | null = null;

  constructor(cfg: AutoPauseConfig = DEFAULT_AUTO_PAUSE_CONFIG) {
    this.cfg = cfg;
  }

  /**
   * Feed a speed reading. Returns 'pause' or 'resume' on a transition,
   * otherwise null. Idempotent within a state — only edges are emitted.
   */
  onSpeed(speedKmh: number, at: number): AutoPauseEvent {
    if (!this.paused) {
      // Looking for a sustained stop.
      if (speedKmh <= this.cfg.stoppedSpeedKmh) {
        if (this.stoppedSince === null) this.stoppedSince = at;
        if (at - this.stoppedSince >= this.cfg.pauseAfterMs) {
          this.paused = true;
          this.stoppedSince = null;
          return 'pause';
        }
      } else {
        this.stoppedSince = null; // moved again before the timeout
      }
      return null;
    }

    // Paused: resume as soon as the rider is clearly moving again.
    if (speedKmh >= this.cfg.movingSpeedKmh) {
      this.paused = false;
      this.stoppedSince = null;
      return 'resume';
    }
    return null;
  }

  /** Mirror external (manual) pause state so auto-logic stays consistent. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.stoppedSince = null;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
