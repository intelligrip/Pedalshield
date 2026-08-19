import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { LiveRouteMap } from '../components/LiveRouteMap.tsx';
import { PayoutCard } from '../components/PayoutCard.tsx';
import { GhostRideSheet } from '../components/GhostRideSheet.tsx';
import { PrivacyRevealSheet } from '../components/PrivacyRevealSheet.tsx';
import { ScreenContainer } from '../components/ScreenContainer.tsx';
import { Stat } from '../components/Stat.tsx';
import { theme } from '../app/theme.ts';
import { RideSession, type RideSessionSnapshot } from '../ride/rideSession.ts';
import { computeRideStats } from '../ride/rideStats.ts';
import { addRide } from '../ride/rideHistory.ts';
import { getPrivateRidePrefs } from '../prefs/privateRide.ts';
import { RideStatsCard } from '../components/RideStatsCard.tsx';
import { VerdictCard } from '../components/VerdictCard.tsx';
import { FedCard } from '../components/FedCard.tsx';
import { getCompanionPrefs } from '../prefs/companion.ts';
import { getRides } from '../ride/rideHistory.ts';
import type { RawRide } from '../verification/types.ts';
import {
  RealSensorSource,
  subscribeGpsQuality,
  type GpsQuality,
} from '../ride/realSensorSource.ts';

type SensorSource = { start: (s: RideSession) => void; stop: () => void };
import { formatDurationMs } from '../lib/format.ts';
import {
  distanceUnit,
  speedUnit,
  formatDistance,
  formatSpeed,
  kmToDisplay,
  displayUnitInKm,
  useUnits,
} from '../lib/units.ts';
import { SplitTracker } from '../ride/splitTracker.ts';
import {
  cueStart,
  cueFinish,
  cuePause,
  cueResume,
  cueSplit,
} from '../ride/cues.ts';
const ATT = {
  platform: 'android' as const,
  token: 'demo-attestation',
  issuedAt: Date.now(),
};

const HORIZ_PADDING = theme.space.lg * 2;
const MAP_HEIGHT = 360;

