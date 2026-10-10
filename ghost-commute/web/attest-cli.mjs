#!/usr/bin/env node
// Same code the web app runs, from a terminal. Handy for the scripted demo.
//
//   node web/attest-cli.mjs samples/bike-commute.gpx --payout-ua utest1… [--key rider-key.json] [--out attestation.json]
//
// Exit code 2 if the motion check rejects the ride.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseGpx, motionCheck, buildAttestation, generateRiderKey, exportRiderKey, importRiderKey } from "./ghost-core.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const gpxPath = args[0];
if (!gpxPath || gpxPath.startsWith("--")) {
  console.error("usage: node web/attest-cli.mjs <ride.gpx> --payout-ua <utest1…> [--key rider-key.json] [--out attestation.json]");
  process.exit(1);
}

const points = parseGpx(readFileSync(gpxPath, "utf8"));
const check = motionCheck(points);
const s = check.stats;
console.error(`ride: ${points.length} points, ${(s.distance_m / 1000).toFixed(2)} km, ${Math.round(s.duration_s / 60)} min, median ${s.median_kmh} km/h, p95 ${s.p95_kmh} km/h`);
console.error(`motion check (${"prototype-v1"}): ${check.verdict.toUpperCase()}`);
for (const r of check.reasons) console.error("  · " + r);
if (check.verdict !== "bike") {
  console.error("✗ not attesting: nothing leaves this device.");
  process.exit(2);
}

const keyPath = opt("--key", "rider-key.json");
let keyPair;
if (existsSync(keyPath)) keyPair = await importRiderKey(JSON.parse(readFileSync(keyPath, "utf8")));
else {
  keyPair = await generateRiderKey();
  writeFileSync(keyPath, JSON.stringify(await exportRiderKey(keyPair), null, 2));
  console.error(`(new rider key → ${keyPath}; keep it on this device)`);
}

const { attestation, salt, receipt_id } = await buildAttestation({ points, check, payoutUa: opt("--payout-ua"), keyPair });
const out = opt("--out", "attestation.json");
writeFileSync(out, JSON.stringify(attestation, null, 2));
writeFileSync(out.replace(/\.json$/, "") + ".salt.local", salt + "\n");
console.error(`✓ wrote ${out} (no coordinates). receipt ${receipt_id}`);
console.error(`  route salt kept locally in ${out.replace(/\.json$/, "")}.salt.local — never send it.`);
