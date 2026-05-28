//
//  PedalshieldWallet.swift
//
//  Pedalshield wallet - iOS native module.
//
//  Bridges the React Native JS layer in
//  `mobile/src/wallet/nativeWallet.ts` to Electric Coin Company's
//  ZcashLightClientKit. The Objective-C bridge in PedalshieldWallet.m
//  exposes these methods to JavaScript.
//
//  Conventions:
//    - Zatoshi values cross the bridge as decimal strings (JS bigint).
//    - Methods return via Promise resolve / reject blocks.
//    - syncStatus + balance updates are emitted via RCTEventEmitter.
//
//  Every `// TODO: SDK` comment marks a call that must be verified
//  against the pinned ZcashLightClientKit version. The RN bridge
//  patterns (@objc, RCTPromise*, supportedEvents) are stable.
//

import Foundation
// TODO: verify import against the pinned ZcashLightClientKit version
// import ZcashLightClientKit

@objc(PedalshieldWallet)
class PedalshieldWallet: RCTEventEmitter {

    // private var synchronizer: Synchronizer?
    private var hasListeners = false

    override static func requiresMainQueueSetup() -> Bool { return false }

    override func supportedEvents() -> [String]! {
        return ["syncStatus", "balance"]
    }

    override func startObserving() { hasListeners = true }
    override func stopObserving()  { hasListeners = false }

    @objc(initialize:resolver:rejecter:)
    func initialize(
        _ params: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK
        // let networkStr = params["network"] as? String ?? "mainnet"
        // let network: ZcashNetwork = (networkStr == "mainnet") ? .mainnet : .testnet
        // let seedWords = params["seedWords"] as? [String] ?? []
        // let birthday  = params["birthdayHeight"] as? NSNumber
        // let host      = (params["lightwalletdHost"] as? String) ?? ""
        // let parts     = host.split(separator: ":")
        // let endpoint  = LightWalletEndpoint(
        //     address: String(parts[0]),
        //     port: Int(parts[1]) ?? 9067,
        //     secure: true
        // )
        // ...construct Initializer + Synchronizer per SDK docs and start
        //    collectors that call sendEvent(withName:body:) for syncStatus / balance.
        resolve(nil)
    }

    @objc(getAddress:rejecter:)
    func getAddress(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK
        // Task {
        //   do {
        //     let ua = try await synchronizer.getUnifiedAddress(accountIndex: 0)
        //     resolve(["ua": ua.stringEncoded])
        //   } catch { reject("ADDRESS_FAILED", error.localizedDescription, error) }
        // }
        resolve(["ua": ""])
    }

    @objc(getBalance:rejecter:)
    func getBalance(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK
        // Task {
        //   do {
        //     let bal = try await synchronizer.getAccountBalance(accountIndex: 0)
        //     resolve([
        //       "verifiedZatoshi": String(bal.saplingBalance.spendable.amount + bal.orchardBalance.spendable.amount),
        //       "pendingZatoshi":  String(bal.unshielded.amount),
        //       "totalZatoshi":    String(bal.saplingBalance.total.amount + bal.orchardBalance.total.amount),
        //     ])
        //   } catch { reject("BALANCE_FAILED", error.localizedDescription, error) }
        // }
        resolve([
            "verifiedZatoshi": "0",
            "pendingZatoshi": "0",
            "totalZatoshi": "0",
        ])
    }

    @objc(getSyncStatus:rejecter:)
    func getSyncStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve([
            "phase": "idle",
            "progress": 0,
            "lastScannedHeight": 0,
            "chainTipHeight": 0,
        ])
    }

    @objc(startSync:rejecter:)
    func startSync(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK - synchronizer.start() ; start state collectors
        resolve(nil)
    }

    @objc(stopSync:rejecter:)
    func stopSync(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK - synchronizer.stop()
        resolve(nil)
    }

    @objc(send:resolver:rejecter:)
    func send(
        _ params: NSDictionary,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK
        // let amountStr = (params["amountZatoshi"] as? String) ?? "0"
        // let amount = Zatoshi(Int64(amountStr) ?? 0)
        // let toAddress = (params["toAddress"] as? String) ?? ""
        // let memo = params["memo"] as? String
        // Task {
        //   do {
        //     let tx = try await synchronizer.sendToAddress(
        //         spendingKey: spendingKey, zatoshi: amount,
        //         toAddress: Recipient(toAddress, network: .mainnet),
        //         memo: try Memo(string: memo ?? "")
        //     )
        //     resolve(["txid": tx.rawID.toHexStringTxId(), "feeZatoshi": "10000"])
        //   } catch { reject("SEND_FAILED", error.localizedDescription, error) }
        // }
        resolve(["txid": "", "feeZatoshi": "10000"])
    }

    @objc(listTransactions:resolver:rejecter:)
    func listTransactions(
        _ limit: NSNumber,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK - synchronizer.allTransactions().prefix(limit)
        resolve([])
    }

    @objc(close:rejecter:)
    func close(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // TODO: SDK - synchronizer?.stop(); synchronizer = nil
        resolve(nil)
    }
}
