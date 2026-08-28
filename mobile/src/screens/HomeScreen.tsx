import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card.tsx';
import { MilestoneCard } from '../components/MilestoneCard.tsx';
import { CompanionCard } from '../components/CompanionCard.tsx';
import {
  getCompanionPrefs,
  onCompanionChange,
} from '../prefs/companion.ts';
import { MainnetStatusChip } from '../components/MainnetStatusChip.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { Stat } from '../components/Stat.tsx';
import { theme } from '../app/theme.ts';
import { ConnectWalletCard } from '../components/ConnectWalletCard.tsx';
import { Linking } from 'react-native';
import {
  distanceUnit,
  formatDistance,
  formatRate,
  useUnits,
  setUnitPreference,
  type UnitPreference,
} from '../lib/units.ts';
import { getAccrualBalance, getTreasuryInfo } from '../lib/api.ts';
import { DEFAULT_ZAT_PER_KM } from '../lib/config.ts';
import { proofPageUrl } from '../lib/proof.ts';
import { onConnectedUAChange } from '../wallet/connectedWallet.ts';
import {
  onRideHistoryChange,
  getRides,
  getSummary,
  type RideRecord,
  type HistorySummary,
} from '../ride/rideHistory.ts';

/** ZEC string from a zatoshi number, trimmed to 8 dp without trailing zeros. */
function zecFromZat(zat: number): string {
  const s = (zat / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return s.length ? s : '0';
}

export function HomeScreen({ navigation }: { navigation: any }) {
  useUnits(); // re-render when the rider toggles mi/km
  const [zatPerKm, setZatPerKm] = useState<number>(DEFAULT_ZAT_PER_KM);
  const [lifetimeZat, setLifetimeZat] = useState<number | null>(null);
  const [ridesCount, setRidesCount] = useState<number>(0);
  const [companion, setCompanion] = useState(getCompanionPrefs());
  useEffect(() => onCompanionChange(setCompanion), []);
  const [summary, setSummary] = useState<HistorySummary>(getSummary());
  const [recent, setRecent] = useState<RideRecord[]>(getRides());

  // Live ride history (banked on-device): drives YTD + the recent list.
  useEffect(
    () =>
      onRideHistoryChange(() => {
        setSummary(getSummary());
        setRecent(getRides());
      }),
    [],
  );

  useEffect(() => {
    // Live reward rate from the treasury (falls back to the default).
    getTreasuryInfo()
      .then((info) => {
        if (info?.zat_per_km) setZatPerKm(info.zat_per_km);
      })
      .catch(() => {});

    // Lifetime rewards follow the rider's connected wallet — refetch
    // whenever they connect or change it.
    const off = onConnectedUAChange((ua) => {
      if (ua.startsWith('u1')) {
        getAccrualBalance(ua)
          .then((b) => {
            setLifetimeZat(b.lifetime_zatoshi);
            setRidesCount(b.rides_count);
          })
          .catch(() => {});
      } else {
        setLifetimeZat(null);
        setRidesCount(0);
      }
    });
    return off;
  }, []);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.brand}>Pedalshield</Text>
          <MainnetStatusChip />
        </View>
        <Text style={styles.tagline}>Ride private. Earn shielded.</Text>
      </View>

      <ConnectWalletCard />

      {/* Lifetime rewards — the headline number a rider keeps coming back for. */}
      <Card>
        <Text style={styles.cardLabel}>LIFETIME REWARDS</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.lifetimeValue}>
            {lifetimeZat === null ? '0' : zecFromZat(lifetimeZat)}
          </Text>
          <Text style={styles.balanceUnit}>ZEC</Text>
        </View>
        <Text style={styles.lifetimeMeta}>
          {lifetimeZat === null
            ? 'Connect your wallet above to start earning'
            : `Earned across ${ridesCount} ${ridesCount === 1 ? 'ride' : 'rides'}, all shielded`}
        </Text>
        <View style={styles.rateRow}>
          <Text style={styles.rateLabel}>EARN RATE</Text>
          <Text style={styles.rateValue}>{formatRate(zatPerKm)}</Text>
        </View>
      </Card>

      {/* The core loop: your bike is alive and miles are what it eats.
          Cyclists already name their bikes — this gives that attachment
          somewhere to live. One number, one picture, one thing to want. */}
      <CompanionCard records={recent} name={companion.name} />

      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Stat
            label="This year"
            value={formatDistance(summary.ytdKm)}
            unit={distanceUnit()}
          />
        </View>
        <View style={styles.statCol}>
          <Stat label="Rides this year" value={String(summary.ytdRides)} />
        </View>
      </View>

      <Card>
        <Text style={styles.cardLabel}>RECENT RIDES</Text>
        <RecentRides rides={recent} />
      </Card>

      <Card>
        <View style={styles.unitsRow}>
          <Text style={styles.cardLabel}>UNITS</Text>
          <UnitToggle />
        </View>
      </Card>

      <Card>
        <Text style={styles.cardLabel}>READY TO RIDE</Text>
        <Text style={styles.cta}>
          Tap the Ride tab below to start. Your route never leaves your phone.
        </Text>
      </Card>
    </ScreenContainer>
  );
}

