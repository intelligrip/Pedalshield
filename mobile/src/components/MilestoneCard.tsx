/**
 * Streak, verified mileage, and progress toward the next trophy.
 *
 * REPLACES a card that displayed a streak hardcoded to `useState(4)` and a
 * "Multiplier x1.40" that corresponded to nothing in the backend. Both were
 * invented. In an app whose entire pitch is that you can trust what it tells
 * you, a fabricated earnings multiplier is the most expensive kind of bug —
 * it costs credibility, which is the product.
 *
 * Everything here is computed on-device from banked ride history. No network,
 * no server, nothing new leaving the phone.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card.tsx';
import { theme } from '../app/theme.ts';
import { currentStreakDays, milestoneProgress } from '../ride/milestones.ts';
import type { RideRecord } from '../ride/rideHistory.ts';

export function MilestoneCard({ records }: { records: RideRecord[] }) {
  const streak = currentStreakDays(records);
  const p = milestoneProgress(records);

  const latest = p.earned.length > 0 ? p.earned[p.earned.length - 1] : null;

  return (
    <Card>
      <Text style={styles.cardLabel}>VERIFIED MILES</Text>

      <View style={styles.topRow}>
        <View>
          <Text style={styles.miles}>
            {p.miles < 10 ? p.miles.toFixed(1) : Math.floor(p.miles).toLocaleString()}
          </Text>
          <Text style={styles.milesUnit}>miles verified</Text>
        </View>
        <View style={styles.streakBox}>
          <Text style={styles.streakNum}>{streak}</Text>
          <Text style={styles.streakUnit}>
            {streak === 1 ? 'day streak' : 'day streak'}
          </Text>
        </View>
      </View>

      {latest ? (
        <Text style={styles.earned}>
          🏅 {latest.name} — {latest.blurb}
        </Text>
      ) : null}

      {p.next ? (
        <>
          <View style={styles.nextRow}>
            <Text style={styles.nextLabel}>Next: {p.next.name}</Text>
            <Text style={styles.nextRemain}>
              {p.milesToNext < 10
                ? p.milesToNext.toFixed(1)
                : Math.ceil(p.milesToNext).toLocaleString()}{' '}
              mi to go
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(p.fraction * 100)}%` }]} />
          </View>
        </>
      ) : (
        <Text style={styles.earned}>Every trophy earned. Genuinely.</Text>
      )}

      {/* Deliberately no earnings multiplier. Streaks are motivation, not a
          rate change — claiming otherwise is what the old card did. */}
      <Text style={styles.note}>
        Counted from rides that passed verification, on this phone. Rejected
        rides never count — that&apos;s what makes the number mean something.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  miles: { color: theme.color.text, fontSize: 40, fontWeight: '800', lineHeight: 44 },
  milesUnit: { color: theme.color.textDim, fontSize: 13, marginTop: 2 },
  streakBox: { alignItems: 'flex-end' },
  streakNum: { color: theme.color.accent, fontSize: 28, fontWeight: '800', lineHeight: 32 },
  streakUnit: { color: theme.color.textDim, fontSize: 12 },
  earned: {
    color: theme.color.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: theme.space.md,
  },
  nextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: theme.space.lg,
    marginBottom: 6,
  },
  nextLabel: { color: theme.color.text, fontSize: 13, fontWeight: '600' },
  nextRemain: { color: theme.color.textDim, fontSize: 12 },
  track: {
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.color.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4, backgroundColor: theme.color.accent },
  note: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space.lg,
  },
});
