/**
 * LiveRouteMap - on-device route renderer. Two modes, both zero-leak:
 *
 * 1. Offline basemap (preferred): if the rider has downloaded the PMTiles
 *    region pack covering this ride, the route draws over real streets
 *    rendered 100% locally by MapLibre. No tile server, no glyph fetch,
 *    no network at all during the ride.
 * 2. Tileless fallback: the original SVG polyline on a coordinate grid,
 *    projected straight from the on-device GPS buffer.
 *
 * Either way the privacy story is visible in the UI: the map never phones
 * home. Auto-fits to the route bounds; a halo + dot marks the position.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OfflineBaseMap, offlineMapAvailable } from './OfflineBaseMap.tsx';
import { packCovering } from '../map/regions.ts';
import {
  downloadedPackUri,
  hydratePackStore,
  onPackChange,
} from '../map/packStore.ts';
import Svg, {
  Circle,
  Defs,
  Line,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { theme } from '../app/theme.ts';

interface Coord {
  lat: number;
  lon: number;
}

interface Props {
  route: ReadonlyArray<Coord>;
  width: number;
  height: number;
  /** Show the "no map tiles fetched" overlay label. */
  showWatermark?: boolean;
}

/**
 * file:// URI of a downloaded pack covering the ride start, or null.
 * Subscribes to the pack store so finishing a download upgrades the map
 * live, mid-ride.
 */
function useCoveringPackUri(route: ReadonlyArray<Coord>): string | null {
  const [, bump] = useState(0);
  useEffect(() => {
    void hydratePackStore();
    return onPackChange(() => bump((n) => n + 1));
  }, []);
  if (!offlineMapAvailable() || route.length === 0) return null;
  const pack = packCovering(route[0].lat, route[0].lon);
  return pack ? downloadedPackUri(pack.id) : null;
}

