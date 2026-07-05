import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../app/theme.ts';
import { formatDistance, type LatLng, type SpendMerchant } from '../spend/geo.ts';
import { OfflineBaseMap, offlineMapAvailable } from './OfflineBaseMap.tsx';
import { Button } from './Button.tsx';
import { packCovering, type RegionPack } from '../map/regions.ts';
import {
  downloadPack,
  downloadedPackUri,
  getPackState,
  hydratePackStore,
  onPackChange,
  packStoreAvailable,
} from '../map/packStore.ts';

/**
 * Visual map of ZEC-accepting merchants.
 *
 * Privacy ladder, best first:
 * 1. Offline PMTiles basemap (MapLibre) — the viewport is rendered from a
 *    locally downloaded region pack, so browsing merchants reveals nothing
 *    to any tile server.
 * 2. If the offline stack is linked but the local pack isn't downloaded
 *    yet: a download prompt. We deliberately do NOT silently fall through
 *    to an online map — that would leak the rider's area to Apple/Google
 *    on a screen that's literally about where they are.
 * 3. react-native-maps (Apple Maps) only when the MapLibre module isn't in
 *    the build at all — legacy behavior for old dev clients, clearly
 *    labeled as revealing the viewing area.
 *
 * All native modules are loaded behind runtime guards (same pattern as the
 * sensor sources) so importing this file never hard-crashes a client.
 */

declare const require: (m: string) => any;
let Maps: any = null;
try {
  Maps = require('react-native-maps');
} catch {
  Maps = null;
}

/** True when some map (offline or legacy) can render. */
export function mapAvailable(): boolean {
  return offlineMapAvailable() || !!Maps?.default;
}

export function MerchantMap({
  center,
  merchants,
  onSelect,
}: {
  center: LatLng;
  merchants: SpendMerchant[];
  onSelect?: (m: SpendMerchant) => void;
}) {
  // Re-render on pack downloads finishing / progressing.
  const [, bump] = useState(0);
  useEffect(() => {
    void hydratePackStore();
    return onPackChange(() => bump((n) => n + 1));
  }, []);

  const pack = packCovering(center.lat, center.lon);
  const packUri = pack ? downloadedPackUri(pack.id) : null;

  // 1. Fully offline map.
  if (offlineMapAvailable() && packUri) {
    return (
      <View style={styles.wrap}>
        <OfflineBaseMap
          packUri={packUri}
          center={{ lat: center.lat, lon: center.lon }}
          zoom={12}
          markers={merchants.map((m) => ({
            id: m.id,
            lat: m.lat,
            lon: m.lon,
            color: m.payUA ? theme.color.accent : theme.color.success,
          }))}
          onMarkerPress={(id) => {
            const m = merchants.find((x) => x.id === id);
            if (m && onSelect) onSelect(m);
          }}
        />
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>OFFLINE MAP · 0 BYTES SENT</Text>
        </View>
      </View>
    );
  }

  // 2. Offline stack present but the pack isn't local yet: prompt, don't leak.
  if (offlineMapAvailable() && pack && packStoreAvailable()) {
    return <PackPrompt pack={pack} />;
  }

  // 3. Legacy fallback: Apple Maps (reveals the viewing area to Apple).
  if (!Maps?.default) return null;
  const MapView = Maps.default;
  const Marker = Maps.Marker;

  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        showsUserLocation
        initialRegion={{
          latitude: center.lat,
          longitude: center.lon,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {merchants.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lon }}
            title={m.name}
            description={`${m.category}${
              m.distanceM != null ? ` · ${formatDistance(m.distanceM)}` : ''
            }${m.payUA ? ' · accepts ZEC in-app' : ''}`}
            pinColor={m.payUA ? theme.color.accent : theme.color.success}
            onCalloutPress={() => onSelect?.(m)}
          />
        ))}
      </MapView>
      <View style={[styles.badge, styles.badgeWarn]} pointerEvents="none">
        <Text style={[styles.badgeText, styles.badgeTextWarn]}>
          ONLINE MAP · AREA VISIBLE TO APPLE
        </Text>
      </View>
    </View>
  );
}

function PackPrompt({ pack }: { pack: RegionPack }) {
  const state = getPackState(pack.id);
  const downloading = state.status === 'downloading';
  return (
    <View style={[styles.wrap, styles.prompt]}>
      <Text style={styles.promptTitle}>Private map available</Text>
      <Text style={styles.promptBody}>
        Download the {pack.name} offline map (~{pack.approxMB} MB, once, ideally
        on WiFi) and this screen renders entirely on your phone — no tile
        server ever sees where you&apos;re browsing.
      </Text>
      <Button
        label={
          downloading
            ? `Downloading… ${Math.round(state.progress * 100)}%`
            : `Download ${pack.name} map`
        }
        onPress={() => void downloadPack(pack)}
        disabled={downloading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 340,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  map: { flex: 1 },
  badge: {
    position: 'absolute',
    top: theme.space.md,
    right: theme.space.md,
    backgroundColor: 'rgba(34, 211, 161, 0.12)',
    borderColor: theme.color.success,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  badgeText: {
    color: theme.color.success,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
  },
  badgeWarn: {
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderColor: theme.color.warning,
  },
  badgeTextWarn: { color: theme.color.warning },
  prompt: {
    backgroundColor: theme.color.bgElev,
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: theme.space.xl,
    gap: theme.space.md,
  },
  promptTitle: {
    color: theme.color.text,
    fontSize: theme.font.h2.size,
    fontWeight: theme.font.h2.weight,
    textAlign: 'center',
  },
  promptBody: {
    color: theme.color.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: theme.space.sm,
  },
});
