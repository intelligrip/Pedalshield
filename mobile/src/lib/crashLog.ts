/**
 * Crash recorder — persists the last fatal JS error so it survives the
 * crash and can be shown (and copied) on next launch.
 *
 * iOS .ips crash logs strip the JS message from React Native fatals
 * (all you get is RCTExceptionsManager + SIGABRT), which made a TestFlight
 * mid-ride crash undiagnosable. This closes that gap: ErrorUtils fires
 * before RN aborts, we write the message + stack to AsyncStorage, and the
 * Home screen surfaces it on the next launch.
 *
 * Storage is guarded the same way as rideHistory (in-memory fallback), so
 * importing this module can never itself be a crash source.
 */

declare const require: (m: string) => any;
declare const ErrorUtils: any;

const STORAGE_KEY = 'pedalshield.lastCrash.v1';

export interface CrashRecord {
  message: string;
  stack: string;
  isFatal: boolean;
  at: number;
  appState: string;
}

let AsyncStorage: any = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch {
  AsyncStorage = null;
}

let _last: CrashRecord | null = null;
let _installed = false;

/** Install the global handler. Idempotent; call once at app boot. */
export function installCrashRecorder(getAppState?: () => string): void {
  if (_installed) return;
  _installed = true;
  if (typeof ErrorUtils === 'undefined' || !ErrorUtils?.getGlobalHandler) {
    return; // node test env — nothing to install
  }
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    try {
      const e = error as Error;
      const rec: CrashRecord = {
        message: String(e?.message ?? error),
        stack: String(e?.stack ?? '').slice(0, 4000),
        isFatal: !!isFatal,
        at: Date.now(),
        appState: getAppState ? getAppState() : 'unknown',
      };
      _last = rec;
      // Fire-and-forget — we're crashing; best effort only.
      AsyncStorage?.setItem(STORAGE_KEY, JSON.stringify(rec));
    } catch {
      /* never make a crash worse */
    }
    previous?.(error, isFatal);
  });
}

/** Read (without clearing) the previous session's crash, if any. */
export async function getLastCrash(): Promise<CrashRecord | null> {
  if (_last) return _last;
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CrashRecord) : null;
  } catch {
    return null;
  }
}

export async function clearLastCrash(): Promise<void> {
  _last = null;
  try {
    await AsyncStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* best effort */
  }
}
