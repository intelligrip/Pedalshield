/**
 * Fogline home: the fog, and one quest. Not a feed, not an earnings card.
 *
 * The camera opens on the public quest area — never on the rider. "My fog"
 * frames the atlas instead; that view is computed and drawn on the phone
 * and goes nowhere.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FogMap } from './FogMap.tsx';
import { fog, mono } from './theme.ts';
import { getFoglinePot, type FoglinePot } from './api.ts';
import { activeQuest } from '../map/quests.ts';
import { centroidTile, tileDistance } from '../map/tiles.ts';
import { clearAtlas, loadAtlas, onAtlasChange, type Atlas } from '../map/atlas.ts';
import {
  getConnectedUA,
  onConnectedUAChange,
  setConnectedUA,
  validateZcashUA,
} from '../wallet/connectedWallet.ts';

type View_ = 'quest' | 'mine';

export function FogScreen() {
  const nav: any = useNavigation();
  const quest = activeQuest();
  const [atlas, setAtlas] = useState<Atlas>({ v: 1, tiles: [], rides: 0 });
  const [view, setView] = useState<View_>('quest');
  const [pot, setPot] = useState<FoglinePot | null>(null);
  const [ua, setUa] = useState(getConnectedUA());

  useEffect(() => {
    void loadAtlas();
    const offA = onAtlasChange(setAtlas);
    const offU = onConnectedUAChange(setUa);
    getFoglinePot().then(setPot).catch(() => setPot(null));
    return () => {
      offA();
      offU();
    };
  }, []);

  const unlocked = useMemo(() => new Set(atlas.tiles), [atlas.tiles]);
  const questCenter = useMemo(() => centroidTile(quest.tiles)!, [quest.tiles]);

  // "My fog": frame the atlas, generously, so it reads as territory.
  const mine = useMemo(() => {
    const c = centroidTile(atlas.tiles);
    if (!c) return null;
    let r = 6;
    for (const t of atlas.tiles) r = Math.max(r, Math.min(14, tileDistance(t, c) + 2));
    return { center: c, radius: r };
  }, [atlas.tiles]);

  const frame = view === 'mine' && mine ? mine : { center: questCenter, radius: 9 };
  const size = Math.min(Dimensions.get('window').width - 32, 420);
  const clearedStops = quest.stops.filter((s) => unlocked.has(s.tile)).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.brand}>FOGLINE</Text>
        <Text style={styles.tagline}>Own the dark map. Never the route.</Text>

        <FogMap
          center={frame.center}
          radius={frame.radius}
          unlocked={unlocked}
          questStops={quest.stops}
          size={size}
        />

        <View style={styles.toggleRow}>
          <Toggle label="Quest" active={view === 'quest'} onPress={() => setView('quest')} />
          <Toggle
            label="My fog"
            active={view === 'mine'}
            disabled={!mine}
            onPress={() => setView('mine')}
          />
          <Text style={styles.count}>
            {atlas.tiles.length} {atlas.tiles.length === 1 ? 'cell' : 'cells'} cleared
          </Text>
        </View>

        {/* The one quest. */}
        <View style={styles.card}>
          <Text style={styles.kicker}>QUEST</Text>
          <Text style={styles.questTitle}>{quest.title}</Text>
          <Text style={styles.body}>{quest.blurb}</Text>
          <View style={styles.stops}>
            {quest.stops.map((s) => (
              <Text
                key={s.tile}
                style={[styles.stop, unlocked.has(s.tile) && styles.stopClear]}
              >
                {unlocked.has(s.tile) ? '◆' : '◇'} {s.label}
              </Text>
            ))}
          </View>
          <Text style={styles.small}>
            {clearedStops} of {quest.stops.length} cleared on your atlas · the drop
            needs {quest.need} in a single ride
          </Text>
          <View style={styles.rule} />
          <Text style={styles.small}>
            Quest drop from a 0.1 ZEC demo pot. Minimum spendable note + 1 zatoshi.
          </Text>
          {pot ? (
            <Text style={[styles.small, pot.paused && { color: fog.danger }]}>
              {pot.paused
                ? 'Pot is paused — the fog still clears.'
                : pot.drops_remaining !== null
                  ? `About ${pot.drops_remaining} drops left.`
                  : 'Pot is live.'}
            </Text>
          ) : null}
        </View>

        <WalletCard ua={ua} />

        <Pressable style={styles.ride} onPress={() => nav.navigate('Ride')}>
          <Text style={styles.rideText}>Ride into the fog</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.kicker}>WHAT LEAVES THIS PHONE</Text>
          <Text style={styles.body}>
            Your route, your cells and your atlas never do. A finished quest sends one
            line — ride id, quest id, “verified” — and your address so the drop can
            reach you. Nothing about where you went.
          </Text>
          <Pressable
            onPress={() =>
              Alert.alert('Clear your atlas?', 'This erases every cleared cell on this phone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear', style: 'destructive', onPress: () => void clearAtlas() },
              ])
            }
          >
            <Text style={styles.link}>Clear my atlas</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.toggle, active && styles.toggleActive, disabled && { opacity: 0.35 }]}
    >
      <Text style={[styles.toggleText, active && { color: fog.bg }]}>{label}</Text>
    </Pressable>
  );
}

