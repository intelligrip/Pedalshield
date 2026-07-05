/**
 * Emit the pmtiles extract commands for every region pack — generated from
 * the same registry the app uses (src/map/regions.ts), so the hosted packs
 * can never drift from what the app expects.
 *
 * Usage (from mobile/):
 *   node scripts/printPackCommands.ts                 # all packs
 *   node scripts/printPackCommands.ts us-oh sf-bay    # just these ids
 *   MAXZOOM=13 node scripts/printPackCommands.ts      # smaller state packs
 *   BUILD=20260701 node scripts/printPackCommands.ts  # pin a planet build
 *
 * Pipe to a file and run it:
 *   node scripts/printPackCommands.ts > build_packs.sh && sh build_packs.sh
 */

import { REGION_PACKS } from '../src/map/regions.ts';

const build =
  process.env.BUILD ??
  new Date().toISOString().slice(0, 10).replace(/-/g, '');
const maxzoom = process.env.MAXZOOM ?? '15';
const planet = `https://build.protomaps.com/${build}.pmtiles`;

const wanted = process.argv.slice(2);
const packs = wanted.length
  ? REGION_PACKS.filter((p) => wanted.includes(p.id))
  : REGION_PACKS;

if (wanted.length && packs.length !== wanted.length) {
  const known = new Set(REGION_PACKS.map((p) => p.id));
  const bad = wanted.filter((id) => !known.has(id));
  console.error(`unknown pack id(s): ${bad.join(', ')}`);
  process.exit(1);
}

console.log('#!/bin/sh');
console.log(`# ${packs.length} pack(s) · planet build ${build} · maxzoom ${maxzoom}`);
console.log('set -e');
for (const p of packs) {
  const bbox = p.bbox.join(',');
  console.log(
    `pmtiles extract ${planet} ${p.id}.pmtiles --bbox=${bbox} --maxzoom=${maxzoom}`,
  );
}
console.log('ls -lh *.pmtiles');
