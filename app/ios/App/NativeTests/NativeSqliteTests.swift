import XCTest
import UIKit
import WebKit
@testable import App

/// Hosted XCTest 驱动实际 App 的 WKWebView；不使用浏览器数据库或 Mock。
@MainActor
final class NativeSqliteTests: XCTestCase {
    override func setUpWithError() throws {
        try OwnedSimulatorTestContext.requireOwnedSimulator()
    }

    func testRejectUnownedTestContexts() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("test-context-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        addTeardownBlock { try FileManager.default.removeItem(at: folder) }
        let file = folder.appendingPathComponent("context.json")
        let device = UUID().uuidString
        let good = ["simulatorId": device, "runId": UUID().uuidString, "appId": "com.mybill.offline"]
        try JSONSerialization.data(withJSONObject: good).write(to: file)
        let env = ["SIMULATOR_UDID": device, "MYBILL_TEST_CONTEXT_FILE": file.path]
        XCTAssertNoThrow(try OwnedSimulatorTestContext.validate(environment: env, simulator: true))
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: env, simulator: false))
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: [:], simulator: true))
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: ["SIMULATOR_UDID": UUID().uuidString, "MYBILL_TEST_CONTEXT_FILE": file.path], simulator: true))
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: ["SIMULATOR_UDID": device, "MYBILL_TEST_CONTEXT_FILE": file.path + ".missing"], simulator: true))
        var wrong = good
        wrong["appId"] = "other.app"
        try JSONSerialization.data(withJSONObject: wrong).write(to: file)
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: env, simulator: true))
        try Data("{}".utf8).write(to: file)
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: env, simulator: true))
        try Data(repeating: 32, count: 4097).write(to: file)
        XCTAssertThrowsError(try OwnedSimulatorTestContext.validate(environment: env, simulator: true))
        print("OWNED_SIMULATOR_GUARD_NEGATIVES_VERIFIED")
    }

    private func findWebView(in view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView { return webView }
        return view.subviews.lazy.compactMap { self.findWebView(in: $0) }.first
    }

    private func readyWebView() async throws -> WKWebView {
        // 同时等待原生窗口和随包 Vue 入口；有界等待，失败由 XCTest 明确报告。
        for _ in 0..<200 {
            let windows = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
            if let view = windows.compactMap({ $0.rootViewController?.view }).first,
               let webView = findWebView(in: view), webView.url != nil {
                let ready = try await webView.evaluateJavaScript(
                    "document.readyState === 'complete' && !!document.querySelector('[data-page-key=ledger-entry] h1') && window.Capacitor?.getPlatform() === 'ios'"
                )
                if ready as? Bool == true { return webView }
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw NSError(domain: "NativeSqliteTests", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "随包 Vue/原生桥未在 20 秒内就绪"])
    }

    func testBundledEntryAndNativeSqliteBridge() async throws {
        let webView = try await readyWebView()
        XCTAssertEqual(webView.url?.scheme, "capacitor")
        XCTAssertEqual(webView.url?.host, "localhost")
        let title = try await webView.evaluateJavaScript("document.querySelector('#app h1').textContent")
        XCTAssertEqual(title as? String, "记一笔")
        let remoteResources = try await webView.evaluateJavaScript(
            "performance.getEntriesByType('resource').filter(r => /^https?:/.test(r.name)).length"
        )
        XCTAssertEqual(remoteResources as? Int, 0)

        // 探针脚本只在 test bundle 中；生产入口没有测试开关或数据库写入命令。
        let scriptUrl = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        let script = try String(contentsOf: scriptUrl, encoding: .utf8)
        _ = try await webView.evaluateJavaScript(script + ";void 0;")
        let result = try await webView.callAsyncJavaScript(
            "return await MyBillNativeProbe.run()", arguments: [:], in: nil, contentWorld: .page
        )
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["platform"] as? String, "ios")
        XCTAssertEqual(evidence["cents"] as? String, "9007199254740993")
        XCTAssertEqual(evidence["sum"] as? String, "9007199254742536")
        XCTAssertEqual(evidence["total"] as? String, "15.43")
        XCTAssertEqual(evidence["version"] as? Int, 2)
        XCTAssertEqual(evidence["rows"] as? Int, 2)

        let library = try XCTUnwrap(FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first)
        let databaseDirectory = library.appendingPathComponent("OfflineLedger", isDirectory: true)
        XCTAssertTrue(try databaseDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true)
        let remaining = try FileManager.default.contentsOfDirectory(atPath: databaseDirectory.path)
        XCTAssertFalse(remaining.contains { $0.hasPrefix("probe_") }, "探针数据库未清理")
        print("NATIVE_SQLITE_EVIDENCE " + String(describing: evidence))
    }
    func testOriginalShellNavigationAndOverlays() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.shell()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["draftsRetained"] as? Bool, true)
        XCTAssertEqual(evidence["focusRestored"] as? Bool, true)
        XCTAssertEqual(evidence["nestedDiscard"] as? Bool, true)
        XCTAssertEqual(evidence["remoteResources"] as? Int, 0)
        print("IPHONE_SHELL_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testClosedDatabaseSidecarPolicy() throws {
        let fm = FileManager.default
        let folder = fm.temporaryDirectory.appendingPathComponent("ledger-sidecar-" + UUID().uuidString)
        try fm.createDirectory(at: folder, withIntermediateDirectories: false)
        addTeardownBlock { try fm.removeItem(at: folder) }
        let db = folder.appendingPathComponent("test.db")
        let journal = URL(fileURLWithPath: db.path + "-journal")
        let wal = URL(fileURLWithPath: db.path + "-wal")
        XCTAssertNoThrow(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
        // 非热 journal 可非空，但必须有完整全零头；不读取、改写或删除其数据页。
        try (Data(repeating: 0, count: 28) + Data(repeating: 1, count: 512)).write(to: journal)
        XCTAssertNoThrow(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
        XCTAssertTrue(fm.fileExists(atPath: journal.path))
        // 中断时尚未同步的 journal 可仅 magic 为零，其他头字段仍有值。
        try (Data(repeating: 0, count: 8) + Data(repeating: 1, count: 532)).write(to: journal)
        XCTAssertNoThrow(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
        try Data([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7] + Array(repeating: 0, count: 532)).write(to: journal)
        XCTAssertThrowsError(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
        try Data(repeating: 0, count: 8).write(to: journal)
        XCTAssertThrowsError(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
        try fm.removeItem(at: journal)
        try Data(repeating: 0, count: 32).write(to: wal)
        XCTAssertThrowsError(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
        try Data().write(to: wal)
        XCTAssertNoThrow(try LedgerFilesPlugin.verifyClosedSidecars(database: db))
    }

    private func residentBytes() throws -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
        let status = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        XCTAssertEqual(status, KERN_SUCCESS)
        return info.resident_size
    }

    func testLedgerLifecycleAndProtection() async throws {
        let beforeBytes = try residentBytes()
        let webView = try await readyWebView()
        let scriptUrl = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: scriptUrl, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.lifecycle()", arguments: [:], in: nil, contentWorld: .page)
        var evidence = try XCTUnwrap(result as? [String: Any])
        evidence["hostResidentBytesBefore"] = beforeBytes
        evidence["hostResidentBytesAfter"] = try residentBytes()
        let checks = try XCTUnwrap(evidence["checks"] as? [String])
        XCTAssertEqual(checks.count, 5)
        XCTAssertTrue(checks.contains("close-failure-retry-retained-owner"))
        let prefix = try XCTUnwrap(evidence["databasePrefix"] as? String)
        try verifySnapshots(prefix: prefix, minimum: 2, cleanup: true)
        print("LEDGER_LIFECYCLE_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineDictionaryGovernance() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.dictionaries()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 6)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 10)
        let prefix = try XCTUnwrap(evidence["databasePrefix"] as? String)
        try verifySnapshots(prefix: prefix, minimum: 5, cleanup: true)
        print("OFFLINE_DICTIONARY_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineEntryWrites() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.entries()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 6)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 7)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 3, cleanup: true)
        print("OFFLINE_ENTRY_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflinePersonalState() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.personal()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 6)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 5)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 1, cleanup: true)
        print("OFFLINE_PERSONAL_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineAdjustmentLifecycle() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.adjustments()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 6)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 5)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 1, cleanup: true)
        print("OFFLINE_ADJUSTMENT_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineCleanupFinalization() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.cleanupFinalization()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 6)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 1)
        // 此场景只创建当前结构的随机库，不产生升级快照；数据库由共享探针回收。
        XCTAssertNotNil(evidence["databasePrefix"] as? String)
        print("OFFLINE_CLEANUP_FINALIZATION_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineCleanupForegroundState() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.cleanupForegroundState()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        let active = try XCTUnwrap(evidence["active"] as? Bool)
        XCTAssertEqual(active, UIApplication.shared.applicationState == .active)
        print("OFFLINE_CLEANUP_FOREGROUND_STATE_VERIFIED")
    }

    // 只由局部入口明确选中；完整入口仍执行 testOfflineDictionaryGovernance 的全部场景。
    func testOfflineDictionaryScenario() async throws {
        let selected = try OwnedSimulatorTestContext.requestedScenario()
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.dictionaries(selected)", arguments: ["selected": selected], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 1)
        let prefix = try XCTUnwrap(evidence["databasePrefix"] as? String)
        if selected == "upgrade" { try verifySnapshots(prefix: prefix, minimum: 5, cleanup: true) }
        print("NATIVE_DICTIONARY_SCENARIO_VERIFIED " + selected)
    }

    func testOfflineDictionaryPages() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.dictionaryUi()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["dictionaries"] as? Int, 8)
        XCTAssertEqual(evidence["mergeHistoryAndTemplate"] as? Bool, true)
        XCTAssertEqual(evidence["cancelWithoutWrite"] as? Bool, true)
        print("OFFLINE_DICTIONARY_UI_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    private func verifySnapshots(prefix: String, minimum: Int, cleanup: Bool) throws {
        let library = try XCTUnwrap(FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first)
        let root = library.appendingPathComponent("OfflineLedger/Snapshots", isDirectory: true)
        var verified = 0
        for folder in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            let manifestURL = folder.appendingPathComponent("manifest.json")
            let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any]
            guard (manifest?["database"] as? String)?.hasPrefix(prefix) == true else { continue }
            for url in [root, folder, manifestURL, folder.appendingPathComponent("ledger.db")] {
                XCTAssertEqual(try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
                #if !targetEnvironment(simulator)
                XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey] as? String, FileProtectionType.completeUntilFirstUserAuthentication.rawValue)
                #endif
            }
            verified += 1
            if cleanup { try FileManager.default.removeItem(at: folder) }
        }
        XCTAssertGreaterThanOrEqual(verified, minimum)
    }

    private func requestedStage() throws -> String {
        let caches = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first)
        let stage = try String(contentsOf: caches.appendingPathComponent("ledger-crash-request"), encoding: .utf8)
        XCTAssertTrue(["snapshot-ready", "migration-recorded", "upgrade-committed"].contains(stage))
        return stage
    }

    // 只由隔离模拟器脚本选中；不通过 App 生产参数开启故障注入。
    func testPrepareProcessInterruption() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let stage = try requestedStage()
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.prepareCrash(stage)", arguments: ["stage": stage], in: nil, contentWorld: .page)
        let receipt = try XCTUnwrap(result as? [String: Any])
        try verifySnapshots(prefix: try XCTUnwrap(receipt["database"] as? String), minimum: 1, cleanup: false)
        let caches = try XCTUnwrap(FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first)
        try Data(stage.utf8).write(to: caches.appendingPathComponent("ledger-crash-ready"), options: .atomic)
        try await Task.sleep(for: .seconds(55))
        XCTFail("隔离脚本未在指定升级阶段终止进程")
    }

    func testRecoverProcessInterruption() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let stage = try requestedStage()
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.recoverCrash(stage)", arguments: ["stage": stage], in: nil, contentWorld: .page)
        let receipt = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(receipt["stage"] as? String, stage)
        try verifySnapshots(prefix: try XCTUnwrap(receipt["database"] as? String), minimum: 1, cleanup: true)
        print("LEDGER_PROCESS_INTERRUPTION_RECOVERED " + stage)
    }

}