/** Paste an existing Unified Address. We never create or hold keys. */
function WalletCard({ ua }: { ua: string }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const save = async () => {
    const v = validateZcashUA(draft);
    if (!v.ok) {
      setErr(v.reason ?? 'Not a Zcash Unified Address.');
      return;
    }
    try {
      await setConnectedUA(draft.trim());
      setDraft('');
      setErr('');
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>DROP ADDRESS</Text>
      {ua ? (
        <Text style={[styles.small, { fontFamily: mono }]} numberOfLines={1} ellipsizeMode="middle">
          {ua}
        </Text>
      ) : (
        <Text style={styles.small}>
          Paste a Zcash Unified Address from Zodl or any wallet. Fogline never holds keys.
        </Text>
      )}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={ua ? 'Replace address…' : 'u1…'}
        placeholderTextColor={fog.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        onSubmitEditing={save}
      />
      {draft ? (
        <Pressable onPress={save}>
          <Text style={styles.link}>Save address</Text>
        </Pressable>
      ) : null}
      {err ? <Text style={[styles.small, { color: fog.danger }]}>{err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: fog.bg },
  scroll: { padding: 16, paddingBottom: 48, alignItems: 'center' },
  brand: { color: fog.text, fontSize: 13, letterSpacing: 6, fontWeight: '700', marginTop: 8 },
  tagline: { color: fog.dim, fontSize: 13, marginTop: 4, marginBottom: 16 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    alignSelf: 'stretch',
  },
  toggle: {
    borderWidth: 1,
    borderColor: fog.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  toggleActive: { backgroundColor: fog.clear, borderColor: fog.clear },
  toggleText: { color: fog.dim, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  count: { marginLeft: 'auto', color: fog.dim, fontSize: 12, fontFamily: mono },
  card: {
    alignSelf: 'stretch',
    backgroundColor: fog.panel,
    borderColor: fog.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
    gap: 6,
  },
  kicker: { color: fog.quest, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  questTitle: { color: fog.text, fontSize: 22, fontWeight: '700' },
  body: { color: fog.text, fontSize: 14, lineHeight: 20, opacity: 0.85 },
  stops: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 4 },
  stop: { color: fog.dim, fontSize: 13 },
  stopClear: { color: fog.quest },
  small: { color: fog.dim, fontSize: 12, lineHeight: 17 },
  rule: { height: 1, backgroundColor: fog.line, marginVertical: 6 },
  input: {
    borderWidth: 1,
    borderColor: fog.line,
    borderRadius: 10,
    color: fog.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: mono,
    fontSize: 12,
    marginTop: 4,
  },
  link: { color: fog.clear, fontSize: 13, fontWeight: '600', marginTop: 6 },
  ride: {
    alignSelf: 'stretch',
    marginTop: 18,
    backgroundColor: fog.clear,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  rideText: { color: fog.bg, fontSize: 16, fontWeight: '800', letterSpacing: 0.4 },
});
