/**
 * The bike companion's voice.
 *
 * Milestones pull weakly — a trophy you earned is finished. A companion that
 * responds to what you actually did creates a reason to ride this week. This
 * module turns a ride into one line the companion says about it.
 *
 * DESIGN RULE, non-negotiable: neglect makes the companion SLEEPY, never
 * sick, never dying, never disappointed. People get injured, ill, busy, or
 * have a bad month. An app that guilts them for it is one they delete
 * instead of returning to, and a rewards app that manufactures shame about
 * exercise is doing real harm. Decay that pauses and resumes motivates;
 * decay that punishes drives people away at exactly the moment they were
 * already struggling.
 *
 * Same one-way rule as the rest of src/ai: this reads ride aggregates and
 * emits display text. It never influences verification or payout.
 */

import { generateLine } from './onDevice.ts';

/** Derived ride aggregates. Deliberately no route, coordinates or times. */
export interface RideDigest {
  distanceKm: number;
  durationS: number;
  elevationGainM: number;
  avgSpeedKmh: number;
  /** Days since the rider's previous ride; null on their first ever. */
  daysSinceLastRide: number | null;
}

export interface CompanionState {
  name: string;
  /** 0..1 condition tracks. */
  chain: number;
  tires: number;
  spirit: number;
  streakDays: number;
}

/**
 * Which quality dominated this ride. Drives both the deterministic line and
 * the hint given to the model, so the two layers always agree.
 */
export type RideCharacter =
  | 'first'
  | 'return'
  | 'climb'
  | 'long'
  | 'quick'
  | 'steady';

export function characteriseRide(d: RideDigest): RideCharacter {
  if (d.daysSinceLastRide === null) return 'first';
  if (d.daysSinceLastRide >= 7) return 'return';
  // Metres climbed per km — anything over ~15 is genuinely hilly terrain.
  if (d.distanceKm > 0 && d.elevationGainM / d.distanceKm > 15) return 'climb';
  if (d.distanceKm >= 15) return 'long';
  if (d.durationS <= 15 * 60) return 'quick';
  return 'steady';
}

/**
 * Deterministic companion lines. Several per character so the app doesn't
 * repeat itself, chosen by a cheap hash of the ride's own numbers — same
 * ride always yields the same line, different rides vary.
 */
const LINES: Record<RideCharacter, string[]> = {
  first: [
    'First ride together. {name} is going to remember this one.',
    '{name} has been waiting for this.',
  ],
  return: [
    '{name} stretched, yawned, and rolled straight back into it.',
    'Been a little while. {name} did not mind waiting.',
    '{name} woke up the moment the wheels turned.',
  ],
  climb: [
    'That was proper climbing. {name} feels stronger for it.',
    '{name} liked the hills more than either of you expected.',
    'All that up. {name} is quietly pleased with itself.',
  ],
  long: [
    'A long one. {name} settled into it about halfway.',
    '{name} could have kept going, honestly.',
    'Distance like that builds real stamina. {name} noticed.',
  ],
  quick: [
    'Short and sharp. {name} approves.',
    'In and out. {name} likes a ride with no fuss.',
    '{name} barely had time to get comfortable.',
  ],
  steady: [
    'Good steady miles. {name} is well looked after.',
    '{name} likes this rhythm.',
    'Nothing dramatic, just solid riding. {name} is content.',
  ],
};

function hashNumbers(d: RideDigest): number {
  const s = `${Math.round(d.distanceKm * 100)}:${d.durationS}:${Math.round(
    d.elevationGainM,
  )}:${Math.round(d.avgSpeedKmh * 10)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Instant, offline, always-available companion line. This is the one most
 * riders see; the model layer is a bonus on top.
 */
export function companionLine(digest: RideDigest, state: CompanionState): string {
  const character = characiseSafe(digest);
  const pool = LINES[character];
  const pick = pool[hashNumbers(digest) % pool.length];
  return pick.replace(/\{name\}/g, state.name);
}

/** Guards against a malformed digest producing an undefined pool. */
function characiseSafe(d: RideDigest): RideCharacter {
  const c = characteriseRide(d);
  return LINES[c] ? c : 'steady';
}

/**
 * Optional model-written line. Null when unavailable — callers fall back to
 * `companionLine`, which is always good enough to ship alone.
 *
 * The model gets the ride's character and condition tracks, never raw route
 * data. It is explicitly told not to shame the rider, because a small model
 * left to improvise about a week off the bike will reliably produce exactly
 * the guilt this design forbids.
 */
export async function companionLineAI(
  digest: RideDigest,
  state: CompanionState,
): Promise<string | null> {
  const character = characiseSafe(digest);
  const facts = [
    `Companion name: ${state.name}. It is a bicycle with a personality.`,
    `Ride character: ${character}.`,
    `Distance: ${digest.distanceKm.toFixed(1)} km over ${Math.round(
      digest.durationS / 60,
    )} minutes, climbing ${Math.round(digest.elevationGainM)} m.`,
    digest.daysSinceLastRide === null
      ? 'This is their first ever ride together.'
      : `Days since the last ride: ${digest.daysSinceLastRide}.`,
    `Current streak: ${state.streakDays} days.`,
  ].join('\n');

  return generateLine(
    [
      `Write one short, warm sentence in the voice of ${state.name}, a bicycle that is fond of its rider.`,
      'Be specific to the ride described. Affectionate and understated, never cutesy.',
      'If there was a gap since the last ride, treat it as waking up rested — never as being neglected, sad, or disappointed. Never guilt the rider.',
      'No emoji, no exclamation marks, no questions.',
      '',
      facts,
    ].join('\n'),
    { maxWords: 25 },
  );
}
