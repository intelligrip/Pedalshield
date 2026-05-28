import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
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

export function RideTrackerScreen() {
  const sessionRef = useRef<RideSession>(new RideSession(ATT));
  const sourceRef = useRef<SyntheticSensorSource>(new SyntheticSensorSource());
  const [snap, setSnap] = useState<RideSessionSnapshot>(
    sessionRef.current.snapshot(),
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const off = sessionRef.current.subscribe(setSnap);
    return off;
  }, []);

  // Repaint live stats (elapsed clock) once per second while active
  useEffect(() => {
    if (snap.state !== 'active') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [snap.state]);

  // Force re-snapshot to refresh elapsedS without sample injection
  useEffect(() => {
    if (snap.state === 'active') setSnap(sessionRef.current.snapshot());
  }, [tick]);

  const elapsedMs = snap.startedAt
    ? (snap.endedAt ?? Date.now()) - snap.startedAt
    : 0;

  if (snap.state === 'complete' && snap.result) {
    return <PostRide snap={snap} onDone={() => {
      sourceRef.current.stop();
      sessionRef.current.reset();
    }} />;
  }

  return (
    <ScreenContainer scroll={false}>
      <Text style={styles.title}>
        {snap.state === 'active' ? 'Riding' : 'Ride'}
      </Text>

      <View style={styles.heroBlock}>
        <Stat
          label="Distance"
          value={formatKm(snap.stats.liveKm)}
          unit="km"
          emphasised
        />
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Stat label="Time" value={formatDurationMs(elapsedMs)} />
        </View>
        <View style={styles.col}>
          <Stat label="Avg speed" value={formatKmh(snap.stats.liveAvgKmh)} unit="km/h" />
        </View>
      </View>

      <Card>
        <View style={styles.privacyRow}>
          <View style={[styles.dot, { backgroundColor: theme.color.success }]} />
          <Text style={styles.privacyText}>
            Route held on device only. No data leaving the phone.
          </Text>
        </View>
        <Text style={styles.subtle}>
          Samples buffered: {snap.stats.geoSampleCount} GPS · {snap.stats.motionSampleCount} motion
        </Text>
      </Card>

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
    </ScreenContainer>
  );
}

function PostRide({
  snap,
  onDone,
}: {
  snap: RideSessionSnapshot;
  onDone: () => void;
}) {
  const result = snap.result!;
  const verified = result.status === 'verified';
  const color = verified
    ? theme.color.success
    : result.status === 'review'
      ? theme.color.warning
      : theme.color.danger;

  // Demo payout: simulate a credit to the wallet for a verified ride.
  // In production this is the server's confirmed shielded payout.
  React.useEffect(() => {
    if (!verified) return;
    try {
      const w = getWallet() as unknown as { credit?: (z: bigint, m?: string) => void };
      // base_rate 0.00005 ZEC/km * km
      const z = BigInt(Math.floor(result.verifiedKm * 5_000));
      if (typeof w.credit === 'function' && z > 0n) {
        w.credit(z, `Pedalshield payout - ride ${result.rideId.slice(0, 8)}`);
      } else if (z > 0n) {
        // For non-mock wallets, payout is server-side; nothing to do here.
        void zecToZatoshi('0');
      }
    } catch {
      // wallet not configured; demo only
    }
  }, [verified, result.rideId, result.verifiedKm]);

  return (
    <ScreenContainer>
      <Text style={styles.title}>Ride complete</Text>

      <Card accent>
        <Text style={[styles.statusBadge, { color }]}>{result.status.toUpperCase()}</Text>
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
        <Card>
          <Text style={styles.cardLabel}>SHIELDED PAYOUT</Text>
          <Text style={styles.payoutLine}>
            FROST 2-of-3 ceremony queued. ZEC has landed in your Streak Vault.
          </Text>
        </Card>
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  heroBlock: {
    paddingVertical: theme.space.xl,
    alignItems: 'flex-start',
  },
  row: { flexDirection: 'row', gap: theme.space.lg },
  col: { flex: 1 },
  actions: { marginTop: 'auto' },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  privacyText: { color: theme.color.text, fontSize: 14, fontWeight: '600' },
  subtle: { color: theme.color.textDim, fontSize: 12, marginTop: theme.space.sm },
  statusBadge: { fontSize: theme.font.label.size, fontWeight: '800', letterSpacing: 1.2 },
  cardLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  payoutLine: { color: theme.color.text, fontSize: 15, lineHeight: 22 },
  flag: { color: theme.color.textDim, fontSize: 13, marginVertical: 2 },
});
