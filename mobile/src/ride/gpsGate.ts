/**
 * GPS acquisition + gating state machine (pure, on-device).
 *
 * Fixes the two biggest tracking-experience bugs:
 *   1. Zero-distance / undercounted starts — raw GPS needs 10-30s to get a
 *      tight fix, and the old code dropped those cold-start fixes silently.
 *      We now don't COUNT distance until a real lock is achieved, and the UI
 *      can show "Acquiring GPS…" until then, so the ride starts clean.
 *   2. Silent failure when Precise Location is off — reduced-accuracy iOS
 *      fixes come back as hundreds of metres, never pass the gate, and the
 *      rider just sees nothing move. We detect that and surface it.
 *
 * Pure and deterministic: feed it fixes + clock ticks, it returns a status
 * and whether each fix should count toward distance. No I/O, fully testable.
 */

export type GpsStatus =
  | 'idle' // not started
  | 'acquiring' // started, waiting for a first tight fix (lock)
  | 'locked' // good fix, counting distance
  | 'weak' // locked earlier, current fixes too noisy to count
  | 'lost' // no fix for a while (tunnel, lock screen, signal drop)
  | 'precise-off'; // sustained reduced accuracy => Precise Location likely off

export interface GpsGateConfig {
  /** Need a fix at least this good (m) to LOCK and start counting. */
  lockAccuracyM: number;
  /** After lock, fixes within this accuracy (m) count toward distance. */
  countAccuracyM: number;
  /** Sustained accuracy worse than this (m) => Precise Location off. */
  preciseOffAccuracyM: number;
  /** No fix for longer than this (ms) => 'lost'. */
  staleMs: number;
  /** Observe at least this long (ms) before declaring 'precise-off'. */
  preciseOffGraceMs: number;
}

export const DEFAULT_GPS_GATE_CONFIG: GpsGateConfig = {
  lockAccuracyM: 20,
  countAccuracyM: 30,
  preciseOffAccuracyM: 65,
  staleMs: 6000,
  preciseOffGraceMs: 8000,
};

export interface GpsFix {
  /** Horizontal accuracy in metres (smaller = better). */
  accuracy: number;
  /** Epoch ms of the fix. */
  at: number;
}

export interface GateDecision {
  status: GpsStatus;
  /** True if this fix should be fed to the ride session (counts to distance). */
  count: boolean;
  /** True once a lock has ever been achieved this session. */
  locked: boolean;
  /** Accuracy of the most recent fix, or null if none yet. */
  accuracy: number | null;
}

export class GpsGate {
  private cfg: GpsGateConfig;
  private locked = false;
  private startedAt: number;
  private lastFixAt = 0;
  private lastAccuracy: number | null = null;
  private bestAccuracy = Infinity;
  private sawAnyFix = false;

  constructor(startedAt: number, cfg: GpsGateConfig = DEFAULT_GPS_GATE_CONFIG) {
    this.cfg = cfg;
    this.startedAt = startedAt;
  }

  /** Feed a GPS fix. Returns whether it should count + the current status. */
  onFix(fix: GpsFix): GateDecision {
    this.sawAnyFix = true;
    this.lastFixAt = fix.at;
    this.lastAccuracy = fix.accuracy;
    if (fix.accuracy < this.bestAccuracy) this.bestAccuracy = fix.accuracy;

    if (!this.locked) {
      if (fix.accuracy <= this.cfg.lockAccuracyM) {
        this.locked = true;
        return this.decide('locked', true);
      }
      // Not locked yet. If we've waited past the grace window and still can't
      // get a tight fix, that's the Precise-Location-off signature.
      if (
        fix.at - this.startedAt >= this.cfg.preciseOffGraceMs &&
        this.bestAccuracy > this.cfg.preciseOffAccuracyM
      ) {
        return this.decide('precise-off', false);
      }
      return this.decide('acquiring', false);
    }

    // Locked: count only tight fixes; noisy ones don't count but don't unlock.
    if (fix.accuracy <= this.cfg.countAccuracyM) {
      return this.decide('locked', true);
    }
    return this.decide('weak', false);
  }

  /**
   * Call periodically (e.g. every 1-2s) so the gate can detect a dropped
   * signal or a Precise-Location-off situation even when no fixes arrive.
   */
  onTick(now: number): GateDecision {
    if (!this.sawAnyFix) {
      // No fix at all yet.
      if (
        now - this.startedAt >= this.cfg.preciseOffGraceMs &&
        this.cfg.preciseOffAccuracyM < Infinity &&
        this.bestAccuracy > this.cfg.preciseOffAccuracyM
      ) {
        // Never even got a fix after the grace window: still "acquiring"
        // (no evidence yet it's a permission/precise issue vs cold start).
        return this.decide('acquiring', false);
      }
      return this.decide('acquiring', false);
    }

    if (now - this.lastFixAt > this.cfg.staleMs) {
      return this.decide('lost', false);
    }

    if (!this.locked) {
      if (
        now - this.startedAt >= this.cfg.preciseOffGraceMs &&
        this.bestAccuracy > this.cfg.preciseOffAccuracyM
      ) {
        return this.decide('precise-off', false);
      }
      return this.decide('acquiring', false);
    }

    // Locked and fixes are fresh — hold last-known good status.
    const status: GpsStatus =
      this.lastAccuracy != null && this.lastAccuracy <= this.cfg.countAccuracyM
        ? 'locked'
        : 'weak';
    return this.decide(status, false);
  }

  private decide(status: GpsStatus, count: boolean): GateDecision {
    return {
      status,
      count,
      locked: this.locked,
      accuracy: this.lastAccuracy,
    };
  }
}
