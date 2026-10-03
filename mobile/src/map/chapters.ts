/**
 * The letter chain — chapters whose rules are about HOW you explore, never
 * WHERE.
 *
 * Each chapter's rule is evaluated on the phone against this ride's tiles
 * and the atlas as it stood BEFORE the ride. Because no rule names a place,
 * a completed chapter tells the server nothing about location: it works in
 * any city, and the claim stays {v, rideId, questId, pass, code}.
 *
 * Finishing chapter N earns a letter: a shielded payment whose encrypted
 * memo carries the story and the code that opens chapter N+1. The code is
 * per-address and minted server-side, so it can only be read in the rider's
 * own wallet. The app never sees the wallet; the rider types the code in.
 *
 * Chain state on the phone is just {chapter, awaitingCode, code}. The server
 * holds the authoritative position per address and checks the code.
 *
 * Pure rules + a small storage adapter (same pattern as atlas.ts).
 */

import { QUEST_DATA } from './quests.ts';
import { tileDistance } from './tiles.ts';

export type ChapterRule =
  | { kind: 'newCells'; n: number }
  | { kind: 'frontier'; n: number };

export interface Chapter {
  id: string;
  title: string;
  brief: string;
  rule: ChapterRule;
}

export const CHAPTERS: readonly Chapter[] = (
  QUEST_DATA.chapters as unknown as Chapter[]
).map((c) => ({ id: c.id, title: c.title, brief: c.brief, rule: c.rule }));

/** Codes look like `ABCD-EFGH`: no I, O, 0 or 1, so they survive handwriting. */
export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normaliseCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8) return null;
  const code = `${s.slice(0, 4)}-${s.slice(4)}`;
  return CODE_PATTERN.test(code) ? code : null;
}

export interface RuleResult {
  done: boolean;
  /** Progress toward `need`, for the UI. */
  have: number;
  need: number;
}

/**
 * Evaluate a chapter rule. `atlasBefore` MUST be the atlas before this
 * ride was merged in, or every cell would already count as "known".
 */
export function evaluateRule(
  rule: ChapterRule,
  rideTiles: readonly string[],
  atlasBefore: readonly string[],
): RuleResult {
  const known = new Set(atlasBefore);
  const fresh = [...new Set(rideTiles)].filter((t) => !known.has(t));

  if (rule.kind === 'newCells') {
    return { done: fresh.length >= rule.n, have: fresh.length, need: rule.n };
  }

  // frontier: the farthest new cell's distance from everything known.
  if (known.size === 0) return { done: false, have: 0, need: rule.n };
  let best = 0;
  for (const t of fresh) {
    let nearest = Infinity;
    for (const k of known) {
      const d = tileDistance(t, k);
      if (d < nearest) nearest = d;
      if (nearest <= best) break; // cannot beat the current best
    }
    if (nearest !== Infinity && nearest > best) best = nearest;
  }
  return { done: best >= rule.n, have: best, need: rule.n };
}

/* ------------------------------------------------------------------ */
/* Chain state on the phone                                           */
/* ------------------------------------------------------------------ */

export interface ChainState {
  v: 1;
  /** Index into CHAPTERS of the chapter being played. CHAPTERS.length = finished. */
  chapter: number;
  /** A letter was sent; waiting for the rider to enter its code. */
  awaitingCode: boolean;
  /** Code that unlocks `chapter` (null for the first chapter). */
  code: string | null;
}

export const START: ChainState = { v: 1, chapter: 0, awaitingCode: false, code: null };

export function isFinished(s: ChainState): boolean {
  return s.chapter >= CHAPTERS.length;
}

export function parseChain(raw: string | null): ChainState {
  if (!raw) return { ...START };
  try {
    const p = JSON.parse(raw) as Partial<ChainState>;
    const chapter =
      Number.isInteger(p.chapter) && (p.chapter as number) >= 0
        ? Math.min(p.chapter as number, CHAPTERS.length)
        : 0;
    const code = typeof p.code === 'string' ? normaliseCode(p.code) : null;
    return { v: 1, chapter, awaitingCode: p.awaitingCode === true, code };
  } catch {
    return { ...START };
  }
}

/** A letter for `chapter` went out: move on and wait for its code. */
export function afterLetter(s: ChainState, chapter: number): ChainState {
  if (chapter !== s.chapter) return s;
  return { v: 1, chapter: s.chapter + 1, awaitingCode: s.chapter + 1 < CHAPTERS.length, code: null };
}

/** The rider typed the code from their letter. */
export function withCode(s: ChainState, raw: string): ChainState | null {
  const code = normaliseCode(raw);
  if (!code) return null;
  return { ...s, awaitingCode: false, code };
}

/** The server said the code was wrong: ask again. */
export function codeRejected(s: ChainState): ChainState {
  return { ...s, awaitingCode: true, code: null };
}

type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const STORAGE_KEY = 'fogline.chain.v1';
const memory: Record<string, string> = {};
const inMemory: StorageLike = {
  async getItem(k) {
    return k in memory ? memory[k] : null;
  },
  async setItem(k, v) {
    memory[k] = v;
  },
};

function resolveStorage(): StorageLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const AS = mod?.default ?? mod;
    if (AS && typeof AS.getItem === 'function') return AS as StorageLike;
  } catch {
    /* in-memory under node */
  }
  return inMemory;
}

const storage = resolveStorage();
let _chain: ChainState = { ...START };
let _loaded = false;
const listeners = new Set<(s: ChainState) => void>();

export function onChainChange(cb: (s: ChainState) => void): () => void {
  listeners.add(cb);
  cb(_chain);
  return () => {
    listeners.delete(cb);
  };
}

export function getChain(): ChainState {
  return _chain;
}

export async function loadChain(): Promise<ChainState> {
  if (_loaded) return _chain;
  try {
    _chain = parseChain(await storage.getItem(STORAGE_KEY));
  } catch {
    _chain = { ...START };
  }
  _loaded = true;
  for (const cb of listeners) cb(_chain);
  return _chain;
}

export async function saveChain(next: ChainState): Promise<ChainState> {
  _chain = next;
  _loaded = true;
  for (const cb of listeners) cb(_chain);
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(_chain));
  } catch {
    /* best effort */
  }
  return _chain;
}
