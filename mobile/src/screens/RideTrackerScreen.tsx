import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { LiveRouteMap } from '../components/LiveRouteMap.tsx';
import { PayoutCard } from '../components/PayoutCard.tsx';
import { PrivacyRevealSheet } from '../components/PrivacyRevealSheet.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { Stat } from '../components/Stat.tsx';
import { theme } from '../app/theme.ts';
import { RideSession, type RideSessionSnapshot } from '../ride/rideSession.ts';
import { SyntheticSensorSource } from '../ride/syntheticSensorSource.ts';
import {
  formatDurationMs,
  formatKm,
  formatKmh,
} from '../lib/format.ts';
import { getWallet } from '../wallet/walletManager.ts';
import { zecToZatoshi } from '../wallet/mockWallet.ts';

const ATT = {
  platform: 'android' as const,
  token: 'demo-attestation',
  issuedAt: Date.now(),
};

const HORIZ_PADDING = theme.space.lg * 2;
const MAP_HEIGHT = 360;

export function RideTrackerScreen() {
  const sessionRef = useRef<RideSession>(new RideSession(ATT));
  const sourceRef = useRef<SyntheticSensorSource>(new SyntheticSensorSource());
  const [snap, setSnap] = useState<RideSessionSnapshot>(
    sessionRef.current.snapshot(),
  );
  const [tick, setTick] = useState(0);
  const [revealOpen, setRevealOpen] = useState(false);

  useEffect(() => {
    const off = sessionRef.current.subscribe(setSnap);
    return off;
  }, []);

  // Repaint live stats (elapsed clock) once per second while active.
  useEffect(() => {
    if (snap.state !== 'active') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [snap.state]);

  useEffect(() => {
    if (snap.state === 'active') setSnap(sessionRef.current.snapshot());
  }, [tick]);

  const elapsedMs = snap.startedAt
    ? (snap.endedAt ?? Date.now()) - snap.startedAt
    : 0;

  const mapWidth = useMemo(
    () => Math.max(280, Dimensions.get('window').width - HORIZ_PADDING),
    [],
  );

  if (snap.state === 'complete' && snap.result) {
    return (
      <PostRide
        snap={snap}
        mapWidth={mapWidth}
        onDone={() => {
          sourceRef.current.stop();
          sessionRef.current.reset();
        }}
      />
    );
  }

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {snap.state === 'active' ? 'Riding' : 'Ride'}
        </Text>
        <Pressable
          style={styles.padlockChip}
          onPress={() => setRevealOpen(true)}
        >
          <Text style={styles.padlockIcon}>🔒</Text>
          <Text style={styles.padlockText}>On device only</Text>
        </Pressable>
      </View>

      <View style={styles.mapWrap}>
        <LiveRouteMap
          route={snap.liveRoute}
          width={mapWidth}
          height={MAP_HEIGHT}
        />
        {/* Glass stat tiles floating over the map. */}
        <View style={styles.glassRow} pointerEvents="none">
          <GlassTile
            label="DISTANCE"
            value={formatKm(snap.stats.liveKm)}
            unit="km"
          />
          <GlassTile
            label="TIME"
            value={formatDurationMs(elapsedMs)}
            unit=""
          />
          <GlassTile
            label="SPEED"
            value={formatKmh(snap.stats.liveAvgKmh)}
            unit="km/h"
          />
        </View>
      </View>

      <View style={styles.actions}>
        {snap.state === 'idle' && (
          <Button
            label="Start ride"
            size="lg"
            onPress={() => {
              sessionRef.current.start();
              sourceRef.current.start(sessionRef.current);
            }}
          />
        )}
        {snap.state === 'active' && (
          <Button
            label="Stop ride"
            size="lg"
            variant="danger"
            onPress={() => {
              sourceRef.current.stop();
              sessionRef.current.stop();
            }}
          />
        )}
        {snap.state === 'error' && (
          <Button
            label="Reset"
            size="lg"
            variant="secondary"
            onPress={() => sessionRef.current.reset()}
          />
        )}
      </View>

      <PrivacyRevealSheet
        visible={revealOpen}
        onClose={() => setRevealOpen(false)}
        rideId={snap.rideId ?? ''}
        distanceM={snap.stats.liveKm * 1000}
      />
    </ScreenContainer>
  );
}

function GlassTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.glassTile}>
      <Text style={styles.glassLabel}>{label}</Text>
      <View style={styles.glassValueRow}>
        <Text style={styles.glassValue}>{value}</Text>
        {unit ? <Text style={styles.glassUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function PostRide({
  snap,
  mapWidth,
  onDone,
}: {
  snap: RideSessionSnapshot;
  mapWidth: number;
  onDone: () => void;
}) {
  const result = snap.result!;
  const verified = result.status === 'verified';
  const color = verified
    ? theme.color.success
    : result.status === 'review'
      ? theme.color.warning
      : theme.color.danger;
  const [revealOpen, setRevealOpen] = useState(false);

  // Demo payout: simulate a credit to the wallet for a verified ride.
  // In production this is the server's confirmed shielded payout.
  useEffect(() => {
    if (!verified) return;
    try {
      const w = getWallet() as unknown as {
        credit?: (z: bigint, m?: string) => void;
      };
      const z = BigInt(Math.floor(result.verifiedKm * 5_000));
      if (typeof w.credit === 'function' && z > 0n) {
        w.credit(z, `Pedalshield payout - ride ${result.rideId.slice(0, 8)}`);
      } else if (z > 0n) {
        void zecToZatoshi('0');
      }
    } catch {
      // wallet not configured; demo only
    }
  }, [verified, result.rideId, result.verifiedKm]);

  return (
    <ScreenContainer>
      <Text style={styles.title}>Ride complete</Text>

      <View style={[styles.mapWrap, { marginTop: theme.space.md }]}>
        <LiveRouteMap
          route={snap.liveRoute}
          width={mapWidth}
          height={240}
          showWatermark={false}
        />
      </View>

      <Card accent>
        <Text style={[styles.statusBadge, { color }]}>
          {result.status.toUpperCase()}
        </Text>
        <View style={{ height: theme.space.md }} />
        <Stat
          label="Verified distance"
          value={formatKm(result.verifiedKm)}
          unit="km"
          emphasised
        />
        <View style={{ height: theme.space.md }} />
        <Stat
          label="Integrity score"
          value={result.integrityScore.toFixed(2)}
        />
      </Card>

      {verified && (
        <>
          <PayoutCard
            rideId={result.rideId}
            distanceM={result.verifiedKm * 1000}
          />
          <Pressable
            style={styles.linkRow}
            onPress={() => setRevealOpen(true)}
          >
            <Text style={styles.linkText}>See what was sent ›</Text>
          </Pressable>
        </>
      )}

      {result.flags.length > 0 && (
        <Card>
          <Text style={styles.cardLabel}>VERIFICATION NOTES</Text>
          {result.flags.map((f, i) => (
            <Text key={i} style={styles.flag}>
              · {f.code.replace(/_/g, ' ').toLowerCase()}
              {f.detail ? ` (${f.detail})` : ''}
            </Text>
          ))}
        </Card>
      )}

      <Button label="Done" size="lg" onPress={onDone} />

      <PrivacyRevealSheet
        visible={revealOpen}
        onClose={() => setRevealOpen(false)}
        rideId={result.rideId}
        distanceM={result.verifiedKm * 1000}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  padlockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderColor: theme.color.success,
    borderWidth: 1,
    backgroundColor: 'rgba(34, 211, 161, 0.10)',
  },
  padlockIcon: { fontSize: 11 },
  padlockText: {
    color: theme.color.success,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  mapWrap: {
    marginTop: theme.space.lg,
    alignItems: 'center',
    position: 'relative',
  },
  glassRow: {
    position: 'absolute',
    top: theme.space.md,
    left: theme.space.md,
    right: theme.space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.space.sm,
  },
  glassTile: {
    flex: 1,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: 'rgba(10, 14, 26, 0.72)',
    borderRadius: theme.radius.md,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  glassLabel: {
    color: theme.color.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
  },
  glassValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 2,
  },
  glassValue: {
    color: theme.color.text,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  glassUnit: { color: theme.color.textDim, fontSize: 11, fontWeight: '700' },
  actions: { marginTop: 'auto' },
  statusBadge: {
    fontSize: theme.font.label.size,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  cardLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  payoutLine: { color: theme.color.text, fontSize: 15, lineHeight: 22 },
  flag: { color: theme.color.textDim, fontSize: 13, marginVertical: 2 },
  linkRow: { marginTop: theme.space.md },
  linkText: {
    color: theme.color.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});
