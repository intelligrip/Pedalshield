/**
 * Pedalshield wallet - domain types.
 *
 * All zatoshi values are `bigint` in TypeScript and decimal strings when
 * crossing the React Native bridge to / from native code. See
 * `mobile/native/README.md` for the BigInt convention.
 */

export type Network = 'mainnet' | 'testnet';

/** Smallest Zcash unit. 1 ZEC = 100,000,000 zatoshi. */
export type Zatoshi = bigint;

export interface SeedPhrase {
  /** BIP-39 mnemonic - 24 words for Zcash. */
  words: string[];
  /**
   * Block height the wallet was created at. The light-client SDK will
   * skip blocks below this on first sync, which can save hours of
   * scanning. If omitted, the SDK will start from the sapling activation
   * height (very slow on first run).
   */
  birthdayHeight?: number;
}

export interface WalletAddress {
  /** Unified Address with at least an Orchard receiver (`u1...`). */
  ua: string;
  /** Optional Sapling fallback (`zs1...`) for older recipients. */
  sapling?: string;
  /** Optional transparent address (`t1...`). Not used by Pedalshield. */
  transparent?: string;
}

export interface Balance {
  /** Confirmed, available to spend. */
  verifiedZatoshi: Zatoshi;
  /** Incoming or unconfirmed. */
  pendingZatoshi: Zatoshi;
  /** verified + pending. */
  totalZatoshi: Zatoshi;
}

export type SyncPhase =
  | 'idle'
  | 'fetching_blocks'
  | 'scanning'
  | 'enhancing'
  | 'synced'
  | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** 0..1 */
  progress: number;
  /** last block height the wallet has scanned */
  lastScannedHeight: number;
  /** chain tip height per lightwalletd */
  chainTipHeight: number;
  errorMessage?: string;
}

export interface Transaction {
  txid: string;
  /** null if unconfirmed (mempool only). */
  blockHeight: number | null;
  /** Epoch seconds. null if unconfirmed. */
  blockTime: number | null;
  isIncoming: boolean;
  /**
   * Signed value: positive for incoming, negative for outgoing
   * (fee included in the negative outgoing amount).
   */
  valueZatoshi: Zatoshi;
  memo?: string;
}

export interface SendParams {
  toAddress: string;
  amountZatoshi: Zatoshi;
  memo?: string;
  /** Override the default ZIP-317 conventional fee (10_000 zatoshi). */
  feeZatoshi?: Zatoshi;
}

export interface SendResult {
  txid: string;
  feeZatoshi: Zatoshi;
}
