import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from '../components/Card.tsx';
import { MapPacksCard } from '../components/MapPacksCard.tsx';
import { PrivacyCheckupCard } from '../components/PrivacyCheckupCard.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { theme } from '../app/theme.ts';
import { getConnectedUA, onConnectedUAChange } from '../wallet/connectedWallet.ts';
import {
  getDataCoopPrefs,
  onDataCoopChange,
  setCoopLevel,
  setSocialSharing,
  type CoopLevel,
} from '../prefs/dataCoop.ts';
import { shortAddress } from '../lib/format.ts';
import {
  attestationDiagnostics,
  type AttestDiagnostics,
} from '../wallet/appAttest.ts';

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

/**
 * The three commercial sharing levels, in the rider's words.
 *
 * Each one states what actually leaves the phone. No level is presented as
 * the "recommended" or "generous" choice: the moment an interface nudges
 * toward sharing, consent stops being consent.
 */
const COOP_LEVELS: { level: CoopLevel; title: string; body: string }[] = [
  {
    level: 0,
    title: 'Shielded',
    body: 'Nothing but a signed verdict — how far you rode and that it was real. No route, no times, no patterns. This is the default.',
  },
  {
    level: 1,
    title: 'Aggregate',
    body: 'Adds coarse signals: a distance band, the hour of day, a CO₂ estimate, your region. Still no route, and nothing that can be traced back to you.',
  },
  {
    level: 2,
    title: 'Route',
    body: 'Adds the shape of your ride, so planners can see where bike lanes are actually needed. The start and end are always removed first.',
  },
];

