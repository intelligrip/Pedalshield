import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAPTERS,
  START,
  afterLetter,
  codeRejected,
  evaluateRule,
  isFinished,
  normaliseCode,
  parseChain,
  withCode,
} from '../chapters.ts';
import { QUEST_DATA } from '../quests.ts';
import { tileIdFor, tilesWithin } from '../tiles.ts';

const HOME = tileIdFor(44.058, -121.315);

describe('chapter data', () => {
  it('has three chapters, in order, each with a rule and a letter', () => {
    assert.equal(CHAPTERS.length, 3);
    assert.deepEqual(CHAPTERS.map((c) => c.id), ['ch-1', 'ch-2', 'ch-3']);
    for (const c of QUEST_DATA.chapters) {
      assert.ok(c.letter.length > 0);
      // Leave room in the 512-byte memo for the code line.
      assert.ok(new TextEncoder().encode(c.letter).length <= 400, `${c.id} letter too long`);
    }
  });

  it('no chapter rule names a place', () => {
    const json = JSON.stringify(QUEST_DATA.chapters);
    assert.equal(/fl\d+:-?\d+:-?\d+/.test(json), false, 'a tile id in a chapter');
    assert.equal(/-?\d{1,3}\.\d{3,}/.test(json), false, 'a coordinate in a chapter');
  });
});

describe('newCells rule', () => {
  const rule = { kind: 'newCells' as const, n: 3 };
  const ring = tilesWithin(HOME, 1);

  it('counts only cells absent from the atlas before the ride', () => {
    assert.deepEqual(evaluateRule(rule, ring, []), { done: true, have: 7, need: 3 });
    assert.equal(evaluateRule(rule, ring, ring.slice(0, 5)).have, 2);
    assert.equal(evaluateRule(rule, ring, ring.slice(0, 5)).done, false);
  });

  it('a re-ride of known ground completes nothing', () => {
    assert.equal(evaluateRule(rule, ring, ring).done, false);
  });

  it('duplicate tiles do not pad the count', () => {
    assert.equal(evaluateRule(rule, [HOME, HOME, HOME], []).have, 1);
  });
});

describe('frontier rule', () => {
  const rule = { kind: 'frontier' as const, n: 3 };
  const known = tilesWithin(HOME, 2);
  const far = tilesWithin(HOME, 6).filter((t) => !tilesWithin(HOME, 4).includes(t));

  it('needs a cleared atlas to have a frontier at all', () => {
    assert.equal(evaluateRule(rule, far, []).done, false);
  });

  it('is met by a new cell far enough beyond everything known', () => {
    const r = evaluateRule(rule, far, known);
    assert.equal(r.done, true);
    assert.ok(r.have >= 3);
  });

  it('is not met by pushing just past the edge', () => {
    const edge = tilesWithin(HOME, 3).filter((t) => !known.includes(t));
    const r = evaluateRule(rule, edge, known);
    assert.equal(r.have, 1);
    assert.equal(r.done, false);
  });
});

describe('codes', () => {
  it('normalise forgiving input into ABCD-EFGH', () => {
    assert.equal(normaliseCode('abcd efgh'), 'ABCD-EFGH');
    assert.equal(normaliseCode(' AB-CD-EF-GH '), 'ABCD-EFGH');
  });

  it('reject wrong length and ambiguous characters', () => {
    assert.equal(normaliseCode('ABC-EFGH'), null);
    assert.equal(normaliseCode('ABCD-EFG0'), null); // zero
    assert.equal(normaliseCode('ABCD-EFGI'), null); // capital i
  });
});

describe('chain state', () => {
  it('a letter moves on and waits for its code', () => {
    const s1 = afterLetter(START, 0);
    assert.deepEqual(s1, { v: 1, chapter: 1, awaitingCode: true, code: null });
    const s2 = withCode(s1, 'abcd-efgh')!;
    assert.equal(s2.code, 'ABCD-EFGH');
    assert.equal(s2.awaitingCode, false);
    assert.equal(withCode(s1, 'nope'), null);
  });

  it('a stale letter for another chapter changes nothing', () => {
    assert.deepEqual(afterLetter(START, 2), START);
  });

  it('the last letter finishes the chain with nothing to wait for', () => {
    const done = afterLetter({ v: 1, chapter: 2, awaitingCode: false, code: 'ABCD-EFGH' }, 2);
    assert.equal(isFinished(done), true);
    assert.equal(done.awaitingCode, false);
  });

  it('a rejected code asks again', () => {
    const s = codeRejected({ v: 1, chapter: 1, awaitingCode: false, code: 'ABCD-EFGH' });
    assert.equal(s.awaitingCode, true);
    assert.equal(s.code, null);
  });

  it('parses tampered storage safely', () => {
    assert.deepEqual(parseChain(null), START);
    assert.deepEqual(parseChain('junk'), START);
    const p = parseChain(JSON.stringify({ chapter: 99, code: '44.0581', awaitingCode: 'yes' }));
    assert.equal(p.chapter, CHAPTERS.length);
    assert.equal(p.code, null);
    assert.equal(p.awaitingCode, false);
  });
});
