/**
 * Data co-op consent — TIERED, and split by purpose.
 *
 * The old model was one boolean doing three unrelated jobs: share with other
 * riders, license data commercially, and appear on leaderboards. Conflating
 * those is how every fitness app ends up with a rider discovering their data
 * went somewhere they never pictured. They are separate decisions here, and
 * they are separated now because it is nearly impossible to retrofit consent
 * after people have already granted it.
 *
 * TWO INDEPENDENT AXES:
 *
 *   `level` (0-2) — COMMERCIAL. What we may license to a buyer.
 *      0  Shielded    Nothing but a signed verdict. The default, forever.
 *      1  Aggregate   Coarse buckets: distance band, hour of day, CO2, region.
 *      2  Route       Route geometry, with endpoints ALWAYS clipped.
 *
 *   `socialSharing` (bool) — SOCIAL. Visibility to other riders: profile,
 *      leaderboard, shareable cards. Pays NOTHING, deliberately. It is a
 *      feature, not a sale, and must never be bundled with a payment or it
 *      becomes a way to buy visibility into people's lives.
 *
 * WHY LEVEL 2 STILL CLIPS ENDPOINTS: the identifiable harm in route data is
 * home and workplace. Strava's privacy zones are opt-in and leaky. Here the
 * clip is unconditional with no setting to disable it — transparent middle,
 * private ends.
 *
 * WHY THE PAY DIFFERENTIAL IS DELIBERATELY SMALL: if sharing your route paid
 * multiples of not sharing it, a rider who needs the money has no real
 * choice. Privacy would become a thing only comfortable people can afford.
 * Base verification earnings must stand on their own; the co-op share is
 * supplementary by design.
 */

const STORAGE_KEY = 'pedalshield.dataCoop.v2';
/** Previous boolean-era key, migrated on first load then left alone. */
const LEGACY_KEY = 'pedalshield.dataCoop.v1';

/**
 * Bump when co-op terms change materially. Stored consent from an older
 * version is treated as level 0 — silence always resolves to private.
 */
export const DATA_COOP_CONSENT_VERSION = 2;

/** 0 = shielded (default), 1 = coarse aggregates, 2 = route with clipped ends. */
export type CoopLevel = 0 | 1 | 2;

export interface DataCoopPrefs {
  level: CoopLevel;
  /** Visibility to other riders. Independent of `level`, never paid for. */
  socialSharing: boolean;
  /** Epoch ms the current consent was granted (0 if never / revoked). */
  consentedAt: number;
  consentVersion: number;
  /** Back-compat for existing callers: true when level >= 1. */
  optedIn: boolean;
}

const PRIVATE: DataCoopPrefs = {
  level: 0,
  socialSharing: false,
  consentedAt: 0,
  consentVersion: 0,
  optedIn: false,
};

/* ------------------------------------------------------------------ */
/* Storage adapter (AsyncStorage if present, else in-memory)           */
/* ------------------------------------------------------------------ */

type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const memoryStore: Record<string, string> = {};
const inMemoryStorage: StorageLike = {
  async getItem(k) {
    return k in memoryStore ? memoryStore[k] : null;
  },
  async setItem(k, v) {
    memoryStore[k] = v;
  },
  async removeItem(k) {
    delete memoryStore[k];
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
    /* not installed / not linked — fall through */
  }
  return inMemoryStorage;
}

const storage = resolveStorage();

/* ------------------------------------------------------------------ */
/* State + pub/sub                                                     */
/* ------------------------------------------------------------------ */

let _prefs: DataCoopPrefs = { ...PRIVATE };
let _loaded = false;
const listeners = new Set<(p: DataCoopPrefs) => void>();

/**
 * Normalise into the canonical shape.
 *
 * Fully private must be BIT-IDENTICAL to never-consented: no level, no
 * social sharing, no timestamp, no version. Otherwise a revoked rider still
 * carries a consent stamp, which reads as "agreed to version 2" to anything
 * that inspects the record later. Revocation has to leave no residue.
 */
function withDerived(p: Omit<DataCoopPrefs, 'optedIn'>): DataCoopPrefs {
  if (p.level === 0 && !p.socialSharing) return { ...PRIVATE };
  return { ...p, optedIn: p.level >= 1 };
}

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(_prefs);
    } catch {
      /* a bad listener must not break the others */
    }
  }
}

