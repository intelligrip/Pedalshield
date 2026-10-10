#!/usr/bin/env node
// Generates synthetic GPX fixtures. The coordinates are invented points in
// Bend, OR — nobody's actual home, nobody's actual office.
//
//   node scripts/make-samples.mjs   → samples/{bike-commute,car-commute,bus-teleport,walk}.gpx

import { mkdirSync, writeFileSync } from "node:fs";

const WAYPOINTS = [
  [44.0905, -121.356], [44.082, -121.342], [44.07, -121.333], [44.062, -121.32],
  [44.0582, -121.3153], [44.048, -121.305], [44.04, -121.297],
];

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const R = 6371008.8, rad = Math.PI / 180;
function dist(a, b) {
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function along(pathM) {
  let acc = 0;
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const a = WAYPOINTS[i - 1], b = WAYPOINTS[i], d = dist(a, b);
    if (acc + d >= pathM) {
      const f = (pathM - acc) / d;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    acc += d;
  }
  return WAYPOINTS[WAYPOINTS.length - 1];
}
const TOTAL = WAYPOINTS.slice(1).reduce((s, p, i) => s + dist(WAYPOINTS[i], p), 0);

/** speedFn(tSeconds, mAlong) -> km/h; gaps: [{atM, durationS, jumpM}] */
function trace({ speedFn, stepS = 5, gaps = [], startIso = "2026-10-06T15:02:11Z" }) {
  let t = Date.parse(startIso), m = 0;
  const pts = [];
  const g = [...gaps];
  while (m < TOTAL) {
    const p = along(m);
    const jitter = () => (rnd() - 0.5) * 0.00003; // ~±1.5 m GPS noise
    pts.push([p[0] + jitter(), p[1] + jitter(), new Date(t).toISOString()]);
    if (g.length && m >= g[0].atM) {
      const gap = g.shift();
      t += gap.durationS * 1000;
      m += gap.jumpM;
      continue;
    }
    const kmh = Math.max(0, speedFn((t - Date.parse(startIso)) / 1000, m));
    m += (kmh / 3.6) * stepS;
    t += stepS * 1000;
  }
  return pts;
}

function gpx(name, pts) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ghost-commute make-samples" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${name} (synthetic)</name></metadata>
  <trk><name>${name}</name><trkseg>
${pts.map(([la, lo, t]) => `    <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"><time>${t}</time></trkpt>`).join("\n")}
  </trkseg></trk>
</gpx>
`;
}

mkdirSync("samples", { recursive: true });

// Bike: 15–26 km/h, two red lights.
const lights = [1800, 4200];
const bike = trace({
  speedFn: (t, m) => (lights.some((l) => m > l && m < l + 15) ? 0.5 : 19 + 6 * Math.sin(t / 90) + (rnd() - 0.5) * 4),
});
// Car: same route at 45–70 km/h.
const car = trace({ speedFn: (t) => 55 + 12 * Math.sin(t / 40) + (rnd() - 0.5) * 6, stepS: 3 });
// Bus teleport: bike, then a 2 min GPS gap that covers 2.5 km, then bike.
seed = 7;
const bus = trace({
  speedFn: (t) => 18 + 4 * Math.sin(t / 70) + (rnd() - 0.5) * 3,
  gaps: [{ atM: 1500, durationS: 150, jumpM: 2500 }],
});
// Walk: 5 km/h.
const walk = trace({ speedFn: () => 5 + (rnd() - 0.5), stepS: 10 });

for (const [name, pts] of [["bike-commute", bike], ["car-commute", car], ["bus-teleport", bus], ["walk", walk]]) {
  writeFileSync(`samples/${name}.gpx`, gpx(name, pts));
  console.log(`samples/${name}.gpx  ${pts.length} points`);
}
