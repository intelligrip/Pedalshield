/**
 * zcashNetwork - live mainnet connectivity probe.
 *
 * Polls a public Zcash block explorer for the current mainnet block
 * height. The point isn't analytics; it's *proof on screen* that the
 * app is talking to Zcash mainnet, not a mock. Bonus: ticking numbers
 * make demos feel alive.
 *
 * We deliberately do NOT query the treasury UA balance: shielded
 * balances aren't externally observable (that's the whole point), and
 * faking one in the UI would betray the privacy story we're selling.
 * Instead we show network status + height + the public treasury UA
 * prefix, with a note that the balance itself is private by design.
 */

export interface ZcashNetworkStatus {
  height: number;
  /** Approximate timestamp (ms since epoch) of the most recent block. */
  lastBlockMs: number | null;
  /** ISO source string for attribution. */
  source: string;
  /** Set true while a fetch is in flight. */
  fetching: boolean;
  /** Last error message, if any. */
  error: string | null;
}

const EMPTY: ZcashNetworkStatus = {
  height: 0,
  lastBlockMs: null,
  source: 'blockchair.com/zcash',
  fetching: false,
  error: null,
};

const ENDPOINT = 'https://api.blockchair.com/zcash/stats';

export async function fetchZcashNetworkStatus(): Promise<ZcashNetworkStatus> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { ...EMPTY, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      data?: {
        blocks?: number;
        best_block_time?: string;
      };
    };
    const height = json?.data?.blocks ?? 0;
    const lastBlockMs = json?.data?.best_block_time
      ? Date.parse(json.data.best_block_time + 'Z')
      : null;
    return {
      ...EMPTY,
      height,
      lastBlockMs: Number.isFinite(lastBlockMs ?? NaN) ? lastBlockMs : null,
    };
  } catch (e) {
    return { ...EMPTY, error: (e as Error).message ?? 'fetch failed' };
  }
}

/**
 * Treasury UA prefix - publicly known. For the demo we show only the
 * prefix; full address is in `docs/TREASURY.md`. (Even the full UA is
 * non-secret; balance, recipients, and txs are all shielded.)
 */
export const PEDALSHIELD_TREASURY_UA_PREFIX = 'u1rsa5p9...';
