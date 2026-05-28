import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../app/theme.ts';

interface Props {
  label: string;
  value: string;
  unit?: string;
  emphasised?: boolean;
}

export function Stat({ label, value, unit, emphasised }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.row}>
        <Text style={[styles.value, emphasised && styles.valueEmphasised]}>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.space.xs },
  label: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.xs },
  value: {
    color: theme.color.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  valueEmphasised: {
    color: theme.color.accent,
    fontSize: 40,
  },
  unit: {
    color: theme.color.textDim,
    fontSize: 14,
    fontWeight: '600',
    paddingBottom: 6,
  },
});
