import Foundation
import Capacitor
import CryptoKit
import OSLog
import UIKit

/// 生命周期状态与后台写入窗口分别去重；所有入口均由主线程调用。
/// App/Scene 同态通知只转发一次，旧完成或旧到期回调不能释放后来申请的窗口。
final class LedgerLifecycleCoordinator {
    private let center: NotificationCenter
    private let beginTask: (@escaping () -> Void) -> UIBackgroundTaskIdentifier
    private let endTask: (UIBackgroundTaskIdentifier) -> Void
    private let notify: (String, [String: Any]) -> Void
    private var observers: [NSObjectProtocol] = []
    private var active: Bool?
    private var generation = 0
    private var task: UIBackgroundTaskIdentifier = .invalid
    private var leaseGeneration: Int?

    init(center: NotificationCenter = .default,
         beginTask: @escaping (@escaping () -> Void) -> UIBackgroundTaskIdentifier,
         endTask: @escaping (UIBackgroundTaskIdentifier) -> Void,
         notify: @escaping (String, [String: Any]) -> Void) {
        self.center = center
        self.beginTask = beginTask
        self.endTask = endTask
        self.notify = notify
    }

    func start() {
        guard observers.isEmpty else {
            return
        }
        for event in [UIApplication.willResignActiveNotification, UIScene.willDeactivateNotification] {
            observers.append(center.addObserver(forName: event, object: nil, queue: .main) { [weak self] _ in
                self?.transition(active: false)
            })
        }
        for event in [UIApplication.didBecomeActiveNotification, UIScene.didActivateNotification] {
            observers.append(center.addObserver(forName: event, object: nil, queue: .main) { [weak self] _ in
                self?.transition(active: true)
            })
        }
    }

    private func transition(active next: Bool) {
        guard active != next else {
            return
        }
        active = next
        if next {
            notify("foreground", [:])
            return
        }
        generation += 1
        if task == .invalid {
            let lease = generation
            leaseGeneration = lease
            task = beginTask { [weak self] in self?.endLease(lease) }
            if task == .invalid {
                leaseGeneration = nil
            }
        }
        // 是否能申请/复用写入窗口不影响后台事实；清理消费者必须立即收到取消信号。
        notify("background", ["generation": generation])
    }

    func finish(generation completed: Int) {
        guard completed == generation, let lease = leaseGeneration else {
            return
        }
        endLease(lease)
    }

    private func endLease(_ expected: Int) {
        guard leaseGeneration == expected else {
            return
        }
        let held = task
        task = .invalid
        leaseGeneration = nil
        if held != .invalid {
            endTask(held)
        }
    }

    func stop() {
        for observer in observers {
            center.removeObserver(observer)
        }
        observers.removeAll()
        active = nil
        if let lease = leaseGeneration {
            endLease(lease)
        }
    }

    deinit {
        for observer in observers {
            center.removeObserver(observer)
        }
        let held = task
        let release = endTask
        if held != .invalid {
            if Thread.isMainThread {
                release(held)
            } else {
                DispatchQueue.main.async { release(held) }
            }
        }
    }
}