export function onDataCoopChange(cb: (p: DataCoopPrefs) => void): () => void {
  listeners.add(cb);
  cb(_prefs);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Load consent into memory. Call once on boot.
 *
 * MIGRATION: a rider who opted in under the old boolean consented to
 * "privacy-protected aggregate signals" — that is level 1 and nothing more.
 * We deliberately do NOT promote them to level 2; consent to share coarse
 * buckets is not consent to share a route, and inferring the stronger
 * permission from the weaker one would be exactly the bait-and-switch this
 * redesign exists to prevent.
 */
export async function loadDataCoopPrefs(): Promise<DataCoopPrefs> {
  if (_loaded) return _prefs;
  try {
    const saved = await storage.getItem(STORAGE_KEY);
    if (saved) {
      const p = JSON.parse(saved) as Partial<DataCoopPrefs>;
      if (p.consentVersion === DATA_COOP_CONSENT_VERSION) {
        _prefs = withDerived({
          level: normaliseLevel(p.level),
          socialSharing: p.socialSharing === true,
          consentedAt: typeof p.consentedAt === 'number' ? p.consentedAt : 0,
          consentVersion: DATA_COOP_CONSENT_VERSION,
        });
      }
    } else {
      const legacy = await storage.getItem(LEGACY_KEY);
      if (legacy) {
        const old = JSON.parse(legacy) as { optedIn?: boolean; consentedAt?: number };
        if (old?.optedIn === true) {
          _prefs = withDerived({
            level: 1, // aggregates only — never auto-upgrade to route sharing
            socialSharing: false,
            consentedAt:
              typeof old.consentedAt === 'number' ? old.consentedAt : Date.now(),
            consentVersion: DATA_COOP_CONSENT_VERSION,
          });
          await storage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
        }
      }
    }
  } catch {
    /* any read/parse failure stays private */
  }
  _loaded = true;
  emit();
  return _prefs;
}

function normaliseLevel(v: unknown): CoopLevel {
  return v === 1 || v === 2 ? v : 0;
}

export function getDataCoopPrefs(): DataCoopPrefs {
  return _prefs;
}

/** Current commercial sharing level. */
export function getCoopLevel(): CoopLevel {
  return _prefs.consentVersion === DATA_COOP_CONSENT_VERSION ? _prefs.level : 0;
}

/** Back-compat: contributing anything commercially at all. */
export function isDataCoopOptedIn(): boolean {
  return getCoopLevel() >= 1;
}

/** May route geometry be exported (still endpoint-clipped)? */
export function mayShareRoute(): boolean {
  return getCoopLevel() >= 2;
}

export function isSocialSharingOn(): boolean {
  return (
    _prefs.socialSharing && _prefs.consentVersion === DATA_COOP_CONSENT_VERSION
  );
}

async function persist(): Promise<void> {
  try {
    if (_prefs.level === 0 && !_prefs.socialSharing) {
      await storage.removeItem(STORAGE_KEY);
    } else {
      await storage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
    }
  } catch {
    /* best effort; in-session value still applies */
  }
}

/** Set the commercial sharing level. Re-stamps consent on every change. */
export async function setCoopLevel(level: CoopLevel): Promise<DataCoopPrefs> {
  _prefs = withDerived({
    level: normaliseLevel(level),
    socialSharing: _prefs.socialSharing,
    consentedAt: level === 0 && !_prefs.socialSharing ? 0 : Date.now(),
    consentVersion: DATA_COOP_CONSENT_VERSION,
  });
  emit();
  await persist();
  return _prefs;
}

/** Toggle rider-to-rider visibility. Independent of level; never paid. */
export async function setSocialSharing(on: boolean): Promise<DataCoopPrefs> {
  _prefs = withDerived({
    level: _prefs.level,
    socialSharing: on,
    consentedAt: _prefs.level === 0 && !on ? 0 : Date.now(),
    consentVersion: DATA_COOP_CONSENT_VERSION,
  });
  emit();
  await persist();
  return _prefs;
}

/**
 * Back-compat shim for the old boolean call site. Opting in lands at level 1
 * (aggregates), never level 2 — the stronger permission must be chosen
 * explicitly.
 */
export async function setDataCoopOptIn(optIn = true): Promise<DataCoopPrefs> {
  return setCoopLevel(optIn ? 1 : 0);
}
