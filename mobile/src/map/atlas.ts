/**
 * The private atlas — which fog cells this rider has unlocked.
 *
 * Lives on the device and nowhere else. Stores tile IDs only: no geometry,
 * no ride ids, no timestamps per tile. A stolen or synced backup reveals the
 * ~400 m cells someone has ridden through, never when or in what order —
 * and never the endpoints, which were stripped before tiling.
 *
 * There is deliberately no upload path. The claim builder sends at most the
 * ride ∩ quest tiles; the atlas itself never leaves.
 *
 * Pure merge logic is separated from storage so it is testable under node.
 * Storage follows the same AsyncStorage-or-memory adapter as prefs/.
 */

import { isTileId } from './tiles.ts';

const STORAGE_KEY = 'fogline.atlas.v1';

export interface Atlas {
  v: 1;
  /** Sorted, unique, validated tile IDs. */
  tiles: string[];
  /** Number of rides that contributed at least one tile. */
  rides: number;
}

export const EMPTY_ATLAS: Atlas = { v: 1, tiles: [], rides: 0 };

export interface MergeResult {
  atlas: Atlas;
  /** Tiles this ride lit for the first time — what blooms on screen. */
  newlyUnlocked: string[];
}

/** Fold one ride's tiles into an atlas. Pure. */
export function mergeRide(atlas: Atlas, rideTiles: readonly string[]): MergeResult {
  const have = new Set(atlas.tiles);
  const newlyUnlocked: string[] = [];
  for (const t of new Set(rideTiles)) {
    if (!isTileId(t) || have.has(t)) continue;
    have.add(t);
    newlyUnlocked.push(t);
  }
  newlyUnlocked.sort();
  const contributed = rideTiles.some(isTileId);
  return {
    atlas: {
      v: 1,
      tiles: [...have].sort(),
      rides: atlas.rides + (contributed ? 1 : 0),
    },
    newlyUnlocked,
  };
}

/**
 * Parse whatever is in storage. Anything that is not a well-formed tile ID
 * is dropped — corrupt or tampered storage degrades to fewer tiles, never to
 * a crash, and never to something coordinate-shaped being treated as a tile.
 */
export function parseAtlas(raw: string | null): Atlas {
  if (!raw) return { ...EMPTY_ATLAS };
  try {
    const p = JSON.parse(raw) as Partial<Atlas>;
    const tiles = Array.isArray(p.tiles) ? [...new Set(p.tiles.filter(isTileId))].sort() : [];
    const rides = Number.isInteger(p.rides) && (p.rides as number) >= 0 ? (p.rides as number) : 0;
    return { v: 1, tiles, rides };
  } catch {
    return { ...EMPTY_ATLAS };
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
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
    /* not linked — in-memory is fine */
  }
  return inMemoryStorage;
}

const storage = resolveStorage();

let _atlas: Atlas = { ...EMPTY_ATLAS };
let _loaded = false;
const listeners = new Set<(a: Atlas) => void>();

function emit() {
  for (const cb of listeners) cb(_atlas);
}

export function onAtlasChange(cb: (a: Atlas) => void): () => void {
  listeners.add(cb);
  cb(_atlas);
  return () => {
    listeners.delete(cb);
  };
}

export function getAtlas(): Atlas {
  return _atlas;
}

export async function loadAtlas(): Promise<Atlas> {
  if (_loaded) return _atlas;
  try {
    _atlas = parseAtlas(await storage.getItem(STORAGE_KEY));
  } catch {
    _atlas = { ...EMPTY_ATLAS };
  }
  _loaded = true;
  emit();
  return _atlas;
}

/**
 * Record a ride's tiles. Runs for every ride that produced tiles, paid or
 * not, verified quest or not — fog lifting is never gated on the treasury.
 */
export async function recordRideTiles(rideTiles: readonly string[]): Promise<MergeResult> {
  await loadAtlas();
  const res = mergeRide(_atlas, rideTiles);
  _atlas = res.atlas;
  emit();
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(_atlas));
  } catch {
    /* best effort; in-memory state still updated */
  }
  return res;
}

/** Wipe the atlas. Exposed in Privacy settings. */
export async function clearAtlas(): Promise<void> {
  _atlas = { ...EMPTY_ATLAS };
  _loaded = true;
  emit();
  try {
    if (storage.removeItem) await storage.removeItem(STORAGE_KEY);
    else await storage.setItem(STORAGE_KEY, JSON.stringify(_atlas));
  } catch {
    /* best effort */
  }
}
