// ghost-core.js — the part of Ghost Commute that runs on the rider's device.
//
// Pure functions + WebCrypto. Runs unchanged in the browser and in Node 20+
// (see attest-cli.mjs). Nothing in this file talks to a network.
//
// Contract with cli/src/attest.rs:
//   * canonical(): sorted keys, no whitespace, integers only, printable ASCII.
//   * signature: Ed25519 over canonical(attestation without "sig").
//   * receipt id: first 16 bytes of SHA-256(canonical(signed attestation)), hex.

export const ATTEST_VERSION = "ghost-commute/attest/1";
export const CHECK_VERSION = "prototype-v1";
const DISTANCE_QUANTUM_M = 100;
const WINDOW_QUANTUM_S = 900;

// ---------- GPX ----------

/** Parse <trkpt lat lon><time/></trkpt> points. Tolerant, dependency-free. */
export function parseGpx(text) {
  const pts = [];
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
  let m;
  while ((m = re.exec(text))) {
    const lat = parseFloat((/lat="([^"]+)"/.exec(m[1]) || [])[1]);
    const lon = parseFloat((/lon="([^"]+)"/.exec(m[1]) || [])[1]);
    const time = (/<time>([^<]+)<\/time>/.exec(m[2]) || [])[1];
    const t = time ? Date.parse(time) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(t)) pts.push({ lat, lon, t });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

export function haversineM(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------- Motion check (PROTOTYPE) ----------
//
// This is a plausibility filter, not anti-cheat. It catches a phone that was in
// a car, on a train, or that "teleported" across a GPS gap. It does NOT catch a
// forged GPX file, a phone on a slow scooter, or an e-bike. The iOS app
// uses Pedalshield's full on-device verifier instead of this check.
// See README "Known limits".

export const THRESHOLDS = {
  minPoints: 20,
  minDurationS: 180,
  minDistanceM: 500,
  movingKmh: 4,          // below this a segment counts as stopped
  walkMedianKmh: 7,      // median moving speed below this = walking
  carMedianKmh: 32,      // sustained cruise above this = not a bike
  carP95Kmh: 45,         // peak above this = not a bike
  carShareAbove40: 0.15, // >15% of moving time above 40 km/h = car
  teleportKmh: 90,       // any single segment faster than this = teleport
  gapS: 60,              // a GPS gap longer than this…
  gapKmh: 35,            // …that implies more than this = rode something else
};

function quantile(sortedPairs, q) {
  // sortedPairs: [{v, w}] sorted by v; time-weighted quantile
  const total = sortedPairs.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (const p of sortedPairs) {
    acc += p.w;
    if (acc >= q * total) return p.v;
  }
  return sortedPairs.length ? sortedPairs[sortedPairs.length - 1].v : 0;
}

export function motionCheck(points, T = THRESHOLDS) {
  const reasons = [];
  let distance = 0, maxKmh = 0;
  const moving = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const d = haversineM(a, b);
    distance += d;
    const kmh = (d / dt) * 3.6;
    if (dt <= T.gapS) maxKmh = Math.max(maxKmh, kmh);
    if (kmh > T.teleportKmh) reasons.push(`segment at ${kmh.toFixed(0)} km/h — teleport`);
    else if (dt > T.gapS && kmh > T.gapKmh)
      reasons.push(`${Math.round(dt)} s GPS gap covering ${(d / 1000).toFixed(1)} km (${kmh.toFixed(0)} km/h) — you rode something with a driver`);
    if (kmh >= T.movingKmh && dt <= T.gapS) moving.push({ v: kmh, w: dt });
  }
  moving.sort((x, y) => x.v - y.v);
  const durationS = points.length > 1 ? (points[points.length - 1].t - points[0].t) / 1000 : 0;
  const movingS = moving.reduce((s, p) => s + p.w, 0);
  const median = quantile(moving, 0.5);
  const p95 = quantile(moving, 0.95);
  const shareAbove40 = movingS ? moving.filter((p) => p.v > 40).reduce((s, p) => s + p.w, 0) / movingS : 0;

  let verdict = "bike";
  if (points.length < T.minPoints || durationS < T.minDurationS || distance < T.minDistanceM) {
    verdict = "too-short";
    reasons.push(`need ≥${T.minPoints} points, ≥${T.minDurationS / 60} min and ≥${T.minDistanceM} m`);
  } else if (reasons.length) {
    verdict = "teleport";
  } else if (median > T.carMedianKmh || p95 > T.carP95Kmh || shareAbove40 > T.carShareAbove40) {
    verdict = "car";
    reasons.push(`median ${median.toFixed(0)} km/h, p95 ${p95.toFixed(0)} km/h, ${(shareAbove40 * 100).toFixed(0)}% of moving time above 40 km/h`);
  } else if (median < T.walkMedianKmh) {
    verdict = "walk";
    reasons.push(`median moving speed ${median.toFixed(1)} km/h : walking pace, not a ride.`);
  }
  return {
    verdict,
    reasons,
    stats: {
      distance_m: Math.round(distance),
      duration_s: Math.round(durationS),
      moving_s: Math.round(movingS),
      median_kmh: Math.round(median),
      p95_kmh: Math.round(p95),
      max_kmh: Math.round(maxKmh),
      points: points.length,
    },
  };
}

// ---------- Zones (coarse geofences, matched on device) ----------

export const ZONES = [
  { id: "bend-or", name: "Bend, OR", bbox: [43.98, -121.42, 44.12, -121.23] },
  { id: "portland-or", name: "Portland, OR", bbox: [45.43, -122.84, 45.65, -122.47] },
  { id: "sf-ca", name: "San Francisco, CA", bbox: [37.70, -122.52, 37.84, -122.35] },
];

export function zoneFor(points) {
  for (const z of ZONES) {
    const [a, b, c, d] = z.bbox;
    if (points.every((p) => p.lat >= a && p.lat <= c && p.lon >= b && p.lon <= d)) return z.id;
  }
  return "unlisted";
}

// ---------- Canonical JSON + hashing ----------

export function canonical(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`canonical JSON forbids non-integer numbers (${v})`);
    return String(v);
  }
  if (typeof v === "string") {
    if (!/^[\x20-\x7e]*$/.test(v)) throw new Error("canonical JSON strings must be printable ASCII");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object")
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  throw new Error(`cannot canonicalize ${typeof v}`);
}

