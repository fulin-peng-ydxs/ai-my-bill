import XCTest
import UIKit
import WebKit
import CryptoKit
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

    func testIosInteractionMatrix() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let original = webView.frame
        defer { webView.frame = original }
        for size in [CGSize(width: 360, height: 800), CGSize(width: 390, height: 844),
                     CGSize(width: 430, height: 932), CGSize(width: 844, height: 390)] {
            webView.frame = CGRect(origin: original.origin, size: size)
            try await Task.sleep(for: .milliseconds(150))
            let evidence = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.reviewPages()", arguments: [:], in: nil, contentWorld: .page)
            let actualWidth = try await webView.evaluateJavaScript("innerWidth")
            XCTAssertEqual((actualWidth as? NSNumber)?.intValue, Int(size.width))
            print("IOS_INTERACTION_MATRIX " + String(decoding: try JSONSerialization.data(withJSONObject: try XCTUnwrap(evidence), options: [.sortedKeys]), as: UTF8.self))
            let attachment = XCTAttachment(image: webView.snapshotView(afterScreenUpdates: true).map { view in
                UIGraphicsImageRenderer(bounds: view.bounds).image { _ in view.drawHierarchy(in: view.bounds, afterScreenUpdates: true) }
            } ?? UIGraphicsImageRenderer(size: size).image { _ in })
            attachment.name = "matrix-\(Int(size.width))x\(Int(size.height))"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testIosTextScale() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        func change(_ category: UIContentSizeCategory) {
            NotificationCenter.default.post(name: UIContentSizeCategory.didChangeNotification, object: nil,
                userInfo: [UIContentSizeCategory.newValueUserInfoKey:category])
        }
        defer { change(UIApplication.shared.preferredContentSizeCategory) }
        change(.large)
        try await Task.sleep(for: .milliseconds(150))
        let normalValue = try await webView.evaluateJavaScript("parseFloat(getComputedStyle(document.body).fontSize)")
        let normal = try XCTUnwrap(normalValue as? NSNumber)
        change(.accessibilityExtraExtraExtraLarge)
        try await Task.sleep(for: .milliseconds(150))
        let largeValue = try await webView.evaluateJavaScript("parseFloat(getComputedStyle(document.body).fontSize)")
        let large = try XCTUnwrap(largeValue as? NSNumber)
        XCTAssertGreaterThan(large.doubleValue, normal.doubleValue * 1.5)
        let fields = try await webView.evaluateJavaScript("JSON.stringify([...document.querySelectorAll('input')].filter(e=>e.getBoundingClientRect().height).map(e=>({id:e.id,height:e.clientHeight,font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight,scroll:e.scrollHeight})))")
        print("IOS_LARGE_TEXT_FIELDS \(fields)")
        _ = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.reviewPages()", arguments: [:], in: nil, contentWorld: .page)
        print("IOS_TEXT_SCALE_EVIDENCE normal=\(normal) large=\(large)")
    }

    func testIosStatusBarTheme() async throws {
        let web = try await readyWebView()
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        let controller = try XCTUnwrap(windows.compactMap { $0.rootViewController as? LedgerBridgeViewController }.first)
        let systemDark = try await web.evaluateJavaScript("matchMedia('(prefers-color-scheme: dark)').matches")
        for mode in ["dark","light","system"] {
            let resolved = try await web.callAsyncJavaScript("document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('theme').setMode(mode);return document.documentElement.dataset.theme;",
                arguments:["mode":mode],in:nil,contentWorld:.page) as? String
            let expected:UIStatusBarStyle = resolved == "dark" ? .lightContent : .darkContent
            for _ in 0..<20 {
                if controller.preferredStatusBarStyle == expected { break }
                try await Task.sleep(for:.milliseconds(20))
            }
            XCTAssertEqual(controller.preferredStatusBarStyle,expected)
            let currentSystem = try await web.evaluateJavaScript("matchMedia('(prefers-color-scheme: dark)').matches")
            XCTAssertEqual(currentSystem as? Bool,systemDark as? Bool,"状态栏不能反向覆盖系统主题媒体查询")
        }
        print("IOS_STATUS_BAR_THEME_VERIFIED dark/light/system")
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
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
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
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
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
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
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
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
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
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 1)
        // 此场景只创建当前结构的随机库，不产生升级快照；数据库由共享探针回收。
        XCTAssertNotNil(evidence["databasePrefix"] as? String)
        print("OFFLINE_CLEANUP_FINALIZATION_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineLedgerQuery() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.ledgerQueries()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 3)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 1, cleanup: true)
        print("OFFLINE_LEDGER_QUERY_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineCoreReports() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.reportQueries()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 5)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 1, cleanup: true)
        print("OFFLINE_CORE_REPORT_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineDimensionReports() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.dimensionReports()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 3)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 1, cleanup: true)
        print("OFFLINE_DIMENSION_REPORT_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testOfflineDataManagement() async throws {
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.dataManagement()", arguments: [:], in: nil, contentWorld: .page)
        let evidence = try XCTUnwrap(result as? [String: Any])
        XCTAssertEqual(evidence["schemaVersion"] as? Int, 9)
        XCTAssertEqual((evidence["checks"] as? [String])?.count, 10)
        try verifySnapshots(prefix: XCTUnwrap(evidence["databasePrefix"] as? String), minimum: 1, cleanup: true)
        print("OFFLINE_DATA_MANAGEMENT_EVIDENCE " + String(decoding: try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), as: UTF8.self))
    }

    func testDataFileSecurityAndSwitchRecovery() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("data-files-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: root,withIntermediateDirectories: false)
        defer { try? fm.removeItem(at: root) }
        let plugin = LedgerFilesPlugin()
        let hash: (URL) throws -> String = { url in
            let input = try FileHandle(forReadingFrom: url)
            defer { try? input.close() }
            var digest = SHA256()
            while let bytes = try input.read(upToCount: 131072), !bytes.isEmpty { digest.update(data: bytes) }
            return digest.finalize().map { String(format: "%02x",$0) }.joined()
        }
        var failStage: String?
        let storage = LedgerDataStore(root: root,protect: plugin.protectURL,hash: hash,observe: { stage in
            if failStage == stage { failStage = nil; throw LedgerDataError.cancelled }
        })
        let database = try storage.database("ledger")
        let content = Data((0..<(LedgerDataStore.chunk * 2 + 19)).map { UInt8($0 % 251) })
        try content.write(to: database)
        try plugin.protectURL(database)
        let original = try hash(database)
        let id = try storage.begin("backup")
        try storage.seal(id,name: "ledger",password: "Native-password-测试",manifest: ["backupFormatVersion": 1,"schemaVersion": 8])
        let archive = try storage.payload(id), bytes = try Data(contentsOf: archive)
        XCTAssertNil(bytes.range(of: content.prefix(128)))
        XCTAssertThrowsError(try storage.unseal(id,password: "wrong-password")) { XCTAssertEqual($0 as? LedgerDataError,.authentication) }
        let decoded = try storage.unseal(id,password: "Native-password-测试")
        XCTAssertEqual(try hash(storage.database(decoded.0)),original)
        XCTAssertEqual(try storage.database(decoded.0).resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup,true)
        var corrupt = bytes
        corrupt[corrupt.count - 1] ^= 1
        try corrupt.write(to: archive)
        XCTAssertThrowsError(try storage.unseal(id,password: "Native-password-测试"))
        XCTAssertEqual(try hash(database),original)
        try bytes.dropLast().write(to: archive)
        XCTAssertThrowsError(try storage.unseal(id,password: "Native-password-测试"))
        try bytes.write(to: archive)
        // 恶意派生参数在 KDF 前拒绝，不以实际执行高成本派生来测试上界。
        let offset = LedgerDataStore.magic.count
        let headerLength = bytes[offset..<offset+4].reduce(0) { ($0 << 8) | Int($1) }
        var header = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes.subdata(in: offset+4..<offset+4+headerLength)) as? [String: Any])
        header["iterations"] = 2_000_000_000
        let changedHeader = try JSONSerialization.data(withJSONObject: header)
        var size = UInt32(changedHeader.count).bigEndian
        let hostile = LedgerDataStore.magic + withUnsafeBytes(of: &size) { Data($0) } + changedHeader
        try hostile.write(to: archive)
        XCTAssertThrowsError(try storage.unseal(id,password: "Native-password-测试")) { XCTAssertEqual($0 as? LedgerDataError,.incompatible) }
        try bytes.write(to: archive)
        let noSpace = LedgerDataStore(root: root,protect: plugin.protectURL,hash: hash,availableBytes: { 0 })
        XCTAssertThrowsError(try noSpace.unseal(id,password: "Native-password-测试"))
        XCTAssertThrowsError(try storage.database("../../ledger"))
        XCTAssertThrowsError(try storage.transfer("../../outside"))

        // 在 marker 前后、原子提交后及旧文件已删除后分别中断；只读旧库或完整新库可见。
        for stage in ["copies-ready","switch-prepared","switch-committed","result-ready","cleanup-recorded","old-files-removed"] {
            try content.write(to: database)
            let name = "restore_" + UUID().uuidString.replacingOccurrences(of: "-",with: "").lowercased()
            let prepared = try storage.database(name), replacement = Data("new-dataset-\(stage)".utf8)
            try replacement.write(to: prepared)
            failStage = stage
            if stage.hasPrefix("switch-") || stage == "copies-ready" {
                XCTAssertThrowsError(try storage.replace(name: "ledger",prepared: name,operationId: UUID().uuidString,clear: false,expectedSHA256: hash(prepared))) {
                    XCTAssertEqual($0 as? LedgerDataError,.cancelled,"未进入指定切换中断阶段")
                }
            } else {
                try storage.replace(name: "ledger",prepared: name,operationId: UUID().uuidString,clear: false,expectedSHA256: hash(prepared))
                XCTAssertThrowsError(try storage.finishSwitch("ledger")) {
                    XCTAssertEqual($0 as? LedgerDataError,.cancelled,"未进入指定收尾中断阶段")
                }
            }
            try storage.recover("ledger")
            XCTAssertEqual(try Data(contentsOf: database),["copies-ready","switch-prepared"].contains(stage) ? content : replacement)
            try storage.finishSwitch("ledger")
            try storage.finishSwitch("ledger")
            XCTAssertFalse(fm.fileExists(atPath: try storage.marker("ledger").path))
        }
        // 外部副本不在账本根目录，清空内部快照/能力后仍能重新导入并认证解密。
        let external = fm.temporaryDirectory.appendingPathComponent("external-" + UUID().uuidString + ".mybill")
        try bytes.write(to: external)
        defer { try? fm.removeItem(at: external) }
        let snapshots = try storage.directory(root,"Snapshots")
        for i in 0..<9 {
            let snapshotId = UUID().uuidString.lowercased(), folder = try storage.directory(snapshots,snapshotId)
            let copy = folder.appendingPathComponent("ledger.db")
            try content.write(to: copy)
            try storage.writeJSON(["id": snapshotId,"database": "ledger","bytes": content.count,"sha256": original,
                "createdAt": String(format: "2026-11-%02dT00:00:00Z",i+1),"pinned": i == 0],folder.appendingPathComponent("manifest.json"))
        }
        try storage.rotateSnapshots(database: "ledger")
        XCTAssertEqual(try storage.snapshotManifests().count,7)
        XCTAssertTrue(try storage.snapshotManifests().contains { $0.1["pinned"] as? Bool == true })
        try storage.finishSwitch("ledger")
        XCTAssertFalse(try storage.snapshotManifests().contains { $0.1["pinned"] as? Bool == true }, "校验就绪后不遗留中断保护钉住旧快照")
        // 轮换退出有效集合后中断，即使递归删除只完成一部分，健康主库仍可启动并续作。
        for i in 0..<2 {
            let snapshotId = UUID().uuidString.lowercased(), folder = try storage.directory(snapshots,snapshotId)
            try content.write(to: folder.appendingPathComponent("ledger.db"))
            try storage.writeJSON(["id": snapshotId,"database": "ledger","bytes": content.count,"sha256": original,
                "createdAt": String(format: "2027-01-%02dT00:00:00Z",i+1),"pinned": false],folder.appendingPathComponent("manifest.json"))
        }
        failStage = "snapshot-retired"
        XCTAssertThrowsError(try storage.rotateSnapshots(database: "ledger"))
        let retired = try XCTUnwrap(fm.contentsOfDirectory(at: snapshots,includingPropertiesForKeys: nil).first { $0.lastPathComponent.hasPrefix("retiring-") })
        try fm.removeItem(at: retired.appendingPathComponent("ledger.db"))
        let reopened = LedgerDataStore(root: root,protect: plugin.protectURL,hash: hash)
        let healthy = try hash(database)
        XCTAssertNoThrow(try reopened.finishSwitch("ledger"))
        XCTAssertEqual(try hash(database),healthy)
        XCTAssertEqual(try reopened.snapshotManifests().count,7)
        XCTAssertFalse(fm.fileExists(atPath: retired.path))
        // 同时兼容旧版本轮换留下的 UUID 半目录；隔离而不直接销毁可救援文件。
        let malformed = try storage.directory(snapshots,UUID().uuidString.lowercased())
        try content.write(to: malformed.appendingPathComponent("ledger.db"))
        XCTAssertNoThrow(try reopened.finishSwitch("ledger"))
        XCTAssertEqual(try hash(database),healthy)
        XCTAssertEqual(try reopened.snapshotManifests().count,7)
        let quarantine = try storage.directory(root,"QuarantinedSnapshots")
        XCTAssertTrue(fm.fileExists(atPath: quarantine.appendingPathComponent(malformed.lastPathComponent).appendingPathComponent("ledger.db").path))
        XCTAssertTrue(fm.fileExists(atPath: snapshots.appendingPathComponent("warning.json").path))
        XCTAssertNoThrow(try reopened.finishSwitch("ledger"))
        let fresh = "fresh_" + UUID().uuidString.replacingOccurrences(of: "-",with: "").lowercased()
        try Data("empty-dataset".utf8).write(to: storage.database(fresh))
        try storage.replace(name: "ledger",prepared: fresh,operationId: UUID().uuidString,clear: true,expectedSHA256: hash(storage.database(fresh)))
        try storage.finishSwitch("ledger")
        XCTAssertEqual(try storage.snapshotManifests().count,0)
        XCTAssertEqual(try fm.contentsOfDirectory(atPath: storage.directory(root,"QuarantinedSnapshots").path).count,0)
        XCTAssertEqual(try fm.contentsOfDirectory(atPath: storage.directory(root,"Operations").path).count,0)
        XCTAssertEqual(try fm.contentsOfDirectory(atPath: storage.directory(root,"Transfers").path).count,0)
        let imported = try storage.importFile(external)
        let restored = try storage.unseal(imported,password: "Native-password-测试")
        XCTAssertEqual(try hash(storage.database(restored.0)),original)
        print("OFFLINE_DATA_FILE_SECURITY_VERIFIED frames/authentication/limits/space/ownership/switch-recovery/retention/clear/external-restore")
    }

    func testNativeLifecycleDraftWindow() async throws {
        // 私有 NotificationCenter 与可控窗口使慢写/快速切换确定可复现，不改变宿主 App 状态。
        let center = NotificationCenter()
        var expirations: [() -> Void] = []
        var ended: [UIBackgroundTaskIdentifier] = []
        var names: [String] = []
        var generations: [Int] = []
        let coordinator = LedgerLifecycleCoordinator(center: center, beginTask: { expiration in
            expirations.append(expiration)
            return UIBackgroundTaskIdentifier(rawValue: expirations.count == 1 ? 101 : 102)
        }, endTask: { ended.append($0) }, notify: { event, data in
            names.append(event)
            if event == "background" {
                generations.append(data["generation"] as? Int ?? -1)
            }
        })
        coordinator.start()
        coordinator.start()
        defer { coordinator.stop() }
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        center.post(name: UIScene.willDeactivateNotification, object: nil)
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        center.post(name: UIScene.didActivateNotification, object: nil)
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        center.post(name: UIScene.willDeactivateNotification, object: nil)
        XCTAssertEqual(names, ["background", "foreground", "background"])
        XCTAssertEqual(generations, [1, 2])
        XCTAssertEqual(expirations.count, 1, "慢写期间复用一个窗口，不能抑制新的后台状态")
        coordinator.finish(generation: 1)
        XCTAssertTrue(ended.isEmpty, "旧完成不能结束新轮次使用的窗口")
        coordinator.finish(generation: 2)
        XCTAssertEqual(ended, [UIBackgroundTaskIdentifier(rawValue: 101)])
        center.post(name: UIScene.willDeactivateNotification, object: nil)
        XCTAssertEqual(generations, [1, 2], "窗口释放后，同态通知也不能触发额外草稿重试")
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        XCTAssertEqual(expirations.count, 2)
        expirations[0]()
        XCTAssertEqual(ended.count, 1, "旧到期回调不能结束新窗口")
        expirations[1]()
        expirations[1]()
        XCTAssertEqual(ended.count, 2, "当前到期只释放一次")
        center.post(name: UIScene.willDeactivateNotification, object: nil)
        XCTAssertEqual(expirations.count, 2, "同态通知不能循环申请已到期窗口")
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        center.post(name: UIApplication.willResignActiveNotification, object: nil)
        expirations[1]()
        XCTAssertEqual(ended.count, 2, "UIKit 句柄复用时，旧代次仍不能释放新窗口")
        coordinator.stop()
        coordinator.stop()
        XCTAssertEqual(ended.count, 3)
        let count = names.count
        center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertEqual(names.count, count, "停止后必须移除观察者")

        let deniedCenter = NotificationCenter()
        var deniedEvents: [String] = []
        let denied = LedgerLifecycleCoordinator(center: deniedCenter, beginTask: { _ in .invalid },
            endTask: { _ in XCTFail("不能释放无效窗口") }, notify: { event, _ in deniedEvents.append(event) })
        denied.start()
        defer { denied.stop() }
        deniedCenter.post(name: UIApplication.willResignActiveNotification, object: nil)
        deniedCenter.post(name: UIScene.willDeactivateNotification, object: nil)
        XCTAssertEqual(deniedEvents, ["background"], "无后台预算时仍要通知取消清理")
        denied.finish(generation: 1)

        // 同时核验 JS→原生完成回执的代次契约；无关代次只被忽略，不释放当前窗口。
        let webView = try await readyWebView()
        let script = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "sqlite-probe", withExtension: "js"))
        _ = try await webView.evaluateJavaScript(String(contentsOf: script, encoding: .utf8) + ";void 0;")
        let result = try await webView.callAsyncJavaScript("return await MyBillNativeProbe.backgroundCompletion()", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertEqual(result as? Bool, true)
        print("NATIVE_LIFECYCLE_DRAFT_WINDOW_VERIFIED")
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
            if folder.lastPathComponent.hasPrefix("policy-") && folder.pathExtension == "json" {
                guard folder.lastPathComponent.hasPrefix("policy-" + prefix) else { continue }
                let policy = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: folder)) as? [String: String])
                XCTAssertNotNil(policy["revision"].flatMap(UUID.init(uuidString:)))
                XCTAssertEqual(policy["sha256"]?.count, 64)
                XCTAssertEqual(try folder.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
                if cleanup { try FileManager.default.removeItem(at: folder) }
                continue
            }
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
