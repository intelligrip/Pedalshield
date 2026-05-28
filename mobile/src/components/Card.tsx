import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { theme } from '../app/theme.ts';

interface Props {
  children: ReactNode;
  accent?: boolean;
}

export function Card({ children, accent }: Props) {
  return (
    <View style={[styles.card, accent && styles.accent]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.bgCard,
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.space.lg,
  },
  accent: {
    borderColor: theme.color.accent,
  },
});
