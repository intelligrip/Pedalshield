/**
 * MapPacksCard — manage offline map region packs from the Privacy screen.
 *
 * One row per launch city: download (with live progress) or delete. Packs
 * are what let the ride map and merchant map render real streets with zero
 * network traffic, so they belong on the Privacy dashboard: this card IS a
 * privacy feature, not a settings afterthought.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card.tsx';
import { theme } from '../app/theme.ts';
import {
  METRO_PACKS,
  packCovering,
  US_STATE_PACKS,
  type RegionPack,
} from '../map/regions.ts';

/**
 * On-device pack suggestion. Reads the phone's LAST KNOWN position (no new
 * fix, no permission prompt — only works if ride tracking permission is
 * already granted) and matches it against the registry locally. The
 * coordinate never leaves this function, let alone the phone: suggesting
 * "Bend, Oregon" is a bbox lookup in app code, not a server call.
 */
declare const require: (m: string) => any;
let Location: any = null;
try {
  Location = require('expo-location');
} catch {
  Location = null;
}

function useSuggestedPack(): RegionPack | null {
  const [suggested, setSuggested] = useState<RegionPack | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!Location?.getLastKnownPositionAsync) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm?.granted) return; // never prompt from a settings card
        const pos = await Location.getLastKnownPositionAsync({});
        if (!pos?.coords || !alive) return;
        const pack = packCovering(pos.coords.latitude, pos.coords.longitude);
        if (pack && alive) setSuggested(pack);
      } catch {
        /* no fix cached — fine, just no suggestion */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return suggested;
}
import {
  deletePack,
  downloadPack,
  getPackState,
  hydratePackStore,
  onPackChange,
  packStoreAvailable,
} from '../map/packStore.ts';
import { offlineMapAvailable } from './OfflineBaseMap.tsx';

export function MapPacksCard() {
  const [, bump] = useState(0);
  const [showStates, setShowStates] = useState(false);
  const suggested = useSuggestedPack();
  useEffect(() => {
    void hydratePackStore();
    return onPackChange(() => bump((n) => n + 1));
  }, []);

  // Nothing to manage if the build can't use packs at all.
  if (!offlineMapAvailable() || !packStoreAvailable()) return null;

  // State packs the rider already has (or is downloading) surface above the
  // fold; the remaining 50-state list stays behind a toggle. The suggested
  // pack is pinned on top and excluded from the lists below.
  const metros = METRO_PACKS.filter((p) => p.id !== suggested?.id);
  const activeStates = US_STATE_PACKS.filter(
    (p) => p.id !== suggested?.id && getPackState(p.id).status !== 'none',
  );
  const idleStates = US_STATE_PACKS.filter(
    (p) => p.id !== suggested?.id && getPackState(p.id).status === 'none',
  );

  return (
    <Card>
      <Text style={styles.sectionLabel}>OFFLINE MAPS</Text>
      <Text style={styles.note}>
        Download your area once (on WiFi) and every map in Pedalshield renders
        entirely on your phone — the ride map and Spend Nearby never contact a
        tile server. Metros are small; statewide packs cover everywhere else
        but are bigger. Delete any time.
      </Text>
      {suggested ? (
        <View style={styles.suggestWrap}>
          <Text style={styles.suggestLabel}>
            SUGGESTED FOR YOUR AREA · DETECTED ON-DEVICE, NEVER UPLOADED
          </Text>
          <PackRow pack={suggested} />
        </View>
      ) : null}
      {metros.map((pack) => (
        <PackRow key={pack.id} pack={pack} />
      ))}
      {activeStates.map((pack) => (
        <PackRow key={pack.id} pack={pack} />
      ))}
      <Pressable
        style={styles.toggle}
        onPress={() => setShowStates((s) => !s)}
      >
        <Text style={styles.toggleText}>
          {showStates ? 'Hide US states' : `Show all US states (${idleStates.length})`}
        </Text>
      </Pressable>
      {showStates
        ? idleStates.map((pack) => <PackRow key={pack.id} pack={pack} />)
        : null}
    </Card>
  );
}

function PackRow({ pack }: { pack: RegionPack }) {
  const state = getPackState(pack.id);
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.packName}>{pack.name}</Text>
        <Text style={styles.packMeta}>
          {state.status === 'downloaded'
            ? 'Downloaded · maps fully offline here'
            : state.status === 'downloading'
              ? `Downloading… ${Math.round(state.progress * 100)}%`
              : `~${pack.approxMB} MB`}
        </Text>
      </View>
      {state.status === 'none' ? (
        <Pressable
          style={styles.action}
          onPress={() => void downloadPack(pack)}
        >
          <Text style={styles.actionText}>Get</Text>
        </Pressable>
      ) : state.status === 'downloaded' ? (
        <Pressable
          style={[styles.action, styles.actionGhost]}
          onPress={() => void deletePack(pack)}
        >
          <Text style={[styles.actionText, styles.actionTextGhost]}>
            Delete
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.action, styles.actionGhost]}>
          <Text style={[styles.actionText, styles.actionTextGhost]}>
            {Math.round(state.progress * 100)}%
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  note: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: theme.space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    gap: theme.space.md,
  },
  rowText: { flex: 1 },
  packName: { color: theme.color.text, fontSize: 15, fontWeight: '600' },
  packMeta: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  action: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  actionText: { color: '#0A0E1A', fontSize: 13, fontWeight: '700' },
  actionTextGhost: { color: theme.color.textDim },
  toggle: {
    paddingVertical: theme.space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    alignItems: 'center',
  },
  toggleText: {
    color: theme.color.accentSoft,
    fontSize: 13,
    fontWeight: '600',
  },
  suggestWrap: {
    backgroundColor: 'rgba(217, 70, 239, 0.07)',
    borderColor: theme.color.accentSoft,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.md,
    marginBottom: theme.space.sm,
  },
  suggestLabel: {
    color: theme.color.accentSoft,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingTop: theme.space.md,
  },
});
