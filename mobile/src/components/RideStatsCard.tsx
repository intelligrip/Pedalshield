import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card.tsx';
import { theme } from '../app/theme.ts';
import { formatDurationMs, formatKm, formatKmh } from '../lib/format.ts';
import type { RideStatsReport } from '../ride/rideStats.ts';

/**
 * Strava-style post-ride report, computed and rendered entirely
 * on-device. None of this leaves the phone.
 */
export function RideStatsCard({ report }: { report: RideStatsReport }) {
  const maxSplitKmh = Math.max(
    1,
    ...report.splits.map((s) => s.avgKmh),
  );

  return (
    <Card>
      <View style={styles.headerRow}>
        <Text style={styles.label}>RIDE REPORT</Text>
        <Text style={styles.localBadge}>computed on-device</Text>
      </View>

      <View style={styles.grid}>
        <Tile
          label="DISTANCE"
          value={formatKm(report.distanceKm)}
          unit="km"
          big
        />
        <Tile
          label="MOVING TIME"
          value={formatDurationMs(report.movingS * 1000)}
          unit=""
          big
        />
        <Tile
          label="AVG SPEED"
          value={formatKmh(report.avgMovingKmh)}
          unit="km/h"
          big
        />
      </View>

      <View style={[styles.grid, { marginTop: theme.space.md }]}>
        <Tile label="MAX SPEED" value={formatKmh(report.maxKmh)} unit="km/h" />
        <Tile
          label="ELEV GAIN"
          value={String(Math.round(report.elevationGainM))}
          unit="m"
        />
        <Tile
          label="STOPPED"
          value={formatDurationMs(report.stoppedS * 1000)}
          unit=""
        />
      </View>

      {report.splits.length > 0 ? (
        <View style={styles.splits}>
          <Text style={styles.splitsHeader}>SPLITS</Text>
          {report.splits.map((s, i) => {
            const best = i === report.bestSplitIndex;
            const barPct = Math.max(8, (s.avgKmh / maxSplitKmh) * 100);
            return (
              <View key={i} style={styles.splitRow}>
                <Text style={styles.splitKm}>
                  {s.km === 1 ? String(i + 1) : s.km.toFixed(1)}
                </Text>
                <View style={styles.splitBarTrack}>
                  <View
                    style={[
                      styles.splitBar,
                      { width: `${barPct}%` },
                      best && { backgroundColor: theme.color.success },
                    ]}
                  />
                </View>
                <Text style={[styles.splitSpeed, best && styles.splitBest]}>
                  {formatKmh(s.avgKmh)}
                  {best ? ' ★' : ''}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

function Tile({
  label,
  value,
  unit,
  big,
}: {
  label: string;
  value: string;
  unit: string;
  big?: boolean;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileValueRow}>
        <Text style={[styles.tileValue, big && styles.tileValueBig]}>
          {value}
        </Text>
        {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.space.md,
  },
  label: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
  },
  localBadge: {
    color: theme.color.success,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  grid: { flexDirection: 'row', gap: theme.space.md },
  tile: { flex: 1 },
  tileLabel: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  tileValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 2,
  },
  tileValue: {
    color: theme.color.text,
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  tileValueBig: { fontSize: 22 },
  tileUnit: { color: theme.color.textDim, fontSize: 11, fontWeight: '700' },
  splits: { marginTop: theme.space.lg },
  splitsHeader: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: theme.space.sm,
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    marginVertical: 3,
  },
  splitKm: {
    color: theme.color.textDim,
    fontSize: 12,
    fontWeight: '700',
    width: 26,
    fontVariant: ['tabular-nums'],
  },
  splitBarTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(10, 14, 26, 0.7)',
    overflow: 'hidden',
  },
  splitBar: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: theme.color.accentSoft,
  },
  splitSpeed: {
    color: theme.color.text,
    fontSize: 12,
    fontWeight: '700',
    width: 70,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  splitBest: { color: theme.color.success },
});