export function LiveRouteMap({
  route,
  width,
  height,
  showWatermark = true,
}: Props) {
  const packUri = useCoveringPackUri(route);

  // Offline basemap mode: real streets, rendered entirely on-device.
  if (packUri && route.length >= 2) {
    return (
      <View style={[styles.container, { width, height }]}>
        <OfflineBaseMap
          packUri={packUri}
          fitCoords={route}
          route={route}
          interactive={false}
        />
        {showWatermark ? (
          <View style={styles.watermark} pointerEvents="none">
            <Text style={styles.watermarkText}>OFFLINE MAP · 0 BYTES SENT</Text>
          </View>
        ) : null}
      </View>
    );
  }

  // Empty state - placeholder grid only.
  if (route.length < 2) {
    return (
      <View style={[styles.container, { width, height }]}>
        <Svg width={width} height={height}>
          <Grid width={width} height={height} />
        </Svg>
        <View style={styles.centerHint} pointerEvents="none">
          <Text style={styles.hintText}>Start ride to draw route</Text>
        </View>
      </View>
    );
  }

  // Compute bounds with padding for visual breathing room.
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of route) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  // Equal aspect ratio - widen the smaller span to match the bigger one
  // so the route isn't squished. Lat-lon is approximately equal-distance
  // at this scale (and we don't need cartographic accuracy for a demo).
  const PADDING_FRAC = 0.18;
  let latSpan = Math.max(0.0001, maxLat - minLat);
  let lonSpan = Math.max(0.0001, maxLon - minLon);
  const aspect = width / height;
  // We want the *visual* aspect to match the viewport. lonSpan / latSpan
  // should equal aspect after padding. Inflate the smaller dimension.
  if (lonSpan / latSpan > aspect) {
    // longer horizontally - need taller latSpan
    latSpan = lonSpan / aspect;
  } else {
    lonSpan = latSpan * aspect;
  }
  const latPad = latSpan * PADDING_FRAC;
  const lonPad = lonSpan * PADDING_FRAC;
  const latMid = (minLat + maxLat) / 2;
  const lonMid = (minLon + maxLon) / 2;
  const latLo = latMid - latSpan / 2 - latPad;
  const latHi = latMid + latSpan / 2 + latPad;
  const lonLo = lonMid - lonSpan / 2 - lonPad;
  const lonHi = lonMid + lonSpan / 2 + lonPad;
  const latRange = latHi - latLo;
  const lonRange = lonHi - lonLo;

  // Project geo -> SVG. SVG y axis points down, so flip lat.
  const project = (lat: number, lon: number) => {
    const x = ((lon - lonLo) / lonRange) * width;
    const y = ((latHi - lat) / latRange) * height;
    return { x, y };
  };

  // Build the polyline path. Decimate to ~120 points for perf so the
  // path doesn't bloat with a long ride.
  const stride = Math.max(1, Math.floor(route.length / 120));
  let pathD = '';
  for (let i = 0; i < route.length; i += stride) {
    const { x, y } = project(route[i].lat, route[i].lon);
    pathD += i === 0
      ? `M${x.toFixed(1)},${y.toFixed(1)}`
      : ` L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  // Always include the most recent point so the head of the line is
  // anchored to the live position.
  const last = route[route.length - 1];
  if ((route.length - 1) % stride !== 0) {
    const { x, y } = project(last.lat, last.lon);
    pathD += ` L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  const lastPos = project(last.lat, last.lon);
  const startPos = project(route[0].lat, route[0].lon);

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={theme.color.accent} stopOpacity="0.55" />
            <Stop offset="60%" stopColor={theme.color.accent} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={theme.color.accent} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Grid width={width} height={height} />
        {/* Route - subtle glow under, sharp line over */}
        <Path
          d={pathD}
          stroke={theme.color.accent}
          strokeWidth={9}
          opacity={0.18}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={pathD}
          stroke={theme.color.accent}
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Start marker - small hollow ring */}
        <Circle
          cx={startPos.x}
          cy={startPos.y}
          r={5}
          fill="none"
          stroke={theme.color.textDim}
          strokeWidth={1.5}
        />
        {/* Current position - pulsing halo + dot */}
        <Circle cx={lastPos.x} cy={lastPos.y} r={28} fill="url(#haloGrad)" />
        <Circle
          cx={lastPos.x}
          cy={lastPos.y}
          r={7}
          fill={theme.color.accent}
        />
        <Circle
          cx={lastPos.x}
          cy={lastPos.y}
          r={3}
          fill={theme.color.bg}
        />
      </Svg>
      {showWatermark ? (
        <View style={styles.watermark} pointerEvents="none">
          <Text style={styles.watermarkText}>NO MAP TILES FETCHED</Text>
        </View>
      ) : null}
    </View>
  );
}

function Grid({ width, height }: { width: number; height: number }) {
  const lines: React.ReactNode[] = [];
  const DIVISIONS = 6;
  for (let i = 1; i < DIVISIONS; i++) {
    const x = (i / DIVISIONS) * width;
    const y = (i / DIVISIONS) * height;
    lines.push(
      <Line
        key={`v${i}`}
        x1={x}
        y1={0}
        x2={x}
        y2={height}
        stroke={theme.color.border}
        strokeWidth={0.6}
        opacity={0.55}
      />,
    );
    lines.push(
      <Line
        key={`h${i}`}
        x1={0}
        y1={y}
        x2={width}
        y2={y}
        stroke={theme.color.border}
        strokeWidth={0.6}
        opacity={0.55}
      />,
    );
  }
  return <>{lines}</>;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.color.bgElev,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  centerHint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    color: theme.color.textDim,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  watermark: {
    position: 'absolute',
    top: theme.space.md,
    right: theme.space.md,
    backgroundColor: 'rgba(34, 211, 161, 0.12)',
    borderColor: theme.color.success,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.sm,
    paddingVertical: theme.space.xs,
  },
  watermarkText: {
    color: theme.color.success,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.0,
  },
});
