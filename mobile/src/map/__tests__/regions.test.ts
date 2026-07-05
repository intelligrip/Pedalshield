/**
 * Unit tests for the offline map region registry + the offline style.
 *
 * The privacy contract of the map stack lives here: the generated MapLibre
 * style must reference exactly one source — the local PMTiles file — and
 * must never carry `glyphs`, `sprite`, or any http(s) URL. If a future
 * change adds a remote fetch to the basemap, these tests fail loudly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  coversPoint,
  packCovering,
  packFilename,
  packUrl,
  REGION_PACKS,
  US_STATE_PACKS,
  type RegionPack,
} from '../regions.ts';
import { buildOfflineStyle } from '../basemapStyle.ts';

describe('region packs', () => {
  it('every pack has a sane bbox (west<east, south<north)', () => {
    for (const p of REGION_PACKS) {
      const [w, s, e, n] = p.bbox;
      assert.ok(w < e, `${p.id}: west < east`);
      assert.ok(s < n, `${p.id}: south < north`);
      assert.ok(p.approxMB > 0, `${p.id}: size`);
    }
  });

  it('pack ids are unique and url/filename derive from them', () => {
    const ids = new Set(REGION_PACKS.map((p) => p.id));
    assert.equal(ids.size, REGION_PACKS.length);
    const sf = REGION_PACKS[0];
    assert.ok(packUrl(sf).endsWith(`/${sf.id}.pmtiles`));
    assert.equal(packFilename(sf), `map-pack-${sf.id}.pmtiles`);
  });

  it('coversPoint respects bbox edges', () => {
    const bbox = [-1, -1, 1, 1] as const;
    assert.ok(coversPoint(bbox, 0, 0));
    assert.ok(coversPoint(bbox, 1, 1)); // inclusive
    assert.ok(!coversPoint(bbox, 1.01, 0));
    assert.ok(!coversPoint(bbox, 0, -1.01));
  });

  it('finds the SF pack for a ride in San Francisco', () => {
    const p = packCovering(37.7749, -122.4194);
    assert.equal(p?.id, 'sf-bay');
  });

  it('returns null in the middle of the Pacific', () => {
    assert.equal(packCovering(0, -150), null);
  });

  it('covers all 50 US states', () => {
    assert.equal(US_STATE_PACKS.length, 50);
  });

  it('metro beats state: SF ride gets sf-bay, not California', () => {
    assert.equal(packCovering(37.7749, -122.4194)?.id, 'sf-bay');
  });

  it('Bend rider gets the tiny Bend pack, not Oregon', () => {
    assert.equal(packCovering(44.0582, -121.3153)?.id, 'bend');
  });

  it('state is the fallback outside metros', () => {
    assert.equal(packCovering(44.0521, -123.0868)?.id, 'us-or'); // Eugene
    assert.equal(packCovering(39.7392, -104.9903)?.id, 'us-co'); // Denver
    assert.equal(packCovering(30.2672, -97.7431)?.id, 'us-tx'); // Austin
    assert.equal(packCovering(41.4993, -81.6944)?.id, 'us-oh'); // Cleveland
    assert.equal(packCovering(21.3069, -157.8583)?.id, 'us-hi'); // Honolulu
    assert.equal(packCovering(61.2181, -149.9003)?.id, 'us-ak'); // Anchorage
  });

  it('prefers the smallest covering pack', () => {
    const city: RegionPack = {
      id: 'city',
      name: 'City',
      bbox: [-1, -1, 1, 1],
      approxMB: 10,
    };
    const country: RegionPack = {
      id: 'country',
      name: 'Country',
      bbox: [-10, -10, 10, 10],
      approxMB: 100,
    };
    assert.equal(packCovering(0, 0, [country, city])?.id, 'city');
  });
});

describe('offline style privacy contract', () => {
  const uri = 'file:///data/map-pack-sf-bay.pmtiles';
  const style = buildOfflineStyle(uri) as any;

  it('has exactly one source and it is the local pmtiles file', () => {
    const sources = Object.values(style.sources) as any[];
    assert.equal(sources.length, 1);
    assert.equal(sources[0].url, `pmtiles://${uri}`);
  });

  it('has no glyphs or sprite (those would be network fetches)', () => {
    assert.ok(!('glyphs' in style));
    assert.ok(!('sprite' in style));
  });

  it('contains no http(s) URL anywhere', () => {
    assert.ok(!JSON.stringify(style).match(/https?:\/\//));
  });

  it('has no symbol layers (text/icons would need glyph/sprite fetches)', () => {
    for (const layer of style.layers) {
      assert.notEqual(layer.type, 'symbol', `layer ${layer.id}`);
    }
  });
});
