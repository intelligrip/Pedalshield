/**
 * Unit tests for the MockWallet - the implementation the UI is built
 * against. Real-device behaviour is integration-tested separately on
 * iOS / Android using the NativeWallet bridge.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MockWallet,
  zatoshiToZec,
  zecToZatoshi,
} from '../mockWallet.ts';
import type { Balance, SyncStatus } from '../types.ts';
import type { WalletInitParams } from '../walletInterface.ts';

const SEED_WORDS = [
  'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'abandon',
  'abandon', 'abandon', 'abandon', 'abandon', 'abandon', 'art',
];

const INIT: WalletInitParams = {
  network: 'mainnet',
  lightwalletdHost: 'mainnet.lightwalletd.com:9067',
  seedPhrase: { words: SEED_WORDS, birthdayHeight: 2_800_000 },
  storageDir: '/tmp/pedalshield-test-wallet',
};

describe('MockWallet - lifecycle', () => {
  it('initialises and exposes a Unified Address', async () => {
    const w = new MockWallet();
    await w.init(INIT);
    const addr = await w.getAddress();
    assert.ok(
      addr.ua.startsWith('u1'),
      `UA must start with u1, got: ${addr.ua}`,
    );
  });

  it('refuses operations before init', async () => {
    const w = new MockWallet();
    await assert.rejects(w.getAddress(), /not initialised/);
  });

  it('starts with zero balance unless seeded', async () => {
    const w = new MockWallet();
    await w.init(INIT);
    const b = await w.getBalance();
    assert.equal(b.verifiedZatoshi, 0n);
    assert.equal(b.totalZatoshi, 0n);
  });

  it('honours an initialZatoshi option', async () => {
    const w = new MockWallet({ initialZatoshi: zecToZatoshi('0.25') });
    await w.init(INIT);
    const b = await w.getBalance();
    assert.equal(b.verifiedZatoshi, 25_000_000n);
  });
});

describe('MockWallet - shielded payout simulation', () => {
  it('credits an incoming payout and emits a balance event', async () => {
    const w = new MockWallet();
    await w.init(INIT);

    const events: Balance[] = [];
    const off = w.onBalanceChange((b) => events.push(b));

    const payout = zecToZatoshi('0.05'); // 5,000,000 zatoshi
    w.credit(payout, 'Pedalshield ride payout - batch 1');

    const b = await w.getBalance();
    assert.equal(b.verifiedZatoshi, payout);
    assert.equal(events.length, 1);
    assert.equal(events[0].verifiedZatoshi, payout);

    const txs = await w.listTransactions();
    assert.equal(txs.length, 1);
    assert.equal(txs[0].isIncoming, true);
    assert.equal(txs[0].valueZatoshi, payout);
    assert.equal(txs[0].memo, 'Pedalshield ride payout - batch 1');

    off();
  });

  it('unsubscribes balance listeners cleanly', async () => {
    const w = new MockWallet();
    await w.init(INIT);
    const events: Balance[] = [];
    const off = w.onBalanceChange((b) => events.push(b));
    off();
    w.credit(zecToZatoshi('0.01'));
    assert.equal(events.length, 0);
  });
});

describe('MockWallet - send shielded', () => {
  it('debits balance with the ZIP-317 conventional fee', async () => {
    const w = new MockWallet({ initialZatoshi: zecToZatoshi('1.0') });
    await w.init(INIT);

    const result = await w.send({
      toAddress: 'u1someotheraddr',
      amountZatoshi: zecToZatoshi('0.1'),
      memo: 'upgrade: titanium frame',
    });

    assert.ok(result.txid.startsWith('mocktxid'));
    assert.equal(result.feeZatoshi, 10_000n); // ZIP-317 conventional

    const b = await w.getBalance();
    const expected =
      zecToZatoshi('1.0') - zecToZatoshi('0.1') - 10_000n;
    assert.equal(b.verifiedZatoshi, expected);

    const txs = await w.listTransactions();
    assert.equal(txs[0].isIncoming, false);
    assert.equal(txs[0].valueZatoshi, -(zecToZatoshi('0.1') + 10_000n));
  });

  it('rejects sends that exceed verified balance', async () => {
    const w = new MockWallet({ initialZatoshi: zecToZatoshi('0.01') });
    await w.init(INIT);

    await assert.rejects(
      w.send({ toAddress: 'u1abc', amountZatoshi: zecToZatoshi('1.0') }),
      /Insufficient funds/,
    );
  });
});

describe('MockWallet - sync simulation', () => {
  it('progresses to a fully synced state and emits events', async () => {
    const w = new MockWallet({ syncTickMs: 5 });
    await w.init(INIT);

    const events: SyncStatus[] = [];
    w.onSyncStatusChange((s) => events.push(s));

    await w.startSync();
    // Worst case: 10 ticks * 5ms = 50ms. Give it some slack.
    await new Promise((r) => setTimeout(r, 200));

    const final = await w.getSyncStatus();
    assert.equal(final.phase, 'synced');
    assert.equal(final.progress, 1);
    assert.ok(events.some((e) => e.phase === 'synced'));
    assert.ok(events.length >= 2, `expected progress events, got ${events.length}`);
  });
});

describe('zecToZatoshi / zatoshiToZec', () => {
  it('round-trips canonical amounts', () => {
    assert.equal(zecToZatoshi('1'), 100_000_000n);
    assert.equal(zecToZatoshi('0.5'), 50_000_000n);
    assert.equal(zecToZatoshi('0.00000001'), 1n);
    assert.equal(zatoshiToZec(100_000_000n), '1.0');
    assert.equal(zatoshiToZec(50_000_000n), '0.5');
    assert.equal(zatoshiToZec(1n), '0.00000001');
  });
});
