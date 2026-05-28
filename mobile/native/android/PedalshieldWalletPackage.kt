package com.pedalshield.wallet

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers PedalshieldWalletModule with React Native.
 *
 * Add to MainApplication.kt:
 *
 *   override fun getPackages(): List<ReactPackage> {
 *       val packages = PackageList(this).packages
 *       packages.add(PedalshieldWalletPackage())
 *       return packages
 *   }
 */
class PedalshieldWalletPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> =
        listOf(PedalshieldWalletModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
