/**
 * GhostRideSheet — the pre-ride privacy ritual ("settings foundation").
 *
 * What good is a privacy app if Strava is streaming in the background?
 * iOS won't let us see or stop other apps (that same sandbox is our own
 * guarantee), so this sheet does the two things that ARE real:
 *
 *  1. A checklist ritual before the first ride (optionally every ride).
 *  2. GHOST MODE: Airplane Mode. GPS is a passive receiver — it works
 *     with every radio off. Pedalshield needs no network during a ride
 *     (verification is on-device; the claim submits at the end), so a
 *     ghost ride silences every app's live streaming at the RADIO level.
 *     No detection needed when nothing can transmit.
 *
 * Honest footnote shown to the rider: apps that record locally (Strava)
 * will still upload after landing — closing them first matters.
 */

import React, { useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Button } from './Button.tsx';
import { theme } from '../app/theme.ts';
import {
  getPrivateRidePrefs,
  setPrivateRidePrefs,
} from '../prefs/privateRide.ts';

interface Props {
  visible: boolean;
  /** Rider confirmed — start the ride. */
  onProceed: () => void;
  /** Dismissed without starting (back out). */
  onClose: () => void;
}

export function GhostRideSheet({ visible, onProceed, onClose }: Props) {
  const [everyRide, setEveryRide] = useState(
    getPrivateRidePrefs().showEveryRide,
  );

  const proceed = () => {
    void setPrivateRidePrefs({ acknowledged: true, showEveryRide: everyRide });
    onProceed();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>Ride like a ghost 🛡</Text>
            <Text style={styles.sub}>
              Pedalshield never transmits your route. But other apps on this
              phone might. Thirty seconds makes this ride actually private:
            </Text>

            <Step n="1" title="Close other tracking apps">
              Swipe up and flick away Strava, Maps, and anything with a
              location arrow. Apps record locally even offline — closed apps
              record nothing.
            </Step>
            <Step n="2" title="Ghost Mode: turn on Airplane Mode" accent>
              GPS still works — it only listens. With every radio off,
              NOTHING on this phone can stream your location while you ride.
              Reconnect when you're done to claim your ZEC.
            </Step>
            <Step n="3" title="Once: audit Location Services">
              Settings → Privacy &amp; Security → Location Services.
              Downgrade every app you don&apos;t fully trust to &quot;While
              Using&quot; or &quot;Never&quot;.
            </Step>

            <Pressable
              onPress={() => void Linking.openURL('app-settings:')}
              hitSlop={6}
            >
              <Text style={styles.link}>Open iOS Settings ›</Text>
            </Pressable>

            <Text style={styles.honest}>
              Straight talk: iOS forbids any app from seeing or stopping
              another app — that same wall is why nothing can reach your ride
              data here. This checklist is yours to run. The ghost is real.
            </Text>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Show before every ride</Text>
              <Switch
                value={everyRide}
                onValueChange={setEveryRide}
                trackColor={{
                  false: theme.color.border,
                  true: theme.color.accentSoft,
                }}
                thumbColor={
                  everyRide ? theme.color.accent : theme.color.textMuted
                }
                ios_backgroundColor={theme.color.border}
              />
            </View>

            <Button label="I'm a ghost — start the ride" size="lg" onPress={proceed} />
            <Pressable onPress={onClose} hitSlop={8} style={styles.cancel}>
              <Text style={styles.cancelText}>Not yet</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Step({
  n,
  title,
  accent,
  children,
}: {
  n: string;
  title: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.step, accent && styles.stepAccent]}>
      <Text style={[styles.stepN, accent && { color: theme.color.success }]}>
        {n}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.color.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.color.bgElev,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.space.xl,
    maxHeight: '88%',
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    marginBottom: theme.space.sm,
  },
  sub: {
    color: theme.color.textDim,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: theme.space.lg,
  },
  step: {
    flexDirection: 'row',
    gap: theme.space.md,
    backgroundColor: theme.color.bgCard,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    marginBottom: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  stepAccent: { borderColor: theme.color.success },
  stepN: {
    color: theme.color.accent,
    fontWeight: '800',
    fontSize: 18,
    width: 20,
  },
  stepTitle: {
    color: theme.color.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  stepBody: { color: theme.color.textDim, fontSize: 13, lineHeight: 19 },
  link: {
    color: theme.color.accentSoft,
    fontWeight: '700',
    fontSize: 14,
    marginVertical: theme.space.md,
  },
  honest: {
    color: theme.color.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: theme.space.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space.lg,
  },
  toggleLabel: { color: theme.color.text, fontSize: 14, fontWeight: '600' },
  cancel: { alignItems: 'center', paddingVertical: theme.space.md },
  cancelText: { color: theme.color.textDim, fontSize: 14, fontWeight: '600' },
});
