/**
 * Region-aware distance units for the Pedalshield UI.
 *
 * Riders in the United States see miles; everyone else sees kilometres.
 * The app stores and computes everything in metric internally (the ride
 * pipeline and the backend reward formula are both per-km); this module is
 * purely a display layer that converts at the edge.
 *
 * Region detection is dependency-free: we read the device locale from the
 * JS `Intl` API when available, then fall back to React Native's native
 * locale settings. No `expo-localization` needed.
 */
import { NativeModules } from 'react-native';

const KM_PER_MILE = 1.609344;

// `Platform` isn't in the sandbox type shim; read it loosely at runtime.
const RN: any = { NativeModules };
function getPlatformOS(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('react-native') as any).Platform?.OS ?? '';
  } catch {
    return '';
  }
}

/** Best-effort region (ISO 3166-1 alpha-2, uppercased) for the device. */
function detectRegion(): string {
  // 1) Intl is the cleanest source when Hermes ships it (locale like "en-US").
  try {
    const loc =
      typeof Intl !== 'undefined' &&
      Intl.DateTimeFormat?.().resolvedOptions?.().locale;
    if (loc) {
      const region = regionFromLocale(loc);
      if (region) return region;
    }
  } catch {
    // ignore and fall through to native lookups
  }

  // 2) Native locale identifiers (e.g. "en_US", "en-US").
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
    // ignore
  }

  return '';
}

/** Pull the region subtag out of a BCP-47 / POSIX locale string. */
function regionFromLocale(locale: string): string | null {
  // Handles "en-US", "en_US", "en-Latn-US", "en_US.UTF-8".
  const cleaned = locale.replace('_', '-').split('.')[0];
  const parts = cleaned.split('-');
  for (const p of parts.slice(1)) {
    if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  }
  return null;
}

const REGION = detectRegion();

/** True when the device is in the US (or US territories) → use miles. */
export const USES_MILES: boolean = ['US', 'UM', 'PR', 'GU', 'VI', 'AS', 'MP'].includes(
  REGION,
);

/** Unit label for the current region, e.g. "mi" or "km". */
export const DISTANCE_UNIT: 'mi' | 'km' = USES_MILES ? 'mi' : 'km';

/** Longer label for prose, e.g. "mile" / "kilometre". */
export const DISTANCE_UNIT_LONG = USES_MILES ? 'mile' : 'km';

/** Convert a kilometre value into the rider's display unit (mi or km). */
export function kmToDisplay(km: number): number {
  if (!isFinite(km)) return 0;
  return USES_MILES ? km / KM_PER_MILE : km;
}

/** Convert metres into the rider's display unit. */
export function metersToDisplay(meters: number): number {
  return kmToDisplay(meters / 1000);
}

/**
 * Format a kilometre value for display with a sensible number of digits,
 * already converted to the rider's unit. Mirrors the old `formatKm` curve.
 */
export function formatDistance(km: number): string {
  const v = kmToDisplay(km);
  if (!isFinite(v)) return '0.0';
  if (v < 10) return v.toFixed(2);
  if (v < 100) return v.toFixed(1);
  return Math.round(v).toString();
}

/** Format a speed (km/h in, mph or km/h out). */
export function formatSpeed(kmh: number): string {
  const v = kmToDisplay(kmh);
  if (!isFinite(v) || v < 0) return '0.0';
  return v.toFixed(1);
}

/** Speed unit label, e.g. "mph" / "km/h". */
export const SPEED_UNIT = USES_MILES ? 'mph' : 'km/h';

/**
 * Reward rate, expressed in the rider's unit. The backend rewards
 * `zatPerKm` zatoshi per kilometre; per mile is that × km-per-mile.
 * Returns ZEC (not zatoshi) per display unit.
 */
export function zecPerDistanceUnit(zatPerKm: number): number {
  const zatPerUnit = USES_MILES ? zatPerKm * KM_PER_MILE : zatPerKm;
  return zatPerUnit / 1e8;
}

/**
 * Pretty rate string like "0.00032 ZEC / mile". Trims to a readable number
 * of significant digits for the small per-unit reward.
 */
export function formatRate(zatPerKm: number): string {
  const zec = zecPerDistanceUnit(zatPerKm);
  return `${trimZec(zec)} ZEC / ${DISTANCE_UNIT_LONG}`;
}

/** Trim a small ZEC amount to up to 8 decimals, dropping trailing zeros. */
function trimZec(zec: number): string {
  if (!isFinite(zec)) return '0';
  const s = zec.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return s.length ? s : '0';
}
