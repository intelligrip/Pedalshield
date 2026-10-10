import {
  parseGpx, motionCheck, buildAttestation, verifyAttestation, previewPayout, receiptId,
  generateRiderKey, exportRiderKey, importRiderKey, hex, ZONES,
} from "./ghost-core.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Loaders that work both from the repo (fetch) and from the single-file build
// (scripts/build-single.mjs inlines samples and fixtures into window globals).
async function loadSample(name) {
  if (window.GHOST_SAMPLES?.[name]) return window.GHOST_SAMPLES[name];
  const r = await fetch(`../samples/${name}.gpx`);
  if (!r.ok) throw new Error("Couldn't load sample (serve the repo root: python3 -m http.server)");
  return r.text();
}
const FIXTURES = { statement: "statement.json", report: "report.json", attestation: "attestation.json", receipt: "rider-receipt.json" };
async function loadFixture(key) {
  if (window.GHOST_FIXTURES?.[key]) return structuredClone(window.GHOST_FIXTURES[key]);
  const r = await fetch(`fixtures/${FIXTURES[key]}`);
  if (!r.ok) throw new Error("fixture missing");
  return r.json();
}

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === b.dataset.tab));
  }),
);

// ---------- rider key ----------
let keyPair = null;
async function loadKey(forceNew = false) {
  const saved = !forceNew && store.get("ghost.riderKey");
  keyPair = saved ? await importRiderKey(JSON.parse(saved)) : await generateRiderKey();
  if (!saved) store.set("ghost.riderKey", JSON.stringify(await exportRiderKey(keyPair)));
  const pk = hex(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  $("#keyInfo").textContent = `rider key ${pk.slice(0, 12)}… (on this device)`;
}
$("#newKeyBtn").addEventListener("click", () => loadKey(true));
loadKey().catch((e) => ($("#keyInfo").textContent = "Ed25519 unavailable in this browser: " + e.message));

$("#payoutUa").value = store.get("ghost.payoutUa") || "";
$("#payoutUa").addEventListener("input", (e) => store.set("ghost.payoutUa", e.target.value.trim()));

// ---------- ride ----------
let ride = null; // { points, check }
let lastAttestation = null;

function drawRoute(points, verdict) {
  const c = $("#routeCanvas"), g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  if (points.length < 2) return;
  const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
  const [minLa, maxLa, minLo, maxLo] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const k = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180);
  const w = (maxLo - minLo) * k || 1e-6, h = maxLa - minLa || 1e-6;
  const s = Math.min((c.width - 40) / w, (c.height - 40) / h);
  const X = (p) => 20 + (p.lon - minLo) * k * s + (c.width - 40 - w * s) / 2;
  const Y = (p) => c.height - 20 - (p.lat - minLa) * s - (c.height - 40 - h * s) / 2;
  const css = getComputedStyle(document.documentElement);
  g.lineWidth = 3;
  g.lineJoin = "round";
  g.strokeStyle = verdict === "bike" ? css.getPropertyValue("--ok") : css.getPropertyValue("--bad");
  g.beginPath();
  points.forEach((p, i) => {
    // Break the line across GPS gaps so a teleport looks like one.
    const gap = i > 0 && (p.t - points[i - 1].t) / 1000 > 60;
    if (i === 0 || gap) g.moveTo(X(p), Y(p));
    else g.lineTo(X(p), Y(p));
  });
  g.stroke();
}

function showRide(text, label) {
  const points = parseGpx(text);
  const check = motionCheck(points);
  ride = { points, check };
  const v = $("#verdict");
  const words = { bike: "BIKE ✓", car: "CAR ✗", teleport: "TELEPORT ✗", walk: "WALK ✗", "too-short": "TOO SHORT ✗" };
  v.textContent = words[check.verdict] || check.verdict;
  v.className = "verdict " + (check.verdict === "bike" ? "bike" : "bad");
  const s = check.stats;
  $("#stats").innerHTML = [
    ["ride", esc(label)],
    ["points", s.points],
    ["distance", (s.distance_m / 1000).toFixed(2) + " km"],
    ["duration", Math.round(s.duration_s / 60) + " min"],
    ["median moving", s.median_kmh + " km/h"],
    ["p95", s.p95_kmh + " km/h"],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  $("#reasons").innerHTML = check.reasons.map((r) => `<li>${esc(r)}</li>`).join("");
  drawRoute(points, check.verdict);
  $("#attestBtn").disabled = check.verdict !== "bike";
  $("#attestOut").classList.add("hidden");
}

document.querySelectorAll("[data-sample]").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      showRide(await loadSample(b.dataset.sample), b.textContent.trim());
    } catch (e) {
      alertBox(e.message);
    }
  }),
);
$("#gpxFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) showRide(await f.text(), f.name);
});

