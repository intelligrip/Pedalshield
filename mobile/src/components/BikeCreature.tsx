/**
 * The bike, drawn at a level of detail set by how many miles it has been fed.
 *
 * One drawing, six stages. Parts fade in as the bike grows rather than the
 * shape changing, so a rider recognises their own bike getting fuller instead
 * of being handed a different one.
 *
 * Falls back to nothing if react-native-svg isn't linked — the home screen
 * still works, it just loses the picture. Same runtime-guard pattern as the
 * sensors and the wallet.
 */

import React from 'react';
import { View } from 'react-native';
import { theme } from '../app/theme.ts';

declare const require: (m: string) => any;

let Svg: any = null;
let Circle: any = null;
let Path: any = null;
try {
  const mod = require('react-native-svg');
  Svg = mod?.default ?? mod?.Svg ?? null;
  Circle = mod?.Circle ?? null;
  Path = mod?.Path ?? null;
  if (!Svg || !Circle || !Path) Svg = null;
} catch {
  Svg = null;
}

export function svgAvailable(): boolean {
  return !!Svg;
}

export interface BikeCreatureProps {
  /** 0..1 from the growth stage — how much of the bike is drawn. */
  detail: number;
  /** Resting bikes are drawn dimmer. Never sad, just quieter. */
  resting?: boolean;
  width?: number;
  height?: number;
}

export function BikeCreature({
  detail,
  resting = false,
  width = 240,
  height = 130,
}: BikeCreatureProps) {
  if (!Svg) return <View style={{ height }} />;

  const d = Math.min(1, Math.max(0, detail));
  const main = resting ? theme.color.textMuted : theme.color.accent;
  const rim = resting ? theme.color.border : '#1c5c45';
  const eye = resting ? theme.color.textMuted : '#f5c451';

  // Everything above its threshold is drawn; the frame is always there so
  // there is a bike from the very first ride.
  const showRims = d >= 0.5;
  const showCrank = d >= 0.5;
  const showEyes = d >= 0.65;
  const showBars = d >= 0.8;
  const showSpokes = d >= 0.92;

  const stroke = 3 + d * 0.8;

  return (
    <Svg width={width} height={height} viewBox="0 0 240 130">
      {/* wheels — always present */}
      <Circle cx={58} cy={92} r={30} fill="none" stroke={main} strokeWidth={stroke} />
      <Circle cx={182} cy={92} r={30} fill="none" stroke={main} strokeWidth={stroke} />

      {showRims ? (
        <>
          <Circle cx={58} cy={92} r={20} fill="none" stroke={rim} strokeWidth={1.5} />
          <Circle cx={182} cy={92} r={20} fill="none" stroke={rim} strokeWidth={1.5} />
        </>
      ) : null}

      {showSpokes ? (
        <>
          <Path d="M58 62 L58 122 M28 92 L88 92 M37 71 L79 113 M79 71 L37 113"
                stroke={rim} strokeWidth={1} fill="none" />
          <Path d="M182 62 L182 122 M152 92 L212 92 M161 71 L203 113 M203 71 L161 113"
                stroke={rim} strokeWidth={1} fill="none" />
        </>
      ) : null}

      {/* frame */}
      <Path
        d="M58 92 L104 92 L134 44 L164 92 M104 92 L130 46 M182 92 L146 46"
        fill="none"
        stroke={main}
        strokeWidth={stroke + 0.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {showBars ? (
        <Path d="M146 46 L166 42" fill="none" stroke={main}
              strokeWidth={stroke + 0.5} strokeLinecap="round" />
      ) : null}

      {showCrank ? (
        <Circle cx={104} cy={92} r={7} fill="none" stroke={main} strokeWidth={2.5} />
      ) : null}

      {showEyes ? (
        <>
          <Circle cx={128} cy={36} r={5} fill={eye} />
          <Circle cx={146} cy={36} r={5} fill={eye} />
        </>
      ) : null}
    </Svg>
  );
}