/// 私有账本文件操作；调用方必须先关闭连接，所有路径由经过校验的库标识派生。
@objc(LedgerFilesPlugin)
public class LedgerFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LedgerFilesPlugin"
    public let jsName = "LedgerFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "protect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLifecycleState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishBackground", returnType: CAPPluginReturnPromise)
    ]
    private let worker = DispatchQueue(label: "com.mybill.offline.files", qos: .utility)
    private var lifecycle: LedgerLifecycleCoordinator?

    public override func load() {
        lifecycle = LedgerLifecycleCoordinator(beginTask: { expiration in
            UIApplication.shared.beginBackgroundTask(withName: "SaveLedgerDrafts", expirationHandler: expiration)
        }, endTask: { task in
            UIApplication.shared.endBackgroundTask(task)
        }, notify: { [weak self] event, data in
            self?.notifyListeners(event, data: data)
        })
        lifecycle?.start()
    }

    @objc func finishBackground(_ call: CAPPluginCall) {
        guard let generation = call.getInt("generation"), generation > 0 else {
            call.reject("后台任务代次无效。")
            return
        }
        DispatchQueue.main.async {
            self.lifecycle?.finish(generation: generation)
            call.resolve()
        }
    }

    /// 在主线程读取真实初态，供 JS 订阅完成后补齐冷启动期间遗漏的通知。
    @objc func getLifecycleState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["active": UIApplication.shared.applicationState == .active])
        }
    }

    private func root() throws -> URL {
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
            throw CocoaError(.fileNoSuchFile)
        }
        return library.appendingPathComponent("OfflineLedger", isDirectory: true)
    }

    private func database(_ call: CAPPluginCall) throws -> URL {
        guard let name = call.getString("name"), name.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else {
            throw CocoaError(.fileReadInvalidFileName)
        }
        return try root().appendingPathComponent(name + "SQLite.db")
    }

    /// 对目录和文件均重新应用并回读；不能依赖插件只在建目录时设置一次。
    private func protectURL(_ input: URL) throws {
        var url = input
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType != .typeSymbolicLink else { throw CocoaError(.fileReadInvalidFileName) }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        guard try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
            throw CocoaError(.fileWriteNoPermission)
        }
        #if !targetEnvironment(simulator)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        let protection = try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey]
        guard ((protection as? FileProtectionType)?.rawValue ?? (protection as? String)) == FileProtectionType.completeUntilFirstUserAuthentication.rawValue else {
            throw CocoaError(.fileWriteNoPermission)
        }
        #endif
    }

    private var protectionEvidence: [String: Any] {
        #if targetEnvironment(simulator)
        return ["excluded": true, "protected": false, "simulator": true]
        #else
        return ["excluded": true, "protected": true, "simulator": false]
        #endif
    }

    private func digest(_ url: URL) throws -> String {
        let stream = try FileHandle(forReadingFrom: url)
        defer { try? stream.close() }
        var hash = SHA256()
        while let data = try stream.read(upToCount: 131072), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// 调用者已经通过 SQLite 校验并关闭连接；零头 journal 是已失效日志，不是待回滚事务。
    /// 仅放行完整日志头中 8 字节 magic 已清零的非热日志；其他非空日志保守拒绝，绝不主动删除日志。
    static func verifyClosedSidecars(database: URL) throws {
        let fm = FileManager.default
        for suffix in ["-wal", "-journal"] {
            let url = URL(fileURLWithPath: database.path + suffix)
            guard fm.fileExists(atPath: url.path),
                  (try fm.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value != 0 else { continue }
            if suffix == "-journal" {
                let handle = try FileHandle(forReadingFrom: url)
                let header: Data
                do {
                    header = try handle.read(upToCount: 28) ?? Data()
                } catch {
                    do { try handle.close() }
                    catch let closeError { throw NSError(domain: "LedgerSidecarRead", code: 1, userInfo: [NSUnderlyingErrorKey: error, "closeError": closeError]) }
                    throw error
                }
                try handle.close()
                if header.count == 28 && header.prefix(8).allSatisfy({ $0 == 0 }) {
                    Logger(subsystem: "com.mybill.offline", category: "storage").notice("Non-hot rollback journal retained (zero magic).")
                    continue
                }
                Logger(subsystem: "com.mybill.offline", category: "storage").error("Rollback journal rejected: headerBytes=\(header.count)")
            }
            throw CocoaError(.fileReadUnknown)
        }
    }

    @objc func protect(_ call: CAPPluginCall) {
        worker.async {
            do {
                let db = try self.database(call)
                try self.protectURL(self.root())
                try self.protectURL(db)
                for suffix in ["-wal", "-shm", "-journal"] {
                    let sidecar = URL(fileURLWithPath: db.path + suffix)
                    if FileManager.default.fileExists(atPath: sidecar.path) { try self.protectURL(sidecar) }
                }
                call.resolve(self.protectionEvidence)
            } catch {
                Logger(subsystem: "com.mybill.offline", category: "storage").error("File protection failed: domain=\((error as NSError).domain, privacy: .public), code=\((error as NSError).code)")
                call.reject("账本文件保护失败。", "FILE_PROTECTION_FAILED", error)
            }
        }
    }

    @objc func snapshot(_ call: CAPPluginCall) {
        worker.async {
            var pending: URL?
            var stage = "preflight"
            do {
                let db = try self.database(call)
                let fm = FileManager.default
                try self.protectURL(self.root())
                try self.protectURL(db)
                stage = "sidecar"
                try Self.verifyClosedSidecars(database: db)
                stage = "capacity"
                let size = (try fm.attributesOfItem(atPath: db.path)[.size] as? NSNumber)?.int64Value ?? 0
                let available = (try fm.attributesOfFileSystem(forPath: db.deletingLastPathComponent().path)[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
                guard size > 0, available > size + 16 * 1024 * 1024 else { throw CocoaError(.fileWriteOutOfSpace) }
                stage = "copy"
                let directory = try self.root().appendingPathComponent("Snapshots", isDirectory: true)
                try fm.createDirectory(at: directory, withIntermediateDirectories: true)
                try self.protectURL(directory)
                let id = UUID().uuidString.lowercased()
                let temp = directory.appendingPathComponent("pending-" + id, isDirectory: true)
                pending = temp
                try fm.createDirectory(at: temp, withIntermediateDirectories: false)
                try self.protectURL(temp)
                let copy = temp.appendingPathComponent("ledger.db")
                try fm.copyItem(at: db, to: copy)
                try self.protectURL(copy)
                stage = "digest"
                let checksum = try self.digest(db)
                guard try self.digest(copy) == checksum else { throw CocoaError(.fileReadCorruptFile) }
                stage = "manifest"
                let manifest = try JSONSerialization.data(withJSONObject: ["id": id, "database": call.getString("name")!, "bytes": size, "sha256": checksum, "createdAt": ISO8601DateFormatter().string(from: Date())], options: [.sortedKeys])
                let manifestURL = temp.appendingPathComponent("manifest.json")
                try manifest.write(to: manifestURL, options: .atomic)
                try self.protectURL(manifestURL)
                let final = directory.appendingPathComponent(id, isDirectory: true)
                try fm.moveItem(at: temp, to: final)
                pending = nil
                try self.protectURL(final)
                var result = self.protectionEvidence
                result.merge(["id": id, "bytes": size, "sha256": checksum]) { _, new in new }
                call.resolve(result)
            } catch {
                Logger(subsystem: "com.mybill.offline", category: "storage").error("Snapshot failed: stage=\(stage, privacy: .public), domain=\((error as NSError).domain, privacy: .public), code=\((error as NSError).code)")
                // 只回收本次未完成的临时目录；已完成快照由 T12 的保留策略管理。
                if let pending {
                    do { try FileManager.default.removeItem(at: pending) }
                    catch let cleanup { call.reject("快照失败且临时文件清理失败。", "SNAPSHOT_CLEANUP_FAILED", cleanup); return }
                }
                call.reject("升级保护快照失败，账本未升级。", "SNAPSHOT_FAILED", error)
            }
        }
    }
}

class LedgerBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(LedgerFilesPlugin()) }
}
