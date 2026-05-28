/**
 * MockWallet - in-memory wallet for development on simulator and Node tests.
 *
 * Simulates sync progress, generates a plausible-looking Unified Address,
 * and lets tests inject incoming payouts via the `credit()` helper. The
 * UI can be fully exercised against this implementation without a real
 * device or lightwalletd connection.
 *
 * Swap in `NativeWallet` from './nativeWallet.ts' in App.tsx for real
 * shielded transactions on device.
 */

import type {
  Balance,
  BalanceListener,
  SyncListener,
  SyncStatus,
  Transaction,
  WalletAddress,
  Zatoshi,
} from './types.ts';
import type {
  Wallet,
  WalletInitParams,
} from './walletInterface.ts';
import type {
  SendParams,
  SendResult,
} from './types.ts';

const ZAT_PER_ZEC = 100_000_000n;
/** ZIP-317 conventional fee. */
const DEFAULT_FEE_ZATOSHI: Zatoshi = 10_000n;
/** A plausible recent Zcash mainnet height (mock starting point). */
const MOCK_BASE_HEIGHT = 2_900_000;

export interface MockWalletOptions {
  /** Pre-seed the wallet with a balance, for tests / demos. */
  initialZatoshi?: Zatoshi;
  /** Sim sync tick interval. Default 50ms; tests use lower. */
  syncTickMs?: number;
}

export class MockWallet implements Wallet {
  private initialized = false;
  private address: WalletAddress | null = null;
  private balance: Balance = {
    verifiedZatoshi: 0n,
    pendingZatoshi: 0n,
    totalZatoshi: 0n,
  };
  private sync: SyncStatus = {
    phase: 'idle',
    progress: 0,
    lastScannedHeight: 0,
    chainTipHeight: 0,
  };
  private txs: Transaction[] = [];
  private syncListeners = new Set<SyncListener>();
  private balanceListeners = new Set<BalanceListener>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private nextHeight = MOCK_BASE_HEIGHT;
  private opts: Required<MockWalletOptions>;

  constructor(opts: MockWalletOptions = {}) {
    this.opts = {
      initialZatoshi: opts.initialZatoshi ?? 0n,
      syncTickMs: opts.syncTickMs ?? 50,
    };
  }

  async init(params: WalletInitParams): Promise<void> {
    // Generate a stable mock UA-ish address from the first word of the seed.
    const seedTag = (params.seedPhrase.words[0] ?? 'seed').toLowerCase();
    const tag = seedTag.padEnd(8, '0').slice(0, 8);
    this.address = {
      ua: `u1mock${tag}${'x'.repeat(60)}`,
    };
    this.balance = {
      verifiedZatoshi: this.opts.initialZatoshi,
      pendingZatoshi: 0n,
      totalZatoshi: this.opts.initialZatoshi,
    };
    this.sync = {
      phase: 'idle',
      progress: 0,
      lastScannedHeight:
        params.seedPhrase.birthdayHeight ?? MOCK_BASE_HEIGHT - 1000,
      chainTipHeight: MOCK_BASE_HEIGHT,
    };
    this.initialized = true;
  }

  async getAddress(): Promise<WalletAddress> {
    this.assertInit();
    return this.address as WalletAddress;
  }

  async getBalance(): Promise<Balance> {
    this.assertInit();
    return this.balance;
  }

  async getSyncStatus(): Promise<SyncStatus> {
    this.assertInit();
    return this.sync;
  }

  async startSync(): Promise<void> {
    this.assertInit();
    if (this.syncTimer) return;
    this.setSync({ ...this.sync, phase: 'scanning' });
    this.syncTimer = setInterval(() => {
      const nextProgress = Math.min(1, this.sync.progress + 0.1);
      const heightDelta = Math.floor(
        (this.sync.chainTipHeight - this.sync.lastScannedHeight) * 0.1,
      );
      const newScanned = this.sync.lastScannedHeight + heightDelta;
      if (nextProgress >= 1) {
        this.setSync({
          ...this.sync,
          phase: 'synced',
          progress: 1,
          lastScannedHeight: this.sync.chainTipHeight,
        });
        if (this.syncTimer) {
          clearInterval(this.syncTimer);
          this.syncTimer = null;
        }
      } else {
        this.setSync({
          ...this.sync,
          progress: nextProgress,
          lastScannedHeight: newScanned,
        });
      }
    }, this.opts.syncTickMs);
  }

