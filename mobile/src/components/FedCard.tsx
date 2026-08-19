/**
 * The post-ride payoff: miles flowing into your bike, and one line from it.
 *
 * This is the two-second dopamine loop the whole app is built around. It sits
 * at the TOP of the ride-complete screen, above the payout and the verdict,
 * because the feeling is what brings someone back tomorrow and the zatoshi
 * never will.
 *
 * Renders nothing on a rejected ride — a rejection is not a feeding, and
 * dressing it up as one would be dishonest about what happened.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card.tsx';
import { BikeCreature } from './BikeCreature.tsx';
import { theme } from '../app/theme.ts';
import { stageFor } from '../prefs/companion.ts';
import { companionLine, characteriseRide } from '../ai/companionVoice.ts';
import { verifiedMiles } from '../ride/milestones.ts';
import type { RideRecord } from '../ride/rideHistory.ts';

const KM_PER_MILE = 1.609344;

export function FedCard({
  name,
  verifiedKm,
  elevationGainM,
  durationS,
  avgKmh,
  history,
  rejected,
}: {
  name: string;
  verifiedKm: number;
  elevationGainM: number;
  durationS: number;
  avgKmh: number;
  /** Banked rides BEFORE this one, for "days since" and the new total. */
  history: RideRecord[];
  rejected: boolean;
}) {
  if (rejected || !name || verifiedKm <= 0) return null;

  const fedMiles = verifiedKm / KM_PER_MILE;
  const totalBefore = verifiedMiles(history);
  const totalAfter = totalBefore + fedMiles;

  const before = stageFor(totalBefore);
  const after = stageFor(totalAfter);
  const grew = after.stage.miles > before.stage.miles;

  // Days since the previous ride, so the line can acknowledge a return.
  let latest = 0;
  for (const r of history) {
    if (r.status !== 'rejected' && r.completedAt > latest) latest = r.completedAt;
  }
  const daysSince = latest
    ? Math.max(0, Math.floor((Date.now() - latest) / 86400000))
    : null;

  const digest = {
    distanceKm: verifiedKm,
    durationS,
    elevationGainM,
    avgSpeedKmh: avgKmh,
    daysSinceLastRide: daysSince,
  };
  const line = companionLine(digest, {
    name,
    chain: 1,
    tires: 1,
    spirit: 1,
    streakDays: 0,
  });

  return (
    <Card accent>
      <Text style={styles.amount}>
        +{fedMiles < 10 ? fedMiles.toFixed(1) : Math.round(fedMiles)}
      </Text>
      <Text style={styles.unit}>MILES FED</Text>

      <View style={styles.art}>
        <BikeCreature detail={after.stage.detail} width={200} height={110} />
      </View>

      {grew ? (
        <View style={styles.grew}>
          <Text style={styles.grewText}>
            {name} grew — now {after.stage.label.toLowerCase()}
          </Text>
        </View>
      ) : null}

      <View style={styles.quote}>
        <Text style={styles.quoteText}>{line}</Text>
        <Text style={styles.quoteAttr}>— {name.toUpperCase()}</Text>
      </View>

      {after.next ? (
        <Text style={styles.next}>
          {Math.ceil(after.milesToNext).toLocaleString()} miles until {name}{' '}
          grows again
        </Text>
      ) : null}

      {/* Kept deliberately small. The character of the ride is public to the
          rider; the route is not public to anyone. */}
      <Text style={styles.note}>
        {characteriseRide(digest) === 'climb'
          ? 'Climbing feeds it more than flat miles.'
          : 'Verified on this phone. No map, no location.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  amount: {
    color: theme.color.accent,
    fontSize: 44,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 48,
  },
  unit: {
    color: theme.color.textDim,
    fontSize: 11,
    letterSpacing: 1.4,
    textAlign: 'center',
    marginTop: 2,
  },
  art: { alignItems: 'center', marginVertical: theme.space.md },
  grew: {
    backgroundColor: theme.color.bg,
    borderRadius: 10,
    paddingVertical: 9,
    marginBottom: theme.space.md,
  },
  grewText: {
    color: theme.color.accent,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  quote: {
    backgroundColor: theme.color.bg,
    borderRadius: 12,
    padding: theme.space.md,
  },
  quoteText: {
    color: theme.color.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  quoteAttr: {
    color: theme.color.textDim,
    fontSize: 10,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 8,
  },
  next: {
    color: theme.color.textDim,
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: theme.space.md,
  },
  note: {
    color: theme.color.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: theme.space.sm,
  },
});