function alertBox(msg) {
  $("#reasons").innerHTML = `<li>${esc(msg)}</li>`;
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("#attestBtn").addEventListener("click", async () => {
  try {
    const { attestation, salt, receipt_id } = await buildAttestation({
      points: ride.points, check: ride.check, payoutUa: $("#payoutUa").value.trim(), keyPair,
    });
    lastAttestation = attestation;
    $("#attestJson").textContent = JSON.stringify(attestation, null, 2);
    const zone = ZONES.find((z) => z.id === attestation.zone);
    $("#staysList").innerHTML = [
      `${ride.points.length} GPS points with timestamps`,
      `exact start / end times (attested only to the 15-min window)`,
      `exact distance ${(ride.check.stats.distance_m / 1000).toFixed(2)} km (attested rounded down to 100 m)`,
      `the street-level route (attested: “${esc(zone ? zone.name : attestation.zone)}”)`,
      `route salt <code>${salt.slice(0, 12)}…</code> (opens the route commitment if you ever choose to)`,
      `your rider signing key`,
      `receipt id <code>${receipt_id}</code> (sponsor will put it in your memo)`,
    ].map((x) => `<li>${x}</li>`).join("");
    $("#attestOut").classList.remove("hidden");
  } catch (e) {
    alertBox(e.message);
  }
});
$("#dlAttest").addEventListener("click", () => lastAttestation && download("attestation.json", lastAttestation));

// ---------- sponsor ----------
let claim = null;
async function checkClaim(att) {
  claim = att;
  const res = await verifyAttestation(att);
  const leak = ["lat", "lon", "coords", "points", "trace", "gpx", "route"].filter((k) => k in att);
  $("#claimCheck").innerHTML = `
    <ul class="checks">
      <li class="${res.ok ? "ok" : "bad"}">${res.ok ? "✓ rider signature verifies" : "✗ " + esc(res.errors.join("; "))}</li>
      <li class="${att.motion?.verdict === "bike" ? "ok" : "bad"}">${att.motion?.verdict === "bike" ? "✓" : "✗"} motion verdict: ${esc(att.motion?.verdict)} <span class="proto">${esc(att.motion?.check)}</span></li>
      <li class="${leak.length ? "bad" : "ok"}">${leak.length ? "✗ contains location fields: " + leak.join(", ") : "✓ no coordinates in the claim"}</li>
    </ul>
    <dl class="stats">
      <dt>distance</dt><dd>${(att.distance_m / 1000).toFixed(1)} km</dd>
      <dt>window</dt><dd>${new Date(att.window.start * 1000).toLocaleString()} → ${new Date(att.window.end * 1000).toLocaleTimeString()}</dd>
      <dt>zone</dt><dd>${esc(att.zone)}</dd>
      <dt>pay to</dt><dd>${esc(att.payout_ua.slice(0, 22))}… (one-time)</dd>
      <dt>receipt</dt><dd>${res.receipt_id || "—"}</dd>
    </dl>`;
  $("#learnsYes").innerHTML = res.ok
    ? [`about ${(att.distance_m / 1000).toFixed(1)} km by bike`, `sometime in a 15-min-rounded window`, `city: ${esc(att.zone)}`, `a one-time payout address`, `a pseudonymous rider key`].map((x) => `<li>${x}</li>`).join("")
    : "<li>nothing it should trust</li>";
  updatePayout();
}
function updatePayout() {
  if (!claim) return;
  const p = previewPayout(claim, { rateZatPerKm: +$("#rate").value, capZat: +$("#cap").value });
  $("#payoutPreview").innerHTML = `<div class="verdict bike">${p.value_zec} ZEC</div><span>${p.value_zat} zat, shielded, memo encrypted to the rider</span>`;
  $("#sponsorCmd").textContent = `ghost claim attestation.json --zone ${claim.zone} --rate-zat-per-km ${+$("#rate").value} --cap-zat ${+$("#cap").value}
# → prints: zcash-devtool wallet -w wallets/sponsor send --address <orchard-only UA> --value ${p.value_zat} --memo 'GHOST1 r=…'`;
}
$("#rate").addEventListener("input", updatePayout);
$("#cap").addEventListener("input", updatePayout);
$("#claimFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) checkClaim(JSON.parse(await f.text()));
});
$("#useLocalClaim").addEventListener("click", () => (lastAttestation ? checkClaim(lastAttestation) : ($("#claimCheck").innerHTML = `<p class="fine">Sign an attestation in tab 1 first.</p>`)));

