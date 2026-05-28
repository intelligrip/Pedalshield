/**
 * The Wallet contract. Both MockWallet (for simulator / Node tests) and
 * NativeWallet (RN bridge to ZcashLightClientKit / zcash-android-wallet-sdk)
 * implement this interface so the rest of the app is agnostic to which
 * one is in use.
 */

import type {
  Balance,
  Network,
  SeedPhrase,
  SendParams,
  SendResult,
  SyncStatus,
  Transaction,
  WalletAddress,
} from './types.ts';

export interface WalletInitParams {
  network: Network;
  /** e.g. "mainnet.lightwalletd.com:9067" */
  lightwalletdHost: string;
  seedPhrase: SeedPhrase;
  /** Native SDK writes sqlite + cache here. App document dir on device. */
  storageDir: string;
}

export type SyncListener = (status: SyncStatus) => void;
export type BalanceListener = (balance: Balance) => void;

export interface Wallet {
  /** Initialise from a seed phrase. Safe to call once per app launch. */
  init(params: WalletInitParams): Promise<void>;

  /** Get the receive address (Unified Address with Orchard receiver). */
  getAddress(): Promise<WalletAddress>;

  /** Current balance snapshot. */
  getBalance(): Promise<Balance>;

  /** Current sync state. */
  getSyncStatus(): Promise<SyncStatus>;

  /** Begin background sync against lightwalletd. */
  startSync(): Promise<void>;

  /** Pause background sync. */
  stopSync(): Promise<void>;

  /** Build and broadcast a shielded send (Orchard). */
  send(params: SendParams): Promise<SendResult>;

  /** Recent transactions, most recent first. */
  listTransactions(limit?: number): Promise<Transaction[]>;

  /** Tear down the wallet (closes the SDK Synchronizer). */
  close(): Promise<void>;

  /** Subscribe to sync state changes. Returns an unsubscribe function. */
  onSyncStatusChange(listener: SyncListener): () => void;

  /** Subscribe to balance changes. Returns an unsubscribe function. */
  onBalanceChange(listener: BalanceListener): () => void;
}
