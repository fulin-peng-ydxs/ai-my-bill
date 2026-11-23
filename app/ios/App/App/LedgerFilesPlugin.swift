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
        CAPPluginMethod(name: "finishBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareRestore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "replaceLedger", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hashDatabase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardDatabase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dataStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordDataResult", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishSwitch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishSnapshot", returnType: CAPPluginReturnPromise)
    ]
    let worker = DispatchQueue(label: "com.mybill.offline.files", qos: .utility)
    var documentCall: CAPPluginCall?
    var documentExportId: String?
    let cancellationLock = NSLock()
    var cancelledTransfers = Set<String>()
    var cleanedLaunchTransfers = false
    var snapshotCancellationId: String?
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

    func root() throws -> URL {
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
    func protectURL(_ input: URL) throws {
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

    func digest(_ url: URL) throws -> String {
        let stream = try FileHandle(forReadingFrom: url)
        defer { try? stream.close() }
        var hash = SHA256()
        while let data = try stream.read(upToCount: 131072), !data.isEmpty {
            try checkSnapshotCancellation()
            hash.update(data: data)
        }
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
            self.snapshotCancellationId = call.getString("operationId")
            defer {
                if let id = self.snapshotCancellationId {
                    self.cancellationLock.lock()
                    self.cancelledTransfers.remove(id)
                    self.cancellationLock.unlock()
                }
                self.snapshotCancellationId = nil
            }
            var pending: URL?
            var stage = "preflight"
            do {
                let db = try self.database(call)
                let fm = FileManager.default
                try self.protectURL(self.root())
                try self.protectURL(db)
                stage = "sidecar"
                try Self.verifyClosedSidecars(database: db)
                let storage = try self.store()
                let previous = try storage.snapshotManifests().filter { $0.1["database"] as? String == call.getString("name") }
                let checksum = try self.digest(db)
                let reason = call.getString("reason") ?? "upgrade"
                guard ["daily","upgrade","restore"].contains(reason) else { throw LedgerDataError.invalidFile }
                if reason == "daily" {
                    guard let day = call.getString("day"), day.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { throw LedgerDataError.invalidFile }
                    guard let revision = call.getString("revision"), UUID(uuidString: revision) != nil else { throw LedgerDataError.invalidFile }
                    let directory = try storage.directory(self.root(), "Snapshots")
                    let policy = directory.appendingPathComponent("policy-" + call.getString("name")! + ".json")
                    let saved = FileManager.default.fileExists(atPath: policy.path) ? try storage.json(policy) : [:]
                    if !saved.isEmpty {
                        guard let value = saved["day"] as? String, value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",options: .regularExpression) != nil,
                              let previousRevision = saved["revision"] as? String, UUID(uuidString: previousRevision) != nil,
                              let previousHash = saved["sha256"] as? String, previousHash.range(of: "^[a-f0-9]{64}$",options: .regularExpression) != nil else { throw LedgerDataError.invalidFile }
                    }
                    let storedDay = saved["day"] as? String ?? ""
                    let lastDay = max(storedDay, previous.compactMap { $0.1["reason"] as? String == "daily" ? $0.1["day"] as? String : nil }.max() ?? "")
                    if lastDay >= day || saved["revision"] as? String == revision {
                        guard let valid = previous.first, try self.digest(valid.0.appendingPathComponent("ledger.db")) == valid.1["sha256"] as? String else { throw LedgerDataError.invalidFile }
                        var skipped = self.protectionEvidence
                        skipped.merge(["id": previous.first?.1["id"] as? String ?? "", "bytes": 0, "sha256": checksum, "skipped": true]) { _, new in new }
                        call.resolve(skipped)
                        return
                    }
                } else if let existing = previous.first(where: { $0.1["sha256"] as? String == checksum && $0.1["pinned"] as? Bool == true && $0.1["reason"] as? String == reason }) {
                    guard try self.digest(existing.0.appendingPathComponent("ledger.db")) == checksum else { throw LedgerDataError.invalidFile }
                    var reused = self.protectionEvidence
                    reused.merge(["id": existing.1["id"]!, "bytes": existing.1["bytes"]!, "sha256": checksum]) { _, new in new }
                    call.resolve(reused)
                    return
                }
                stage = "capacity"
                try storage.assertSnapshotCapacity()
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
                guard try self.digest(copy) == checksum else { throw CocoaError(.fileReadCorruptFile) }
                stage = "manifest"
                let manifest = try JSONSerialization.data(withJSONObject: ["id": id, "database": call.getString("name")!, "bytes": size, "sha256": checksum, "createdAt": ISO8601DateFormatter().string(from: Date()), "reason": reason, "day": call.getString("day") ?? "", "revision": call.getString("revision") ?? "", "pinned": reason != "daily"], options: [.sortedKeys])
                let manifestURL = temp.appendingPathComponent("manifest.json")
                try manifest.write(to: manifestURL, options: .atomic)
                try self.protectURL(manifestURL)
                for url in [copy,manifestURL] {
                    let handle = try FileHandle(forWritingTo: url)
                    try handle.synchronize()
                    try handle.close()
                }
                try storage.syncDirectory(temp)
                let final = directory.appendingPathComponent(id, isDirectory: true)
                try self.checkSnapshotCancellation()
                try fm.moveItem(at: temp, to: final)
                pending = nil
                try storage.syncDirectory(directory)
                try self.protectURL(final)
                try storage.rotateSnapshots(database: call.getString("name")!)
                if reason == "daily" {
                    try storage.writeJSON(["day": call.getString("day")!, "sha256": checksum, "revision": call.getString("revision")!], directory.appendingPathComponent("policy-" + call.getString("name")! + ".json"))
                }
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

    func checkSnapshotCancellation() throws {
        guard let id = snapshotCancellationId else { return }
        guard UUID(uuidString: id) != nil else { throw LedgerDataError.invalidFile }
        cancellationLock.lock()
        let cancelled = cancelledTransfers.contains(id)
        cancellationLock.unlock()
        if cancelled { throw LedgerDataError.cancelled }
    }
}

class LedgerBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LedgerFilesPlugin())
        bridge?.registerPluginInstance(LedgerAppearancePlugin())
    }
}