// ---------- auditor ----------
let report = null, auditAtt = null;
function renderStatement(st) {
  $("#auditHead").innerHTML = st.all_verified
    ? `<span class="ok">✓ ${st.verified} of ${st.payouts} payouts verified</span> · ${esc(st.total_zec)} ZEC`
    : `<span class="bad">✗ ${st.verified} of ${st.payouts} payouts verified</span>`;
  const pools = Object.entries(st.pools || {}).map(([k, v]) => `${esc(k)} ×${v}`).join(", ") || "—";
  $("#auditStats").innerHTML = [
    ["statement", esc(st.label || "")],
    ["network", esc(st.network)],
    ["total", `${esc(st.total_zec)} ZEC (${st.total_zat} zat)`],
    ["pools", pools + " (all shielded)"],
    ["heights", st.mined_height_range ? `${st.mined_height_range[0]} – ${st.mined_height_range[1]}` : "—"],
    ["inclusion", esc(st.chain_inclusion)],
    ["routes", `<b class="bad">withheld</b>: the pack has no field that could hold one`],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  $("#auditChecks").innerHTML = (st.items || [])
    .map((it) => {
      const v = it.value_zat != null ? (it.value_zat / 1e8).toFixed(8) + " ZEC" : "—";
      return `<li class="${it.verified ? "ok" : "bad"}">${it.verified ? "✓" : "✗"} <code>${esc(String(it.txid).slice(0, 16))}…</code> · ${v} · ${esc(it.pool || "")}${it.receipt_id ? " · receipt " + esc(it.receipt_id.slice(0, 8)) + "…" : ""}${it.error ? " · " + esc(it.error) : ""}</li>`;
    })
    .join("");
  $("#auditCross").textContent = "Each line is one shielded payout, re-opened from its one-note disclosure and re-checked against the transaction. Nothing else in the sponsor's or riders' wallets is visible.";
}

async function renderAudit() {
  if (!report) return;
  $("#auditCard").classList.remove("hidden");
  if (report.v === "ghost-commute/audit-statement/1") return renderStatement(report);
  $("#auditHead").innerHTML = report.verified
    ? `<span class="ok">✓ Payout verified</span> · ${esc(report.value_zec)} ZEC`
    : `<span class="bad">✗ Verification failed</span>`;
  const ride = report.ride;
  $("#auditStats").innerHTML = [
    ["tx", `<code>${esc(report.txid)}</code>`],
    ["pool", `${esc(report.pool)} (shielded) · action #${report.action_index}`],
    ["amount", `${esc(report.value_zec)} ZEC (${report.value_zat} zat)`],
    ["receipt", report.receipt_id ? `<code>${esc(report.receipt_id)}</code>` : `— (memo hash <code>${esc((report.memo_sha256 || "").slice(0, 16))}…</code>)`],
    ["source", esc(report.source)],
    ride ? ["ride", `${(ride.distance_m / 1000).toFixed(1)} km · ${esc(ride.zone)} · ${esc(ride.motion_check)}`] : null,
    ["route", `<b class="bad">withheld</b>: not in the disclosure, not in the memo, not on chain`],
  ].filter(Boolean).map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  $("#auditChecks").innerHTML = report.checks
    .map((c) => {
      const off = c.check.startsWith("OFFLINE");
      return `<li class="${!c.ok ? "bad" : off ? "warn" : "ok"}">${!c.ok ? "✗" : off ? "!" : "✓"} ${esc(c.check)}</li>`;
    }).join("");
  $("#auditCross").textContent = "";
  if (auditAtt) {
    const v = await verifyAttestation(auditAtt);
    const rid = await receiptId(auditAtt);
    $("#auditCross").innerHTML = v.ok && rid === report.receipt_id
      ? `<span class="ok">✓ Browser re-check: attestation signature valid and SHA-256 receipt matches the memo.</span>`
      : `<span class="bad">✗ Browser re-check failed: ${esc(v.errors.join("; ") || "receipt id mismatch")}</span>`;
  }
}
$("#reportFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) { report = JSON.parse(await f.text()); renderAudit(); }
});
$("#auditAttFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) { auditAtt = JSON.parse(await f.text()); renderAudit(); }
});

