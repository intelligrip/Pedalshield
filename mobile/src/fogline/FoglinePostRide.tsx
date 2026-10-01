/**
 * After a Fogline ride: the fog lifts, then — only if the quest is done —
 * one line goes to the server.
 *
 * Order on screen is the order of importance:
 *   1. the bloom (cells this ride cleared for the first time)
 *   2. quest progress for this ride
 *   3. the drop, if any — with txid + explorer link when paid
 *   4. "what left your phone": the literal request body, or "nothing"
 *
 * Tiles are computed here from the ride's geometry and written to the
 * on-device atlas. The geometry itself is never stored or sent; the claim
 * carries no tiles (map/foglineClaim.ts).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FogMap } from './FogMap.tsx';
import { fog, mono } from './theme.ts';
import {
  pollFoglineClaim,
  submissionBody,
  submitFoglineClaim,
  type FoglineRow,
  type FoglineSubmission,
} from './api.ts';
import { tilesForRide, centroidTile, tileDistance } from '../map/tiles.ts';
import { getAtlas, recordRideTiles } from '../map/atlas.ts';
import { activeQuest, questProgress } from '../map/quests.ts';
import { buildFoglineClaim } from '../map/foglineClaim.ts';
import { getConnectedUA } from '../wallet/connectedWallet.ts';
import { signFoglineClaim } from '../wallet/deviceIdentity.ts';
import { EXPLORER_TX_BASE } from '../lib/config.ts';
import type { RawRide, RideVerificationResult } from '../verification/types.ts';

type Drop =
  | { kind: 'none'; why: string }
  | { kind: 'sending' }
  | { kind: 'row'; row: FoglineRow }
  | { kind: 'error'; message: string };

export function FoglinePostRide({
  result,
  rawRide,
  onDone,
}: {
  result: RideVerificationResult;
  rawRide: RawRide | null;
  onDone: () => void;
}) {
  const quest = activeQuest();
  const verified = result.status === 'verified';

  // Tiles for this ride: endpoints stripped, computed once, on device.
  const rideTiles = useMemo(() => (rawRide ? tilesForRide(rawRide.geo) : []), [rawRide]);
  const progress = useMemo(() => questProgress(quest, rideTiles), [quest, rideTiles]);

  const [bloom, setBloom] = useState<Set<string>>(new Set());
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set(getAtlas().tiles));
  const [drop, setDrop] = useState<Drop>({ kind: 'none', why: '' });
  const [sentBody, setSentBody] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Fog lifts on every ride with tiles — paid or not, quest or not. A
    // rejected ride lifts nothing: it did not verifiably happen.
    if (verified && rideTiles.length > 0) {
      void recordRideTiles(rideTiles).then((r) => {
        setBloom(new Set(r.newlyUnlocked));
        setUnlocked(new Set(r.atlas.tiles));
      });
    }

    const claim = buildFoglineClaim(result, rideTiles, quest, rawRide?.deviceAttestation);
    if (!claim) {
      setDrop({
        kind: 'none',
        why: !verified
          ? 'Ride not verified — no claim sent.'
          : `${progress.hit.length} of ${progress.need} quest cells this ride — no claim sent.`,
      });
      return;
    }
    const ua = getConnectedUA();
    if (!ua) {
      setDrop({ kind: 'none', why: 'Quest complete — add a drop address on the Fog tab to claim next time.' });
      return;
    }

    setDrop({ kind: 'sending' });
    void (async () => {
      try {
        const signed = await signFoglineClaim(claim, ua);
        const sub: FoglineSubmission = {
          claim,
          recipient_ua: ua,
          ...(signed
            ? { signature: signed.signature, rider_id: signed.rider_id, signed_at: signed.signed_at }
            : {}),
        };
        setSentBody(submissionBody(sub));
        let row = await submitFoglineClaim(sub);
        if (row.status === 'paying') row = await pollFoglineClaim(claim.rideId);
        setDrop({ kind: 'row', row });
      } catch (e) {
        setDrop({ kind: 'error', message: String((e as Error)?.message ?? e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame the ride's own cells; fall back to the quest.
  const frame = useMemo(() => {
    const c = centroidTile(rideTiles) ?? centroidTile(quest.tiles)!;
    let r = 5;
    for (const t of rideTiles) r = Math.max(r, Math.min(14, tileDistance(t, c) + 2));
    return { center: c, radius: r };
  }, [rideTiles, quest.tiles]);

  const size = Math.min(Dimensions.get('window').width - 32, 420);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.brand}>FOGLINE</Text>

        <FogMap
          center={frame.center}
          radius={frame.radius}
          unlocked={unlocked}
          bloom={bloom}
          questStops={quest.stops}
          size={size}
        />

        <Text style={styles.bloomNum}>
          {verified ? `+${bloom.size}` : '0'}
        </Text>
        <Text style={styles.bloomUnit}>
          {verified
            ? bloom.size === 1
              ? 'NEW CELL CLEARED'
              : 'NEW CELLS CLEARED'
            : 'RIDE NOT VERIFIED — THE FOG HOLDS'}
        </Text>
        {verified && rideTiles.length > bloom.size ? (
          <Text style={styles.small}>
            {rideTiles.length - bloom.size} already yours · first and last 250 m never count
          </Text>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.kicker}>{quest.title.toUpperCase()}</Text>
          <Text style={styles.questLine}>
            {progress.hit.length} of {progress.need} quest cells this ride
            {progress.complete ? ' — complete' : ''}
          </Text>
          <DropView drop={drop} />
        </View>

        <View style={styles.card}>
          <Text style={styles.kicker}>WHAT LEFT YOUR PHONE</Text>
          {sentBody ? (
            <>
              <Text style={styles.small}>Exactly this, and nothing else:</Text>
              <Text style={styles.code} selectable>
                {prettyForDisplay(sentBody)}
              </Text>
            </>
          ) : (
            <Text style={styles.body}>Nothing. This ride stayed on your phone.</Text>
          )}
        </View>

        <Pressable style={styles.done} onPress={onDone}>
          <Text style={styles.doneText}>Back to the fog</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function DropView({ drop }: { drop: Drop }) {
  if (drop.kind === 'none') return <Text style={styles.small}>{drop.why}</Text>;
  if (drop.kind === 'sending') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={fog.quest} />
        <Text style={styles.small}>Claiming the drop…</Text>
      </View>
    );
  }
  if (drop.kind === 'error') {
    return <Text style={[styles.small, { color: fog.danger }]}>Couldn’t reach the pot: {drop.message}</Text>;
  }
  const { row } = drop;
  switch (row.status) {
    case 'paid':
      return (
        <View style={{ gap: 6 }}>
          <Text style={styles.paid}>
            Drop sent · {(row.payout_zat ?? 0).toLocaleString()} zatoshi, shielded
          </Text>
          {row.payout_txid ? (
            <Pressable onPress={() => Linking.openURL(`${EXPLORER_TX_BASE}${row.payout_txid}`)}>
              <Text style={styles.txid} numberOfLines={1} ellipsizeMode="middle">
                {row.payout_txid}
              </Text>
              <Text style={styles.link}>View on explorer ›</Text>
            </Pressable>
          ) : null}
        </View>
      );
    case 'paying':
      return <Text style={styles.small}>Broadcasting — check back in a minute.</Text>;
    case 'capped':
      return <Text style={styles.small}>Already claimed today ({row.reason}). The fog still lifted.</Text>;
    case 'treasury_paused':
      return <Text style={styles.small}>The demo pot is paused. Your atlas still updated.</Text>;
    case 'failed':
    default:
      return <Text style={[styles.small, { color: fog.danger }]}>Drop failed: {row.reason ?? 'unknown'}</Text>;
  }
}

/** Show the body readably; shorten the opaque signature/attestation blobs. */
function prettyForDisplay(body: string): string {
  const o = JSON.parse(body) as Record<string, unknown>;
  const short = (s: unknown) =>
    typeof s === 'string' && s.length > 24 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
  const claim = { ...(o.claim as Record<string, unknown>) };
  if (claim.attestation) claim.attestation = '<device attestation>';
  return JSON.stringify(
    { ...o, claim, recipient_ua: short(o.recipient_ua), signature: short(o.signature) },
    null,
    2,
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: fog.bg },
  scroll: { padding: 16, paddingBottom: 48, alignItems: 'center' },
  brand: { color: fog.text, fontSize: 13, letterSpacing: 6, fontWeight: '700', marginVertical: 12 },
  bloomNum: { color: fog.clear, fontSize: 52, fontWeight: '800', marginTop: 16 },
  bloomUnit: { color: fog.dim, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
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
  questLine: { color: fog.text, fontSize: 16, fontWeight: '600' },
  body: { color: fog.text, fontSize: 14, lineHeight: 20, opacity: 0.85 },
  small: { color: fog.dim, fontSize: 12, lineHeight: 17, textAlign: 'left' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paid: { color: fog.quest, fontSize: 15, fontWeight: '700' },
  txid: { color: fog.text, fontFamily: mono, fontSize: 11 },
  link: { color: fog.clear, fontSize: 13, fontWeight: '600', marginTop: 4 },
  code: {
    color: fog.text,
    fontFamily: mono,
    fontSize: 11,
    lineHeight: 16,
    backgroundColor: fog.bg,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  done: {
    alignSelf: 'stretch',
    marginTop: 18,
    borderColor: fog.clear,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneText: { color: fog.clear, fontSize: 15, fontWeight: '700' },
});
