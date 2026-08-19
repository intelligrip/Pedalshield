/**
 * The home screen's centre of gravity: your bike, and how many miles it's been
 * fed.
 *
 * One number, one picture, one thing to want. No integrity score, no ZEC
 * headline, no leaderboard — the reward is a footnote elsewhere, because $0.15
 * was never the reason anyone would ride.
 *
 * Everything is computed on-device from banked ride history.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from './Card.tsx';
import { BikeCreature } from './BikeCreature.tsx';
import { theme } from '../app/theme.ts';
import {
  SUGGESTED_NAMES,
  restLabel,
  restState,
  setCompanionName,
  stageFor,
} from '../prefs/companion.ts';
import {
  currentStreakDays,
  verifiedMiles,
} from '../ride/milestones.ts';
import type { RideRecord } from '../ride/rideHistory.ts';

/** Whole days since the most recent non-rejected ride, or null if none. */
function daysSinceLastRide(records: RideRecord[], now = Date.now()): number | null {
  let latest = 0;
  for (const r of records) {
    if (r.status === 'rejected') continue;
    if (r.completedAt > latest) latest = r.completedAt;
  }
  if (!latest) return null;
  return Math.max(0, Math.floor((now - latest) / 86400000));
}

export function CompanionCard({
  records,
  name,
}: {
  records: RideRecord[];
  name: string;
}) {
  const miles = verifiedMiles(records);
  const { stage, next, fraction, milesToNext } = stageFor(miles);
  const streak = currentStreakDays(records);
  const since = daysSinceLastRide(records);
  const state = restState(streak, since);

  if (!name) return <NamePrompt />;

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.state}>{restLabel(state, streak)}</Text>
      </View>

      <View style={styles.art}>
        <BikeCreature detail={stage.detail} resting={state === 'resting'} />
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>FED</Text>
        <Text style={styles.rowValue}>
          {miles < 10 ? miles.toFixed(1) : Math.floor(miles).toLocaleString()}
          {next ? ` of ${next.miles.toLocaleString()} mi` : ' mi'}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
      </View>

      <Text style={styles.next}>
        {next
          ? `${
              milesToNext < 10
                ? milesToNext.toFixed(1)
                : Math.ceil(milesToNext).toLocaleString()
            } more miles and ${name} grows`
          : `${name} is fully grown. Genuinely.`}
      </Text>

      {/* Stated once, quietly. The privacy claim belongs next to the thing
          it protects, not on a separate screen nobody visits. */}
      <Text style={styles.note}>
        Only rides that passed verification count. Nothing about where you rode
        ever leaves this phone.
      </Text>
    </Card>
  );
}

/**
 * Shown until the rider names their bike. The app never picks a name on their
 * behalf — choosing it is the moment the attachment starts, and taking that
 * away to save one tap would be a bad trade.
 */
function NamePrompt() {
  const [value, setValue] = useState('');
  const suggestion = SUGGESTED_NAMES[
    Math.floor(Date.now() / 86400000) % SUGGESTED_NAMES.length
  ];

  return (
    <Card accent>
      <Text style={styles.promptLabel}>YOUR BIKE</Text>
      <Text style={styles.promptTitle}>What do you call it?</Text>
      <Text style={styles.promptBody}>
        Every verified mile you ride feeds it. Most riders already have a name
        in mind.
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={suggestion}
          placeholderTextColor={theme.color.textMuted}
          maxLength={24}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void setCompanionName(value || suggestion)}
        />
        <Pressable
          style={styles.saveBtn}
          onPress={() => void setCompanionName(value || suggestion)}
        >
          <Text style={styles.saveText}>Name it</Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', marginBottom: theme.space.sm },
  name: { color: theme.color.text, fontSize: 21, fontWeight: '800' },
  state: { color: theme.color.accent, fontSize: 12.5, marginTop: 3 },
  art: { alignItems: 'center', marginVertical: theme.space.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: theme.space.md,
    marginBottom: 6,
  },
  rowLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    letterSpacing: theme.font.label.letterSpacing,
  },
  rowValue: { color: theme.color.accent, fontSize: 13, fontWeight: '700' },
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.color.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 5, backgroundColor: theme.color.accent },
  next: {
    color: theme.color.textDim,
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: theme.space.md,
  },
  note: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: theme.space.md,
  },

  promptLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  promptTitle: {
    color: theme.color.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  promptBody: {
    color: theme.color.textDim,
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: theme.space.lg,
  },
  inputRow: { flexDirection: 'row', gap: theme.space.sm },
  input: {
    flex: 1,
    color: theme.color.text,
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
    backgroundColor: theme.color.bg,
  },
  saveBtn: {
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: theme.color.accent,
  },
  saveText: { color: theme.color.bg, fontWeight: '800', fontSize: 14 },
});
