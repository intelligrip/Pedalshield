/**
 * Connected (bring-your-own) Zcash wallet.
 *
 * Pedalshield is NON-CUSTODIAL: the rider connects a wallet they already
 * control (Zashi, Zodl, Ywallet, ...) by entering its Unified Address.
 * Verified rides pay real shielded ZEC straight to that address — the app
 * never holds the rider's keys and never custodies funds.
 *
 * This module is the single source of truth for "which address gets paid":
 *   - validates the UA (catches typos / wrong network / the old mock addr)
 *   - persists it across app restarts (AsyncStorage, with a safe in-memory
 *     fallback so the JS bundle never crashes if the native module isn't
 *     installed yet)
 *   - notifies the UI on change (pub/sub)
 *
 * `config.ts` (getRecipientUA / setRecipientUA) and the Home + Ride screens
 * all read through here.
 */

const STORAGE_KEY = 'pedalshield.connectedUA.v1';

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type UAValidation = { ok: boolean; reason?: string };

// Bech32m alphabet (lowercase). UAs are bech32m and exclude: 1 b i o.
const BECH32M_CHARSET = /^[023456789acdefghjklmnpqrstuvwxyz]+$/;

/**
 * Validate a Zcash mainnet Unified Address.
 *
 * We deliberately do NOT do a full bech32m checksum verify on-device (that
 * pulls in crypto we don't otherwise need here); instead we apply strong,
 * cheap structural checks that catch every realistic mistake a rider makes
 * when copy/pasting: wrong network, truncation, stray whitespace, the demo
 * mock address, or a transparent/legacy address pasted by accident.
 */
export function validateZcashUA(raw: string): UAValidation {
  const ua = (raw ?? '').trim();

  if (!ua) return { ok: false, reason: 'Paste your Zcash Unified Address.' };

  if (ua.startsWith('u1mock')) {
    return { ok: false, reason: 'That is the demo placeholder, not a real wallet. Paste your own Unified Address.' };
  }

  // Mainnet Unified Addresses are bech32m with HRP "u" → start with "u1".
  if (ua.startsWith('utest1') || ua.startsWith('uregtest1')) {
    return { ok: false, reason: 'That looks like a testnet address. Pedalshield pays on Zcash mainnet — use your mainnet UA.' };
  }
  if (/^z/.test(ua)) {
    return { ok: false, reason: 'That is a legacy Sapling address. Use your wallet’s Unified Address (starts with u1).' };
  }
  if (/^t[13]/.test(ua)) {
    return { ok: false, reason: 'That is a transparent (unshielded) address. Use your shielded Unified Address (starts with u1).' };
  }
  if (!ua.startsWith('u1')) {
    return { ok: false, reason: 'A Zcash Unified Address starts with “u1”.' };
  }

  // The bech32m body after the "u1...". Length: an Orchard-only UA is ~140+
  // chars; UAs with more receivers are longer. Anything much shorter is a
  // truncated paste.
  if (ua.length < 100) {
    return { ok: false, reason: 'That address looks incomplete — copy the whole thing from your wallet.' };
  }
  if (ua.length > 512) {
    return { ok: false, reason: 'That address is too long — make sure you copied only the address.' };
  }
  // The bech32m data charset applies to the body AFTER the "u1" prefix
  // (the "1" is the bech32 separator and is itself excluded from the
  // charset, so it must not be included in this test).
  if (!BECH32M_CHARSET.test(ua.slice(2))) {
    return { ok: false, reason: 'That contains characters a Zcash address never uses — re-copy it from your wallet.' };
  }

  return { ok: true };
}

/** True if the string passes UA validation. */
export function isValidUA(raw: string): boolean {
  return validateZcashUA(raw).ok;
}

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
    // Lazy require so a missing native module degrades gracefully (falls
    // back to in-memory) instead of crashing the bundle at import time.
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

let _ua = '';
let _loaded = false;
const listeners = new Set<(ua: string) => void>();

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(_ua);
    } catch {
      /* a bad listener must not break the others */
    }
  }
}

/**
 * Subscribe to connected-address changes. Returns an unsubscribe fn.
 * Fires immediately with the current value for convenience.
 */
export function onConnectedUAChange(cb: (ua: string) => void): () => void {
  listeners.add(cb);
  cb(_ua);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Load the persisted connected address into memory. Call once on app boot
 * (before rendering screens that read getConnectedUA). Idempotent.
 */
export async function loadConnectedWallet(): Promise<string> {
  if (_loaded) return _ua;
  try {
    const saved = await storage.getItem(STORAGE_KEY);
    if (saved && isValidUA(saved)) {
      _ua = saved.trim();
    }
  } catch {
    /* ignore read errors — rider can reconnect */
  }
  _loaded = true;
  emit();
  return _ua;
}

/** Synchronous read of the cached connected address ('' if none). */
export function getConnectedUA(): string {
  return _ua;
}

/** True if a rider wallet is connected. */
export function isConnected(): boolean {
  return _ua.startsWith('u1');
}

/**
 * Connect (or change) the rider's wallet. Validates, caches, persists, and
 * notifies subscribers. Throws with a human-readable reason if invalid.
 */
export async function setConnectedUA(raw: string): Promise<void> {
  const result = validateZcashUA(raw);
  if (!result.ok) {
    throw new Error(result.reason ?? 'Invalid Zcash Unified Address.');
  }
  _ua = raw.trim();
  emit();
  try {
    await storage.setItem(STORAGE_KEY, _ua);
  } catch {
    /* persistence best-effort; the in-session value still works */
  }
}

/** Disconnect the rider's wallet (forgets the address). */
export async function clearConnectedUA(): Promise<void> {
  _ua = '';
  emit();
  try {
    await storage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
