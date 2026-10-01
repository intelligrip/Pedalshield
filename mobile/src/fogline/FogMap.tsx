/**
 * The fog. An abstract hex field — no streets, no basemap, no location dot.
 *
 * Why no basemap: Fogline is Dark Forest for streets, and Dark Forest is a
 * field of darkness you light by exploring. A street map underneath would
 * make every screenshot a map of where someone rides. This view shows only
 * the shape of cleared territory and the public quest landmarks.
 *
 * It also has no dependency on the native map module or a downloaded map
 * pack: it renders the same on every phone, offline, on first launch.
 *
 * Inputs are tile IDs only (atlas + quest). See map/fogLayout.ts.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { G, Polygon, Text as SvgText } from 'react-native-svg';
import { hexPoints, layoutFog, type HexCell } from '../map/fogLayout.ts';
import { fog } from './theme.ts';

const AnimatedG = Animated.createAnimatedComponent(G);

interface Props {
  center: string;
  radius: number;
  unlocked: ReadonlySet<string>;
  bloom?: ReadonlySet<string>;
  questStops?: ReadonlyArray<{ tile: string; label: string }>;
  size: number;
  /** Show quest stop names. Off for tiny thumbnails. */
  labels?: boolean;
}

export function FogMap({ center, radius, unlocked, bloom, questStops, size, labels = true }: Props) {
  const layout = useMemo(
    () => layoutFog({ center, radius, unlocked, bloom, questStops }),
    [center, radius, unlocked, bloom, questStops],
  );

  // Bloom: newly cleared cells breathe in, then settle.
  const pulse = useRef(new Animated.Value(0)).current;
  const hasBloom = (bloom?.size ?? 0) > 0;
  useEffect(() => {
    if (!hasBloom) return;
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.55, duration: 1400, useNativeDriver: false }),
          Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: false }),
        ]),
        { iterations: 3 },
      ),
    ]).start();
  }, [hasBloom, pulse]);

  const [vx, vy, vw, vh] = layout.viewBox;
  const byState = (s: HexCell['state']) => layout.cells.filter((c) => c.state === s);
  const fontSize = Math.max(0.55, vw / 34);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`${vx} ${vy} ${vw} ${vh}`}>
        {/* Fog first, everything else lights on top of it. */}
        <G>
          {byState('fog').map((c) => (
            <Polygon
              key={c.id}
              points={hexPoints(c.x, c.y)}
              fill={fog.fogFill}
              stroke={fog.fogEdge}
              strokeWidth={0.06}
            />
          ))}
        </G>
        <G>
          {byState('clear').map((c) => (
            <Polygon
              key={c.id}
              points={hexPoints(c.x, c.y)}
              fill={fog.clearFill}
              stroke={fog.clear}
              strokeWidth={0.07}
              strokeOpacity={0.55}
            />
          ))}
        </G>
        <AnimatedG opacity={pulse}>
          {byState('bloom').map((c) => (
            <Polygon
              key={c.id}
              points={hexPoints(c.x, c.y)}
              fill={fog.bloomFill}
              stroke={fog.clear}
              strokeWidth={0.12}
            />
          ))}
        </AnimatedG>
        <G>
          {[...byState('quest'), ...byState('questClear')].map((c) => (
            <Polygon
              key={c.id}
              points={hexPoints(c.x, c.y, 0.86)}
              fill={c.state === 'questClear' ? fog.questClearFill : fog.questFill}
              stroke={fog.quest}
              strokeWidth={0.1}
              strokeDasharray={c.state === 'quest' ? '0.25 0.18' : undefined}
            />
          ))}
        </G>
        {labels ? (
          <G>
            {layout.cells
              .filter((c) => c.label)
              .map((c) => (
                <SvgText
                  key={`l-${c.id}`}
                  x={c.x + 1.05}
                  y={c.y + fontSize * 0.35}
                  fill={c.state === 'questClear' ? fog.quest : fog.dim}
                  fontSize={fontSize}
                  fontWeight="600"
                >
                  {c.label}
                </SvgText>
              ))}
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: fog.bg,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: fog.line,
  },
});
