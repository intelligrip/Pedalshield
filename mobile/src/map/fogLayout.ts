/**
 * Fog layout — pure maths that turns tile IDs into screen hexagons.
 *
 * Because the grid is laid on Mercator metres, axial (q, r) coordinates map
 * to the plane exactly; the fog view needs no latitude or longitude at all.
 * Nothing here touches geometry from a ride — only tile IDs from the atlas
 * and the public quest.
 */

import { parseTileId, tilesWithin, tileDistance } from './tiles.ts';

const SQRT3 = Math.sqrt(3);

export type HexState = 'fog' | 'clear' | 'bloom' | 'quest' | 'questClear';

export interface HexCell {
  id: string;
  /** Centre in view units (before scaling). */
  x: number;
  y: number;
  state: HexState;
  label?: string;
}

export interface FogLayout {
  cells: HexCell[];
  /** viewBox for an SVG: [minX, minY, width, height]. */
  viewBox: [number, number, number, number];
  /** Hex circumradius in view units (always 1). */
  size: number;
  /** Unlocked tiles that exist but fall outside this view. */
  clearOutside: number;
}

/** Pointy-top hex centre for axial (q, r); y flipped so north is up. */
export function hexCenter(q: number, r: number): { x: number; y: number } {
  return { x: SQRT3 * q + (SQRT3 / 2) * r, y: -1.5 * r };
}

/** Corner points of a unit pointy-top hex, as an SVG `points` string. */
export function hexPoints(cx: number, cy: number, inset = 0.94): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + inset * Math.cos(ang)).toFixed(3)},${(cy + inset * Math.sin(ang)).toFixed(3)}`);
  }
  return pts.join(' ');
}

export interface LayoutInput {
  center: string;
  radius: number;
  unlocked: ReadonlySet<string>;
  /** Tiles unlocked by the ride just finished — drawn as a bloom. */
  bloom?: ReadonlySet<string>;
  questStops?: ReadonlyArray<{ tile: string; label: string }>;
}

export function layoutFog(input: LayoutInput): FogLayout {
  const bloom = input.bloom ?? new Set<string>();
  const stops = new Map((input.questStops ?? []).map((s) => [s.tile, s.label]));
  const cells: HexCell[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of tilesWithin(input.center, input.radius)) {
    const a = parseTileId(id)!;
    const { x, y } = hexCenter(a.q, a.r);
    const isClear = input.unlocked.has(id);
    const label = stops.get(id);
    let state: HexState;
    if (label !== undefined) state = isClear ? 'questClear' : 'quest';
    else if (bloom.has(id)) state = 'bloom';
    else state = isClear ? 'clear' : 'fog';
    cells.push({ id, x, y, state, ...(label !== undefined ? { label } : {}) });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  let clearOutside = 0;
  for (const t of input.unlocked) {
    if (tileDistance(t, input.center) > input.radius) clearOutside++;
  }

  const pad = 1.2;
  const viewBox: [number, number, number, number] =
    cells.length === 0
      ? [-1, -1, 2, 2]
      : [minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad];

  return { cells, viewBox, size: 1, clearOutside };
}
