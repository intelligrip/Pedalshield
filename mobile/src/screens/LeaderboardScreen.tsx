import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { theme } from '../app/theme.ts';
import {
  getLeaderboard,
  setHandle,
  type LeaderboardEntry,
} from '../lib/api.ts';
import { getRecipientUA } from '../lib/config.ts';

type Window = 'all' | 'week';

/** ZEC string from zatoshi, trimmed to 6 dp without trailing zeros. */
function zec(zatoshi: number): string {
  const s = (zatoshi / 1e8).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s.length ? s : '0';
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function LeaderboardScreen() {
  const [window, setWindow] = useState<Window>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const myUa = getRecipientUA();
  const myShort =
    myUa.length > 14 ? `${myUa.slice(0, 8)}…${myUa.slice(-4)}` : myUa;

  const load = useCallback(async (w: Window) => {
    setLoading(true);
    setError(null);
    try {
      const board = await getLeaderboard(w, 50);
      setEntries(board.entries);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(window);
  }, [window, load]);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.subtitle}>
          Top riders earning shielded ZEC. Pseudonymous by design — pick a
          handle, never your address.
        </Text>
      </View>

      <View style={styles.tabs}>
        <Tab
          label="All-time"
          active={window === 'all'}
          onPress={() => setWindow('all')}
        />
        <Tab
          label="This week"
          active={window === 'week'}
          onPress={() => setWindow('week')}
        />
      </View>

      <HandleEditor onSaved={() => void load(window)} />

      <Card>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.color.accent} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>Couldn’t load the board.</Text>
            <Text style={styles.errorSub}>{error}</Text>
            <View style={{ height: theme.space.md }} />
            <Button label="Retry" variant="secondary" onPress={() => void load(window)} />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No riders ranked yet.</Text>
            <Text style={styles.errorSub}>
              {window === 'week'
                ? 'Be the first to log a ride this week.'
                : 'Complete a ride to claim the top spot.'}
            </Text>
          </View>
        ) : (
          entries.map((e) => {
            const mine = !!myShort && e.short_ua === myShort;
            return (
              <View
                key={`${e.rank}-${e.short_ua}`}
                style={[styles.row, mine && styles.rowMine]}
              >
                <Text style={styles.rank}>
                  {e.rank <= 3 ? MEDALS[e.rank - 1] : e.rank}
                </Text>
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>
                    {e.handle ?? e.short_ua}
                    {mine ? '  (you)' : ''}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {e.handle ? e.short_ua : ''}
                    {e.handle ? '  ·  ' : ''}
                    {e.rides_count} {e.rides_count === 1 ? 'ride' : 'rides'}
                  </Text>
                </View>
                <View style={styles.amountCol}>
                  <Text style={styles.amount}>{zec(e.zatoshi)}</Text>
                  <Text style={styles.amountUnit}>ZEC</Text>
                </View>
              </View>
            );
          })
        )}
      </Card>

      <Text style={styles.footnote}>
        Rankings come from the treasury’s accrual ledger. Amounts are real
        shielded ZEC earned; addresses are always shown shortened.
      </Text>
    </ScreenContainer>
  );
}

function Tab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Inline editor for the rider's chosen leaderboard handle. */
function HandleEditor({ onSaved }: { onSaved: () => void }) {
  const ua = getRecipientUA();
  const hasUa = ua.startsWith('u1');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [msg, setMsg] = useState('');

  async function save() {
    const handle = name.trim();
    if (!handle) return;
    setStatus('saving');
    setMsg('');
    try {
      await setHandle(ua, handle);
      setStatus('saved');
      setMsg(`You’ll show up as “${handle}”.`);
      onSaved();
    } catch (e) {
      setStatus('error');
      setMsg(String((e as Error)?.message ?? e));
    }
  }

  if (!hasUa) {
    return (
      <Card>
        <Text style={styles.cardLabel}>YOUR HANDLE</Text>
        <Text style={styles.help}>
          Set your Zashi wallet on the Ride tab first, then come back to pick
          a display name for the board.
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.cardLabel}>YOUR HANDLE</Text>
      <Text style={styles.help}>
        Pick a public display name. Your wallet address stays private — only a
        shortened form is ever shown.
      </Text>
      <View style={styles.handleRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. dawnrider"
          placeholderTextColor={theme.color.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
        />
        <Button
          label={status === 'saving' ? 'Saving…' : 'Save'}
          onPress={save}
          disabled={status === 'saving' || name.trim().length === 0}
        />
      </View>
      {msg ? (
        <Text
          style={[
            styles.handleMsg,
            status === 'error' && { color: theme.color.danger },
            status === 'saved' && { color: theme.color.success },
          ]}
        >
          {msg}
        </Text>
      ) : null}
    </Card>
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
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.pill,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: theme.color.accent },
  tabLabel: { color: theme.color.textDim, fontSize: 14, fontWeight: '700' },
  tabLabelActive: { color: '#0A0E1A' },
  cardLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  help: { color: theme.color.textDim, fontSize: 13, lineHeight: 19, marginBottom: theme.space.md },
  handleRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    color: theme.color.text,
    backgroundColor: 'rgba(10,14,26,0.6)',
    borderColor: theme.color.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    fontSize: 15,
  },
  handleMsg: { color: theme.color.text, fontSize: 13, marginTop: theme.space.sm },
  center: { alignItems: 'center', paddingVertical: theme.space.xl, gap: 4 },
  errorText: { color: theme.color.text, fontSize: 15, fontWeight: '700' },
  errorSub: { color: theme.color.textDim, fontSize: 12, textAlign: 'center' },
  emptyText: { color: theme.color.text, fontSize: 15, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space.md,
    borderBottomColor: theme.color.border,
    borderBottomWidth: 1,
    gap: theme.space.md,
  },
  rowMine: {
    backgroundColor: 'rgba(217,70,239,0.08)',
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
  },
  rank: {
    color: theme.color.text,
    fontSize: 18,
    fontWeight: '800',
    width: 34,
    textAlign: 'center',
  },
  who: { flex: 1, gap: 2 },
  name: { color: theme.color.text, fontSize: 15, fontWeight: '700' },
  sub: { color: theme.color.textMuted, fontSize: 11, fontFamily: 'monospace' },
  amountCol: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  amount: {
    color: theme.color.success,
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  amountUnit: { color: theme.color.textDim, fontSize: 11, fontWeight: '700', paddingBottom: 2 },
  footnote: {
    color: theme.color.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
});
