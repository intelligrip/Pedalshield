/**
 * The ride, as a game: the fog lifts around you while you ride.
 *
 * Replaces Pedalshield's live route line in Fogline mode. There is no line
 * at all — only cells cracking open as you enter them, a running count of
 * new ground, live chapter progress, and a haptic tick on every new cell so
 * progress can be felt without looking down. Safety first: everything here
 * is glanceable or felt; nothing needs reading while moving.
 *
 * Works in any city. The view centres on the cell you are in, computed on
 * the phone from the same on-device route buffer the session already holds.
 * Nothing is stored or sent from here. The first 250 m light nothing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { FogMap } from './FogMap.tsx';
import { fog, mono } from './theme.ts';
import { liveFog } from '../map/liveFog.ts';
import { centroidTile, tileIdFor } from '../map/tiles.ts';
import { getAtlas, loadAtlas, onAtlasChange } from '../map/atlas.ts';
import { CHAPTERS, isFinished, loadChain, onChainChange, type ChainState } from '../map/chapters.ts';
import { formatDurationMs } from '../lib/format.ts';
import type { RideSessionSnapshot } from '../ride/rideSession.ts';

declare const require: (m: string) => any;
let Haptics: any = null;
try {
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

/** A neutral cell to frame an empty field around: abstract fog, no place. */
const NOWHERE = tileIdFor(0, 0);

export function FoglineRideView({ snap }: { snap: RideSessionSnapshot }) {
  const [atlasTiles, setAtlasTiles] = useState<string[]>(getAtlas().tiles);
  const [chain, setChain] = useState<ChainState | null>(null);

  useEffect(() => {
    void loadAtlas();
    void loadChain();
    const offA = onAtlasChange((a) => setAtlasTiles(a.tiles));
    const offC = onChainChange(setChain);
    return () => {
      offA();
      offC();
    };
  }, []);

  const riding = snap.state === 'active' || snap.state === 'paused';
  const atlasBefore = useMemo(() => new Set(atlasTiles), [atlasTiles]);

  const chapter =
    chain && !isFinished(chain) && !chain.awaitingCode ? CHAPTERS[chain.chapter] : null;

  const live = useMemo(
    () => liveFog(riding ? snap.liveRoute : [], atlasBefore, chapter?.rule ?? null),
    [riding, snap.liveRoute, atlasBefore, chapter],
  );

  // A tick in the pocket for every new cell.
  const lastCount = useRef(0);
  useEffect(() => {
    if (!riding) {
      lastCount.current = 0;
      return;
    }
    if (live.newTiles.length > lastCount.current) {
      try {
        void Haptics?.notificationAsync?.(Haptics.NotificationFeedbackType?.Success);
      } catch {
        /* haptics are a nicety */
      }
    }
    lastCount.current = live.newTiles.length;
  }, [riding, live.newTiles.length]);

  const unlocked = useMemo(() => new Set([...atlasTiles, ...live.rideTiles]), [atlasTiles, live.rideTiles]);
  const bloom = useMemo(() => new Set(live.newTiles), [live.newTiles]);

  const center = live.current ?? centroidTile(atlasTiles) ?? NOWHERE;
  const size = Math.min(Dimensions.get('window').width - 32, 420);

  return (
    <View style={styles.wrap}>
      <Text style={styles.brand}>
        FOGLINE{snap.state === 'paused' ? ' · PAUSED' : riding ? ' · RIDING' : ''}
      </Text>

      <FogMap
        center={center}
        radius={riding ? 4 : 6}
        unlocked={unlocked}
        bloom={bloom}
        size={size}
        labels={false}
        current={riding ? live.current : null}
      />

      {riding ? (
        <>
          {live.warmupLeftM > 0 ? (
            <Text style={styles.warm}>The fog stirs in {live.warmupLeftM} m</Text>
          ) : (
            <>
              <Text style={styles.big}>+{live.newTiles.length}</Text>
              <Text style={styles.unit}>NEW CELLS</Text>
            </>
          )}

          {chapter && live.chapter ? (
            <View style={styles.chapter}>
              <View style={styles.chapterRow}>
                <Text style={styles.chapterName}>{chapter.title.toUpperCase()}</Text>
                <Text style={styles.chapterCount}>
                  {Math.min(live.chapter.have, live.chapter.need)} / {live.chapter.need}
                </Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.min(1, live.chapter.have / live.chapter.need) * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.chapterNote}>
                {live.chapter.done
                  ? 'Chapter complete. Finish the ride to send for your letter.'
                  : chapter.brief}
              </Text>
            </View>
          ) : null}

          <Text style={styles.stats}>
            {formatDurationMs(snap.stats.elapsedS * 1000)} · {snap.stats.liveKm.toFixed(1)} km
          </Text>
        </>
      ) : (
        <View style={styles.idle}>
          <Text style={styles.idleTitle}>{atlasTiles.length ? 'Back into the fog' : 'Ride to begin'}</Text>
          <Text style={styles.idleBody}>
            Cells open around you as you ride, anywhere. Nothing lights in your first 250 m, so the map never
            points at your door.
          </Text>
          {chapter ? (
            <Text style={styles.idleChapter}>
              Chapter {chain!.chapter + 1}: {chapter.title} · {chapter.brief}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 4 },
  brand: { color: fog.text, fontSize: 13, letterSpacing: 6, fontWeight: '700', marginBottom: 12 },
  warm: { color: fog.dim, fontSize: 15, marginTop: 18, fontFamily: mono },
  big: { color: fog.clear, fontSize: 64, fontWeight: '800', marginTop: 8, lineHeight: 70 },
  unit: { color: fog.dim, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  chapter: {
    alignSelf: 'stretch',
    marginTop: 16,
    backgroundColor: fog.panel,
    borderColor: fog.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  chapterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  chapterName: { color: fog.quest, fontSize: 12, letterSpacing: 2, fontWeight: '700' },
  chapterCount: { color: fog.text, fontSize: 13, fontFamily: mono },
  track: { height: 6, borderRadius: 3, backgroundColor: fog.line, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: fog.quest },
  chapterNote: { color: fog.dim, fontSize: 12, lineHeight: 17 },
  stats: { color: fog.muted, fontSize: 12, fontFamily: mono, marginTop: 14 },
  idle: { alignSelf: 'stretch', marginTop: 16, gap: 6 },
  idleTitle: { color: fog.text, fontSize: 20, fontWeight: '700' },
  idleBody: { color: fog.dim, fontSize: 13, lineHeight: 19 },
  idleChapter: { color: fog.quest, fontSize: 13, lineHeight: 19, marginTop: 4 },
});
