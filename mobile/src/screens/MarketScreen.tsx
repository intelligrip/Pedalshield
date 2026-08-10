import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { MarketBuySheet } from '../components/MarketBuySheet.tsx';
import { SpendNearbyContent } from './SpendNearbyScreen.tsx';
import { theme } from '../app/theme.ts';
import {
  CATALOG,
  categoryLabel,
  type MarketCategory,
  type MarketItem,
} from '../market/catalog.ts';

type Filter = 'all' | MarketCategory;
type Mode = 'inapp' | 'nearby';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'service', label: 'Services' },
  { key: 'digital', label: 'Digital' },
  { key: 'voucher', label: 'Vouchers' },
];

export function MarketScreen() {
  const [mode, setMode] = useState<Mode>('inapp');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<MarketItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const items = useMemo(
    () => (filter === 'all' ? CATALOG : CATALOG.filter((i) => i.category === filter)),
    [filter],
  );

  function open(item: MarketItem) {
    setSelected(item);
    setSheetOpen(true);
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Market</Text>
        <Text style={styles.subtitle}>
          Spend the shielded ZEC you earned riding. You pay merchants directly,
          privately — Pedalshield never holds your funds.
        </Text>
      </View>

      <View style={styles.segment}>
        <Pressable
          onPress={() => setMode('inapp')}
          style={[styles.seg, mode === 'inapp' && styles.segActive]}
        >
          <Text style={[styles.segLabel, mode === 'inapp' && styles.segLabelActive]}>
            In-app
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('nearby')}
          style={[styles.seg, mode === 'nearby' && styles.segActive]}
        >
          <Text style={[styles.segLabel, mode === 'nearby' && styles.segLabelActive]}>
            Nearby
          </Text>
        </Pressable>
      </View>

      {mode === 'nearby' ? (
        <SpendNearbyContent />
      ) : (
        <>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, filter === f.key && styles.chipLabelActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {items.map((item) => (
        <Pressable key={item.id} onPress={() => open(item)}>
          <Card>
            <View style={styles.cardTop}>
              <Text style={styles.cat}>{categoryLabel(item.category)}</Text>
              <View style={styles.priceCol}>
                <Text style={styles.price}>{item.priceZec}</Text>
                <Text style={styles.priceUnit}>ZEC</Text>
              </View>
            </View>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <View style={styles.merchantRow}>
              <Text style={styles.merchant}>{item.merchant}</Text>
              {item.sample ? (
                <Text style={styles.exampleTag}>EXAMPLE</Text>
              ) : null}
            </View>
            <Text style={styles.blurb}>{item.blurb}</Text>
            <Text style={styles.fulfillment}>{item.fulfillment}</Text>
          </Card>
        </Pressable>
      ))}

      <Text style={styles.footnote}>
        These are examples of how the marketplace will work — none can be bought
        yet. Real merchants onboard with a view-only shop key,
        so they detect your payment on-chain without anyone holding custody.
        Private-native goods (services, digital, vouchers) come first — no
        shipping address required.
      </Text>
        </>
      )}

      <MarketBuySheet
        item={selected}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.space.xs },
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  subtitle: { color: theme.color.textDim, fontSize: 14, lineHeight: 20 },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.pill,
    padding: 4,
    gap: 4,
  },
  seg: {
    flex: 1,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
  },
  segActive: { backgroundColor: theme.color.accent },
  segLabel: { color: theme.color.textDim, fontSize: 14, fontWeight: '700' },
  segLabelActive: { color: '#0A0E1A' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  chip: {
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.bgElev,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  chipLabel: { color: theme.color.textDim, fontSize: 13, fontWeight: '700' },
  chipLabelActive: { color: '#0A0E1A' },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cat: {
    color: theme.color.accentSoft,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
  },
  priceCol: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  price: {
    color: theme.color.success,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  priceUnit: {
    color: theme.color.textDim,
    fontSize: 11,
    fontWeight: '700',
    paddingBottom: 3,
  },
  itemTitle: {
    color: theme.color.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: theme.space.sm,
  },
  merchantRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exampleTag: {
    color: theme.color.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  merchant: { color: theme.color.textMuted, fontSize: 12, marginTop: 2 },
  blurb: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: theme.space.sm,
  },
  fulfillment: {
    color: theme.color.textMuted,
    fontSize: 12,
    marginTop: theme.space.sm,
  },
  footnote: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
});