export function RideTrackerScreen() {
  const sessionRef = useRef<RideSession>(new RideSession(ATT));
  const sourceRef = useRef<SensorSource | null>(null);
  const splitRef = useRef<SplitTracker>(new SplitTracker());
  const [snap, setSnap] = useState<RideSessionSnapshot>(
    sessionRef.current.snapshot(),
  );
  const [tick, setTick] = useState(0);
  const [revealOpen, setRevealOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);

  useEffect(() => {
    const off = sessionRef.current.subscribe(setSnap);
    return off;
  }, []);

  useUnits(); // re-render when the rider toggles mi/km
  const paused = snap.state === 'paused';
  const riding = snap.state === 'active' || paused;

  function startRide() {
    splitRef.current.reset();
    sourceRef.current = new RealSensorSource();
    sessionRef.current.start();
    sourceRef.current.start(sessionRef.current);
    cueStart();
  }

  // Privacy-first start: the Ghost Ride checklist (close other trackers,
  // optional Airplane Mode) gates the FIRST ride, and every ride if the
  // rider opts in. The settings foundation comes before the tracking.
  function requestStartRide() {
    const prefs = getPrivateRidePrefs();
    if (!prefs.acknowledged || prefs.showEveryRide) {
      setGhostOpen(true);
      return;
    }
    startRide();
  }

  function finishRide() {
    sourceRef.current?.stop();
    sessionRef.current.stop();
    cueFinish();
  }

  function togglePause() {
    if (snap.state === 'active') {
      sessionRef.current.pause();
      cuePause();
    } else if (snap.state === 'paused') {
      sessionRef.current.resume();
      cueResume();
    }
  }

  // Eyes-free distance milestone cues (every whole mile / km).
  useEffect(() => {
    if (!riding) return;
    const reached = splitRef.current.update(kmToDisplay(snap.stats.liveKm));
    for (const n of reached) cueSplit(n, distanceUnit());
  }, [snap.stats.liveKm, riding]);

  // Repaint live stats (elapsed clock) once per second while active.
  useEffect(() => {
    if (snap.state !== 'active') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [snap.state]);

  useEffect(() => {
    if (snap.state === 'active') setSnap(sessionRef.current.snapshot());
  }, [tick]);

  const mapWidth = useMemo(
    () => Math.max(280, Dimensions.get('window').width - HORIZ_PADDING),
    [],
  );

  if (snap.state === 'complete' && snap.result) {
    return (
      <PostRide
        snap={snap}
        rawRide={sessionRef.current.getRawRide()}
        mapWidth={mapWidth}
        onDone={() => {
          sourceRef.current?.stop();
          sessionRef.current.reset();
        }}
      />
    );
  }

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>
          {paused ? 'Paused' : snap.state === 'active' ? 'Riding' : 'Ride'}
        </Text>
        <View style={styles.chipRow}>
          {riding && <GpsChip />}
          <Pressable
            style={styles.padlockChip}
            onPress={() => setRevealOpen(true)}
          >
            <Text style={styles.padlockIcon}>🔒</Text>
            <Text style={styles.padlockText}>On device only</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.mapWrap}>
        <LiveRouteMap
          route={snap.liveRoute}
          width={mapWidth}
          height={MAP_HEIGHT}
        />
        {/* Glass stat tiles floating over the map. */}
        <View style={styles.glassRow} pointerEvents="none">
          <GlassTile
            label="DISTANCE"
            value={formatDistance(snap.stats.liveKm)}
            unit={distanceUnit()}
          />
          <GlassTile
            label="TIME"
            value={formatDurationMs(snap.stats.elapsedS * 1000)}
            unit=""
          />
          <GlassTile
            label="SPEED"
            value={formatSpeed(snap.stats.liveAvgKmh)}
            unit={speedUnit()}
          />
        </View>
      </View>

      {snap.state === 'active' && <GpsBanner />}
      {paused && (
        <View style={[styles.gpsBanner, { borderLeftColor: theme.color.warning }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.gpsBannerTitle, { color: theme.color.warning }]}>
              Ride paused
            </Text>
            <Text style={styles.gpsBannerBody}>
              Distance and time are frozen. Tap Resume to keep riding.
            </Text>
          </View>
        </View>
      )}

      <View style={styles.actions}>
        {snap.state === 'idle' && (
          <>
            <Button label="Start ride" size="lg" onPress={requestStartRide} />
            <Pressable
              onPress={() => setGhostOpen(true)}
              hitSlop={8}
              style={styles.ghostLink}
            >
              <Text style={styles.ghostLinkText}>
                🛡 Private-ride checklist ›
              </Text>
            </Pressable>
          </>
        )}
        {riding && (
          <View style={styles.ridingActions}>
            <View style={styles.pauseBtnWrap}>
              <Button
                label={paused ? 'Resume' : 'Pause'}
                size="lg"
                variant="secondary"
                onPress={togglePause}
              />
            </View>
            <HoldToFinish onFinish={finishRide} />
          </View>
        )}
        {snap.state === 'error' && (
          <Button
            label="Reset"
            size="lg"
            variant="secondary"
            onPress={() => sessionRef.current.reset()}
          />
        )}
      </View>

      <PrivacyRevealSheet
        visible={revealOpen}
        onClose={() => setRevealOpen(false)}
        rideId={snap.rideId ?? ''}
        distanceM={snap.stats.liveKm * 1000}
      />

      <GhostRideSheet
        visible={ghostOpen}
        onProceed={() => {
          setGhostOpen(false);
          startRide();
        }}
        onClose={() => setGhostOpen(false)}
      />
    </ScreenContainer>
  );
}

/**
 * Hold-to-finish button. Stopping a ride triggers verification + submission,
 * so a single accidental tap shouldn't end it. The rider holds for ~1.2s; a
 * fill animates across, then the ride finishes. Releasing early cancels.
 */
