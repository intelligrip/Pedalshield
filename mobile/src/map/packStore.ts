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
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; fileUri: string };

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

  states.set(pack.id, { status: 'downloading', progress: 0 });
  emit();
  try {
    const dl = FS.createDownloadResumable(
      packUrl(pack),
      fileUriFor(pack),
      {},
      (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
        const frac =
          p.totalBytesExpectedToWrite > 0
            ? p.totalBytesWritten / p.totalBytesExpectedToWrite
            : 0;
        states.set(pack.id, { status: 'downloading', progress: frac });
        emit();
      },
    );
    const res = await dl.downloadAsync();
    if (!res?.uri) throw new Error('download failed');
    states.set(pack.id, { status: 'downloaded', fileUri: res.uri });
    emit();
    return true;
  } catch {
    // Clean up a partial file so "downloaded" can never mean "corrupt".
    try {
      await FS.deleteAsync(fileUriFor(pack), { idempotent: true });
    } catch {
      /* best effort */
    }
    states.set(pack.id, { status: 'none' });
    emit();
    return false;
  }
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
