/**
 * Wallet singleton.
 *
 * App init picks the implementation:
 *
 *   // In App.tsx, on a real device build:
 *   import { NativeWallet } from './wallet/nativeWallet';
 *   setWallet(new NativeWallet());
 *
 *   // In Storybook / simulator / dev:
 *   import { MockWallet } from './wallet/mockWallet';
 *   setWallet(new MockWallet({ initialZatoshi: zecToZatoshi('0.5') }));
 *
 * Screens and services then call `getWallet()` and don't care which
 * implementation is wired.
 */

import type { Wallet } from './walletInterface.ts';

let instance: Wallet | null = null;

export function setWallet(wallet: Wallet): void {
  instance = wallet;
}

export function getWallet(): Wallet {
  if (!instance) {
    throw new Error(
      'Wallet not configured. Call setWallet(new MockWallet() | new NativeWallet()) during app init.',
    );
  }
  return instance;
}

export function clearWallet(): void {
  instance = null;
}

export function hasWallet(): boolean {
  return instance !== null;
}
