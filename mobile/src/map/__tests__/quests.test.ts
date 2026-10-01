/**
 * The hard-coded quest. Its tile IDs are pinned to the public landmarks they
 * came from, so a change to the grid maths cannot silently move the quest.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { QUESTS, QUEST_DATA, activeQuest, questProgress } from '../quests.ts';
import { tileIdFor, isTileId } from '../tiles.ts';

// Approximate public landmark positions along the Deschutes in Bend. Only
// their ~400 m cell matters, not the exact point.
const ANCHORS: Record<string, [number, number]> = {
  Riverbend: [44.0418, -121.3215],
  'Old Mill': [44.0478, -121.3155],
  'Drake Park': [44.0586, -121.3196],
  'Pioneer Park': [44.0668, -121.3127],
  'First Street Rapids': [44.0735, -121.3152],
};

describe('quest data', () => {
  const q = activeQuest();

  it('app copy and backend copy (quests.json) are identical', () => {
    const json = JSON.parse(
      readFileSync(new URL('../quests.json', import.meta.url), 'utf8'),
    );
    assert.deepEqual(json, JSON.parse(JSON.stringify(QUEST_DATA)));
  });

  it('has one well-formed live quest', () => {
    assert.equal(QUESTS.length, 1);
    assert.ok(q.id && q.title);
    assert.equal(q.tiles.length, 5);
    assert.ok(q.tiles.every(isTileId));
    assert.equal(new Set(q.tiles).size, q.tiles.length, 'stops must be distinct cells');
    assert.equal(q.need, 3);
  });

  it('each stop tile is the cell of its landmark', () => {
    for (const s of q.stops) {
      const [lat, lon] = ANCHORS[s.label];
      assert.equal(s.tile, tileIdFor(lat, lon), `${s.label} drifted`);
    }
  });
});

describe('questProgress', () => {
  const q = activeQuest();
  const other = 'fl1:0:0';

  it('completes at the threshold, from one ride', () => {
    const p = questProgress(q, [q.tiles[0], q.tiles[2], q.tiles[4], other]);
    assert.deepEqual(p.hit, [q.tiles[0], q.tiles[2], q.tiles[4]].sort());
    assert.equal(p.complete, true);
  });

  it('is incomplete below it', () => {
    const p = questProgress(q, [q.tiles[1], q.tiles[3]]);
    assert.equal(p.hit.length, 2);
    assert.equal(p.complete, false);
  });

  it('duplicates do not count twice', () => {
    const p = questProgress(q, [q.tiles[0], q.tiles[0], q.tiles[0]]);
    assert.equal(p.complete, false);
  });

  it('an empty ride makes no progress', () => {
    assert.deepEqual(questProgress(q, []).hit, []);
  });
});
