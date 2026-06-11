import React from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button.tsx';
import { theme } from '../app/theme.ts';
import { EXPLORER_TX_BASE } from '../lib/config.ts';
import { formatKm } from '../lib/format.ts';

/**
 * Proof-without-exposure share card.
 *
 * The shareable artifact contains distance, integrity score, and the
 * mainnet txid — and deliberately NO map, NO location, NO start time.
 * Strava's share object is a map of your life; ours is a receipt.
 * Native image export (react-native-view-shot) is queued for the next
 * dev-client build; until then the card is screenshot-perfect and the
 * Share button sends the text + explorer link.
 */
export function ShareCard({
  distanceM,
  integrityScore,
  txid,
}: {
  distanceM: number;
  integrityScore: number;
  txid: string;
}) {
  const km = distanceM / 1000;

  async function onShare() {
    const msg =
      `Rode ${formatKm(km)} km. My phone verified it — the route never ` +
      `left the device. An autonomous treasury paid me shielded ZEC on ` +
      `Zcash mainnet. Proof: ${EXPLORER_TX_BASE}${txid}` +
      `\n\nRide private. Earn shielded. #Pedalshield`;
    try {
      await Share.share({ message: msg });
    } catch {
      // user dismissed the sheet; nothing to do
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>PEDALSHIELD</Text>
          <Text style={styles.brandTag}>RIDE PRIVATE</Text>
        </View>

        <View style={styles.kmRow}>
          <Text style={styles.km}>{formatKm(km)}</Text>
          <Text style={styles.kmUnit}>km verified</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>INTEGRITY</Text>
            <Text style={styles.metaValue}>
              {integrityScore.toFixed(2)}
            </Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>PAID</Text>
            <Text style={[styles.metaValue, { color: theme.color.success }]}>
              shielded ZEC
            </Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>OPERATOR</Text>
            <Text style={styles.metaValue}>none</Text>
          </View>
        </View>

        <Text style={styles.txid} numberOfLines={1}>
          tx {txid.slice(0, 16)}…{txid.slice(-8)}
        </Text>

        <View style={styles.privacyStrip}>
          <Text style={styles.privacyText}>
            🔒 No map. No location. No start time. The route never left
            the phone.
          </Text>
        </View>
      </View>

      <Button label="Share the receipt" size="lg" onPress={onShare} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.space.lg, gap: theme.space.md },
  card: {
    backgroundColor: theme.color.bgElev,
    borderColor: theme.color.accent,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: theme.color.accent,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
  },
  brandTag: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  kmRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.space.sm,
    marginTop: theme.space.lg,
  },
  km: {
    color: theme.color.text,
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  kmUnit: { color: theme.color.textDim, fontSize: 15, fontWeight: '600' },
  metaRow: {
    flexDirection: 'row',
    marginTop: theme.space.lg,
    gap: theme.space.xl,
  },
  metaCol: {},
  metaLabel: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
  },
  metaValue: {
    color: theme.color.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  txid: {
    color: theme.color.textDim,
    fontSize: 11,
    marginTop: theme.space.lg,
    fontVariant: ['tabular-nums'],
  },
  privacyStrip: {
    marginTop: theme.space.md,
    paddingTop: theme.space.md,
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
  },
  privacyText: {
    color: theme.color.success,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
});