// ---------- rider wallet ----------
$("#receiptFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) renderReceipt(JSON.parse(await f.text()));
});
document.querySelectorAll("[data-fixture]").forEach((b) =>
  b.addEventListener("click", async () => {
    const k = b.dataset.fixture;
    if (k === "receipt") return renderReceipt(await loadFixture("receipt"));
    report = await loadFixture(k);
    auditAtt = k === "report" ? await loadFixture("attestation") : null;
    renderAudit();
  }),
);
function renderReceipt(r) {
  const memo = r.memo || "";
  const ghost = memo.startsWith("GHOST1 ");
  const [head, ...rest] = memo.split("\n");
  const line = ghost ? rest.join("\n") : memo;
  const km = ghost ? /d=([\d.]+)km/.exec(head) : null;
  const rid = ghost ? (/r=([0-9a-f]+)/.exec(head) || [])[1] : null;
  $("#memoCard").innerHTML = `
    <div class="fine">Incoming · ${esc(r.pool)} pool · ${(r.value_zat / 1e8).toFixed(8)} ZEC</div>
    <div class="big">${esc(line || "(no message)")}</div>
    <div class="fine">${km ? esc(km[1]) + " km · " : ""}${rid ? "receipt <code>" + esc(rid) + "</code>" : ""}</div>
    <div class="fine">tx <code>${esc(r.txid)}</code> · on chain this memo is 512 bytes of ChaCha20-Poly1305 ciphertext.</div>`;
  $("#memoCard").classList.remove("hidden");
}

// ---------- landing: live mainnet audit ----------
(async function renderLiveAudit() {
  const box = document.querySelector("#liveAudit");
  if (!box) return;
  try {
    const st = await loadFixture("statement");
    const rows = (st.items || []).map((it) => `
      <tr>
        <td><code>${esc(String(it.txid).slice(0, 12))}…</code></td>
        <td>${esc(it.pool || "")}</td>
        <td class="num">${it.value_zat != null ? (it.value_zat / 1e8).toFixed(8) : "—"}</td>
        <td class="num">${it.mined_height ?? "—"}</td>
        <td class="${it.verified ? "ok" : "bad"}">${it.verified ? "✓ verified" : "✗ " + esc(it.error || "failed")}</td>
      </tr>`).join("");
    const pools = Object.entries(st.pools || {}).map(([k, v]) => `${v} ${esc(k)}`).join(", ");
    box.innerHTML = `
      <div class="stamp">ROUTE<br />WITHHELD</div>
      <div class="audit-head">${st.all_verified ? `<span class="ok">✓ ${st.verified} of ${st.payouts} payouts verified</span>` : `<span class="bad">${st.verified} of ${st.payouts} verified</span>`}</div>
      <p class="fine">${esc(st.label || "")} · Zcash ${esc(st.network === "main" ? "mainnet" : st.network)} · ${pools} · blocks ${st.mined_height_range ? st.mined_height_range.join("–") : "—"}</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Transaction</th><th>Pool</th><th class="num">ZEC</th><th class="num">Block</th><th>Check</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="fine">Each row re-opens one shielded payout from its disclosure: the note commitment matches the transaction on chain, and the amount and recipient are proven. Nothing else in either wallet is visible, and no route exists to show.</p>`;
  } catch {
    box.innerHTML = `<p class="fine">The audit statement couldn't load here. It's in the repo at <code>ghost-commute/fixtures/mainnet/statement.json</code>.</p>`;
  }
})();
