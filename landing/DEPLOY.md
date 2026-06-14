# Deploying the Pedalshield waitlist page

The page is a single static folder (`landing/`). The live page is at **`/beta/`**
(matching the `pedalshield.app/beta` link in the manifesto); the root `/` redirects there.

Pick one host. Both are free and configured for one-click deploys.

---

## Option A — GitHub Pages (no account beyond GitHub)

Already wired via `.github/workflows/deploy-pages.yml`.

1. Push this repo to GitHub.
2. Repo → **Settings → Pages → Build and deployment → Source: "GitHub Actions"**.
3. Done. Every push to `main` that touches `landing/` redeploys automatically.

Default URL: `https://intelligrip.github.io/Pedalshield/beta/`
(With a custom domain it becomes `https://pedalshield.app/beta/` — see below.)

---

## Option B — Netlify

Configured via `netlify.toml` at the repo root.

1. On [netlify.com](https://netlify.com): **Add new site → Import an existing project**.
2. Connect this Git repo and click **Deploy**. Netlify reads `netlify.toml` — nothing to fill in.

Default URL: `https://<random-name>.netlify.app/beta/`
Set your custom domain under **Site settings → Domain management**.

---

## Custom domain (pedalshield.app)

1. Point DNS at your host:
   - **Netlify:** add the domain in the dashboard and follow its DNS instructions.
   - **GitHub Pages:** rename `landing/CNAME.example` to `landing/CNAME`
     (it already contains `pedalshield.app`), then in Settings → Pages set the
     custom domain. Add a DNS `CNAME` record for `pedalshield.app` →
     `intelligrip.github.io` (or the four A records GitHub lists for an apex domain).
2. Once DNS resolves, the manifesto's `pedalshield.app/beta` link works as-is.

> Keep `CNAME` as `.example` until DNS is ready — an active CNAME file makes
> GitHub Pages serve *only* the custom domain, which 404s before DNS is set up.

---

## Don't forget: connect the email form

The form currently shows a thank-you message but doesn't store emails.
See the comment block inside `beta/index.html` (`CONNECT THE FORM`) — the
fastest path is a free Formspree form ID pasted into the form `action`.
