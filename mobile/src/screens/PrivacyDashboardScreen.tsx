import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from '../components/Card.tsx';
import { MapPacksCard } from '../components/MapPacksCard.tsx';
import { PrivacyCheckupCard } from '../components/PrivacyCheckupCard.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { theme } from '../app/theme.ts';
import { getConnectedUA, onConnectedUAChange } from '../wallet/connectedWallet.ts';
import {
  getDataCoopPrefs,
  isDataCoopOptedIn,
  onDataCoopChange,
  setDataCoopOptIn,
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

export function PrivacyDashboardScreen() {
  // Non-custodial: this is the rider's OWN connected Unified Address, not a
  // wallet we hold. Updates live when they connect/change it.
  const [address, setAddress] = useState<string>(getConnectedUA());
  useEffect(() => onConnectedUAChange(setAddress), []);
  const connected = address.startsWith('u1');

  // Data co-op: OFF by default. Reflects the persisted, versioned consent.
  const [coopOptedIn, setCoopOptedIn] = useState<boolean>(isDataCoopOptedIn());
  useEffect(
    () => onDataCoopChange((p) => setCoopOptedIn(p.optedIn)),
    [],
  );
  const consentedAt = getDataCoopPrefs().consentedAt;

  const toggleCoop = (next: boolean) => {
    // Optimistic: the store emits and re-syncs us via the subscription above.
    setCoopOptedIn(next);
    void setDataCoopOptIn(next);
  };

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
        <View style={styles.coopHeader}>
          <View style={styles.coopHeaderText}>
            <Text style={styles.sectionLabel}>DATA CO-OP · OPT-IN</Text>
            <Text style={styles.coopState}>
              {coopOptedIn ? 'On — you’re contributing' : 'Off — fully private'}
            </Text>
          </View>
          <Switch
            value={coopOptedIn}
            onValueChange={toggleCoop}
            trackColor={{ false: theme.color.border, true: theme.color.accentSoft }}
            thumbColor={coopOptedIn ? theme.color.accent : theme.color.textMuted}
            ios_backgroundColor={theme.color.border}
          />
        </View>
        <Text style={styles.note}>
          Off by default. Turn this on to earn extra ZEC by contributing to the
          rider data co-op. Even when it’s on, your raw route never leaves your
          phone — only privacy-protected, aggregated signals do, and they can’t
          be traced back to you. Turn it off any time; nothing further is shared.
        </Text>
        {coopOptedIn && consentedAt > 0 ? (
          <Text style={styles.coopMeta}>
            Opted in {new Date(consentedAt).toLocaleDateString()} · you own this
            choice and can revoke it instantly.
          </Text>
        ) : null}
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
