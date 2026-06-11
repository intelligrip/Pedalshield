import React, { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { ShareCard } from './ShareCard.tsx';
import { theme } from '../app/theme.ts';
import { submitClaim, pollClaim } from '../lib/api.ts';
import {
  EXPLORER_TX_BASE,
  getRecipientUA,
  setRecipientUA,
} from '../lib/config.ts';

type Phase = 'idle' | 'submitting' | 'polling' | 'paid' | 'error';

const PIPELINE = [
  'Claim sent — route stayed on your phone',
  'Treasury scanning shielded notes',
  'Building + proving the Orchard transaction',
  'Broadcast to Zcash mainnet',
] as const;

/**
 * Vertical pipeline tracker for the autonomous payout. The treasury
 * doing real cryptography in real time is the product's best moment -
 * show each stage instead of a single spinner.
 */
function Pipeline({ active, done }: { active: number; done: boolean }) {
  return (
    <View style={styles.pipeline}>
      {PIPELINE.map((label, i) => {
        const state =
          done || i < active ? 'done' : i === active ? 'active' : 'todo';
        const color =
          state === 'done'
            ? theme.color.success
            : state === 'active'
              ? theme.color.accent
              : theme.color.textMuted;
        return (
          <View key={label} style={styles.pipelineRow}>
            <View style={styles.pipelineRail}>
              <View
                style={[
                  styles.pipelineDot,
                  { borderColor: color },
                  state === 'done' && { backgroundColor: color },
                ]}
              >
                {state === 'active' ? (
                  <ActivityIndicator size="small" color={color} />
                ) : null}
              </View>
              {i < PIPELINE.length - 1 ? (
                <View
                  style={[
                    styles.pipelineLine,
                    (done || i < active) && {
                      backgroundColor: theme.color.success,
                    },
                  ]}
                />
              ) : null}
            </View>
            <Text
              style={[
                styles.pipelineLabel,
                { color: state === 'todo' ? theme.color.textMuted : theme.color.text },
                state === 'active' && { fontWeight: '700' },
              ]}
            >
              {state === 'done' ? '✓ ' : ''}
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Real autonomous-payout card. Submits the completed ride as a claim to
 * the Pedalshield backend, which builds + proves + signs + broadcasts a
 * shielded Orchard payout with no operator, then polls for the on-chain
 * txid and shows it. Replaces the old simulated "FROST queued" copy.
 */
export function PayoutCard({
  rideId,
  distanceM,
  integrityScore = 0,
}: {
  rideId: string;
  distanceM: number;
  integrityScore?: number;
}) {
  const [ua, setUa] = useState(getRecipientUA());
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [txid, setTxid] = useState<string | null>(null);
  const [stage, setStage] = useState(0);

  const busy = phase === 'submitting' || phase === 'polling';

  async function onClaim() {
    const recip = ua.trim();
    if (!recip.startsWith('u1') || recip.length < 80) {
      setPhase('error');
      setMessage('Paste a valid Zashi Unified Address (starts with u1).');
      return;
    }
    setRecipientUA(recip);
    setTxid(null);
    setStage(0);
    setPhase('submitting');
    setMessage('');
    try {
      await submitClaim({
        claim_id: rideId,
        recipient_ua: recip,
        distance_meters: Math.max(1, Math.round(distanceM)),
        signature: 'demo-sig',
      });
      setPhase('polling');
      setStage(1);
      const row = await pollClaim(rideId, {
        onUpdate: (r) => {
          if (r.status === 'paying') setStage(2);
        },
      });
      if (row.status === 'paid' && row.payout_txid) {
        setStage(3);
        setTxid(row.payout_txid);
        setPhase('paid');
        setMessage('');
      } else if (row.status === 'rejected') {
        setPhase('error');
        setMessage(row.rejection_reason ?? 'Payout rejected.');
      } else {
        setPhase('polling');
        setMessage('Still settling on chain — check back shortly.');
      }
    } catch (e) {
      setPhase('error');
      setMessage(String((e as Error)?.message ?? e));
    }
  }

  return (
    <Card>
      <Text style={styles.label}>SHIELDED PAYOUT</Text>

      {phase === 'paid' && txid ? (
        <>
          <Pipeline active={3} done />
          <Text style={styles.paidLine}>
            ✓ Shielded ZEC is on its way to your wallet. No operator
            touched it.
          </Text>
          <Text style={styles.txidLabel}>Transaction</Text>
          <Text style={styles.txid} selectable>
            {txid}
          </Text>
          <Pressable
            style={styles.linkRow}
            onPress={() => void Linking.openURL(EXPLORER_TX_BASE + txid)}
          >
            <Text style={styles.linkText}>View on explorer ›</Text>
          </Pressable>
          <ShareCard
            distanceM={distanceM}
            integrityScore={integrityScore}
            txid={txid}
          />
        </>
      ) : busy ? (
        <Pipeline active={stage} done={false} />
      ) : (
        <>
          <Text style={styles.help}>
            Paste your Zashi Unified Address. The treasury builds and
            broadcasts a real Orchard transaction automatically — no
            operator, route stays on device.
          </Text>
          <TextInput
            style={styles.input}
            value={ua}
            onChangeText={setUa}
            placeholder="u1…"
            placeholderTextColor={theme.color.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            editable={!busy}
          />
          <Button
            label="Claim shielded payout"
            size="lg"
            onPress={onClaim}
            disabled={busy}
          />
          {message ? (
            <View style={styles.statusRow}>
              <Text
                style={[
                  styles.status,
                  phase === 'error' && { color: theme.color.danger },
                ]}
              >
                {message}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  label: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  help: { color: theme.color.textDim, fontSize: 13, lineHeight: 19, marginBottom: theme.space.md },
  input: {
    color: theme.color.text,
    backgroundColor: 'rgba(10,14,26,0.6)',
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    fontSize: 12,
    minHeight: 64,
    marginBottom: theme.space.md,
    fontVariant: ['tabular-nums'],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.space.md,
  },
  status: { color: theme.color.text, fontSize: 13, flexShrink: 1, lineHeight: 18 },
  paidLine: {
    color: theme.color.success,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: theme.space.md,
  },
  txidLabel: {
    color: theme.color.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  txid: {
    color: theme.color.text,
    fontSize: 12,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  linkRow: { marginTop: theme.space.md },
  linkText: { color: theme.color.accent, fontSize: 13, fontWeight: '700' },
  pipeline: { marginTop: theme.space.xs, marginBottom: theme.space.md },
  pipelineRow: { flexDirection: 'row', alignItems: 'flex-start' },
  pipelineRail: { alignItems: 'center', width: 28 },
  pipelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipelineLine: {
    width: 2,
    height: 22,
    backgroundColor: theme.color.border,
    marginVertical: 2,
  },
  pipelineLabel: {
    fontSize: 13,
    lineHeight: 18,
    marginLeft: theme.space.sm,
    marginTop: 2,
    flexShrink: 1,
  },
});
