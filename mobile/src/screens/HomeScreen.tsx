import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { Stat } from '../components/Stat.tsx';
import { theme } from '../app/theme.ts';
import { getWallet } from '../wallet/walletManager.ts';
import { formatZec, shortAddress } from '../lib/format.ts';
import type { Balance } from '../wallet/types.ts';

export function HomeScreen({ navigation }: { navigation: any }) {
  const [balance, setBalance] = useState<Balance>({
    verifiedZatoshi: 0n,
    pendingZatoshi: 0n,
    totalZatoshi: 0n,
  });
  const [address, setAddress] = useState<string>('');
  const [streakDays, setStreakDays] = useState<number>(4);

  useEffect(() => {
    const wallet = getWallet();
    wallet.getBalance().then(setBalance);
    wallet.getAddress().then((a) => setAddress(a.ua));
    const off = wallet.onBalanceChange(setBalance);
    return off;
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.brand}>Pedalshield</Text>
        <Text style={styles.tagline}>Ride private. Earn shielded.</Text>
      </View>

      <Card accent>
        <Text style={styles.cardLabel}>SHIELDED VAULT</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceValue}>{formatZec(balance.verifiedZatoshi)}</Text>
          <Text style={styles.balanceUnit}>ZEC</Text>
        </View>
        <Text style={styles.address}>{address ? shortAddress(address) : 'syncing...'}</Text>
      </Card>

      <Card>
        <Text style={styles.cardLabel}>YOUR STREAK</Text>
        <View style={styles.streakRow}>
          <Text style={styles.streakNum}>{streakDays}</Text>
          <Text style={styles.streakUnit}>day streak</Text>
        </View>
        <Text style={styles.streakMult}>Multiplier x{(1 + 0.1 * streakDays).toFixed(2)}</Text>
      </Card>

      <View style={styles.statsRow}>
        <View style={styles.statCol}><Stat label="This week" value="42.3" unit="km" /></View>
        <View style={styles.statCol}><Stat label="Avg score" value="0.91" /></View>
      </View>

      <Card>
        <Text style={styles.cardLabel}>READY TO RIDE</Text>
        <Text style={styles.cta}>
          Tap the Ride tab below to start. Your route never leaves your phone.
        </Text>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  brand: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  tagline: { color: theme.color.textDim, fontSize: 15 },
  cardLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm },
  balanceValue: {
    color: theme.color.accent,
    fontSize: theme.font.display.size,
    fontWeight: theme.font.display.weight,
    letterSpacing: theme.font.display.letterSpacing,
  },
  balanceUnit: { color: theme.color.textDim, fontSize: 18, fontWeight: '700', paddingBottom: 10 },
  address: { color: theme.color.textMuted, fontSize: 12, marginTop: theme.space.sm, fontFamily: 'monospace' },
  streakRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm },
  streakNum: { color: theme.color.text, fontSize: 40, fontWeight: '800' },
  streakUnit: { color: theme.color.textDim, fontSize: 16, fontWeight: '600' },
  streakMult: { color: theme.color.success, fontSize: 14, fontWeight: '700', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: theme.space.lg },
  statCol: { flex: 1 },
  cta: { color: theme.color.text, fontSize: 15, lineHeight: 22 },
});
