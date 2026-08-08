/**
 * Trophies, streaks and progress — derived entirely from on-device history.
 *
 * WHY NO BACKEND: `rideHistory.ts` already banks distance, status and
 * completion time for every ride, on the phone, with no route data. Every
 * milestone in this file is a pure function of that. Sending totals to a
 * server to compute an achievement would add a privacy surface and an outage
 * mode in exchange for nothing — the phone already knows.
 *
 * The trade-off, stated honestly: history does not survive a reinstall, so
 * neither do trophies. That is the correct trade for now. Making them durable
 * means putting them somewhere we can see, and a rider should not have to
 * choose between keeping their badges and keeping their privacy.
 *
 * DESIGN RULES:
 *  - Rejected rides never count. A trophy that includes unverified miles is
 *    worth nothing, and "verified miles" is the phrase that makes this
 *    different from a self-reported log.
 *  - Totals only ever grow, so a trophy once earned cannot be un-earned by a
 *    later change to thresholds.
 *  - The first trophy is reachable on day one. A first milestone weeks away
 *    teaches new riders that the app has nothing for them.
 */

import type { RideRecord } from './rideHistory.ts';

const KM_PER_MILE = 1.609344;

export interface Trophy {
  /** Threshold in verified miles. */
  miles: number;
  name: string;
  /** One line shown when earned. */
  blurb: string;
}

/**
 * Deliberately front-loaded. 1 and 10 exist so a new rider earns something
 * immediately; 5,000 and 10,000 exist so a committed one still has somewhere
 * to go years later.
 */
export const TROPHIES: Trophy[] = [
  { miles: 1, name: 'First Verified Mile', blurb: 'Proven by physics, not by your word for it.' },
  { miles: 10, name: 'Ten Miles', blurb: 'Ten miles nobody can place on a map.' },
  { miles: 50, name: 'Fifty', blurb: 'Fifty verified miles, and not one route stored.' },
  { miles: 100, name: 'Century', blurb: 'A hundred miles of proof without surveillance.' },
  { miles: 500, name: 'Five Hundred', blurb: 'Most riders never get here.' },
  { miles: 1000, name: 'Thousand', blurb: 'A thousand verified miles. That is a real number.' },
  { miles: 5000, name: 'Five Thousand', blurb: 'Years of riding, none of it tracked.' },
  { miles: 10000, name: 'Ten Thousand', blurb: 'Ten thousand miles. Nobody knows where any of them were.' },
];

/** Collectible companions are awarded every this many verified miles. */
export const COLLECTIBLE_INTERVAL_MILES = 50;

/** Verified kilometres: everything except rejected rides. */
export function verifiedKm(records: RideRecord[]): number {
  let km = 0;
  for (const r of records) {
    if (r.status === 'rejected') continue;
    if (Number.isFinite(r.distanceKm) && r.distanceKm > 0) km += r.distanceKm;
  }
  return km;
}

export function verifiedMiles(records: RideRecord[]): number {
  return verifiedKm(records) / KM_PER_MILE;
}

/** Trophies earned at this mileage, in ascending order. */
export function earnedTrophies(miles: number): Trophy[] {
  return TROPHIES.filter((t) => miles >= t.miles);
}

/** The next trophy, or null once every one is earned. */
export function nextTrophy(miles: number): Trophy | null {
  return TROPHIES.find((t) => miles < t.miles) ?? null;
}

export interface MilestoneProgress {
  miles: number;
  earned: Trophy[];
  next: Trophy | null;
  /** 0..1 toward `next`, measured from the previous tier, not from zero. */
  fraction: number;
  milesToNext: number;
  /** Collectibles unlocked so far (one per COLLECTIBLE_INTERVAL_MILES). */
  collectibles: number;
  milesToNextCollectible: number;
}

/**
 * Progress is measured from the PREVIOUS tier rather than from zero. A rider
 * at 600 miles is 20% of the way from 500 to 1000 — showing them 60% of a bar
 * toward 1000 would be technically true and motivationally useless.
 */
export function milestoneProgress(records: RideRecord[]): MilestoneProgress {
  const miles = verifiedMiles(records);
  const earned = earnedTrophies(miles);
  const next = nextTrophy(miles);
  const floor = earned.length > 0 ? earned[earned.length - 1].miles : 0;

  let fraction = 1;
  let milesToNext = 0;
  if (next) {
    const span = next.miles - floor;
    fraction = span > 0 ? Math.min(1, Math.max(0, (miles - floor) / span)) : 0;
    milesToNext = Math.max(0, next.miles - miles);
  }

  const collectibles = Math.floor(miles / COLLECTIBLE_INTERVAL_MILES);
  const milesToNextCollectible =
    COLLECTIBLE_INTERVAL_MILES - (miles % COLLECTIBLE_INTERVAL_MILES);

  return {
    miles,
    earned,
    next,
    fraction,
    milesToNext,
    collectibles,
    milesToNextCollectible,
  };
}

/**
 * Consecutive days ending today (or yesterday) on which a non-rejected ride
 * was completed.
 *
 * A streak survives ONE missed day on purpose. Resetting to zero the moment
 * someone has a bad day punishes exactly the person who most needs a reason
 * to come back, and turns a motivator into a source of guilt. Grace is
 * cheap; abandonment is not.
 */
export function currentStreakDays(
  records: RideRecord[],
  now: number = Date.now(),
): number {
  const days = new Set<number>();
  for (const r of records) {
    if (r.status === 'rejected') continue;
    days.add(dayIndex(r.completedAt));
  }
  if (days.size === 0) return 0;

  const today = dayIndex(now);
  // Allow the streak to be "live" if they rode today or yesterday.
  let cursor = days.has(today) ? today : days.has(today - 1) ? today - 1 : -1;
  if (cursor < 0) return 0;

  let streak = 0;
  let misses = 0;
  while (cursor >= 0) {
    if (days.has(cursor)) {
      streak++;
      misses = 0;
    } else {
      misses++;
      if (misses > 1) break; // one grace day, then the streak ends
    }
    cursor--;
  }
  return streak;
}

/** Local-time day number, so streaks follow the rider's calendar. */
function dayIndex(epochMs: number): number {
  const d = new Date(epochMs);
  return Math.floor(
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000,
  );
}
