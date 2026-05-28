# Pedalshield native modules

React Native bridges from `mobile/src/wallet/nativeWallet.ts` to the Zcash light-client SDKs:

- **Android:** `cash.z.ecc.android.sdk.*` (Electric Coin Company's [zcash-android-wallet-sdk](https://github.com/zcash/zcash-android-wallet-sdk)).
- **iOS:** `ZcashLightClientKit` (Electric Coin Company).

Both modules expose the same async surface to the JS bridge:

| Method | Returns |
|---|---|
| `initialize(params)` | `void` |
| `getAddress()` | `{ ua, sapling?, transparent? }` |
| `getBalance()` | `{ verifiedZatoshi, pendingZatoshi, totalZatoshi }` (decimal strings) |
| `getSyncStatus()` | `{ phase, progress, lastScannedHeight, chainTipHeight }` |
| `startSync()`, `stopSync()`, `close()` | `void` |
| `send(params)` | `{ txid, feeZatoshi }` |
| `listTransactions(limit)` | array of `Transaction` |
| events | `syncStatus`, `balance` |

## Install — Android

1. Add the SDK in `android/app/build.gradle`:

   ```gradle
   dependencies {
       implementation "cash.z.ecc.android:zcash-android-sdk:<PINNED_VERSION>"
   }
   ```

2. Copy `android/PedalshieldWalletModule.kt` and `PedalshieldWalletPackage.kt` into:

   ```
   android/app/src/main/java/com/pedalshield/wallet/
   ```

3. Register the package in `MainApplication.kt`:

   ```kotlin
   override fun getPackages(): List<ReactPackage> {
       val packages = PackageList(this).packages
       packages.add(PedalshieldWalletPackage())
       return packages
   }
   ```

4. Rebuild:

   ```bash
   cd android && ./gradlew assembleDebug
   ```

5. Walk every `// TODO: SDK` comment in `PedalshieldWalletModule.kt` and verify the SDK class / method names against the pinned version's docs before the first device test.

## Install — iOS

1. Add `ZcashLightClientKit` to the iOS project (Swift Package or CocoaPods). Pin the version in `Package.swift` or `Podfile`.

2. Drop both files into the iOS project via Xcode (Add Files To... → app target):

   - `ios/PedalshieldWallet.swift`
   - `ios/PedalshieldWallet.m`

3. The Objective-C bridge file is required so React Native can discover the Swift class. `RCT_EXTERN_MODULE` and `RCT_EXTERN_METHOD` generate the bridging glue automatically.

4. Walk every `// TODO: SDK` comment in `PedalshieldWallet.swift` against the pinned ZcashLightClientKit version's docs before the first device test.

## BigInt convention

JS `bigint` values (zatoshi balances, amounts, fees) cross the bridge as decimal strings. Both native modules convert at the boundary to / from the SDK's `Zatoshi` type (`Long` in Kotlin, `Int64` in Swift). This avoids precision loss and matches the SDK types exactly.

## Mock for simulator and Node

During development on a simulator — or when running Node unit tests — the app uses [`MockWallet`](../src/wallet/mockWallet.ts) instead of these native modules. The mock simulates sync progress, balances, incoming payouts (`credit()` test helper), and outgoing sends, so the full UI loop is exercisable without a device or a `lightwalletd` connection. Swap in `NativeWallet` from `mobile/src/wallet/nativeWallet.ts` in `App.tsx` for the on-device build.

## Test approach

- `mobile/src/wallet/__tests__/mockWallet.test.ts` exercises the `Wallet` contract against `MockWallet` (runs in plain Node, no install needed).
- Native module behaviour is integration-tested on real devices during the Phase 3 sprint: build the app, perform a real shielded mainnet payout to the wallet's UA, verify the balance updates in-app and the txid appears on a Zcash block explorer.
