import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../app/theme.ts';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  size?: 'md' | 'lg';
}

export function Button({ label, onPress, variant = 'primary', disabled, size = 'md' }: Props) {
  const styles = makeStyles(variant, size, !!disabled);
  return (
    <Pressable style={styles.button} onPress={onPress} disabled={disabled}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(
  variant: 'primary' | 'secondary' | 'danger',
  size: 'md' | 'lg',
  disabled: boolean,
) {
  const bg =
    variant === 'primary' ? theme.color.accent
    : variant === 'danger' ? theme.color.danger
    : 'transparent';
  const border =
    variant === 'secondary' ? theme.color.border : 'transparent';
  const fg =
    variant === 'secondary' ? theme.color.text : '#0A0E1A';
  const py = size === 'lg' ? theme.space.lg : theme.space.md;
  return StyleSheet.create({
    button: {
      backgroundColor: bg,
      borderColor: border,
      borderWidth: variant === 'secondary' ? 1 : 0,
      paddingVertical: py,
      paddingHorizontal: theme.space.xl,
      borderRadius: theme.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.45 : 1,
    },
    label: {
      color: fg,
      fontSize: size === 'lg' ? 18 : theme.font.body.size,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
  });
}
