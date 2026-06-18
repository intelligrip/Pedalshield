import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Card } from './Card.tsx';
import { Button } from './Button.tsx';
import { theme } from '../app/theme.ts';
import { shortAddress } from '../lib/format.ts';
import {
  clearConnectedUA,
  getConnectedUA,
  onConnectedUAChange,
  setConnectedUA,
  validateZcashUA,
} from '../wallet/connectedWallet.ts';

/**
 * Connect-your-wallet card — the non-custodial heart of Pedalshield.
 *
 * The rider brings a Zcash wallet they already control (Zashi, Zodl, ...)
 * and pastes its Unified Address. Verified rides pay real shielded ZEC
 * straight there; Pedalshield never holds the rider's keys. This replaces
 * the old mock vault address.
 */
export function ConnectWalletCard() {
  const [connected, setConnected] = useState<string>(getConnectedUA());
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => onConnectedUAChange(setConnected), []);

  const draftValid = validateZcashUA(draft).ok;

  function startEditing() {
    setDraft(connected);
    setError('');
    setEditing(true);
  }

  async function onSave() {
    const check = validateZcashUA(draft);
    if (!check.ok) {
      setError(check.reason ?? 'Invalid Zcash Unified Address.');
      return;
    }
    setSaving(true);
    try {
      await setConnectedUA(draft);
      setEditing(false);
      setError('');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function onDisconnect() {
    await clearConnectedUA();
    setEditing(false);
    setDraft('');
    setError('');
  }

  // ---- Connected, not editing: show the address the rider owns ----------
  if (connected.startsWith('u1') && !editing) {
    return (
      <Card accent>
        <View style={styles.headerRow}>
          <Text style={styles.label}>YOUR ZCASH WALLET</Text>
          <View style={styles.connectedPill}>
            <View style={styles.dot} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        </View>

        <Text style={styles.address}>{shortAddress(connected, 12, 8)}</Text>
        <Text style={styles.subtle}>
          Rewards land here, shielded. Pedalshield never holds your keys.
        </Text>

        <View style={styles.actionsRow}>
          <Pressable onPress={startEditing} hitSlop={8}>
            <Text style={styles.linkAction}>Change</Text>
          </Pressable>
          <Text style={styles.actionDivider}>·</Text>
          <Pressable onPress={onDisconnect} hitSlop={8}>
            <Text style={[styles.linkAction, styles.danger]}>Disconnect</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  // ---- Not connected (or editing): the connect form ---------------------
  return (
    <Card accent>
      <Text style={styles.label}>
        {connected.startsWith('u1') ? 'CHANGE YOUR WALLET' : 'CONNECT YOUR ZCASH WALLET'}
      </Text>
      <Text style={styles.subtle}>
        Paste your wallet’s Unified Address. Verified rides pay real shielded
        ZEC straight to it — your route stays on your phone, your keys stay in
        your wallet.
      </Text>

      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={draft}
        onChangeText={(t: string) => {
          setDraft(t);
          if (error) setError('');
        }}
        placeholder="u1..."
        placeholderTextColor={theme.color.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        textAlignVertical="top"
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.formActions}>
        <Button
          label={saving ? 'Saving…' : 'Connect wallet'}
          onPress={onSave}
          disabled={saving || !draftValid}
        />
        {connected.startsWith('u1') ? (
          <Pressable onPress={() => setEditing(false)} hitSlop={8} style={styles.cancel}>
            <Text style={styles.linkAction}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={() => Linking.openURL('https://electriccoin.co/zashi/')}
        hitSlop={8}
      >
        <Text style={styles.helpLink}>
          No shielded wallet yet? Get a free one in Zashi →
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
  },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.success,
  },
  connectedText: {
    color: theme.color.success,
    fontSize: 12,
    fontWeight: '600',
  },
  address: {
    color: theme.color.text,
    fontSize: theme.font.mono.size,
    fontWeight: theme.font.mono.weight,
    marginTop: theme.space.md,
    letterSpacing: 0.3,
  },
  subtle: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: theme.space.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
    marginTop: theme.space.lg,
  },
  actionDivider: {
    color: theme.color.textMuted,
  },
  linkAction: {
    color: theme.color.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  danger: {
    color: theme.color.danger,
  },
  input: {
    marginTop: theme.space.md,
    minHeight: 72,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    color: theme.color.text,
    fontSize: theme.font.mono.size,
    backgroundColor: theme.color.bg,
  },
  inputError: {
    borderColor: theme.color.danger,
  },
  errorText: {
    color: theme.color.danger,
    fontSize: 13,
    marginTop: theme.space.sm,
  },
  formActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.space.md,
  },
  cancel: {
    paddingVertical: theme.space.sm,
  },
  helpLink: {
    color: theme.color.accentSoft,
    fontSize: 13,
    fontWeight: '600',
    marginTop: theme.space.lg,
  },
});
