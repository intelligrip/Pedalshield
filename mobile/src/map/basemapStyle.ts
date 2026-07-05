/**
 * Offline basemap style — dark, label-free, ZERO network.
 *
 * Why no labels: text rendering in MapLibre fetches glyph PBFs from a
 * `glyphs` URL, and icons fetch a sprite sheet. Both are network requests,
 * which would break the "nothing fetched during a ride" guarantee. So this
 * style has no symbol layers at all: geometry only (water, parks, roads,
 * buildings). Street names can come later by bundling glyphs in the app
 * binary — tracked in docs/OFFLINE_MAPS.md.
 *
 * Source layers follow the Protomaps basemap schema (earth / water /
 * landuse / roads / buildings / boundaries).
 *
 * Pure module (no RN imports) — unit-testable under node.
 */

import { theme } from '../app/theme.ts';

/** Colors tuned to sit under the magenta route line without competing. */
const c = {
  bg: theme.color.bg, // land
  water: '#101B33',
  park: '#0E1A22',
  roadMinor: '#232C48',
  roadMajor: '#2E3A5C',
  highway: '#3A4870',
  building: '#141C30',
  boundary: '#2A3350',
};

/**
 * Build a MapLibre style JSON for one locally stored PMTiles pack.
 *
 * @param pmtilesUri absolute file URI of the downloaded pack, e.g.
 *   `file:///.../map-pack-sf-bay.pmtiles`. MapLibre Native reads it via its
 *   built-in `pmtiles://` protocol — no server involved.
 */
export function buildOfflineStyle(pmtilesUri: string): object {
  return {
    version: 8,
    // No `glyphs`, no `sprite` — intentionally. See module docblock.
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtilesUri}`,
        attribution: '© OpenStreetMap',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
      {
        id: 'earth',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'earth',
        paint: { 'fill-color': c.bg },
      },
      {
        id: 'landuse-park',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'landuse',
        filter: [
          'in',
          ['get', 'pmap:kind'],
          ['literal', ['park', 'nature_reserve', 'forest', 'grass', 'cemetery']],
        ],
        paint: { 'fill-color': c.park },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: { 'fill-color': c.water },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'buildings',
        minzoom: 13,
        paint: { 'fill-color': c.building, 'fill-opacity': 0.7 },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: [
          'in',
          ['get', 'pmap:kind'],
          ['literal', ['minor_road', 'other', 'path']],
        ],
        paint: {
          'line-color': c.roadMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 2.2],
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['==', ['get', 'pmap:kind'], 'major_road'],
        paint: {
          'line-color': c.roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 16, 4],
        },
      },
      {
        id: 'roads-highway',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['==', ['get', 'pmap:kind'], 'highway'],
        paint: {
          'line-color': c.highway,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 6],
        },
      },
      {
        id: 'boundaries',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'boundaries',
        paint: {
          'line-color': c.boundary,
          'line-width': 0.8,
          'line-dasharray': [3, 2],
        },
      },
    ],
  };
}
