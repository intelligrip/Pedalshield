import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { theme } from '../app/theme.ts';
import { getWallet } from '../wallet/walletManager.ts';
import { shortAddress } from '../lib/format.ts';

const NEVER_COLLECTED = [
  'Your GPS route or any individual ride coordinates',
  'Accelerometer / gyroscope / barometer raw samples',
  'Your real identity, email, or phone number',
  'Your home, work, or any frequent location',
  'Heart rate or any biometric data',
];

const WHAT_LEAVES_DEVICE = [
  'Verified ride distance (a single number)',
  'Integrity score (0..1) and a small list of flags',
  'Device attestation token (anti-cheat, not identity)',
  'Pseudonymous account id',
];

export function PrivacyDashboardScreen() {
  const [address, setAddress] = useState<string>('');
  useEffect(() => {
    try {
      getWallet().getAddress().then((a) => setAddress(a.ua));
    } catch {
      // wallet not ready yet
    }
  }, []);

  return (
    <ScreenContainer>
      <View>
        <Text style={styles.title}>Privacy</Text>
        <Text style={styles.tagline}>
          What we don&apos;t collect is more important than what we do.
        </Text>
      </View>

      <Card>
        <Text style={styles.sectionLabel}>WHAT WE NEVER COLLECT</Text>
        {NEVER_COLLECTED.map((item, i) => (
          <Row key={i} icon="×" color={theme.color.danger} text={item} />
        ))}
      </Card>

      <Card accent>
        <Text style={styles.sectionLabel}>WHAT LEAVES YOUR DEVICE</Text>
        {WHAT_LEAVES_DEVICE.map((item, i) => (
          <Row key={i} icon="✓" color={theme.color.success} text={item} />
        ))}
        <Text style={styles.note}>
          The on-device verifier produces a small claim payload. A unit test
          enforces with code that no GPS, motion, barometer, or pedometer
          data can leak through it.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>YOUR SHIELDED ADDRESS</Text>
        <Text style={styles.address}>{address ? shortAddress(address, 12, 8) : 'syncing...'}</Text>
        <Text style={styles.note}>
          A Unified Address with an Orchard receiver. Treasury payouts arrive
          here as shielded Zcash transactions - amounts and recipients are
          private on-chain.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>YOU CAN PROVE IT</Text>
        <Text style={styles.note}>
          The on-device verification engine, claim payload definition, and
          privacy assertion are open source under MIT. The Streak Vault
          shows your balance straight from the Zcash light-client SDK -
          nothing we control.
        </Text>
      </Card>
    </ScreenContainer>
  );
}

function Row({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.icon, { color }]}>{icon}</Text>
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  tagline: { color: theme.color.textDim, fontSize: 15, marginTop: 4 },
  sectionLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.md,
  },
  row: { flexDirection: 'row', gap: theme.space.md, paddingVertical: 6 },
  icon: { fontSize: 18, fontWeight: '800', width: 18 },
  rowText: { color: theme.color.text, fontSize: 14, lineHeight: 20, flex: 1 },
  address: {
    color: theme.color.text,
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: theme.space.sm,
  },
  note: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: theme.space.sm,
  },
});
