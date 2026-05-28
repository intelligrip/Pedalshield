package com.pedalshield.wallet

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// TODO: verify exact imports against the zcash-android-wallet-sdk version
// pinned in android/app/build.gradle. The classes below are the
// conceptual touch points; check class names + signatures before first
// device build.
//
// import cash.z.ecc.android.sdk.Synchronizer
// import cash.z.ecc.android.sdk.WalletInitMode
// import cash.z.ecc.android.sdk.model.ZcashNetwork
// import cash.z.ecc.android.sdk.model.LightWalletEndpoint
// import cash.z.ecc.android.sdk.model.UnifiedAddress
// import cash.z.ecc.android.sdk.model.Zatoshi

/**
 * Pedalshield wallet - Android native module.
 *
 * Bridges the React Native JS layer in
 * `mobile/src/wallet/nativeWallet.ts` to Electric Coin Company's
 * zcash-android-wallet-sdk.
 *
 * Conventions:
 *   - All zatoshi values cross the bridge as decimal strings (JS bigint).
 *   - All methods return a Promise; errors are surfaced via reject().
 *   - sync + balance updates are emitted as DeviceEventEmitter events
 *     ("syncStatus", "balance").
 *
 * Every `// TODO: SDK` comment marks a point where the exact SDK call
 * must be verified against the pinned SDK version's docs. The RN module
 * patterns (annotations, Promise resolution, event emission) are stable
 * across SDK versions.
 */
class PedalshieldWalletModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // private var synchronizer: Synchronizer? = null
    private var syncCollectJob: Job? = null
    private var balanceCollectJob: Job? = null

    override fun getName(): String = MODULE_NAME

    @ReactMethod
    fun initialize(params: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // val network = if (params.getString("network") == "mainnet")
                //     ZcashNetwork.Mainnet else ZcashNetwork.Testnet
                //
                // val hostPort = params.getString("lightwalletdHost")!!
                // val endpoint = LightWalletEndpoint(
                //     host = hostPort.substringBefore(":"),
                //     port = hostPort.substringAfter(":").toInt(),
                //     isSecure = true,
                // )
                //
                // val seedArray = params.getArray("seedWords")!!
                // val seedWords = (0 until seedArray.size())
                //     .map { seedArray.getString(it) }
                //
                // val birthday = if (params.hasKey("birthdayHeight") &&
                //                    !params.isNull("birthdayHeight"))
                //     params.getInt("birthdayHeight") else null
                //
                // synchronizer = Synchronizer.new(
                //     context = reactContext,
                //     zcashNetwork = network,
                //     lightWalletEndpoint = endpoint,
                //     seed = seedWords.joinToString(" ").toByteArray(),
                //     birthday = birthday,
                //     walletInitMode = WalletInitMode.NewWallet,
                // ) as Synchronizer
                //
                // startCollectors()
                promise.resolve(null)
            } catch (e: Throwable) {
                promise.reject("INIT_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getAddress(promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // val ua: UnifiedAddress = synchronizer!!.getUnifiedAddress(account = 0)
                val map = Arguments.createMap().apply {
                    putString("ua", "" /* ua.toString() */)
                }
                promise.resolve(map)
            } catch (e: Throwable) {
                promise.reject("ADDRESS_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getBalance(promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // val orchard = synchronizer!!.orchardBalances.value
                // val sapling = synchronizer!!.saplingBalances.value
                // val verified = (orchard?.available?.value ?: 0L) +
                //                (sapling?.available?.value ?: 0L)
                // val total    = (orchard?.total?.value ?: 0L) +
                //                (sapling?.total?.value ?: 0L)
                // val pending  = total - verified
                val map = Arguments.createMap().apply {
                    putString("verifiedZatoshi", "0")
                    putString("pendingZatoshi", "0")
                    putString("totalZatoshi", "0")
                }
                promise.resolve(map)
            } catch (e: Throwable) {
                promise.reject("BALANCE_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getSyncStatus(promise: Promise) {
        scope.launch {
            try {
                val map = Arguments.createMap().apply {
                    putString("phase", "idle")
                    putDouble("progress", 0.0)
                    putInt("lastScannedHeight", 0)
                    putInt("chainTipHeight", 0)
                }
                promise.resolve(map)
            } catch (e: Throwable) {
                promise.reject("STATUS_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun startSync(promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // synchronizer!!.start(scope)
                promise.resolve(null)
            } catch (e: Throwable) {
                promise.reject("SYNC_START_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopSync(promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // synchronizer?.close()
                promise.resolve(null)
            } catch (e: Throwable) {
                promise.reject("SYNC_STOP_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun send(params: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // val usk = synchronizer!!.getUnifiedSpendingKey(account = 0)
                // val amount = Zatoshi(params.getString("amountZatoshi")!!.toLong())
                // val toAddress = params.getString("toAddress")!!
                // val memo = params.getString("memo") ?: ""
                // val txId = synchronizer!!.sendToAddress(
                //     usk = usk, amount = amount,
                //     toAddress = toAddress, memo = memo,
                // )
                val map = Arguments.createMap().apply {
                    putString("txid", "" /* txId.txIdString() */)
                    putString("feeZatoshi", "10000")  // ZIP-317 conventional
                }
                promise.resolve(map)
            } catch (e: Throwable) {
                promise.reject("SEND_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun listTransactions(limit: Double, promise: Promise) {
        scope.launch {
            try {
                // TODO: SDK
                // val txs = synchronizer!!.transactions.first().take(limit.toInt())
                val arr = Arguments.createArray()
                promise.resolve(arr)
            } catch (e: Throwable) {
                promise.reject("LIST_TX_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun close(promise: Promise) {
        scope.launch {
            try {
                syncCollectJob?.cancel()
                balanceCollectJob?.cancel()
                // synchronizer?.close()
                // synchronizer = null
                promise.resolve(null)
            } catch (e: Throwable) {
                promise.reject("CLOSE_FAILED", e.message, e)
            }
        }
    }

    // --- RN EventEmitter required stubs (no-op on Android) ----------
    @ReactMethod fun addListener(eventName: String) { /* no-op */ }
    @ReactMethod fun removeListeners(count: Int) { /* no-op */ }

    private fun emit(event: String, payload: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    // private fun startCollectors() {
    //     // TODO: SDK - collect synchronizer.status, processorInfo,
    //     // orchardBalances flows and emit them as "syncStatus" / "balance"
    //     // events via `emit(...)`.
    // }

    companion object {
        const val MODULE_NAME = "PedalshieldWallet"
    }
}
