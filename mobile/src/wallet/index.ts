// Public API of the wallet module - the parts safe to import in any
// environment (including Node tests).
//
// NativeWallet must be imported directly from './nativeWallet' in app
// code, because it eagerly requires `react-native` and would break Node
// test runs if re-exported here.

export * from './types.ts';
export * from './walletInterface.ts';
export {
  MockWallet,
  zecToZatoshi,
  zatoshiToZec,
} from './mockWallet.ts';
export type { MockWalletOptions } from './mockWallet.ts';
export {
  setWallet,
  getWallet,
  clearWallet,
  hasWallet,
} from './walletManager.ts';
