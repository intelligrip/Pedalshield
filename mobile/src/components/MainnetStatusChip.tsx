/**
 * MainnetStatusChip - live proof that the app is talking to Zcash mainnet.
 *
 * Polls a public block explorer every 30s for the current mainnet block
 * height and shows it as a small chip with a green dot. On tap, opens a
 * sheet explaining why we show height + connectivity instead of treasury
 * balance (the latter is *intentionally* unviewable - it's shielded).
 *
 * Visible on the Home screen header. A ticking number during the demo
 * is free proof to a judge that this is real mainnet, not a mock.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../app/theme.ts';
import {
  fetchZcashNetworkStatus,
  PEDALSHIELD_TREASURY_UA_PREFIX,
  type ZcashNetworkStatus,
} from '../lib/zcashNetwork.ts';

const POLL_MS = 30_000;

export function MainnetStatusChip() {
  const [status, setStatus] = useState<ZcashNetworkStatus | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchZcashNetworkStatus().then((s) => {
        if (!cancelled) setStatus(s);
      });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const connected = !!status && status.error === null && status.height > 0;
  const dotColor = connected ? theme.color.success : theme.color.textMuted;
  const label = connected
    ? `MAINNET · h${status!.height.toLocaleString()}`
    : status?.error
      ? 'MAINNET · offline'
      : 'MAINNET · ...';

  return (
    <>
      <Pressable style={styles.chip} onPress={() => setSheetOpen(true)}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setSheetOpen(false)}
        >
          <Pressable
            style={styles.card}
            onPress={(e: any) => e?.stopPropagation?.()}
          >
            <Text style={styles.cardTitle}>Zcash mainnet</Text>
            <View style={styles.divider} />
            <Row label="Current height" value={status?.height ? `h${status.height.toLocaleString()}` : '...'} />
            <Row
              label="Last block"
              value={
                status?.lastBlockMs
                  ? new Date(status.lastBlockMs).toLocaleString()
                  : '...'
              }
            />
            <Row label="Source" value={status?.source ?? '...'} />
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>TREASURY</Text>
            <Text style={styles.ua}>{PEDALSHIELD_TREASURY_UA_PREFIX}</Text>
            <Text style={styles.note}>
              Treasury balance is shielded by design — even the treasury
              signers can&apos;t reveal it on this screen without leaking
              privacy. The treasury UA prefix is public; payments, balance,
              and recipients are not.
            </Text>
            <Pressable
              style={styles.closeBtn}
              onPress={() => setSheetOpen(false)}
            >
              <Text style={styles.closeText}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.bgElev,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: {
    color: theme.color.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  backdrop: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.space.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.lg,
    padding: theme.space.xl,
  },
  cardTitle: {
    color: theme.color.text,
    fontSize: theme.font.h2.size,
    fontWeight: theme.font.h2.weight,
  },
  divider: {
    height: 1,
    backgroundColor: theme.color.border,
    marginVertical: theme.space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: theme.space.xs,
  },
  rowLabel: { color: theme.color.textDim, fontSize: 13 },
  rowValue: {
    color: theme.color.text,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sectionLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
  },
  ua: {
    color: theme.color.text,
    fontSize: 13,
    fontFamily: 'Courier',
    marginTop: theme.space.xs,
  },
  note: {
    color: theme.color.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: theme.space.md,
  },
  closeBtn: {
    marginTop: theme.space.lg,
    alignSelf: 'center',
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.xxl,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.accent,
  },
  closeText: { color: theme.color.bg, fontSize: 14, fontWeight: '800' },
});
