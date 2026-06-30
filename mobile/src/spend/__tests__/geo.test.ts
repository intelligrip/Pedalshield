import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMeters,
  formatDistance,
  buildOverpassQuery,
  merchantCategory,
  merchantPayUA,
  parseOverpass,
  sortByDistance,
  directionsUrl,
} from '../geo.ts';

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    assert.ok(haversineMeters({ lat: 40, lon: -74 }, { lat: 40, lon: -74 }) < 1);
  });
  it('approximates a known distance (~111 km per degree lat)', () => {
    const d = haversineMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    assert.ok(Math.abs(d - 111195) < 500, `got ${d}`);
  });
});

describe('formatDistance', () => {
  it('rounds metres under ~1km to tens', () => {
    assert.equal(formatDistance(324), '320 m');
  });
  it('switches to km above the threshold', () => {
    assert.equal(formatDistance(1234), '1.2 km');
  });
  it('handles garbage', () => {
    assert.equal(formatDistance(NaN), '—');
  });
});

describe('buildOverpassQuery', () => {
  it('unions every candidate tag with around + center', () => {
    const q = buildOverpassQuery({ lat: 51.5, lon: -0.1 }, 5000);
    assert.ok(q.includes('[out:json]'));
    assert.ok(q.includes('around:5000,51.5,-0.1'));
    assert.ok(q.includes('["currency:ZEC"]'));
    assert.ok(q.includes('["payment:zcash"]'));
    assert.ok(q.includes('out center tags;'));
  });
});

describe('merchantCategory', () => {
  it('prefers shop and prettifies', () => {
    assert.equal(merchantCategory({ shop: 'bicycle' }), 'Bicycle');
  });
  it('falls back across keys then to Merchant', () => {
    assert.equal(merchantCategory({ amenity: 'cafe' }), 'Cafe');
    assert.equal(merchantCategory({}), 'Merchant');
  });
});

describe('merchantPayUA', () => {
  it('returns a unified address when published', () => {
    const ua = 'u1exampleexampleexampleexample';
    assert.equal(merchantPayUA({ 'payment:zcash:address': ua }), ua);
  });
  it('ignores a bare yes / junk', () => {
    assert.equal(merchantPayUA({ 'payment:zcash': 'yes' }), null);
    assert.equal(merchantPayUA({}), null);
  });
});

describe('parseOverpass', () => {
  const json = {
    elements: [
      {
        type: 'node',
        id: 1,
        lat: 40.0,
        lon: -74.0,
        tags: { name: 'Bean & Bike', amenity: 'cafe' },
      },
      {
        type: 'way',
        id: 2,
        center: { lat: 40.1, lon: -74.1 },
        tags: { shop: 'bicycle' },
      },
      { type: 'node', id: 3 /* no coords */, tags: { name: 'Nowhere' } },
    ],
  };
  it('maps nodes and ways, skips coordless', () => {
    const m = parseOverpass(json);
    assert.equal(m.length, 2);
    assert.equal(m[0].id, 'node/1');
    assert.equal(m[0].name, 'Bean & Bike');
    assert.equal(m[1].name, 'Bicycle'); // unnamed -> category label
  });
  it('tolerates empty / malformed input', () => {
    assert.deepEqual(parseOverpass(null), []);
    assert.deepEqual(parseOverpass({}), []);
  });
});

describe('sortByDistance', () => {
  it('annotates and orders nearest-first', () => {
    const here = { lat: 40, lon: -74 };
    const sorted = sortByDistance(
      [
        { id: 'a', name: 'far', lat: 41, lon: -74, category: 'x', payUA: null },
        { id: 'b', name: 'near', lat: 40.01, lon: -74, category: 'x', payUA: null },
      ],
      here,
    );
    assert.equal(sorted[0].name, 'near');
    assert.ok((sorted[0].distanceM ?? 0) < (sorted[1].distanceM ?? 0));
  });
});

describe('directionsUrl', () => {
  const m = { lat: 40, lon: -74, name: 'Bean & Bike' };
  it('uses Apple Maps on ios', () => {
    assert.ok(directionsUrl(m, 'ios').startsWith('https://maps.apple.com/?daddr=40,-74'));
  });
  it('uses Google Maps elsewhere', () => {
    assert.ok(directionsUrl(m, 'android').includes('google.com/maps/dir/'));
  });
});
