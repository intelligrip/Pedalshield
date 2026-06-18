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
import { submitClaim, pollClaim, getAccrualBalance, AccrualBalance } from '../lib/api.ts';
import {
  BACKEND_URL,
  EXPLORER_TX_BASE,
  getRecipientUA,
  setRecipientUA,
} from '../lib/config.ts';

type Phase = 'idle' | 'submitting' | 'polling' | 'paid' | 'accrued' | 'error';

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
  const [accruedBalance, setAccruedBalance] = useState<AccrualBalance | null>(null);

  const busy = phase === 'submitting' || phase === 'polling';

  async function onWithdraw() {
    const recip = ua.trim();
    if (!recip.startsWith('u1')) return;
    setPhase('submitting');
    setMessage('Settling your accrued balance on-chain...');
    try {
      // POST /withdraw/:ua reuses the settlement path (real Orchard spend)
      const res = await fetch(`${BACKEND_URL}/withdraw/${encodeURIComponent(recip)}`, {
        method: 'POST',
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const data = JSON.parse(text) as { txid?: string; status?: string };
      if (data.txid) {
        setTxid(data.txid);
        setPhase('paid');
        setAccruedBalance(null);
        setMessage('');
      } else {
        setPhase('accrued');
        setMessage('Withdraw accepted; check status shortly.');
      }
    } catch (e) {
      setPhase('accrued');
      setMessage('Withdraw failed: ' + String((e as Error)?.message ?? e));
    }
  }

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
      const ack = await submitClaim({
        claim_id: rideId,
        recipient_ua: recip,
        distance_meters: Math.max(1, Math.round(distanceM)),
        signature: 'demo-sig',
      });
      if (ack.status === 'accrued') {
        // Accrual mode: no per-ride on-chain payout. Show balance + option to force settle.
        const bal = await getAccrualBalance(recip);
        setAccruedBalance(bal);
        setPhase('accrued');
        setMessage('');
        return;
      }
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
      ) : phase === 'accrued' ? (
        <>
          <Text style={styles.paidLine}>
            ✓ Ride accrued. No on-chain spend this ride — your earnings
            accumulate off-chain (treasury fee ~0.5% at the 0.01 ZEC floor).
          </Text>
          {accruedBalance ? (
            <View style={styles.balanceBox}>
              <View style={styles.balanceCol}>
                <Text style={styles.balanceColLabel}>PENDING</Text>
                <Text style={styles.balanceColValue} selectable>
                  {(accruedBalance.pending_zatoshi / 1e8).toFixed(6)}
                </Text>
                <Text style={styles.balanceColUnit}>ZEC to settle</Text>
              </View>
              <View style={styles.balanceDivider} />
              <View style={styles.balanceCol}>
                <Text style={styles.balanceColLabel}>LIFETIME EARNED</Text>
                <Text
                  style={[styles.balanceColValue, { color: theme.color.success }]}
                  selectable
                >
                  {(accruedBalance.lifetime_zatoshi / 1e8).toFixed(6)}
                </Text>
                <Text style={styles.balanceColUnit}>
                  ZEC · {accruedBalance.rides_count}{' '}
                  {accruedBalance.rides_count === 1 ? 'ride' : 'rides'}
                </Text>
              </View>
            </View>
          ) : null}
          <Text style={styles.help}>
            Settlements happen automatically in batches once balances cross
            the floor, or tap below to settle this UA now (forces a real
            shielded payout).
          </Text>
          <Button
            label="Settle / withdraw now (real payout)"
            size="lg"
            onPress={onWithdraw}
            disabled={phase === 'submitting'}
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
  balanceBox: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(10,14,26,0.5)',
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    marginBottom: theme.space.md,
  },
  balanceCol: { flex: 1, gap: 2 },
  balanceColLabel: {
    color: theme.color.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  balanceColValue: {
    color: theme.color.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  balanceColUnit: { color: theme.color.textDim, fontSize: 11, fontWeight: '600' },
  balanceDivider: {
    width: 1,
    backgroundColor: theme.color.border,
    marginHorizontal: theme.space.md,
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
