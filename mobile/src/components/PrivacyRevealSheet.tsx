/**
 * PrivacyRevealSheet - the gut-punch comparison.
 *
 * Bottom-sheet modal triggered by tapping the padlock chip on the ride
 * screen. Shows two JSON blobs side by side: what a Strava-style upload
 * looks like for the just-completed ride, vs. what Pedalshield actually
 * sends. The contrast is the point - judges should see in a single
 * glance why "privacy-first" isn't marketing.
 *
 * The Pedalshield payload here is exactly what `claim.ts` produces - if
 * the claim shape changes, this preview should change with it.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '../app/theme.ts';

interface Props {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  distanceM: number;
}

function buildStravaLikePayload(rideId: string): string {
  return `{
  "ride_id": "${rideId}",
  "user_id": "user_1438205",
  "device": {
    "model": "iPhone15,3",
    "os": "iOS 17.2.1",
    "vendor_id": "A2848-EC11..."
  },
  "polyline_encoded":
    "u{~vFvyys@fS]anG~[gG^cMxAaJlAyGfDoFnE...",  // every GPS coord
  "photos": ["s3://strava/2026/05/28/..."],
  "weather": { "temp_c": 19, "wind_kph": 8 },
  "segments_matched": [4218, 9105, 12734],
  "start_time": "2026-05-28T14:32:07-04:00",
  "timezone": "America/New_York",
  "start_lat": 40.6712,
  "start_lon": -73.9706,
  "end_lat": 40.6724,
  "end_lon": -73.9701,
  "elev_high_m": 28.4,
  "elev_low_m": 12.1,
  "average_heartrate_bpm": 142,
  "achievements_unlocked": ["pr_5km", "club_weekly"]
}`;
}

function buildPedalshieldPayload(rideId: string, distM: number): string {
  return `{
  "claim_id":         "${rideId}",
  "distance_meters":  ${distM},
  "claim_signature":  "0x7a3e8c2f...a01b"
}`;
}

const STRAVA_BYTES = 1432;
const PEDALSHIELD_BYTES_BASE = 168;

export function PrivacyRevealSheet({
  visible,
  onClose,
  rideId,
  distanceM,
}: Props) {
  const stravaPayload = buildStravaLikePayload(rideId || '01HXDEMO0RIDE0001');
  const pedalshieldPayload = buildPedalshieldPayload(
    rideId || '01HXDEMO0RIDE0001',
    Math.max(0, Math.round(distanceM)),
  );
  const psBytes = PEDALSHIELD_BYTES_BASE + (rideId?.length ?? 0);
  const ratio = (STRAVA_BYTES / psBytes).toFixed(1);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e: any) => e?.stopPropagation?.()}>
          <View style={styles.handle} />
          <Text style={styles.title}>The privacy proof</Text>
          <Text style={styles.subtitle}>
            What an app like Strava would upload for this ride, vs. what
            Pedalshield actually sends to claim your shielded ZEC.
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text
                  style={[styles.sectionLabel, { color: theme.color.danger }]}
                >
                  ✗ STRAVA-STYLE UPLOAD
                </Text>
                <Text style={[styles.bytes, { color: theme.color.danger }]}>
                  ~{STRAVA_BYTES} bytes
                </Text>
              </View>
              <View
                style={[styles.codeBlock, { borderColor: theme.color.danger }]}
              >
                <Text style={[styles.code, { color: theme.color.danger }]}>
                  {stravaPayload}
                </Text>
              </View>
              <Text style={styles.leaks}>
                Leaks: route, location, device id, photos, time of day,
                heart rate, real identity link.
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text
                  style={[styles.sectionLabel, { color: theme.color.success }]}
                >
                  ✓ PEDALSHIELD UPLOAD
                </Text>
                <Text style={[styles.bytes, { color: theme.color.success }]}>
                  {psBytes} bytes
                </Text>
              </View>
              <View
                style={[styles.codeBlock, { borderColor: theme.color.success }]}
              >
                <Text style={[styles.code, { color: theme.color.success }]}>
                  {pedalshieldPayload}
                </Text>
              </View>
              <Text style={styles.leaks}>
                Carries: an opaque claim id, distance, and a signature.
                Enough for the FROST treasury to verify and pay.
              </Text>
            </View>

            <View style={styles.tldr}>
              <Text style={styles.tldrText}>
                Pedalshield sends{' '}
                <Text style={styles.tldrEm}>{ratio}× less data</Text> than a
                Strava-style upload, and{' '}
                <Text style={styles.tldrEm}>none of it can locate you</Text>.
              </Text>
            </View>
          </ScrollView>

          <Pressable style={styles.closeBtn} onPress={onClose}>
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
    maxHeight: '88%',
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
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  subtitle: {
    color: theme.color.textDim,
    fontSize: 14,
    lineHeight: 20,
    marginTop: theme.space.sm,
    marginBottom: theme.space.lg,
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: theme.space.lg },
  section: { marginBottom: theme.space.md },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: theme.space.sm,
  },
  sectionLabel: {
    fontSize: theme.font.label.size,
    fontWeight: '800',
    letterSpacing: theme.font.label.letterSpacing,
  },
  bytes: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  codeBlock: {
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.space.md,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 11.5,
    lineHeight: 16,
  },
  leaks: {
    color: theme.color.textDim,
    fontSize: 12,
    marginTop: theme.space.sm,
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: theme.color.border,
    marginVertical: theme.space.lg,
  },
  tldr: {
    marginTop: theme.space.md,
    padding: theme.space.lg,
    backgroundColor: theme.color.bgCard,
    borderRadius: theme.radius.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.accent,
  },
  tldrText: { color: theme.color.text, fontSize: 14, lineHeight: 22 },
  tldrEm: { color: theme.color.accent, fontWeight: '800' },
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
