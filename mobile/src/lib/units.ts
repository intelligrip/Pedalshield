/**
 * Region-aware, user-overridable distance units for the Pedalshield UI.
 *
 * The app stores and computes everything in metric internally (the ride
 * pipeline and the backend reward formula are both per-km); this module is
 * purely a display layer that converts at the edge.
 *
 * Unit choice resolves in this order:
 *   1. the rider's explicit preference ('metric' | 'imperial'), if set;
 *   2. otherwise 'auto' → device locale (US & territories → miles).
 *
 * The preference is persisted on-device and changes are broadcast so the UI
 * updates live (see useUnits()). Nothing here leaves the phone.
 */
import { useEffect, useState } from 'react';
import { NativeModules } from 'react-native';

const KM_PER_MILE = 1.609344;
const STORAGE_KEY = 'pedalshield.unitPref.v1';

export type UnitPreference = 'auto' | 'metric' | 'imperial';

/* ------------------------------------------------------------------ */
/* Locale detection (the 'auto' fallback)                              */
/* ------------------------------------------------------------------ */

const RN: any = { NativeModules };
function getPlatformOS(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('react-native') as any).Platform?.OS ?? '';
  } catch {
    return '';
  }
}

function regionFromLocale(locale: string): string | null {
  const cleaned = locale.replace('_', '-').split('.')[0];
  const parts = cleaned.split('-');
  for (const p of parts.slice(1)) {
    if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  }
  return null;
}

function detectRegion(): string {
  try {
    const loc =
      typeof Intl !== 'undefined' &&
      Intl.DateTimeFormat?.().resolvedOptions?.().locale;
    if (loc) {
      const region = regionFromLocale(loc);
      if (region) return region;
    }
  } catch {
    /* fall through */
  }
  try {
    const os = getPlatformOS();
    const nm: any = RN.NativeModules ?? {};
    let raw: string | undefined;
    if (os === 'ios') {
      const sm = nm.SettingsManager?.settings;
      raw =
        sm?.AppleLocale ??
        (Array.isArray(sm?.AppleLanguages) ? sm.AppleLanguages[0] : undefined);
    } else if (os === 'android') {
      raw = nm.I18nManager?.localeIdentifier;
    }
    if (raw) {
      const region = regionFromLocale(raw);
      if (region) return region;
    }
  } catch {
    /* ignore */
  }
  return '';
}

const US_REGIONS = ['US', 'UM', 'PR', 'GU', 'VI', 'AS', 'MP'];
const LOCALE_USES_MILES = US_REGIONS.includes(detectRegion());

/* ------------------------------------------------------------------ */
/* Preference state + persistence                                      */
/* ------------------------------------------------------------------ */

let _pref: UnitPreference = 'auto';
let _loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* a bad listener must not break the others */
    }
  }
}

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

function isPref(v: unknown): v is UnitPreference {
  return v === 'auto' || v === 'metric' || v === 'imperial';
}

/** Load the saved unit preference. Call once on app boot. Idempotent. */
export async function loadUnitPreference(): Promise<void> {
  if (_loaded) return;
  try {
    const saved = await storage().getItem(STORAGE_KEY);
    if (isPref(saved)) _pref = saved;
  } catch {
    /* ignore */
  }
  _loaded = true;
  emit();
}

export function getUnitPreference(): UnitPreference {
  return _pref;
}

/** Set + persist the rider's unit preference; notifies the UI immediately. */
export function setUnitPreference(pref: UnitPreference): void {
  _pref = pref;
  emit();
  void storage().setItem(STORAGE_KEY, pref);
}

/** Subscribe to unit changes. Returns an unsubscribe fn. */
export function onUnitChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Resolved: does the rider see miles right now? */
export function usesMiles(): boolean {
  if (_pref === 'imperial') return true;
  if (_pref === 'metric') return false;
  return LOCALE_USES_MILES;
}

/* ------------------------------------------------------------------ */
/* Dynamic unit labels + converters                                    */
/* ------------------------------------------------------------------ */

export function distanceUnit(): 'mi' | 'km' {
  return usesMiles() ? 'mi' : 'km';
}
export function distanceUnitLong(): string {
  return usesMiles() ? 'mile' : 'km';
}
export function speedUnit(): 'mph' | 'km/h' {
  return usesMiles() ? 'mph' : 'km/h';
}

/** km value in the rider's display unit. */
export function kmToDisplay(km: number): number {
  if (!isFinite(km)) return 0;
  return usesMiles() ? km / KM_PER_MILE : km;
}

export function metersToDisplay(meters: number): number {
  return kmToDisplay(meters / 1000);
}

/** One display unit, in km (1 km, or 1 mile = 1.609 km). For split lengths. */
export function displayUnitInKm(): number {
  return usesMiles() ? KM_PER_MILE : 1;
}

export function formatDistance(km: number): string {
  const v = kmToDisplay(km);
  if (!isFinite(v)) return '0.0';
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return Math.round(v).toString();
}

export function formatSpeed(kmh: number): string {
  const v = kmToDisplay(kmh);
  if (!isFinite(v) || v < 0) return '0.0';
  return v.toFixed(1);
}

export function zecPerDistanceUnit(zatPerKm: number): number {
  const zatPerUnit = usesMiles() ? zatPerKm * KM_PER_MILE : zatPerKm;
  return zatPerUnit / 1e8;
}

export function formatRate(zatPerKm: number): string {
  const zec = zecPerDistanceUnit(zatPerKm);
  return `${trimZec(zec)} ZEC / ${distanceUnitLong()}`;
}

function trimZec(zec: number): string {
  if (!isFinite(zec)) return '0';
  const s = zec.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return s.length ? s : '0';
}

/* ------------------------------------------------------------------ */
/* React hook                                                          */
/* ------------------------------------------------------------------ */

/**
 * Re-render a component when the unit preference changes, and read the
 * current labels. Call the formatter functions (formatDistance, etc.) as
 * usual — they read the live preference.
 */
export function useUnits(): {
  pref: UnitPreference;
  miles: boolean;
  distanceUnit: 'mi' | 'km';
  speedUnit: 'mph' | 'km/h';
} {
  const [, force] = useState(0);
  useEffect(() => onUnitChange(() => force((n) => n + 1)), []);
  return {
    pref: _pref,
    miles: usesMiles(),
    distanceUnit: distanceUnit(),
    speedUnit: speedUnit(),
  };
}