const enc = new TextEncoder();
export const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
export function randomHex(n) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

/** Salted commitment to the raw trace. The salt never leaves the device, so the
 *  commitment reveals nothing; if a ride is ever disputed the rider can choose
 *  to open it (and only that ride). */
export async function routeCommit(points, saltHex) {
  const body = points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)},${p.t}`).join(";");
  return hex(await sha256(enc.encode(saltHex + "|" + body)));
}

export async function receiptId(att) {
  return hex((await sha256(enc.encode(canonical(att)))).slice(0, 16));
}

// ---------- Keys ----------

export async function generateRiderKey() {
  return crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
}
export async function exportRiderKey(kp) {
  return { private: await crypto.subtle.exportKey("jwk", kp.privateKey), public: await crypto.subtle.exportKey("jwk", kp.publicKey) };
}
export async function importRiderKey(j) {
  return {
    privateKey: await crypto.subtle.importKey("jwk", j.private, { name: "Ed25519" }, true, ["sign"]),
    publicKey: await crypto.subtle.importKey("jwk", j.public, { name: "Ed25519" }, true, ["verify"]),
  };
}

// ---------- Attestation ----------

/** Build and sign the attestation. Input: parsed points + check result.
 *  Output contains no coordinates, by construction (see field list). */
export async function buildAttestation({ points, check, payoutUa, keyPair, salt = randomHex(32) }) {
  if (check.verdict !== "bike") throw new Error(`motion check said "${check.verdict}"; not attesting`);
  if (!/^u(test)?1[02-9ac-hj-np-z]+$/.test(payoutUa || "")) throw new Error("payout address must be a unified address (u1… or utest1…)");
  const start = Math.floor(points[0].t / 1000);
  const end = Math.ceil(points[points.length - 1].t / 1000);
  const ws = start - (start % WINDOW_QUANTUM_S);
  let we = end % WINDOW_QUANTUM_S ? end + WINDOW_QUANTUM_S - (end % WINDOW_QUANTUM_S) : end;
  if (we <= ws) we = ws + WINDOW_QUANTUM_S;
  const att = {
    v: ATTEST_VERSION,
    rider_pk: hex(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
    payout_ua: payoutUa,
    distance_m: Math.floor(check.stats.distance_m / DISTANCE_QUANTUM_M) * DISTANCE_QUANTUM_M,
    window: { start: ws, end: we },
    zone: zoneFor(points),
    motion: {
      verdict: check.verdict,
      check: CHECK_VERSION,
      median_kmh: check.stats.median_kmh,
      p95_kmh: check.stats.p95_kmh,
    },
    route_commit: await routeCommit(points, salt),
    nonce: randomHex(16),
  };
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, enc.encode(canonical(att)));
  att.sig = hex(sig);
  return { attestation: att, salt, receipt_id: await receiptId(att) };
}

export async function verifyAttestation(att) {
  const errors = [];
  const allowed = ["v", "rider_pk", "payout_ua", "distance_m", "window", "zone", "motion", "route_commit", "nonce", "sig"];
  for (const k of Object.keys(att)) if (!allowed.includes(k)) errors.push(`unexpected field "${k}"`);
  if (att.v !== ATTEST_VERSION) errors.push("unknown version");
  if (att.distance_m % DISTANCE_QUANTUM_M) errors.push("distance not rounded");
  if (att.window?.start % WINDOW_QUANTUM_S || att.window?.end % WINDOW_QUANTUM_S) errors.push("window not rounded");
  let sigOk = false;
  try {
    const { sig, ...unsigned } = att;
    const pk = await crypto.subtle.importKey("raw", unhex(att.rider_pk), { name: "Ed25519" }, false, ["verify"]);
    sigOk = await crypto.subtle.verify({ name: "Ed25519" }, pk, unhex(sig), enc.encode(canonical(unsigned)));
  } catch (e) {
    errors.push("signature check failed: " + e.message);
  }
  if (!sigOk) errors.push("rider signature does not verify");
  return { ok: errors.length === 0, errors, receipt_id: errors.length ? null : await receiptId(att) };
}

/** Mirror of `ghost claim` amount + memo rules, for the sponsor preview. */
export function previewPayout(att, { rateZatPerKm = 10000, capZat = 500000, flatZat = null } = {}) {
  const value = Math.min(flatZat ?? Math.floor((att.distance_m * rateZatPerKm) / 1000), capZat);
  return { value_zat: value, value_zec: (value / 1e8).toFixed(8) };
}
