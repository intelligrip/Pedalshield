import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { theme } from '../app/theme.ts';
import { IS_FOGLINE } from '../lib/config.ts';
import { fog } from '../fogline/theme.ts';

// Fogline's near-black field; Pedalshield keeps its navy.
const BG = IS_FOGLINE ? fog.bg : theme.color.bg;

interface Props {
  children: ReactNode;
  scroll?: boolean;
}

export function ScreenContainer({ children, scroll = true }: Props) {
  const inner = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.solidContent}>{children}</View>
  );
  return <SafeAreaView style={styles.safe}>{inner}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    padding: theme.space.lg,
    paddingBottom: theme.space.xxxl,
    gap: theme.space.lg,
  },
  solidContent: {
    flex: 1,
    padding: theme.space.lg,
    gap: theme.space.lg,
  },
});
