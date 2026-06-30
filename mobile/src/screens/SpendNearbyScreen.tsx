import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { theme } from '../app/theme.ts';
import {
  directionsUrl,
  formatDistance,
  type LatLng,
  type SpendMerchant,
} from '../spend/geo.ts';
import { fetchNearbyMerchants, getDeviceLocation } from '../spend/overpass.ts';

type Phase =
  | { k: 'locating' }
  | { k: 'denied' }
  | { k: 'unavailable' }
  | { k: 'loading'; coords: LatLng; radiusM: number }
  | { k: 'error'; coords: LatLng; radiusM: number; msg: string }
  | { k: 'ready'; coords: LatLng; radiusM: number; items: SpendMerchant[] };

const NEAR = 5000;
const WIDE = 15000;

/**
 * Embeddable "Spend nearby" content (no ScreenContainer of its own) so it can
 * live as a segment inside the Market tab alongside the in-app catalog.
 */
export function SpendNearbyContent() {
  const [phase, setPhase] = useState<Phase>({ k: 'locating' });

  const search = useCallback(async (coords: LatLng, radiusM: number) => {
    setPhase({ k: 'loading', coords, radiusM });
    try {
      const items = await fetchNearbyMerchants(coords, radiusM);
      setPhase({ k: 'ready', coords, radiusM, items });
    } catch (e) {
      setPhase({
        k: 'error',
        coords,
        radiusM,
        msg: String((e as Error)?.message ?? e),
      });
    }
  }, []);

  const locate = useCallback(async () => {
    setPhase({ k: 'locating' });
    const loc = await getDeviceLocation();
    if (loc.status === 'ok') void search(loc.coords, NEAR);
    else setPhase({ k: loc.status === 'denied' ? 'denied' : 'unavailable' });
  }, [search]);

  useEffect(() => {
    void locate();
  }, [locate]);

  return (
    <>
      <Text style={styles.subtitle}>
        Real-world places that accept Zcash near you — cash out the ZEC you
        earned riding. Data is the open Zcash merchant map (OpenStreetMap).
      </Text>

      {phase.k === 'locating' && (
        <Centered>
          <ActivityIndicator color={theme.color.accent} />
          <Text style={styles.dim}>Finding your location…</Text>
        </Centered>
      )}

      {phase.k === 'denied' && (
        <Card>
          <Text style={styles.cardTitle}>Location is off</Text>
          <Text style={styles.help}>
            Pedalshield needs your location to find merchants near you. It’s
            used on-device for this search only and never leaves your phone.
          </Text>
          <View style={{ height: theme.space.md }} />
          <Button label="Enable location" onPress={() => void locate()} />
        </Card>
      )}

      {phase.k === 'unavailable' && (
        <Card>
          <Text style={styles.cardTitle}>Couldn’t get a location</Text>
          <Text style={styles.help}>Try again with GPS enabled.</Text>
          <View style={{ height: theme.space.md }} />
          <Button label="Retry" onPress={() => void locate()} />
        </Card>
      )}

      {phase.k === 'loading' && (
        <Centered>
          <ActivityIndicator color={theme.color.accent} />
          <Text style={styles.dim}>
            Searching {Math.round(phase.radiusM / 1000)} km around you…
          </Text>
        </Centered>
      )}

      {phase.k === 'error' && (
        <Card>
          <Text style={styles.cardTitle}>Map unavailable</Text>
          <Text style={styles.help}>
            Couldn’t reach the merchant map. {phase.msg}
          </Text>
          <View style={{ height: theme.space.md }} />
          <Button
            label="Retry"
            onPress={() => void search(phase.coords, phase.radiusM)}
          />
        </Card>
      )}

      {phase.k === 'ready' && phase.items.length === 0 && (
        <Card>
          <Text style={styles.cardTitle}>Nothing mapped within {Math.round(phase.radiusM / 1000)} km</Text>
          <Text style={styles.help}>
            Zcash acceptance is still growing, so coverage can be thin. Try a
            wider search, or spend in the in-app Market instead.
          </Text>
          <View style={{ height: theme.space.md }} />
          {phase.radiusM < WIDE ? (
            <Button
              label="Search wider (15 km)"
              onPress={() => void search(phase.coords, WIDE)}
            />
          ) : (
            <Button label="Refresh" variant="secondary" onPress={() => void locate()} />
          )}
        </Card>
      )}

      {phase.k === 'ready' &&
        phase.items.map((m) => <MerchantRow key={m.id} m={m} />)}

      {phase.k === 'ready' && phase.items.length > 0 && (
        <Text style={styles.footnote}>
          {phase.items.length} place{phase.items.length === 1 ? '' : 's'} within{' '}
          {Math.round(phase.radiusM / 1000)} km. Acceptance comes from
          OpenStreetMap and may be out of date — it’s worth confirming with the
          merchant. Most accept ZEC in person at the counter.
        </Text>
      )}
    </>
  );
}

function MerchantRow({ m }: { m: SpendMerchant }) {
  return (
    <Card>
      <View style={styles.rowTop}>
        <View style={styles.who}>
          <Text style={styles.name}>{m.name}</Text>
          <Text style={styles.cat}>{m.category}</Text>
        </View>
        <Text style={styles.dist}>{formatDistance(m.distanceM ?? NaN)}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.action, styles.actionGhost]}
          onPress={() =>
            Linking.openURL(directionsUrl(m, Platform.OS)).catch(() => {})
          }
        >
          <Text style={styles.actionGhostText}>Directions</Text>
        </Pressable>

        {m.payUA ? (
          <Pressable
            style={[styles.action, styles.actionPay]}
            onPress={() => Linking.openURL(`zcash:${m.payUA}`).catch(() => {})}
          >
            <Text style={styles.actionPayText}>Pay with ZEC</Text>
          </Pressable>
        ) : (
          <View style={[styles.action, styles.actionInfo]}>
            <Text style={styles.actionInfoText}>Pay at counter</Text>
          </View>
        )}
      </View>
    </Card>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  header: { gap: theme.space.xs },
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  subtitle: { color: theme.color.textDim, fontSize: 14, lineHeight: 20 },
  centered: { alignItems: 'center', paddingVertical: theme.space.xxl, gap: theme.space.md },
  dim: { color: theme.color.textDim, fontSize: 14 },
  cardTitle: { color: theme.color.text, fontSize: 17, fontWeight: '800' },
  help: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: theme.space.sm,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  who: { flex: 1, paddingRight: theme.space.md },
  name: { color: theme.color.text, fontSize: 17, fontWeight: '800' },
  cat: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  dist: {
    color: theme.color.accent,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  actions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  action: {
    flex: 1,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGhost: { borderColor: theme.color.border, borderWidth: 1 },
  actionGhostText: { color: theme.color.text, fontSize: 14, fontWeight: '700' },
  actionPay: { backgroundColor: theme.color.accent },
  actionPayText: { color: '#0A0E1A', fontSize: 14, fontWeight: '800' },
  actionInfo: { backgroundColor: theme.color.bgElev },
  actionInfoText: { color: theme.color.textDim, fontSize: 13, fontWeight: '700' },
  footnote: { color: theme.color.textMuted, fontSize: 11, lineHeight: 16 },
});