function HoldToFinish({ onFinish }: { onFinish: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  function start() {
    anim.current = Animated.timing(progress, {
      toValue: 1,
      duration: 1200,
      useNativeDriver: false,
    });
    anim.current.start();
    timer.current = setTimeout(() => {
      cancel();
      onFinish();
    }, 1200);
  }

  function cancel() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    anim.current?.stop();
    Animated.timing(progress, {
      toValue: 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }

  // interpolate() exists at runtime; the sandbox RN type stub omits it.
  const width = (
    progress as unknown as {
      interpolate: (c: {
        inputRange: number[];
        outputRange: string[];
      }) => unknown;
    }
  ).interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Pressable onPressIn={start} onPressOut={cancel} style={styles.holdBtn}>
      <Animated.View style={[styles.holdFill, { width }]} />
      <Text style={styles.holdText}>Hold to finish</Text>
    </Pressable>
  );
}

/**
 * Live GPS signal chip. Answers the rider's only mid-ride anxiety:
 * "is this counting?" Green = fixes are passing the verifier's 30 m
 * accuracy gate; amber = weak signal (fixes being dropped); dim =
 * still acquiring.
 */
function GpsChip() {
  const [q, setQ] = useState<GpsQuality>({
    status: 'idle',
    accuracy: null,
    usable: false,
    at: 0,
  });

  useEffect(() => subscribeGpsQuality(setQ), []);

  let label: string;
  let color: string;
  switch (q.status) {
    case 'locked':
      label = `GPS ±${Math.round(q.accuracy ?? 0)} m`;
      color = theme.color.success;
      break;
    case 'weak':
      label = 'GPS weak';
      color = theme.color.warning;
      break;
    case 'lost':
      label = 'GPS lost';
      color = theme.color.danger;
      break;
    case 'precise-off':
      label = 'Precise off';
      color = theme.color.danger;
      break;
    case 'denied':
      label = 'No location';
      color = theme.color.danger;
      break;
    default:
      label = 'GPS …';
      color = theme.color.textMuted;
  }

  return (
    <View style={[styles.gpsChip, { borderColor: color }]}>
      <View style={[styles.gpsDot, { backgroundColor: color }]} />
      <Text style={[styles.gpsText, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * Loud, actionable banner for the states where the rider would otherwise
 * silently record nothing. Permission denied / Precise Location off get an
 * "Open Settings" deep link; acquiring / lost get a plain explanation so the
 * rider knows the ride isn't being undercounted by accident.
 */
function GpsBanner() {
  const [q, setQ] = useState<GpsQuality>({
    status: 'idle',
    accuracy: null,
    usable: false,
    at: 0,
  });
  useEffect(() => subscribeGpsQuality(setQ), []);

  if (q.status === 'locked' || q.status === 'idle') return null;

  let title: string;
  let body: string;
  let action: 'settings' | null = null;
  let tone: string = theme.color.warning;

  switch (q.status) {
    case 'denied':
      title = 'Location is off';
      body = 'Pedalshield needs location to measure your ride. Nothing is counting.';
      action = 'settings';
      tone = theme.color.danger;
      break;
    case 'precise-off':
      title = 'Precise Location is off';
      body = 'Your distance won’t count until Precise Location is on for Pedalshield.';
      action = 'settings';
      tone = theme.color.danger;
      break;
    case 'lost':
      title = 'GPS signal lost';
      body = 'Hang tight — distance pauses until the signal comes back.';
      tone = theme.color.warning;
      break;
    case 'weak':
      title = 'Weak GPS signal';
      body = 'Fixes are too noisy to count right now. Move to open sky if you can.';
      tone = theme.color.warning;
      break;
    default: // 'acquiring'
      title = 'Acquiring GPS…';
      body = 'Distance starts counting the moment your location locks on.';
      tone = theme.color.accent;
  }

  return (
    <View style={[styles.gpsBanner, { borderLeftColor: tone }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.gpsBannerTitle, { color: tone }]}>{title}</Text>
        <Text style={styles.gpsBannerBody}>{body}</Text>
      </View>
      {action === 'settings' && (
        <Pressable
          onPress={() =>
            void (
              Linking as unknown as { openSettings: () => Promise<void> }
            ).openSettings()
          }
          hitSlop={8}
          style={styles.gpsBannerBtn}
        >
          <Text style={styles.gpsBannerBtnText}>Open Settings</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Post-ride verdict with a build-up: the integrity score counts up,
 * then the status stamps in. The verification is the product - give
 * it a moment instead of a static label.
 */
function ScoreReveal({
  status,
  score,
  color,
}: {
  status: string;
  score: number;
  color: string;
}) {
  const [display, setDisplay] = useState(0);
  const badgeScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const v = new Animated.Value(0);
    const sub = v.addListener(({ value }) => setDisplay(value));
    Animated.timing(v, {
      toValue: score,
      duration: 1100,
      useNativeDriver: false,
    }).start(() => {
      setDisplay(score);
      Animated.spring(badgeScale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }).start();
    });
    return () => v.removeListener(sub);
  }, [score]);

  return (
    <View>
      <View style={styles.revealRow}>
        <Text style={styles.revealScore}>{display.toFixed(2)}</Text>
        <Animated.Text
          style={[
            styles.statusBadge,
            { color, transform: [{ scale: badgeScale }] },
          ]}
        >
          {status.toUpperCase()}
        </Animated.Text>
      </View>
      <Text style={styles.revealLabel}>INTEGRITY SCORE</Text>
    </View>
  );
}

function GlassTile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.glassTile}>
      <Text style={styles.glassLabel}>{label}</Text>
      <View style={styles.glassValueRow}>
        <Text style={styles.glassValue}>{value}</Text>
        {unit ? <Text style={styles.glassUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

function PostRide({
  snap,
  rawRide,
  mapWidth,
  onDone,
}: {
  snap: RideSessionSnapshot;
  rawRide: RawRide | null;
  mapWidth: number;
  onDone: () => void;
}) {
  useUnits(); // re-render when the rider toggles mi/km
  const report = useMemo(
    () => (rawRide ? computeRideStats(rawRide, displayUnitInKm()) : null),
    [rawRide],
  );
  const result = snap.result!;
  const verified = result.status === 'verified';
  const color = verified
    ? theme.color.success
    : result.status === 'review'
      ? theme.color.warning
      : theme.color.danger;
  const [revealOpen, setRevealOpen] = useState(false);

  // Bank the finished ride once, so history + YTD survive restarts. Stats
  // only — no route is stored. Rejected rides aren't banked (0 credited km).
  const savedRef = useRef(false);
  useEffect(() => {
    if (savedRef.current || !report || result.status === 'rejected') return;
    savedRef.current = true;
    void addRide({
      id: result.rideId,
      completedAt: Date.now(),
      distanceKm: result.verifiedKm,
      movingS: report.movingS,
      avgKmh: report.avgMovingKmh,
      maxKmh: report.maxKmh,
      elevationGainM: report.elevationGainM,
      integrityScore: result.integrityScore,
      status: result.status,
    });
  }, [report, result.rideId, result.status]);

  // Balance movement: either a real autonomous per-claim shielded payout
  // (classic path) or off-chain accrual + later batched settlement
  // (PEDAL_ACCRUAL=1). PayoutCard now handles both "paid" (with txid) and
  // "accrued" (with live pending balance + withdraw-to-settle button).
  // The app never shows money that doesn't exist.

  return (
    <ScreenContainer>
      <Text style={styles.title}>Ride complete</Text>

      <View style={[styles.mapWrap, { marginTop: theme.space.md }]}>
        <LiveRouteMap
          route={snap.liveRoute}
          width={mapWidth}
          height={240}
          showWatermark={false}
        />
      </View>

      {/* The payoff, first. This two-second moment is the loop the app is
          built around — it sits above the score and the payout because the
          feeling is what brings a rider back and the zatoshi never will. */}
      <FedCard
        name={getCompanionPrefs().name}
        verifiedKm={result.verifiedKm}
        elevationGainM={report?.elevationGainM ?? 0}
        durationS={report?.movingS ?? 0}
        avgKmh={report?.avgMovingKmh ?? 0}
        history={getRides().filter((r) => r.id !== result.rideId)}
        rejected={result.status === 'rejected'}
      />

      <Card accent>
        <ScoreReveal
          status={result.status}
          score={result.integrityScore}
          color={color}
        />
        <View style={{ height: theme.space.md }} />
        <Stat
          label="Verified distance"
          value={formatDistance(result.verifiedKm)}
          unit={distanceUnit()}
          emphasised
        />
      </Card>

      {report ? <RideStatsCard report={report} /> : null}

      {verified && (
        <>
          <PayoutCard
            rideId={result.rideId}
            distanceM={result.verifiedKm * 1000}
            integrityScore={result.integrityScore}
          />
          <Pressable
            style={styles.linkRow}
            onPress={() => setRevealOpen(true)}
          >
            <Text style={styles.linkText}>See what was sent ›</Text>
          </Pressable>
        </>
      )}

      {/* Plain-language explanation. Replaces the old raw flag-code dump,
          which told a rider only that a machine had judged them. Renders
          nothing on a clean verified ride. */}
      <VerdictCard result={result} />

      <Button label="Done" size="lg" onPress={onDone} />

      <PrivacyRevealSheet
        visible={revealOpen}
        onClose={() => setRevealOpen(false)}
        rideId={result.rideId}
        distanceM={result.verifiedKm * 1000}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  ghostLink: { alignItems: 'center', marginTop: 10 },
  ghostLinkText: {
    color: theme.color.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.h1.size,
    fontWeight: theme.font.h1.weight,
    letterSpacing: theme.font.h1.letterSpacing,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.sm,
  },
  gpsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(10, 14, 26, 0.6)',
  },
  gpsDot: { width: 6, height: 6, borderRadius: 3 },
  gpsText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  gpsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    marginTop: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderLeftWidth: 4,
    backgroundColor: theme.color.bgElev,
  },
  gpsBannerTitle: { fontSize: 14, fontWeight: '800' },
  gpsBannerBody: {
    color: theme.color.textDim,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  gpsBannerBtn: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.accent,
  },
  gpsBannerBtnText: {
    color: theme.color.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  revealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  revealScore: {
    color: theme.color.text,
    fontSize: 40,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  revealLabel: {
    color: theme.color.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
    marginTop: 2,
  },
  padlockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderColor: theme.color.success,
    borderWidth: 1,
    backgroundColor: 'rgba(34, 211, 161, 0.10)',
  },
  padlockIcon: { fontSize: 11 },
  padlockText: {
    color: theme.color.success,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  mapWrap: {
    marginTop: theme.space.lg,
    alignItems: 'center',
    position: 'relative',
  },
  glassRow: {
    position: 'absolute',
    top: theme.space.md,
    left: theme.space.md,
    right: theme.space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.space.sm,
  },
  glassTile: {
    flex: 1,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    backgroundColor: 'rgba(10, 14, 26, 0.72)',
    borderRadius: theme.radius.md,
    borderColor: theme.color.border,
    borderWidth: 1,
  },
  glassLabel: {
    color: theme.color.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
  },
  glassValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 2,
  },
  glassValue: {
    color: theme.color.text,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  glassUnit: { color: theme.color.textDim, fontSize: 11, fontWeight: '700' },
  actions: { marginTop: 'auto' },
  ridingActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.space.md,
  },
  pauseBtnWrap: { flex: 1 },
  holdBtn: {
    flex: 1,
    height: 52,
    borderRadius: theme.radius.pill,
    borderWidth: 1.5,
    borderColor: theme.color.danger,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(248, 113, 113, 0.30)',
  },
  holdText: {
    color: theme.color.danger,
    fontSize: 16,
    fontWeight: '800',
  },
  sourceToggle: {
    alignSelf: 'center',
    marginBottom: theme.space.md,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
  },
  sourceToggleText: {
    color: theme.color.textDim,
    fontSize: 13,
    fontWeight: '700',
  },
  statusBadge: {
    fontSize: theme.font.label.size,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  cardLabel: {
    color: theme.color.textDim,
    fontSize: theme.font.label.size,
    fontWeight: theme.font.label.weight,
    letterSpacing: theme.font.label.letterSpacing,
    marginBottom: theme.space.sm,
  },
  payoutLine: { color: theme.color.text, fontSize: 15, lineHeight: 22 },
  linkRow: { marginTop: theme.space.md },
  linkText: {
    color: theme.color.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});
