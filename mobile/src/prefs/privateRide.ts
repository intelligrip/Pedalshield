/**
 * Private-ride ("Ghost Ride") setup preference.
 *
 * Tracks whether the rider has seen the pre-ride privacy checklist, and
 * whether they want it before EVERY ride. Same guarded-AsyncStorage
 * pattern as the other prefs: never crashes when the native module is
 * missing, in-memory fallback for tests.
 */

declare const require: (m: string) => any;

const STORAGE_KEY = 'pedalshield.privateRide.v1';

export interface PrivateRidePrefs {
  /** Rider has been through the checklist at least once. */
  acknowledged: boolean;
  /** Show the checklist before every ride (off = first ride only). */
  showEveryRide: boolean;
}

const DEFAULTS: PrivateRidePrefs = { acknowledged: false, showEveryRide: false };

let AsyncStorage: any = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  AsyncStorage = null;
}

let _prefs: PrivateRidePrefs = { ...DEFAULTS };
const listeners = new Set<(p: PrivateRidePrefs) => void>();

export function getPrivateRidePrefs(): PrivateRidePrefs {
  return { ..._prefs };
}

export function onPrivateRideChange(
  fn: (p: PrivateRidePrefs) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadPrivateRidePrefs(): Promise<PrivateRidePrefs> {
  try {
    const raw = await AsyncStorage?.getItem(STORAGE_KEY);
    if (raw) _prefs = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* fall back to defaults */
  }
  return getPrivateRidePrefs();
}

export async function setPrivateRidePrefs(
  update: Partial<PrivateRidePrefs>,
): Promise<void> {
  _prefs = { ..._prefs, ...update };
  for (const fn of listeners) fn(getPrivateRidePrefs());
  try {
    await AsyncStorage?.setItem(STORAGE_KEY, JSON.stringify(_prefs));
  } catch {
    /* best effort */
  }
}
