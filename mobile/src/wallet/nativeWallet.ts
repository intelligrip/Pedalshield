/**
 * NativeWallet - React Native bridge to the Zcash light-client SDKs.
 *
 *   Android: cash.z.ecc.android.sdk.* (zcash-android-wallet-sdk)
 *   iOS:     ZcashLightClientKit
 *
 * The Kotlin and Swift modules in `mobile/native/` expose the same async
 * surface as the `Wallet` interface. BigInt values cross the bridge as
 * decimal strings; this file converts at the boundary.
 *
 * NOT imported by Node tests (would fail to resolve `react-native`).
 * The MockWallet is the unit-tested implementation; this file is exercised
 * on real devices during the integration sprint.
 */

import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  Balance,
  SendParams,
  SendResult,
  SyncStatus,
  Transaction,
  WalletAddress,
  Zatoshi,
} from './types.ts';
import type {
  BalanceListener,
  SyncListener,
  Wallet,
  WalletInitParams,
} from './walletInterface.ts';

interface NativeBalance {
  verifiedZatoshi: string;
  pendingZatoshi: string;
  totalZatoshi: string;
}

interface NativeTransaction {
  txid: string;
  blockHeight: number | null;
  blockTime: number | null;
  isIncoming: boolean;
  valueZatoshi: string;
  memo?: string;
}

interface NativeWalletModule {
  initialize(params: {
    network: 'mainnet' | 'testnet';
    lightwalletdHost: string;
    seedWords: string[];
    birthdayHeight: number | null;
    storageDir: string;
  }): Promise<void>;
  getAddress(): Promise<WalletAddress>;
  getBalance(): Promise<NativeBalance>;
  getSyncStatus(): Promise<SyncStatus>;
  startSync(): Promise<void>;
  stopSync(): Promise<void>;
  send(params: {
    toAddress: string;
    amountZatoshi: string;
    memo?: string;
    feeZatoshi?: string;
  }): Promise<{ txid: string; feeZatoshi: string }>;
  listTransactions(limit: number): Promise<NativeTransaction[]>;
  close(): Promise<void>;
}

const Module = (NativeModules as Record<string, unknown>)
  .PedalshieldWallet as NativeWalletModule | undefined;

const Emitter = Module
  ? new NativeEventEmitter(Module as unknown as object)
  : null;

function requireModule(): NativeWalletModule {
  if (!Module) {
    throw new Error(
      'PedalshieldWallet native module not linked. ' +
        'Run `npx expo prebuild` and ensure the modules in ' +
        'mobile/native/* are registered. See mobile/native/README.md.',
    );
  }
  return Module;
}

function toBalance(raw: NativeBalance): Balance {
  return {
    verifiedZatoshi: BigInt(raw.verifiedZatoshi),
    pendingZatoshi: BigInt(raw.pendingZatoshi),
    totalZatoshi: BigInt(raw.totalZatoshi),
  };
}

function toTransaction(raw: NativeTransaction): Transaction {
  return { ...raw, valueZatoshi: BigInt(raw.valueZatoshi) };
}

export class NativeWallet implements Wallet {
  async init(params: WalletInitParams): Promise<void> {
    await requireModule().initialize({
      network: params.network,
      lightwalletdHost: params.lightwalletdHost,
      seedWords: params.seedPhrase.words,
      birthdayHeight: params.seedPhrase.birthdayHeight ?? null,
      storageDir: params.storageDir,
    });
  }

  async getAddress(): Promise<WalletAddress> {
    return await requireModule().getAddress();
  }

  async getBalance(): Promise<Balance> {
    return toBalance(await requireModule().getBalance());
  }

  async getSyncStatus(): Promise<SyncStatus> {
    return await requireModule().getSyncStatus();
  }

  async startSync(): Promise<void> {
    await requireModule().startSync();
  }

  async stopSync(): Promise<void> {
    await requireModule().stopSync();
  }

  async send(params: SendParams): Promise<SendResult> {
    const r = await requireModule().send({
      toAddress: params.toAddress,
      amountZatoshi: params.amountZatoshi.toString(),
      memo: params.memo,
      feeZatoshi: params.feeZatoshi?.toString(),
    });
    return { txid: r.txid, feeZatoshi: BigInt(r.feeZatoshi) };
  }

  async listTransactions(limit = 50): Promise<Transaction[]> {
    const txs = await requireModule().listTransactions(limit);
    return txs.map(toTransaction);
  }

  async close(): Promise<void> {
    await requireModule().close();
  }

  onSyncStatusChange(listener: SyncListener): () => void {
    if (!Emitter) return () => undefined;
    const sub = Emitter.addListener('syncStatus', (raw: unknown) =>
      listener(raw as SyncStatus),
    );
    return () => sub.remove();
  }

  onBalanceChange(listener: BalanceListener): () => void {
    if (!Emitter) return () => undefined;
    const sub = Emitter.addListener('balance', (raw: unknown) =>
      listener(toBalance(raw as NativeBalance)),
    );
    return () => sub.remove();
  }
}

// Re-export Zatoshi type for ergonomic imports in app code.
export type { Zatoshi };
