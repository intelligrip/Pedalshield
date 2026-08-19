/**
 * The bike's name and growth stage.
 *
 * The core loop of the app in one sentence: **your bike is alive, and miles
 * are what it eats.**
 *
 * This works because cyclists already name their bikes — we are not
 * manufacturing an attachment, we are giving one that already exists
 * somewhere to live. Everything else (trophies, collectibles, sigils) was cut
 * so there is exactly one thing to understand.
 *
 * DESIGN RULE, enforced in `milestones.ts` and by test: a gap makes the bike
 * RESTED, never sick, sad, or disappointed. Make it rewarding to return, never
 * painful to leave. This is an exercise app — people get injured, ill and
 * overwhelmed, and a mechanic that punishes absence catches exactly the person
 * already struggling.
 *
 * Stored on-device only, like everything else about a ride.
 */

const STORAGE_KEY = 'pedalshield.companion.v1';

/** Offered when a rider hasn't chosen a name. Short, bike-ish, unisex. */
export const SUGGESTED_NAMES = [
  'Osprey',
  'Juniper',
  'Rook',
  'Ash',
  'Wren',
  'Cinder',
  'Marlin',
  'Pike',
] as const;

export interface CompanionPrefs {
  /** Empty until the rider names it — the app never picks for them. */
  name: string;
  /** Epoch ms the name was set (0 if never). */
  namedAt: number;
}

const UNNAMED: CompanionPrefs = { name: '', namedAt: 0 };

/* ------------------------------------------------------------------ */
/* Growth stages — the long arc                                        */
/* ------------------------------------------------------------------ */

export interface Stage {
  /** Verified miles required to reach this stage. */
  miles: number;
  /** Rider-facing name for the stage. */
  label: string;
  /** How much of the bike is drawn, 0..1 — the visible reward. */
  detail: number;
}

/**
 * Deliberately front-loaded: the first growth happens on day one or two, so a
 * new rider sees the mechanic work before deciding whether to care. The later
 * stages are far apart on purpose — they're for the rider who's still here in
 * a year.
 */
export const STAGES: Stage[] = [
  { miles: 0, label: 'New', detail: 0.35 },
  { miles: 10, label: 'Waking', detail: 0.5 },
  { miles: 50, label: 'Settling in', detail: 0.65 },
  { miles: 250, label: 'Seasoned', detail: 0.8 },
  { miles: 1000, label: 'Thriving', detail: 0.92 },
  { miles: 5000, label: 'Legend', detail: 1 },
];

export interface StageProgress {
  stage: Stage;
  next: Stage | null;
  /** 0..1 toward the next stage, measured from the current one. */
  fraction: number;
  milesToNext: number;
}

/**
 * Progress measured from the CURRENT stage, not from zero — a rider at 600
 * miles is 47% of the way from 250 to 1000, and showing them 60% of a bar
 * toward 1000 would be true and useless.
 */
export function stageFor(miles: number): StageProgress {
  const m = Number.isFinite(miles) && miles > 0 ? miles : 0;
  let stage = STAGES[0];
  for (const s of STAGES) if (m >= s.miles) stage = s;
  const next = STAGES.find((s) => s.miles > m) ?? null;

  let fraction = 1;
  let milesToNext = 0;
  if (next) {
    const span = next.miles - stage.miles;
    fraction = span > 0 ? Math.min(1, Math.max(0, (m - stage.miles) / span)) : 0;
    milesToNext = Math.max(0, next.miles - m);
  }
  return { stage, next, fraction, milesToNext };
}

/**
 * Whether the bike reads as awake or resting.
 *
 * Note what this is NOT: there is no unhappy state, no decay, and nothing is
 * ever lost. Resting is a neutral fact, not a reproach.
 */
export function restState(streakDays: number, daysSinceLastRide: number | null) {
  if (daysSinceLastRide === null) return 'new' as const;
  if (daysSinceLastRide <= 1) return streakDays >= 3 ? ('thriving' as const) : ('awake' as const);
  if (daysSinceLastRide <= 7) return 'awake' as const;
  return 'resting' as const;
}

export function restLabel(
  state: ReturnType<typeof restState>,
  streakDays: number,
): string {
  switch (state) {
    case 'new':
      return 'ready for a first ride';
    case 'thriving':
      return `well fed · ${streakDays} day streak`;
    case 'awake':
      return 'awake';
    case 'resting':
      return 'rested and ready';
  }
}

/* ------------------------------------------------------------------ */
/* Storage (same adapter pattern as the other prefs modules)           */
/* ------------------------------------------------------------------ */

type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const memoryStore: Record<string, string> = {};
const inMemoryStorage: StorageLike = {
  async getItem(k) {
    return k in memoryStore ? memoryStore[k] : null;
  },
  async setItem(k, v) {
    memoryStore[k] = v;
  },
};

function resolveStorage(): StorageLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const AsyncStorage = mod?.default ?? mod;
    if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
      return AsyncStorage as StorageLike;
    }
  } catch {
    /* not linked — in-memory is fine */
  }
  return inMemoryStorage;
}

const storage = resolveStorage();

let _prefs: CompanionPrefs = { ...UNNAMED };
let _loaded = false;
const listeners = new Set<(p: CompanionPrefs) => void>();

export function onCompanionChange(cb: (p: CompanionPrefs) => void): () => void {
  listeners.add(cb);
  cb(_prefs);
  return () => {
    listeners.delete(cb);
  };
}

export async function loadCompanionPrefs(): Promise<CompanionPrefs> {
  if (_loaded) return _prefs;
  try {
    const saved = await storage.getItem(STORAGE_KEY);
    if (saved) {
      const p = JSON.parse(saved) as Partial<CompanionPrefs>;
      if (typeof p.name === 'string' && p.name.trim()) {
        _prefs = {
          name: p.name.trim().slice(0, 24),
          namedAt: typeof p.namedAt === 'number' ? p.namedAt : Date.now(),
        };
      }
    }
  } catch {
    /* unnamed is a fine default */
  }
  _loaded = true;
  for (const cb of listeners) cb(_prefs);
  return _prefs;
}

export function getCompanionPrefs(): CompanionPrefs {
  return _prefs;
}

export function isNamed(): boolean {
  return _prefs.name.trim().length > 0;
}

/** Name the bike. Trimmed and capped; empty input is ignored. */
export async function setCompanionName(name: string): Promise<CompanionPrefs> {
  const clean = name.trim().slice(0, 24);
  if (!clean) return _prefs;
  _prefs = { name: clean, namedAt: Date.now() };
  for (const cb of listeners) cb(_prefs);
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
  } catch {
    /* best effort */
  }
  return _prefs;
}
