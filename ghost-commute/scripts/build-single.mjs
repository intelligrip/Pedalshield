#!/usr/bin/env node
// Bundle the web app into ONE self-contained HTML file (no fetches, no server):
// CSS, ghost-core.js, app.js, the sample rides and the example fixtures inlined.
//
//   node scripts/build-single.mjs          → web/dist/index.html     (full page; host anywhere)
//                                           → web/dist/fragment.html  (body-only, for hosts that add the skeleton)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";

const W = "web";
const read = (p) => readFileSync(p, "utf8");
const css = read(`${W}/style.css`);
const core = read(`${W}/ghost-core.js`).replace(/^export /gm, "");
const app = read(`${W}/app.js`).replace(/^import \{[\s\S]*?\} from "\.\/ghost-core\.js";\n/m, "");
const samples = Object.fromEntries(
  readdirSync("samples").filter((f) => f.endsWith(".gpx")).map((f) => [f.replace(/\.gpx$/, ""), read(`samples/${f}`)]),
);
const fx = (f) => JSON.parse(read(`${W}/fixtures/${f}`));
const fixtures = {
  statement: fx("statement.json"),
  report: fx("report.json"),
  attestation: fx("attestation.json"),
  receipt: fx("rider-receipt.json"),
};

const html = read(`${W}/index.html`);
const body = html
  .slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
  .replace(/<script type="module" src="app.js"><\/script>/, "")
  .trim();

const safe = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
const scripts = `<script>window.GHOST_SAMPLES=${safe(samples)};window.GHOST_FIXTURES=${safe(fixtures)};</script>
<script type="module">
${core}
${app}
</script>`;

mkdirSync(`${W}/dist`, { recursive: true });
writeFileSync(
  `${W}/dist/index.html`,
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ghost Commute</title>
<style>${css}</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`,
);
writeFileSync(`${W}/dist/fragment.html`, `<title>Ghost Commute</title>\n<style>${css}</style>\n${body}\n${scripts}\n`);
// Public demo: Pages and Netlify both publish ../landing/, so the demo goes live at /ghost-commute/ on push to main.
import("node:fs").then(({ existsSync, mkdirSync: mk, copyFileSync }) => {
  if (existsSync("../landing")) {
    mk("../landing/ghost-commute", { recursive: true });
    copyFileSync(`${W}/dist/index.html`, "../landing/ghost-commute/index.html");
    console.log("✓ ../landing/ghost-commute/index.html (public demo)");
  }
});
console.log("✓ web/dist/index.html and web/dist/fragment.html");