  async stopSync(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.setSync({ ...this.sync, phase: 'idle' });
  }

  async send(params: SendParams): Promise<SendResult> {
    this.assertInit();
    const fee = params.feeZatoshi ?? DEFAULT_FEE_ZATOSHI;
    const total = params.amountZatoshi + fee;
    if (total > this.balance.verifiedZatoshi) {
      throw new Error(
        `Insufficient funds: need ${total} zatoshi, have ${this.balance.verifiedZatoshi}`,
      );
    }
    const txid = `mocktxid${this.txs.length.toString().padStart(8, '0')}${'a'.repeat(48)}`;
    const blockHeight = ++this.nextHeight;
    this.txs.unshift({
      txid,
      blockHeight,
      blockTime: Math.floor(Date.now() / 1000),
      isIncoming: false,
      valueZatoshi: -total,
      memo: params.memo,
    });
    this.setBalance({
      verifiedZatoshi: this.balance.verifiedZatoshi - total,
      pendingZatoshi: this.balance.pendingZatoshi,
      totalZatoshi: this.balance.totalZatoshi - total,
    });
    return { txid, feeZatoshi: fee };
  }

  async listTransactions(limit = 50): Promise<Transaction[]> {
    return this.txs.slice(0, limit);
  }

  async close(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.initialized = false;
  }

  onSyncStatusChange(listener: SyncListener): () => void {
    this.syncListeners.add(listener);
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  onBalanceChange(listener: BalanceListener): () => void {
    this.balanceListeners.add(listener);
    return () => {
      this.balanceListeners.delete(listener);
    };
  }

  // --- Test-only helpers (NOT part of the Wallet interface) -----------

  /**
   * Simulate an incoming shielded payout (e.g. from the Pedalshield
   * FROST treasury). Records a tx and increments verified balance.
   */
  credit(zatoshi: Zatoshi, memo?: string): Transaction {
    this.assertInit();
    const txid = `mockincoming${this.txs.length.toString().padStart(4, '0')}${'b'.repeat(48)}`;
    const tx: Transaction = {
      txid,
      blockHeight: ++this.nextHeight,
      blockTime: Math.floor(Date.now() / 1000),
      isIncoming: true,
      valueZatoshi: zatoshi,
      memo,
    };
    this.txs.unshift(tx);
    this.setBalance({
      verifiedZatoshi: this.balance.verifiedZatoshi + zatoshi,
      pendingZatoshi: this.balance.pendingZatoshi,
      totalZatoshi: this.balance.totalZatoshi + zatoshi,
    });
    return tx;
  }

  // --- Internal -------------------------------------------------------

  private setSync(next: SyncStatus): void {
    this.sync = next;
    for (const l of this.syncListeners) l(next);
  }

  private setBalance(next: Balance): void {
    this.balance = next;
    for (const l of this.balanceListeners) l(next);
  }

  private assertInit(): void {
    if (!this.initialized) {
      throw new Error('MockWallet not initialised. Call init() first.');
    }
  }
}

/** Convert a human-readable ZEC string (e.g. "0.5") to zatoshi bigint. */
export function zecToZatoshi(zec: string): Zatoshi {
  const [whole, frac = ''] = zec.split('.');
  const fracPadded = frac.padEnd(8, '0').slice(0, 8);
  return BigInt(whole) * ZAT_PER_ZEC + BigInt(fracPadded);
}

/** Convert zatoshi bigint to a human-readable ZEC string. */
export function zatoshiToZec(zat: Zatoshi): string {
  const whole = zat / ZAT_PER_ZEC;
  const frac = zat % ZAT_PER_ZEC;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '') || '0';
  return `${whole}.${fracStr}`;
}