/** Recent banked rides (newest first). Stats only — no route is stored. */
function RecentRides({ rides }: { rides: RideRecord[] }) {
  if (rides.length === 0) {
    return (
      <Text style={styles.emptyRides}>
        No rides yet. Tap the Ride tab to bank your first one.
      </Text>
    );
  }
  const shown = rides.slice(0, 5);
  return (
    <View>
      {shown.map((r) => {
        const date = new Date(r.completedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        const statusColor =
          r.status === 'verified'
            ? theme.color.success
            : r.status === 'review'
              ? theme.color.warning
              : theme.color.textMuted;
        return (
          <View key={r.id} style={styles.rideRow}>
            <View style={[styles.rideDot, { backgroundColor: statusColor }]} />
            <Text style={styles.rideDate}>{date}</Text>
            <Text style={styles.rideDist}>
              {formatDistance(r.distanceKm)} {distanceUnit()}
            </Text>
            {r.amountZat != null && r.amountZat > 0 ? (
              <Text style={styles.rideZec}>
                +{zecFromZat(r.amountZat)} ZEC
                {r.amountUsd != null && r.amountUsd > 0 ? (
                  <Text style={styles.rideUsd}>
                    {' '}
                    · {r.amountUsd < 0.005 ? '<$0.01' : `$${r.amountUsd.toFixed(2)}`}
                  </Text>
                ) : null}
              </Text>
            ) : null}
            {r.txid ? (
              <Pressable
                onPress={() => Linking.openURL(proofPageUrl(r.txid!))}
                hitSlop={6}
              >
                <Text style={styles.rideProof}>proof ›</Text>
              </Pressable>
            ) : (
              <Text style={styles.ridePending}>—</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Segmented mi / km / Auto control. Updates the whole app live. */
function UnitToggle() {
  const { pref } = useUnits();
  const options: { key: UnitPreference; label: string }[] = [
    { key: 'imperial', label: 'mi' },
    { key: 'metric', label: 'km' },
    { key: 'auto', label: 'Auto' },
  ];
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const active = pref === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => setUnitPreference(o.key)}
            style={[styles.segmentItem, active && styles.segmentItemActive]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: theme.space.xs },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  tagline: { color: theme.color.textDim, fontSize: 15 },
  unitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.color.bg,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: 3,
    gap: 2,
  },
  segmentItem: {
    paddingHorizontal: theme.space.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  segmentItemActive: { backgroundColor: theme.color.accent },
  segmentText: {
    color: theme.color.textDim,
    fontSize: 13,
    fontWeight: '700',
  },
  segmentTextActive: { color: '#0A0E1A' },
  emptyRides: { color: theme.color.textDim, fontSize: 14, lineHeight: 20 },
  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    paddingVertical: 8,
    borderBottomColor: theme.color.border,
    borderBottomWidth: 1,
  },
  rideDot: { width: 8, height: 8, borderRadius: 4 },
  rideDate: { color: theme.color.textDim, fontSize: 13, width: 54 },
  rideDist: {
    color: theme.color.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  rideProof: {
    color: theme.color.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  rideZec: {
    color: theme.color.success,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginRight: theme.space.sm,
  },
  rideUsd: {
    color: theme.color.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  ridePending: { color: theme.color.textMuted, fontSize: 13 },
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
  lifetimeValue: {
    color: theme.color.success,
    fontSize: theme.font.display.size,
    fontWeight: theme.font.display.weight,
    letterSpacing: theme.font.display.letterSpacing,
  },
  lifetimeMeta: { color: theme.color.textDim, fontSize: 13, marginTop: theme.space.sm },
  rateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.space.md,
    paddingTop: theme.space.md,
    borderTopColor: theme.color.border,
    borderTopWidth: 1,
  },
  rateLabel: {
    color: theme.color.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  rateValue: { color: theme.color.text, fontSize: 14, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: theme.space.lg },
  statCol: { flex: 1 },
  cta: { color: theme.color.text, fontSize: 15, lineHeight: 22 },
});
