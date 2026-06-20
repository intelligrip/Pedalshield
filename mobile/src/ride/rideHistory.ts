/**
 * Ride history — on-device, privacy-preserving persistence.
 *
 * Banks a compact record for every finished ride so history and year-to-date
 * totals survive app restarts. Stored on-device only (AsyncStorage, with a
 * safe in-memory fallback if the native module isn't linked yet). Crucially,
 * a record holds **stats only — never the route or any GPS coordinates**,
 * keeping the privacy guarantee intact even at rest.
 *
 * Pure aggregation (`summarizeHistory`) is unit-tested; the store reads/writes
 * through here and broadcasts changes so the UI updates live.
 */

const STORAGE_KEY = 'pedalshield.rideHistory.v1';
const MAX_RECORDS = 1000; // cap growth; oldest dropped beyond this

export interface RideRecord {
  /** Ride id (matches the claim id). */
  id: string;
  /** Epoch ms when the ride was banked (completion time). */
  completedAt: number;
  distanceKm: number;
  movingS: number;
  avgKmh: number;
  maxKmh: number;
  elevationGainM: number;
  integrityScore: number;
  status: 'verified' | 'review' | 'rejected';
  /** Mainnet payout txid, once the reward settles (optional). */
  txid?: string;
}

export interface HistorySummary {
  ytdKm: number;
  ytdRides: number;
  totalKm: number;
  totalRides: number;
  lastRide: RideRecord | null;
}

/* ------------------------------------------------------------------ */
/* Pure aggregation (unit-tested)                                      */
/* ------------------------------------------------------------------ */

/** Summarize records as of `now` (defaults to Date.now()). Pure. */
export function summarizeHistory(
  records: RideRecord[],
  now: number = Date.now(),
): HistorySummary {
  const year = new Date(now).getFullYear();
  let ytdKm = 0;
  let ytdRides = 0;
  let totalKm = 0;
  let lastRide: RideRecord | null = null;

  for (const r of records) {
    totalKm += r.distanceKm;
    if (new Date(r.completedAt).getFullYear() === year) {
      ytdKm += r.distanceKm;
      ytdRides += 1;
    }
    if (!lastRide || r.completedAt > lastRide.completedAt) lastRide = r;
  }

  return {
    ytdKm,
    ytdRides,
    totalKm,
    totalRides: records.length,
    lastRide,
  };
}

/* ------------------------------------------------------------------ */
/* Storage adapter (AsyncStorage if linked, else in-memory)            */
/* ------------------------------------------------------------------ */

type StorageLike = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
};
const mem: Record<string, string> = {};
const memStorage: StorageLike = {
  async getItem(k) {
    return k in mem ? mem[k] : null;
  },
  async setItem(k, v) {
    mem[k] = v;
  },
};
function storage(): StorageLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('@react-native-async-storage/async-storage');
    const AS = m?.default ?? m;
    if (AS && typeof AS.getItem === 'function') return AS as StorageLike;
  } catch {
    /* not linked */
  }
  return memStorage;
}

/* ------------------------------------------------------------------ */
/* State + pub/sub                                                     */
/* ------------------------------------------------------------------ */

let _records: RideRecord[] = [];
let _loaded = false;
const listeners = new Set<(records: RideRecord[]) => void>();

function emit(): void {
  for (const cb of listeners) {
    try {
      cb(_records);
    } catch {
      /* a bad listener must not break the others */
    }
  }
}

async function persist(): Promise<void> {
  try {
    await storage().setItem(STORAGE_KEY, JSON.stringify(_records));
  } catch {
    /* best-effort */
  }
}

/** Subscribe to history changes. Fires immediately with current records. */
export function onRideHistoryChange(
  cb: (records: RideRecord[]) => void,
): () => void {
  listeners.add(cb);
  cb(_records);
  return () => {
    listeners.delete(cb);
  };
}

/** Load persisted history into memory. Call once on boot. Idempotent. */
export async function loadRideHistory(): Promise<RideRecord[]> {
  if (_loaded) return _records;
  try {
    const raw = await storage().getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _records = parsed as RideRecord[];
    }
  } catch {
    /* corrupt store — start fresh rather than crash */
    _records = [];
  }
  _loaded = true;
  emit();
  return _records;
}

/** Current records (newest first), synchronous. */
export function getRides(): RideRecord[] {
  return [..._records].sort((a, b) => b.completedAt - a.completedAt);
}

/** Summary of the current records. */
export function getSummary(now?: number): HistorySummary {
  return summarizeHistory(_records, now);
}

/** Bank a finished ride. De-dupes by id (idempotent on re-save). */
export async function addRide(record: RideRecord): Promise<void> {
  const existing = _records.findIndex((r) => r.id === record.id);
  if (existing >= 0) {
    _records[existing] = { ..._records[existing], ...record };
  } else {
    _records.push(record);
    if (_records.length > MAX_RECORDS) {
      _records.sort((a, b) => a.completedAt - b.completedAt);
      _records = _records.slice(_records.length - MAX_RECORDS);
    }
  }
  emit();
  await persist();
}

/** Attach a payout txid to a banked ride once it settles. */
export async function updateRideTxid(id: string, txid: string): Promise<void> {
  const i = _records.findIndex((r) => r.id === id);
  if (i < 0) return;
  _records[i] = { ..._records[i], txid };
  emit();
  await persist();
}

/** Wipe history (e.g. a privacy "clear my data" action). */
export async function clearRideHistory(): Promise<void> {
  _records = [];
  emit();
  await persist();
}
