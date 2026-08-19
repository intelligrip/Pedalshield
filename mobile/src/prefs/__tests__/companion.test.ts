/**
 * The companion's growth and rest states.
 *
 * The design rule under test is the important one: a gap makes the bike
 * RESTED, never sick, sad or disappointed. This is an exercise app — people
 * get injured, ill and overwhelmed, and a mechanic that punishes absence
 * catches exactly the person already struggling. If these fail, the app has
 * started guilting people.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES, restLabel, restState, stageFor } from '../companion.ts';

describe('growth stages', () => {
  it('there is a bike from the very first ride', () => {
    // detail 0 would render nothing and make a new rider think it's broken.
    assert.ok(STAGES[0].detail > 0.2);
    assert.equal(STAGES[0].miles, 0);
  });

  it('the first growth is reachable on day one or two', () => {
    // A first milestone weeks away teaches a new rider the app has nothing
    // for them.
    assert.ok(STAGES[1].miles <= 10, `first growth at ${STAGES[1].miles} mi`);
  });

  it('thresholds ascend and detail never decreases', () => {
    for (let i = 1; i < STAGES.length; i++) {
      assert.ok(STAGES[i].miles > STAGES[i - 1].miles);
      assert.ok(STAGES[i].detail >= STAGES[i - 1].detail);
    }
  });

  it('measures progress from the current stage, not from zero', () => {
    // 600 miles is 47% of the way from 250 to 1000. Showing 60% of a bar
    // toward 1000 would be true and useless.
    const p = stageFor(600);
    assert.equal(p.stage.miles, 250);
    assert.equal(p.next?.miles, 1000);
    assert.ok(Math.abs(p.fraction - 0.4667) < 0.01, `got ${p.fraction}`);
  });

  it('handles zero, fractional and enormous mileage', () => {
    for (const m of [0, 0.4, 9.9, 4999, 999999]) {
      const p = stageFor(m);
      assert.ok(p.fraction >= 0 && p.fraction <= 1, `fraction at ${m}`);
      assert.ok(p.stage.detail > 0);
    }
  });

  it('is safe on malformed input', () => {
    assert.doesNotThrow(() => stageFor(NaN));
    assert.doesNotThrow(() => stageFor(-5));
    assert.equal(stageFor(NaN).stage.miles, 0);
  });

  it('fully grown reports no next stage', () => {
    assert.equal(stageFor(10_000).next, null);
  });
});

describe('rest states — never punish an absence', () => {
  it('a fresh install is new, not neglected', () => {
    assert.equal(restState(0, null), 'new');
  });

  it('riding today with a streak reads as thriving', () => {
    assert.equal(restState(5, 0), 'thriving');
  });

  it('a long gap is resting, never sick or sad', () => {
    for (const days of [8, 30, 200]) {
      assert.equal(restState(0, days), 'resting');
    }
  });

  it('no state label ever guilts the rider', () => {
    const banned =
      /miss|lonely|sad|abandon|forgot|neglect|disappoint|hungry|starv|dying|sick|weak/i;
    const cases: [number, number | null][] = [
      [0, null], [0, 0], [3, 0], [0, 3], [0, 30], [0, 365],
    ];
    for (const [streak, days] of cases) {
      const label = restLabel(restState(streak, days), streak);
      assert.ok(
        !banned.test(label),
        `guilt-shaped label after ${days} days: "${label}"`,
      );
    }
  });

  it('coming back after months is framed as ready, not as failure', () => {
    assert.match(restLabel(restState(0, 90), 0), /rested|ready/i);
  });
});
