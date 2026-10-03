/**
 * Fogline quests — public, hard-coded, identical on device and server.
 *
 * Two copies, one truth: `QUEST_DATA` below for the app, `quests.json` for
 * the Rust backend (embedded with `include_str!`). `quests.test.ts` fails if
 * they differ by a single byte of meaning, so the predicate the phone shows
 * and the predicate the treasury pays on cannot drift apart. (JSON is not
 * imported directly because Node's test runner and Metro disagree on JSON
 * import attributes.)
 *
 * A quest is a set of public tiles and a threshold: touch at least `need` of
 * them in ONE ride. Per-ride rather than cumulative on purpose — the server
 * can then evaluate it from a single claim without ever holding a rider's
 * history, which is the whole privacy model.
 */

import { isTileId } from './tiles.ts';
import type { FoglineQuest } from './foglineClaim.ts';

export interface QuestStop {
  label: string;
  tile: string;
}

export interface Quest extends FoglineQuest {
  title: string;
  blurb: string;
  need: number;
  stops: QuestStop[];
}

export interface QuestProgress {
  hit: string[];
  need: number;
  complete: boolean;
}

export const QUEST_DATA = {
  "version": 1,
  "quests": [
    {
      "id": "q-bend-river-line",
      "title": "The River Line",
      "blurb": "Clear the fog along the Deschutes. Touch any 3 of the 5 river cells in one ride.",
      "need": 3,
      "stops": [
        {
          "label": "Riverbend",
          "tile": "fl1:-30067:11400"
        },
        {
          "label": "Old Mill",
          "tile": "fl1:-30067:11402"
        },
        {
          "label": "Drake Park",
          "tile": "fl1:-30069:11405"
        },
        {
          "label": "Pioneer Park",
          "tile": "fl1:-30069:11408"
        },
        {
          "label": "First Street Rapids",
          "tile": "fl1:-30071:11410"
        }
      ],
      "letter": "FOGLINE · THE RIVER LINE\nYou followed the water through the fog. The river keeps no record of who passes. Neither do we."
    }
  ],
  "chapters": [
    {
      "id": "ch-1",
      "title": "First Light",
      "brief": "Clear 3 cells you have never touched, in one ride.",
      "rule": {
        "kind": "newCells",
        "n": 3
      },
      "letter": "FOGLINE · LETTER 1\nYou rode into the fog and it gave way. Few do. The city keeps its own map, and now it has noticed you.\nThe edges are thinner than they look. Go past them."
    },
    {
      "id": "ch-2",
      "title": "The Frontier",
      "brief": "In one ride, reach a new cell at least 3 cells beyond everything you have cleared.",
      "rule": {
        "kind": "frontier",
        "n": 3
      },
      "letter": "FOGLINE · LETTER 2\nYou went further than the map expected. Out there the fog remembers nothing — not your name, not your road. Keep it that way.\nOne more push. Go where it is darkest."
    },
    {
      "id": "ch-3",
      "title": "Into the Dark",
      "brief": "Clear 8 new cells in one ride.",
      "rule": {
        "kind": "newCells",
        "n": 8
      },
      "letter": "FOGLINE · LETTER 3\nYou cleared the line. No one knows the way you came, and no one ever will. The dark map is yours.\nThank you for riding. — the Fog"
    }
  ]
} as const;

function load(): Quest[] {
  const out: Quest[] = [];
  for (const q of QUEST_DATA.quests as unknown as Omit<Quest, 'tiles'>[]) {
    const stops = [...q.stops].filter((s) => isTileId(s.tile));
    const need = Math.max(1, Math.min(stops.length, Math.floor(q.need)));
    out.push({ ...q, stops, need, tiles: stops.map((s) => s.tile) });
  }
  return out;
}

export const QUESTS: readonly Quest[] = load();

/** The one live quest for v1. */
export function activeQuest(): Quest {
  return QUESTS[0];
}

/** Evaluate the quest against ONE ride's tiles. Pure. */
export function questProgress(quest: Quest, rideTiles: readonly string[]): QuestProgress {
  const ride = new Set(rideTiles);
  const hit = quest.tiles.filter((t) => ride.has(t)).sort();
  return { hit, need: quest.need, complete: hit.length >= quest.need };
}
