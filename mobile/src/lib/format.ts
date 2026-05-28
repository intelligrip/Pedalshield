/**
 * Display formatters for the Pedalshield UI.
 */
import { zatoshiToZec } from '../wallet/mockWallet.ts';
import type { Zatoshi } from '../wallet/types.ts';

export function formatKm(km: number): string {
  if (!isFinite(km)) return '0.0';
  if (km < 10) return km.toFixed(2);
  if (km < 100) return km.toFixed(1);
  return Math.round(km).toString();
}

export function formatKmh(kmh: number): string {
  if (!isFinite(kmh) || kmh < 0) return '0.0';
  return kmh.toFixed(1);
}

export function formatDurationMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Format a ZEC balance for display. Trims trailing zeros, keeps 4 digits. */
export function formatZec(zat: Zatoshi): string {
  const full = zatoshiToZec(zat);
  const [whole, frac = ''] = full.split('.');
  const trimmed = frac.slice(0, 4).replace(/0+$/, '');
  return trimmed.length > 0 ? `${whole}.${trimmed}` : `${whole}.0`;
}

/** Short address for compact display: u1mock....xxxx */
export function shortAddress(ua: string, head = 6, tail = 4): string {
  if (ua.length <= head + tail + 3) return ua;
  return `${ua.slice(0, head)}...${ua.slice(-tail)}`;
}
