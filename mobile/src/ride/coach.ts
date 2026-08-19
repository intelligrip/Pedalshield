/**
 * The coach — for consistency, not performance.
 *
 * Strava, TrainingPeaks and Garmin all coach performance: pace, power,
 * training load. They need a heart-rate strap and a power meter, and they
 * serve an athlete chasing a number. Our rider is a commuter, and **nobody
 * coaches showing up.**
 *
 * That is the gap this fills, and it happens to be what the whole product
 * needs: regular verified trips are what a commute programme buys, what the
 * companion is fed by, and what a rider actually benefits from.
 *
 * ── SAFETY, which drives every design decision here ──────────────────────
 * A rider is in traffic. Nothing this module produces may require looking at
 * a phone while moving:
 *   - mid-ride output is AUDIO ONLY, via the existing cue system
 *   - cues are rate-limited and silent early in a ride, when a rider is
 *     merging into traffic and least able to spare attention
 *   - anything worth reading waits until they have stopped
 * "Glance at your bike computer" is a norm from closed-road group riding.
 * It is not a norm for someone on a road with cars.
 *
 * ── TONE ─────────────────────────────────────────────────────────────────
 * Same rule as the companion: reward returning, never punish absence. No
 * scolding, no streak-loss warnings, no "you haven't ridden in 6 days".
 * People get injured, ill and busy; a coach that makes them feel worse is a
 * coach they delete.
 *
 * Pure functions over banked history — no network, no model, no new data.
 */

import type { RideRecord } from './rideHistory.ts';
import { currentStreakDays, verifiedMiles } from './milestones.ts';

const DAY = 86400000;
const KM_PER_MILE = 1.609344;

/* ------------------------------------------------------------------ */
/* Safety limits for anything spoken while moving                      */
/* ------------------------------------------------------------------ */

/** No coaching audio at all in the opening minutes — merging into traffic. */
export const QUIET_START_S = 180;
/** Minimum gap between coach cues. Splits are separate and unaffected. */
export const MIN_CUE_INTERVAL_S = 300;

/* ------------------------------------------------------------------ */
/* Rider patterns — derived, never asked for                           */
/* ------------------------------------------------------------------ */

/** Local-time day number, so patterns follow the rider's calendar. */
function dayIndex(ms: number): number {
  const d = new Date(ms);
  return Math.floor(
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY,
  );
}

export interface RiderPattern {
  /** Non-rejected rides in the last 7 days. */
  ridesThisWeek: number;
  /** Best 7-day count seen in the last 8 weeks — the bar to match. */
  bestWeek: number;
  /** Weekday (0=Sun..6=Sat) the rider most often rides, or null. */
  usualDay: number | null;
  /** Whole days since the last non-rejected ride, null if never. */
  daysSince: number | null;
  streakDays: number;
  totalMiles: number;
}

export function riderPattern(
  records: RideRecord[],
  now: number = Date.now(),
): RiderPattern {
  const rides = records.filter((r) => r.status !== 'rejected');

  let ridesThisWeek = 0;
  const byWeekday = new Array(7).fill(0);
  const dayCounts = new Map<number, number>();
  let latest = 0;

  for (const r of rides) {
    if (now - r.completedAt <= 7 * DAY) ridesThisWeek++;
    if (now - r.completedAt <= 56 * DAY) {
      byWeekday[new Date(r.completedAt).getDay()]++;
    }
    dayCounts.set(dayIndex(r.completedAt), 1);
    if (r.completedAt > latest) latest = r.completedAt;
  }

  // Best rolling 7-day count over the last 8 weeks.
  let bestWeek = 0;
  const today = dayIndex(now);
  for (let end = today; end > today - 56; end--) {
    let n = 0;
    for (let d = end; d > end - 7; d--) if (dayCounts.has(d)) n++;
    if (n > bestWeek) bestWeek = n;
  }

  let usualDay: number | null = null;
  const maxWeekday = Math.max(...byWeekday);
  // Only claim a pattern when there is one — 2+ rides on that weekday and
  // it is a clear favourite.
  if (maxWeekday >= 2 && byWeekday.filter((n) => n === maxWeekday).length === 1) {
    usualDay = byWeekday.indexOf(maxWeekday);
  }

  return {
    ridesThisWeek,
    bestWeek,
    usualDay,
    daysSince: latest ? Math.max(0, Math.floor((now - latest) / DAY)) : null,
    streakDays: currentStreakDays(records, now),
    totalMiles: verifiedMiles(records),
  };
}

