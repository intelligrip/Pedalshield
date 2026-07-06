/**
 * Data co-op opt-in (privacy-default OFF).
 *
 * Pedalshield's baseline promise is unchanged: your route never leaves the
 * device. This module governs a SEPARATE, explicit, off-by-default choice —
 * whether the rider wants to contribute to the privacy-preserving data
 * co-op in exchange for ZEC.
 *
 * Hard rules this module is the source of truth for:
 *   - Default is OFF. Silence = no contribution. A rider must take a
 *     deliberate action to opt in, and can opt out at any time.
 *   - Opting in NEVER ships a raw route. Even when ON, only privacy-
 *     protected, aggregate signals may be contributed (the aggregation /
 *     differential-privacy layer is enforced elsewhere; this flag is the
 *     consent gate that layer checks first).
 *   - Consent is timestamped and versioned so the app can re-ask if the
 *     terms of the co-op materially change.
 *
 * Mirrors the storage + pub/sub design of `wallet/connectedWallet.ts` so the
 * persistence behaviour (AsyncStorage with a safe in-memory fallback) is
 * identical and well-understood.
 */

const STORAGE_KEY = 'pedalshield.dataCoop.v1';

/**
 * Bump when the co-op terms change in a way that should invalidate prior
 * consent and force a fresh opt-in. `loadDataCoopPrefs` treats a stored
 * consent from an older version as "not opted in".
 */
export const DATA_COOP_CONSENT_VERSION = 1;

export interface DataCoopPrefs {
  /** True only if the rider explicitly opted in under the current version. */
  optedIn: boolean;
  /** Epoch ms when the current opt-in was granted (0 if never / opted out). */
  consentedAt: number;
  /** Consent version the rider agreed to (0 if never). */
  consentVersion: number;
}

const OPTED_OUT: DataCoopPrefs = {
  optedIn: false,
  consentedAt: 0,
  consentVersion: 0,
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
    // Lazy require so a missing native module degrades gracefully instead of
    // crashing the bundle at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const AsyncStorage = mod?.default ?? mod;
    if (AsyncStorage && typeof AsyncStorage.getItem === 'function') {
      return AsyncStorage as StorageLike;
    }
  } catch {
    // not installed / not linked — fall through
  }
  return inMemoryStorage;
}

const storage = resolveStorage();

/* ------------------------------------------------------------------ */
/* State + pub/sub                                                     */
/* ------------------------------------------------------------------ */

let _prefs: DataCoopPrefs = { ...OPTED_OUT };
let _loaded = false;
const listeners = new Set<(p: DataCoopPrefs) => void>();

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(_prefs);
    } catch {
      /* a bad listener must not break the others */
    }
  }
}

/**
 * Subscribe to data-co-op preference changes. Returns an unsubscribe fn and
 * fires immediately with the current value for convenience.
 */
export function onDataCoopChange(cb: (p: DataCoopPrefs) => void): () => void {
  listeners.add(cb);
  cb(_prefs);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Load persisted consent into memory. Call once on app boot before rendering
 * screens that read the opt-in. Idempotent. Consent from an older version is
 * treated as opted-out (defaults stay private).
 */
export async function loadDataCoopPrefs(): Promise<DataCoopPrefs> {
  if (_loaded) return _prefs;
  try {
    const saved = await storage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<DataCoopPrefs>;
      if (
        parsed.optedIn === true &&
        parsed.consentVersion === DATA_COOP_CONSENT_VERSION &&
        typeof parsed.consentedAt === 'number'
      ) {
        _prefs = {
          optedIn: true,
          consentedAt: parsed.consentedAt,
          consentVersion: DATA_COOP_CONSENT_VERSION,
        };
      }
    }
  } catch {
    /* ignore read/parse errors — stay private (opted out) */
  }
  _loaded = true;
  emit();
  return _prefs;
}

/** Synchronous read of the current preferences (opted-out until loaded). */
export function getDataCoopPrefs(): DataCoopPrefs {
  return _prefs;
}

/** True only if the rider has explicitly opted in under the current terms. */
export function isDataCoopOptedIn(): boolean {
  return _prefs.optedIn && _prefs.consentVersion === DATA_COOP_CONSENT_VERSION;
}

/**
 * Opt in or out of the data co-op. `optIn` defaults to true. Opting in stamps
 * the consent time + version; opting out clears them. Persists best-effort and
 * notifies subscribers.
 */
export async function setDataCoopOptIn(optIn = true): Promise<DataCoopPrefs> {
  _prefs = optIn
    ? {
        optedIn: true,
        consentedAt: Date.now(),
        consentVersion: DATA_COOP_CONSENT_VERSION,
      }
    : { ...OPTED_OUT };
  emit();
  try {
    if (optIn) {
      await storage.setItem(STORAGE_KEY, JSON.stringify(_prefs));
    } else {
      await storage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* persistence best-effort; the in-session value still works */
  }
  return _prefs;
}
