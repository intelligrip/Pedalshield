import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from './Button.tsx';
import { theme } from '../app/theme.ts';
import type { MarketItem } from '../market/catalog.ts';
import { buildZcashPaymentUri, newOrderId } from '../market/zcashUri.ts';
import { shortAddress } from '../lib/format.ts';

/**
 * Non-custodial buy sheet. The rider pays the merchant DIRECTLY from their own
 * Zcash wallet via a `zcash:` deep link — Pedalshield never holds funds or
 * touches keys. We just build the payment request (address + amount + an order
 * memo) and hand it off.
 */
export function MarketBuySheet({
  item,
  visible,
  onClose,
}: {
  item: MarketItem | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [orderId, setOrderId] = useState('');
  const [paid, setPaid] = useState(false);

  // Fresh order id each time the sheet opens for an item.
  useEffect(() => {
    if (visible && item) {
      setOrderId(newOrderId());
      setPaid(false);
    }
  }, [visible, item]);

  if (!item) return null;

  const uri = buildZcashPaymentUri(item.merchantUA, item.priceZec, orderId);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e: any) => e?.stopPropagation?.()}>
          <View style={styles.handle} />

          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.merchant}>{item.merchant}</Text>

          <View style={styles.priceRow}>
            <Text style={styles.price}>{item.priceZec}</Text>
            <Text style={styles.priceUnit}>ZEC</Text>
          </View>
          <Text style={styles.fulfillment}>{item.fulfillment}</Text>

          <View style={styles.nonCustodial}>
            <Text style={styles.ncTitle}>🔒 Non-custodial</Text>
            <Text style={styles.ncBody}>
              You pay {item.merchant} directly from your own wallet, privately.
              Pedalshield never holds your funds or touches your keys.
            </Text>
          </View>

          {!paid ? (
            <>
              <Button
                label={`Pay ${item.priceZec} ZEC in your wallet`}
                size="lg"
                onPress={() => {
                  Linking.openURL(uri).catch(() => {});
                  setPaid(true);
                }}
              />
              <Text style={styles.detail}>
                Order {orderId} · to {shortAddress(item.merchantUA, 10, 6)}
              </Text>
            </>
          ) : (
            <View style={styles.pending}>
              <Text style={styles.pendingTitle}>Order {orderId} — paying…</Text>
              <Text style={styles.pendingBody}>
                Confirm the payment in your Zcash wallet. The merchant detects it
                on-chain with their view-only key — Pedalshield never sees your
                funds move. (Live confirmation status is coming next.)
              </Text>
            </View>
          )}

          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.bg,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.space.xl,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.xxl,
  },
  handle: {
    alignSelf: 'center',
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.color.border,
    marginBottom: theme.space.lg,
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.h2.size,
    fontWeight: theme.font.h2.weight,
  },
  merchant: { color: theme.color.textDim, fontSize: 14, marginTop: 2 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.space.sm,
    marginTop: theme.space.lg,
  },
  price: {
    color: theme.color.accent,
    fontSize: theme.font.display.size,
    fontWeight: theme.font.display.weight,
    letterSpacing: theme.font.display.letterSpacing,
  },
  priceUnit: {
    color: theme.color.textDim,
    fontSize: 18,
    fontWeight: '700',
    paddingBottom: 10,
  },
  fulfillment: { color: theme.color.textDim, fontSize: 13, marginTop: 4 },
  nonCustodial: {
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.success,
    padding: theme.space.md,
    marginVertical: theme.space.lg,
  },
  ncTitle: { color: theme.color.success, fontSize: 13, fontWeight: '800' },
  ncBody: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  detail: {
    color: theme.color.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: theme.space.md,
    fontVariant: ['tabular-nums'],
  },
  pending: {
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.md,
    padding: theme.space.lg,
  },
  pendingTitle: { color: theme.color.warning, fontSize: 15, fontWeight: '800' },
  pendingBody: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: theme.space.sm,
  },
  closeBtn: {
    marginTop: theme.space.lg,
    alignSelf: 'center',
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.xxl,
    borderRadius: theme.radius.pill,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  closeText: {
    color: theme.color.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