export function PrivacyDashboardScreen() {
  // Non-custodial: this is the rider's OWN connected Unified Address, not a
  // wallet we hold. Updates live when they connect/change it.
  const [address, setAddress] = useState<string>(getConnectedUA());
  useEffect(() => onConnectedUAChange(setAddress), []);
  const connected = address.startsWith('u1');

  // Data co-op: tiered, private by default. `level` governs COMMERCIAL
  // sharing; `social` is a separate, unpaid consent for rider-to-rider
  // visibility. Deliberately not one switch — see prefs/dataCoop.ts.
  const [prefs, setPrefs] = useState(getDataCoopPrefs());
  useEffect(() => onDataCoopChange(setPrefs), []);
  const level = prefs.level;
  const social = prefs.socialSharing;
  const consentedAt = prefs.consentedAt;

  // Hardware attestation state. Shown because "is this device attested?" is
  // a privacy-relevant fact the rider is entitled to see — and because every
  // failure path in appAttest returns silently, which is right for riders and
  // useless for working out why nothing is happening.
  const [attest, setAttest] = useState<AttestDiagnostics | null>(null);
  useEffect(() => {
    let alive = true;
    void attestationDiagnostics().then((d) => alive && setAttest(d));
    return () => {
      alive = false;
    };
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

      <Card>
        <Text style={styles.sectionLabel}>HARDWARE ATTESTATION</Text>
        <Text style={styles.attestBody}>
          {attest?.registered
            ? 'This device has proved to Apple that it is running a genuine, unmodified Pedalshield build. Nothing about you is revealed by it.'
            : attest?.isSupported === false
              ? 'This iPhone does not support App Attest. That is normal on older hardware and does not affect your earnings.'
              : 'Not yet attested. Attestation is optional and never blocks a ride.'}
        </Text>
        {attest ? (
          <Text style={styles.attestDebug} selectable>
            {[
              `stage: ${attest.stage}`,
              `module: ${attest.moduleLoaded ? 'loaded' : 'missing'}`,
              `supported: ${attest.isSupported === null ? 'unknown' : attest.isSupported}`,
              `key: ${attest.hasKeyId ? 'yes' : 'no'}`,
              attest.detail ? `detail: ${attest.detail}` : null,
            ]
              .filter(Boolean)
              .join('\n')}
          </Text>
        ) : null}
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

      <Card accent>
        <Text style={styles.sectionLabel}>DATA CO-OP · WHAT YOU SHARE</Text>
        <Text style={styles.note}>
          Three choices, not one switch. Shielded is the default and always
          will be. You can change or revoke this at any time.
        </Text>

        {COOP_LEVELS.map((opt) => {
          const active = level === opt.level;
          return (
            <Pressable
              key={opt.level}
              onPress={() => void setCoopLevel(opt.level)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={[styles.levelRow, active && styles.levelRowActive]}
            >
              <View style={[styles.radio, active && styles.radioOn]}>
                {active ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.levelText}>
                <Text style={styles.levelTitle}>{opt.title}</Text>
                <Text style={styles.levelBody}>{opt.body}</Text>
              </View>
            </Pressable>
          );
        })}

        {level >= 2 ? (
          <Text style={styles.coopMeta}>
            The first and last {'≈'}250 m of every ride are always removed
            before a route is shared. That protection has no off switch —
            it&apos;s where you live and work, not where you rode.
          </Text>
        ) : null}

        {/* The pool. An honest zero beats a promise we can't pay. */}
        <View style={styles.pool}>
          <Text style={styles.poolLabel}>CO-OP POOL</Text>
          <Text style={styles.poolBody}>
            The co-op pays out a share of what your data is licensed for, split
            by contributed miles. Nothing has been licensed yet, so the pool is
            $0 today. When that changes, you&apos;ll see what it sold for and
            what your share was.
          </Text>
        </View>

        {consentedAt > 0 ? (
          <Text style={styles.coopMeta}>
            Chosen {new Date(consentedAt).toLocaleDateString()} · revoke any
            time, and nothing further is shared.
          </Text>
        ) : null}
      </Card>

      <Card>
        <View style={styles.coopHeader}>
          <View style={styles.coopHeaderText}>
            <Text style={styles.sectionLabel}>VISIBLE TO OTHER RIDERS</Text>
            <Text style={styles.coopState}>
              {social ? 'On — leaderboard and shared cards' : 'Off — invisible'}
            </Text>
          </View>
          <Switch
            value={social}
            onValueChange={(v: boolean) => void setSocialSharing(v)}
            trackColor={{ false: theme.color.border, true: theme.color.accentSoft }}
            thumbColor={social ? theme.color.accent : theme.color.textMuted}
            ios_backgroundColor={theme.color.border}
          />
        </View>
        <Text style={styles.note}>
          Separate from the co-op, and deliberately unpaid — being visible to
          other riders is a feature, never something we buy from you. Turning
          this on shares nothing with anyone outside Pedalshield.
        </Text>
      </Card>

      <PrivacyCheckupCard />

      <MapPacksCard />

      <Card>
        <Text style={styles.sectionLabel}>YOUR CONNECTED WALLET</Text>
        <Text style={styles.address}>
          {connected ? shortAddress(address, 12, 8) : 'No wallet connected yet'}
        </Text>
        <Text style={styles.note}>
          {connected
            ? 'Your own Zcash Unified Address. Payouts arrive here as shielded transactions — amounts and recipients are private on-chain. We never hold your keys or your funds.'
            : 'Connect a Zcash wallet you control on the Home tab to receive shielded payouts. Pedalshield is non-custodial — your keys and ZEC stay in your wallet.'}
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>YOU CAN PROVE IT</Text>
        <Text style={styles.note}>
          The claim payload definition and the privacy assertion are open source
          under MIT — anyone can verify that no GPS, motion, barometer, or
          pedometer data can leave your device. (The anti-cheat scoring engine
          itself is proprietary, so it can't be gamed — but what it's allowed to
          send is fully open.) And because Pedalshield is non-custodial, your ZEC
          lives in your own wallet — there's no balance for us to control or
          freeze.
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
  attestBody: {
    color: theme.color.text,
    fontSize: 14,
    lineHeight: 20,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: theme.space.md,
    paddingHorizontal: theme.space.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.color.border,
    marginTop: theme.space.md,
  },
  levelRowActive: {
    borderColor: theme.color.accent,
    backgroundColor: theme.color.bgElev,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.color.textMuted,
    marginRight: theme.space.md,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: theme.color.accent },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.color.accent,
  },
  levelText: { flex: 1 },
  levelTitle: {
    color: theme.color.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  levelBody: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  pool: {
    marginTop: theme.space.lg,
    padding: theme.space.md,
    borderRadius: 12,
    backgroundColor: theme.color.bg,
  },
  poolLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  poolBody: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  attestDebug: {
    color: theme.color.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: theme.space.md,
    fontFamily: 'Menlo',
  },
  sectionLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.md,
  },
  coopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space.md,
  },
  coopHeaderText: { flex: 1 },
  coopState: { color: theme.color.text, fontSize: 15, fontWeight: '700' },
  coopMeta: {
    color: theme.color.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: theme.space.sm,
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
