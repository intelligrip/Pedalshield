/**
 * PrivacyCheckupCard — the honest answer to "what about other apps?"
 *
 * iOS sandboxing means NO app can see, detect, or stop another app's
 * location use — including us. (That same isolation is what makes our own
 * privacy promise enforceable, so we say it out loud instead of faking a
 * "scanner".) What we CAN do: teach the rider to audit their phone in one
 * minute and deep-link them to Settings.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card.tsx';
import { theme } from '../app/theme.ts';

const STEPS = [
  'Open Settings → Privacy & Security → Location Services.',
  'For each fitness or social app, ask: does it need "Always"? Downgrade to "While Using" or "Never".',
  'Watch for "Precise Location" — most apps work fine with it OFF.',
  'Fitness apps with public feeds (Strava, etc.): check their in-app privacy zones and map visibility too — their servers keep what they collect.',
];

export function PrivacyCheckupCard() {
  return (
    <Card>
      <Text style={styles.sectionLabel}>PRIVACY CHECKUP · OTHER APPS</Text>
      <Text style={styles.note}>
        Straight answer: Pedalshield cannot see or stop other apps from
        tracking you — iOS isolates every app from every other app. That same
        wall is why nothing can reach your ride data here. But if another app
        is broadcasting your location, your privacy is only as strong as your
        loudest app. One-minute audit:
      </Text>
      {STEPS.map((s, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.n}>{i + 1}</Text>
          <Text style={styles.step}>{s}</Text>
        </View>
      ))}
      <Pressable
        style={styles.btn}
        onPress={() => void Linking.openURL('app-settings:')}
      >
        <Text style={styles.btnText}>Open iOS Settings</Text>
      </Pressable>
      <Text style={styles.fine}>
        The button opens Settings; navigate to Privacy &amp; Security →
        Location Services from there. Apple doesn&apos;t let apps link there
        directly — which is the sandbox doing its job.
      </Text>
    </Card>
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
    gap: theme.space.sm,
    marginBottom: theme.space.sm,
  },
  n: {
    color: theme.color.accentSoft,
    fontWeight: '800',
    fontSize: 13,
    width: 16,
  },
  step: { color: theme.color.text, fontSize: 13, lineHeight: 19, flex: 1 },
  btn: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.space.md,
    alignItems: 'center',
    marginTop: theme.space.sm,
  },
  btnText: { color: '#0A0E1A', fontWeight: '700', fontSize: 14 },
  fine: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space.sm,
  },
});