/* ------------------------------------------------------------------ */
/* Pre-ride — shown while stopped, so it may be visual                 */
/* ------------------------------------------------------------------ */

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * One line before a ride, or null. Null is the common and correct case — a
 * coach that always has something to say is noise.
 *
 * Never mentions a gap as a failure. "First ride in a while" is a welcome,
 * not an accusation, and there is no wording that implies a lapse.
 */
export function preRideNudge(
  records: RideRecord[],
  now: number = Date.now(),
): string | null {
  const p = riderPattern(records, now);

  if (p.daysSince === null) return 'First ride. Everything after this is a streak.';

  // A return, framed as a welcome.
  if (p.daysSince >= 14) return 'Good to have you back.';

  // Matching or beating their own best week — the only competition offered.
  if (p.bestWeek >= 3 && p.ridesThisWeek === p.bestWeek - 1) {
    return `${p.ridesThisWeek} rides this week. One more matches your best.`;
  }
  if (p.bestWeek >= 2 && p.ridesThisWeek >= p.bestWeek) {
    return `${p.ridesThisWeek} rides this week — your best stretch yet.`;
  }

  // Their own habit, observed rather than prescribed.
  const todayName = WEEKDAY[new Date(now).getDay()];
  if (p.usualDay !== null && p.usualDay === new Date(now).getDay()) {
    return `You usually ride on ${todayName}s.`;
  }

  if (p.streakDays >= 3) return `${p.streakDays} days in a row.`;

  return null;
}

/* ------------------------------------------------------------------ */
/* Mid-ride — audio only, rate limited                                 */
/* ------------------------------------------------------------------ */

export interface MidRideState {
  elapsedS: number;
  liveKm: number;
  /** Verified miles banked BEFORE this ride. */
  milesBefore: number;
  /** Seconds since the last coach cue, or null if none yet. */
  sinceLastCueS: number | null;
  /** Milestone thresholds in miles, ascending (from companion STAGES). */
  milestones: number[];
}

/**
 * What, if anything, the coach should say right now. Null almost always.
 *
 * Only one kind of mid-ride cue exists: crossing a companion milestone. It
 * earns the interruption because it is a real, rare event the rider cares
 * about. Pace commentary does not.
 */
export function midRideCue(s: MidRideState): string | null {
  if (s.elapsedS < QUIET_START_S) return null;
  if (s.sinceLastCueS !== null && s.sinceLastCueS < MIN_CUE_INTERVAL_S) return null;

  const before = s.milesBefore;
  const after = before + s.liveKm / KM_PER_MILE;

  for (const m of s.milestones) {
    if (before < m && after >= m) {
      return `${m.toLocaleString()} miles.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Post-ride — how this ride fits the pattern                          */
/* ------------------------------------------------------------------ */

/**
 * One line after a ride, or null. Reads the ride in the context of the
 * rider's own history — never against anyone else's.
 */
export function postRideNote(
  recordsIncludingThisRide: RideRecord[],
  now: number = Date.now(),
): string | null {
  const p = riderPattern(recordsIncludingThisRide, now);

  if (p.ridesThisWeek >= 2 && p.ridesThisWeek === p.bestWeek && p.bestWeek >= 3) {
    return `${p.ridesThisWeek} rides this week — that ties your best.`;
  }
  if (p.streakDays >= 2) {
    return `${p.streakDays} days in a row.`;
  }
  if (p.ridesThisWeek >= 2) {
    return `${p.ridesThisWeek} rides this week.`;
  }
  return null;
}
