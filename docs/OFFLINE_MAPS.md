# Offline maps — real streets, zero leak

The ride map and Spend Nearby can now render a real street basemap with
**no network traffic at all** — no tile server, no glyph fetch, nothing.
This document covers the privacy model, how to build and host region packs,
and what's left on the roadmap.

## Privacy model

The old `LiveRouteMap` drew the route as a polyline on a blank grid: perfect
privacy, no geography. The problem with adding a normal map is that tile
SDKs fetch the viewport from a server — which tells that server roughly
where the rider is, every time the map moves. On a cycling app, tile
requests ≈ a low-resolution copy of the route.

The fix is to move the whole map onto the phone:

- One **PMTiles region pack** (vector tiles, Protomaps basemap schema) per
  metro, downloaded once, explicitly, ideally on WiFi.
- **MapLibre Native** renders it locally via its built-in `pmtiles://`
  protocol. The style (`mobile/src/map/basemapStyle.ts`) has **no `glyphs`,
  no `sprite`, and no http(s) URL** — a unit test
  (`mobile/src/map/__tests__/regions.test.ts`) enforces this, same as the
  claim-payload test enforces the upload contract.
- What a pack download reveals: "someone in this metro fetched the pack
  once." What it can never reveal: routes, positions, or per-ride activity.

Fallback ladder (implemented in `LiveRouteMap` / `MerchantMap`):

1. Offline pack downloaded → local MapLibre basemap. Badge: `OFFLINE MAP ·
   0 BYTES SENT`.
2. MapLibre linked but pack not downloaded → ride map falls back to the
   tileless SVG polyline; merchant map shows a download prompt instead of
   silently leaking the area to an online map.
3. MapLibre module absent (old dev clients) → previous behavior everywhere
   (SVG polyline; Apple Maps for merchants, now labeled `ONLINE MAP · AREA
   VISIBLE TO APPLE`).

## Why no street names (yet)

MapLibre renders text by fetching glyph PBFs from the style's `glyphs` URL —
a network request. So the offline style ships **geometry only**: water,
parks, roads, buildings. To add labels without breaking the guarantee,
bundle a glyph set in the app binary and point `glyphs` at the local asset
path. Tracked as roadmap below.

## Building region packs

Packs are extracted from the public Protomaps daily planet build with the
[`pmtiles` CLI](https://github.com/protomaps/go-pmtiles):

```bash
# bbox = west,south,east,north — must match REGION_PACKS in
# mobile/src/map/regions.ts
pmtiles extract https://build.protomaps.com/$(date +%Y%m%d).pmtiles \
  sf-bay.pmtiles --bbox=-123.05,36.95,-121.20,38.35

pmtiles extract https://build.protomaps.com/$(date +%Y%m%d).pmtiles \
  nyc.pmtiles --bbox=-74.55,40.35,-73.35,41.15
# ... one per entry in REGION_PACKS
```

A metro at zooms 0–15 lands around 30–60 MB. Update `approxMB` in
`regions.ts` with real sizes after extraction.

## Hosting

The app downloads packs from `https://packs.pedalshield.app/<id>.pmtiles`
(`PACK_BASE_URL` in `regions.ts`). They're plain static files — add a
`packs.pedalshield.app` site to the existing Caddy config on the VPS
(see `deploy/Caddyfile`) pointing at a directory of `.pmtiles` files.
No CORS needed (native download, not browser). Set long cache headers;
re-extract packs quarterly or when a city's road network meaningfully
changes.

## App integration (already wired)

- `mobile/src/map/regions.ts` — pack registry + coverage math (pure, tested)
- `mobile/src/map/packStore.ts` — download/delete/progress, presence-of-file
  = downloaded, guarded `expo-file-system`
- `mobile/src/map/basemapStyle.ts` — dark, label-free style (pure, tested)
- `mobile/src/components/OfflineBaseMap.tsx` — guarded MapLibre wrapper
- `mobile/src/components/MapPacksCard.tsx` — pack manager on the Privacy tab
- `LiveRouteMap` / `MerchantMap` — consume the ladder above

New native deps (require a new dev build / EAS build, not just JS update):

```bash
cd mobile
npx expo install expo-file-system @maplibre/maplibre-react-native
npx expo prebuild --clean   # or eas build
```

The `@maplibre/maplibre-react-native` config plugin is already listed in
`app.json`. Until a new native build ships, every guard reports
"unavailable" and the app behaves exactly as before.

## Roadmap

- Bundle glyphs locally → street-name labels with zero fetches.
- Auto-suggest the right pack after the first ride in a new metro
  (suggestion computed on-device, naturally).
- Ship the rider's home pack inside the app binary for launch cities so the
  first ride already has streets.
- Swap Protomaps daily build for pinned, reproducible extracts once packs
  are versioned.
