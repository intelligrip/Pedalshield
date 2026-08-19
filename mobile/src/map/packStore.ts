/**
 * Region-pack store: download, delete, and query offline map packs.
 *
 * Storage model is deliberately dumb: presence of the .pmtiles file in the
 * app's document directory IS the "downloaded" state. No extra registry to
 * drift out of sync.
 *
 * expo-file-system is loaded behind a runtime guard (same pattern as the
 * sensor sources and react-native-maps) so importing this module never
 * crashes a client that lacks it — everything just reports "unavailable"
 * and the UI falls back.
 */

import {
  packFilename,
  packUrl,
  REGION_PACKS,
  type RegionPack,
} from './regions.ts';

declare const require: (m: string) => any;

let FS: any = null;
try {
  // SDK 54+ moved the classic API to /legacy; older SDKs export it directly.
  try {
    FS = require('expo-file-system/legacy');
  } catch {
    FS = require('expo-file-system');
  }
  if (!FS?.documentDirectory) FS = null;
} catch {
  FS = null;
}

export function packStoreAvailable(): boolean {
  return !!FS;
}

export type PackState =
  | { status: 'none' }
  | { status: 'downloading'; progress: number; bytes: number }
  | { status: 'downloaded'; fileUri: string }
  /**
   * A failure the rider can read. Previously any error reset silently to
   * 'none', so a download that could never succeed looked identical to one
   * never started — which is exactly how a pack sat at 0% with nothing to
   * explain it.
   */
  | { status: 'error'; message: string };

const states = new Map<string, PackState>();
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  for (const l of listeners) l();
}

/** Subscribe to any pack-state change. Returns unsubscribe. */
export function onPackChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function fileUriFor(pack: RegionPack): string {
  return `${FS.documentDirectory}${packFilename(pack)}`;
}

/** Scan disk once so synchronous reads reflect reality. Idempotent. */
export async function hydratePackStore(): Promise<void> {
  if (!FS || hydrated) return;
  for (const pack of REGION_PACKS) {
    try {
      const info = await FS.getInfoAsync(fileUriFor(pack));
      states.set(
        pack.id,
        info.exists
          ? { status: 'downloaded', fileUri: fileUriFor(pack) }
          : { status: 'none' },
      );
    } catch {
      states.set(pack.id, { status: 'none' });
    }
  }
  hydrated = true;
  emit();
}

export function getPackState(packId: string): PackState {
  return states.get(packId) ?? { status: 'none' };
}

/** File URI of a downloaded pack, else null. */
export function downloadedPackUri(packId: string): string | null {
  const s = getPackState(packId);
  return s.status === 'downloaded' ? s.fileUri : null;
}

/**
 * Download a pack. Progress lands in the store (poll via onPackChange).
 * Resolves true on success. Never throws — failures reset state to 'none'.
 */
export async function downloadPack(pack: RegionPack): Promise<boolean> {
  if (!FS) return false;
  const current = getPackState(pack.id);
  if (current.status !== 'none') return current.status === 'downloaded';

  states.set(pack.id, { status: 'downloading', progress: 0, bytes: 0 });
  emit();
  try {
    const dl = FS.createDownloadResumable(
      packUrl(pack),
      fileUriFor(pack),
      {},
      (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
        // A server that sends no Content-Length reports an expected size of
        // 0 or -1, which made the fraction permanently 0 even while bytes
        // were arriving. Track bytes too so the UI can show progress either
        // way rather than an eternal 0%.
        const frac =
          p.totalBytesExpectedToWrite > 0
            ? p.totalBytesWritten / p.totalBytesExpectedToWrite
            : 0;
        states.set(pack.id, {
          status: 'downloading',
          progress: frac,
          bytes: p.totalBytesWritten,
        });
        emit();
      },
    );
    const res = await dl.downloadAsync();
    if (!res?.uri) throw new Error('The download did not complete.');

    // HTTP errors do NOT throw here — expo writes whatever the server sent.
    // Without this check a 404 page is happily saved as `bend.pmtiles` and
    // marked downloaded, and the failure surfaces much later as a broken map.
    const status = Number((res as { status?: number }).status ?? 200);
    if (status >= 400) {
      throw new Error(
        status === 404
          ? 'That map pack is not on the server yet.'
          : `The map server returned ${status}.`,
      );
    }

    if (!(await looksLikePmtiles(fileUriFor(pack)))) {
      throw new Error('The downloaded file was not a map pack.');
    }

    states.set(pack.id, { status: 'downloaded', fileUri: res.uri });
    emit();
    return true;
  } catch (e) {
    // Clean up a partial or bogus file so "downloaded" can never mean
    // "corrupt".
    try {
      await FS.deleteAsync(fileUriFor(pack), { idempotent: true });
    } catch {
      /* best effort */
    }
    states.set(pack.id, {
      status: 'error',
      message: describeDownloadError(e),
    });
    emit();
    return false;
  }
}

/**
 * Every PMTiles archive begins with the ASCII bytes "PMTiles". Checking them
 * is the difference between "we received a file" and "we received a map" — a
 * captive portal, an error page, or an HTML 404 all download successfully.
 */
async function looksLikePmtiles(uri: string): Promise<boolean> {
  try {
    const head = await FS.readAsStringAsync(uri, {
      encoding: 'base64',
      position: 0,
      length: 7,
    });
    // "PMTiles" base64-encodes to "UE1UaWxlcw==" for 8 bytes; compare the
    // decoded prefix instead so the length is not load-bearing.
    const decoded = globalThis.atob ? globalThis.atob(head) : '';
    return decoded.startsWith('PMTiles');
  } catch {
    // If we cannot read it back, treat that as a failure rather than
    // assuming success.
    return false;
  }
}

function describeDownloadError(e: unknown): string {
  const raw = String((e as Error)?.message ?? e ?? '');
  if (/not on the server|not a map pack|returned \d/i.test(raw)) return raw;
  if (/Network request failed|ENOTFOUND|dns|Could not connect/i.test(raw)) {
    return 'Could not reach the map server. Check your connection.';
  }
  return 'The download failed. Try again on Wi-Fi.';
}

export async function deletePack(pack: RegionPack): Promise<void> {
  if (!FS) return;
  try {
    await FS.deleteAsync(fileUriFor(pack), { idempotent: true });
  } catch {
    /* best effort */
  }
  states.set(pack.id, { status: 'none' });
  emit();
}
