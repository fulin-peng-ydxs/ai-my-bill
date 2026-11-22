import Foundation
import CryptoKit
import CommonCrypto
import Security
import Darwin
import Capacitor
import UIKit
import UniformTypeIdentifiers
import OSLog

enum LedgerDataError: String, Error {
    case invalidFile = "BACKUP_INVALID"
    case incompatible = "BACKUP_INCOMPATIBLE"
    case authentication = "BACKUP_AUTHENTICATION_FAILED"
    case cancelled = "OPERATION_CANCELLED"
    case conflict = "DATA_OPERATION_CONFLICT"
}

/// 版本 1 无压缩，最大 256MiB；按 256KiB 认证帧流式处理，不把整库放入桥或内存。
/// 帧 AAD 绑定完整头、顺序和用途，末尾及 SHA-256 再校验完整数据库；算法使用系统实现。
final class LedgerDataStore {
    static let maximum = 256 * 1024 * 1024
    static let chunk = 256 * 1024
    static let iterations = 600_000
    static let magic = Data("MYBILL-BACKUP-1\n".utf8)
    let root: URL
    let protect: (URL) throws -> Void
    let hash: (URL) throws -> String
    let check: () throws -> Void
    let observe: (String) throws -> Void
    let availableBytes: (() throws -> Int64)?
    let fm = FileManager.default

    init(root: URL, protect: @escaping (URL) throws -> Void, hash: @escaping (URL) throws -> String,
         check: @escaping () throws -> Void = {}, observe: @escaping (String) throws -> Void = { _ in },
         availableBytes: (() throws -> Int64)? = nil) {
        self.root = root
        self.protect = protect
        self.hash = hash
        self.check = check
        self.observe = observe
        self.availableBytes = availableBytes
    }

    func directory(_ parent: URL, _ name: String) throws -> URL {
        let url = parent.appendingPathComponent(name, isDirectory: true)
        if fm.fileExists(atPath: url.path) {
            guard try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey]).isSymbolicLink != true,
                  try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else { throw LedgerDataError.invalidFile }
        } else {
            try fm.createDirectory(at: url, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        }
        try protect(url)
        return url
    }

    func database(_ name: String) throws -> URL {
        guard name.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil else { throw LedgerDataError.invalidFile }
        return root.appendingPathComponent(name + "SQLite.db")
    }

    func regularFile(_ url: URL, maximum: Int = LedgerDataStore.maximum) throws -> Int {
        let attrs = try fm.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              let bytes = attrs[.size] as? NSNumber, bytes.int64Value >= 0, bytes.int64Value <= maximum else { throw LedgerDataError.invalidFile }
        return bytes.intValue
    }

    func syncDirectory(_ url: URL) throws {
        let fd = Darwin.open(url.path, O_RDONLY)
        guard fd >= 0 else { throw POSIXError(.EIO) }
        defer { Darwin.close(fd) }
        guard Darwin.fsync(fd) == 0 else { throw POSIXError(.EIO) }
    }

    func writeJSON(_ value: [String: Any], _ url: URL) throws {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: url, options: .atomic)
        try protect(url)
        let handle = try FileHandle(forWritingTo: url)
        try handle.synchronize()
        try handle.close()
        try syncDirectory(url.deletingLastPathComponent())
    }

    func json(_ url: URL) throws -> [String: Any] {
        _ = try regularFile(url, maximum: 65536)
        guard let result = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else { throw LedgerDataError.invalidFile }
        return result
    }

    func transfer(_ id: String) throws -> URL {
        guard UUID(uuidString: id) != nil else { throw LedgerDataError.invalidFile }
        let base = try directory(root, "Transfers")
        let url = base.appendingPathComponent(id.lowercased(), isDirectory: true)
        guard fm.fileExists(atPath: url.path), try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
        return url
    }

    func begin(_ kind: String) throws -> String {
        guard ["csv", "backup", "incoming"].contains(kind) else { throw LedgerDataError.invalidFile }
        let base = try directory(root, "Transfers")
        // 能力数有界；遗留敏感文件由启动恢复回收，不能无限创建。
        guard try fm.contentsOfDirectory(atPath: base.path).count < 16 else { throw LedgerDataError.conflict }
        let id = UUID().uuidString.lowercased()
        let folder = try directory(base, id)
        let file = folder.appendingPathComponent(kind == "csv" ? "payload.csv" : "payload.mybill")
        guard fm.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteUnknown) }
        try protect(file)
        try writeJSON(["id": id, "kind": kind, "createdAt": ISO8601DateFormatter().string(from: Date())], folder.appendingPathComponent("receipt.json"))
        return id
    }

    func payload(_ id: String) throws -> URL {
        let folder = try transfer(id)
        let receipt = try json(folder.appendingPathComponent("receipt.json"))
        guard receipt["id"] as? String == id.lowercased(), let kind = receipt["kind"] as? String,
              ["csv", "backup", "incoming"].contains(kind) else { throw LedgerDataError.invalidFile }
        let url = folder.appendingPathComponent(kind == "csv" ? "payload.csv" : "payload.mybill")
        _ = try regularFile(url, maximum: Self.maximum + 131072)
        return url
    }

    func append(_ id: String, text: String) throws {
        try check()
        let url = try payload(id), data = Data(text.utf8)
        guard url.pathExtension == "csv", data.count <= Self.chunk,
              try regularFile(url) + data.count <= Self.maximum else { throw LedgerDataError.invalidFile }
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }

    func importFile(_ source: URL) throws -> String {
        _ = try regularFile(source, maximum: Self.maximum + 131072)
        let id = try begin("incoming")
        do {
            let input = try FileHandle(forReadingFrom: source)
            defer { try? input.close() }
            let output = try FileHandle(forWritingTo: payload(id))
            defer { try? output.close() }
            var bytes = 0
            while let data = try input.read(upToCount: Self.chunk), !data.isEmpty {
                try check()
                bytes += data.count
                guard bytes <= Self.maximum + 131072 else { throw LedgerDataError.invalidFile }
                try output.write(contentsOf: data)
            }
            try output.synchronize()
            return id
        } catch {
            try discard(id)
            throw error
        }
    }

    private func key(_ password: String, salt: Data, iterations: Int) throws -> SymmetricKey {
        let bytes = Array(password.utf8)
        guard (8...1024).contains(bytes.count), salt.count == 32, iterations == Self.iterations else { throw LedgerDataError.incompatible }
        var derived = [UInt8](repeating: 0, count: 32)
        defer { derived.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) } }
        let result = bytes.withUnsafeBytes { p in salt.withUnsafeBytes { s in derived.withUnsafeMutableBytes { d in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), p.baseAddress!.assumingMemoryBound(to: Int8.self), bytes.count,
                s.baseAddress!.assumingMemoryBound(to: UInt8.self), salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                UInt32(iterations), d.baseAddress!.assumingMemoryBound(to: UInt8.self), 32)
        } } }
        guard result == kCCSuccess else { throw LedgerDataError.authentication }
        return SymmetricKey(data: derived)
    }

    private func u32(_ value: Int) -> Data {
        var number = UInt32(value).bigEndian
        return withUnsafeBytes(of: &number) { Data($0) }
    }

    private func exact(_ handle: FileHandle, count: Int) throws -> Data {
        guard count >= 0, count <= Self.chunk + 65536 else { throw LedgerDataError.invalidFile }
        var data = Data()
        while data.count < count {
            guard let part = try handle.read(upToCount: count - data.count), !part.isEmpty else { throw LedgerDataError.invalidFile }
            data.append(part)
        }
        return data
    }

    private func length(_ handle: FileHandle) throws -> Int {
        let data = try exact(handle, count: 4)
        return data.reduce(0) { ($0 << 8) | Int($1) }
    }

    private func aad(_ header: Data, index: Int) -> Data {
        var sequence = UInt64(index).bigEndian
        return header + withUnsafeBytes(of: &sequence) { Data($0) }
    }

    func seal(_ id: String, name: String, password: String, manifest: [String: Any]) throws {
        let source = try database(name)
        try LedgerFilesPlugin.verifyClosedSidecars(database: source)
        let bytes = try regularFile(source)
        guard bytes > 0 else { throw LedgerDataError.invalidFile }
        try requireSpace(Int64(bytes + 16 * 1024 * 1024))
        var salt = Data(count: 32)
        let random = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard random == errSecSuccess else { throw LedgerDataError.authentication }
        let header = try JSONSerialization.data(withJSONObject: ["version": 1, "cipher": "AES-256-GCM",
            "kdf": "PBKDF2-HMAC-SHA256", "iterations": Self.iterations, "salt": salt.base64EncodedString(),
            "bytes": bytes, "chunk": Self.chunk], options: [.sortedKeys])
        let key = try key(password, salt: salt, iterations: Self.iterations)
        var info = manifest
        info["bytes"] = bytes
        info["sha256"] = try hash(source)
        let metadata = try JSONSerialization.data(withJSONObject: info, options: [.sortedKeys])
        guard metadata.count <= 65536 else { throw LedgerDataError.invalidFile }
        let folder = try transfer(id), pending = folder.appendingPathComponent("pending")
        fm.createFile(atPath: pending.path, contents: nil, attributes: [.posixPermissions: 0o600])
        try protect(pending)
        let output = try FileHandle(forWritingTo: pending)
        let input = try FileHandle(forReadingFrom: source)
        defer { try? output.close(); try? input.close() }
        do {
            try output.write(contentsOf: Self.magic + u32(header.count) + header)
            func frame(_ data: Data, index: Int) throws {
                try check()
                let box = try AES.GCM.seal(data, using: key, authenticating: aad(header, index: index))
                let combined = box.combined!
                try output.write(contentsOf: u32(combined.count) + combined)
            }
            try frame(metadata, index: 0)
            var index = 1, total = 0
            while let data = try input.read(upToCount: Self.chunk), !data.isEmpty {
                total += data.count
                guard total <= bytes else { throw LedgerDataError.invalidFile }
                try frame(data, index: index)
                index += 1
            }
            guard total == bytes, try hash(source) == info["sha256"] as? String else { throw LedgerDataError.conflict }
            try output.synchronize()
            try output.close()
            let final = try payload(id)
            guard Darwin.rename(pending.path, final.path) == 0 else { throw POSIXError(.EIO) }
            try protect(final)
            try syncDirectory(folder)
        } catch {
            if fm.fileExists(atPath: pending.path) { try fm.removeItem(at: pending) }
            throw error
        }
    }

    func unseal(_ id: String, password: String) throws -> (String, [String: Any]) {
        let input = try FileHandle(forReadingFrom: payload(id))
        defer { try? input.close() }
        guard try exact(input, count: Self.magic.count) == Self.magic else { throw LedgerDataError.incompatible }
        let headerLength = try length(input)
        guard (1...4096).contains(headerLength) else { throw LedgerDataError.invalidFile }
        let header = try exact(input, count: headerLength)
        guard let fields = try JSONSerialization.jsonObject(with: header) as? [String: Any],
              Set(fields.keys) == Set(["version","cipher","kdf","iterations","salt","bytes","chunk"]),
              fields["version"] as? Int == 1, fields["cipher"] as? String == "AES-256-GCM",
              fields["kdf"] as? String == "PBKDF2-HMAC-SHA256", fields["chunk"] as? Int == Self.chunk,
              let iterations = fields["iterations"] as? Int, iterations == Self.iterations,
              let count = fields["bytes"] as? Int, (1...Self.maximum).contains(count),
              let encodedSalt = fields["salt"] as? String, let salt = Data(base64Encoded: encodedSalt), salt.count == 32 else { throw LedgerDataError.incompatible }
        try requireSpace(Int64(count * 3 + 16 * 1024 * 1024))
        let key = try key(password, salt: salt, iterations: iterations)
        func frame(_ expected: Int, index: Int) throws -> Data {
            try check()
            let bytes = try length(input)
            guard bytes >= 28, bytes <= expected + 28 else { throw LedgerDataError.invalidFile }
            let box = try AES.GCM.SealedBox(combined: exact(input, count: bytes))
            do { return try AES.GCM.open(box, using: key, authenticating: aad(header, index: index)) }
            catch { throw LedgerDataError.authentication }
        }
        let metadata = try frame(65536, index: 0)
        guard let manifest = try JSONSerialization.jsonObject(with: metadata) as? [String: Any],
              manifest["backupFormatVersion"] as? Int == 1, manifest["bytes"] as? Int == count,
              let checksum = manifest["sha256"] as? String, checksum.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw LedgerDataError.incompatible }
        let name = "restore_" + id.replacingOccurrences(of: "-", with: "").lowercased()
        let destination = try database(name)
        // 同一文件重试只回收此前属于该能力的临时库，原账本从不在此路径。
        try discardDatabase(name)
        fm.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600])
        try protect(destination)
        let output = try FileHandle(forWritingTo: destination)
        defer { try? output.close() }
        do {
            var remaining = count, index = 1
            while remaining > 0 {
                let expected = min(Self.chunk, remaining)
                let data = try frame(expected, index: index)
                guard data.count == expected else { throw LedgerDataError.invalidFile }
                try output.write(contentsOf: data)
                remaining -= expected
                index += 1
            }
            guard (try input.read(upToCount: 1) ?? Data()).isEmpty else { throw LedgerDataError.invalidFile }
            try output.synchronize()
            try output.close()
            guard try hash(destination) == checksum else { throw LedgerDataError.authentication }
            return (name, manifest)
        } catch {
            try discardDatabase(name)
            throw error
        }
    }

    func requireSpace(_ bytes: Int64) throws {
        let available = try availableBytes?() ?? (fm.attributesOfFileSystem(forPath: root.path)[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
        guard available > bytes else { throw CocoaError(.fileWriteOutOfSpace) }
    }

    func discard(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw LedgerDataError.invalidFile }
        let url = try directory(root,"Transfers").appendingPathComponent(id.lowercased())
        if fm.fileExists(atPath: url.path) { try fm.removeItem(at: transfer(id)) }
    }

    func discardDatabase(_ name: String) throws {
        guard name.hasPrefix("restore_") || name.hasPrefix("fresh_") else { throw LedgerDataError.invalidFile }
        let file = try database(name)
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let url = URL(fileURLWithPath: file.path + suffix)
            if fm.fileExists(atPath: url.path) {
                _ = try regularFile(url)
                try fm.removeItem(at: url)
            }
        }
        for (url, info) in try snapshotManifests() where info["database"] as? String == name {
            try fm.removeItem(at: url)
        }
    }

    func marker(_ name: String) throws -> URL { try directory(root, "Switches").appendingPathComponent(name + ".json") }

    /// 原库副本和准备库先持久化，标记落盘后才执行同文件系统 rename；恢复按内容摘要判定提交点。
    func replace(name: String, prepared: String, operationId: String, clear: Bool, expectedSHA256: String) throws {
        guard name != prepared, UUID(uuidString: operationId) != nil,
              prepared.hasPrefix(clear ? "fresh_" : "restore_") else { throw LedgerDataError.invalidFile }
        let active = try database(name), source = try database(prepared), state = try marker(name)
        guard !fm.fileExists(atPath: state.path) else { throw LedgerDataError.conflict }
        try LedgerFilesPlugin.verifyClosedSidecars(database: active)
        try LedgerFilesPlugin.verifyClosedSidecars(database: source)
        let bytes = try regularFile(active) + regularFile(source)
        guard try hash(source) == expectedSHA256 else { throw LedgerDataError.conflict }
        try requireSpace(Int64(bytes + 16 * 1024 * 1024))
        let operations = try directory(root, "Operations"), folder = try directory(operations, operationId.lowercased())
        let old = folder.appendingPathComponent("old.db"), next = folder.appendingPathComponent("next.db")
        try fm.copyItem(at: active, to: old)
        try protect(old)
        try fm.copyItem(at: source, to: next)
        try protect(next)
        let previous = try hash(active), candidate = try hash(source)
        guard try hash(old) == previous, try hash(next) == candidate else { throw LedgerDataError.invalidFile }
        for url in [old,next] {
            let handle = try FileHandle(forWritingTo: url)
            try handle.synchronize()
            try handle.close()
        }
        try syncDirectory(folder)
        try check()
        try observe("copies-ready")
        try writeJSON(["name": name,"prepared": prepared,"operationId": operationId.lowercased(),"clear": clear,
                       "oldSha256": previous,"newSha256": candidate], state)
        try observe("switch-prepared")
        // 自此取消不再把已提交结果伪装成未执行；下次打开由同一标记收敛。
        guard Darwin.rename(next.path, active.path) == 0 else { throw POSIXError(.EIO) }
        try syncDirectory(root)
        try observe("switch-committed")
        try protect(active)
    }

    func switchState(_ name: String) throws -> ([String: Any], URL)? {
        let active = try database(name), state = try marker(name)
        guard fm.fileExists(atPath: state.path) else { return nil }
        let value = try json(state)
        guard value["name"] as? String == name, let id = value["operationId"] as? String, UUID(uuidString: id) != nil,
              let old = value["oldSha256"] as? String, let next = value["newSha256"] as? String,
              let prepared = value["prepared"] as? String, prepared.hasPrefix("restore_") || prepared.hasPrefix("fresh_") else { throw LedgerDataError.invalidFile }
        let folder = try directory(root,"Operations").appendingPathComponent(id)
        if value["phase"] as? String != "cleanup" {
            guard try hash(folder.appendingPathComponent("old.db")) == old else { throw LedgerDataError.invalidFile }
        }
        let current = try hash(active)
        guard current == old || current == next else { throw LedgerDataError.conflict }
        return (value, folder)
    }

    func recover(_ name: String) throws {
        guard let (state,_) = try switchState(name) else { return }
        let active = try database(name)
        if try hash(active) == state["newSha256"] as? String {
            // 新主库已原子提交；旧的非热 journal/shm 不能遗留为清空后的内部数据。
            // 此入口总在共享迁移器打开连接前调用，仍拒绝任何热日志。
            try LedgerFilesPlugin.verifyClosedSidecars(database: active)
            for suffix in ["-wal","-shm","-journal"] {
                let url = URL(fileURLWithPath: active.path + suffix)
                if fm.fileExists(atPath: url.path) { _ = try regularFile(url); try fm.removeItem(at: url) }
            }
        }
    }

    /// 冷启动/确认清空时只回收本 App 随机命名、且未被切换标记引用的临时对象。
    func cleanupOrphans() throws {
        let switches = try directory(root,"Switches")
        var prepared = Set<String>(), operations = Set<String>()
        for state in try fm.contentsOfDirectory(at: switches,includingPropertiesForKeys: nil) where state.pathExtension == "json" {
            let info = try json(state)
            guard let name = info["prepared"] as? String, let operation = info["operationId"] as? String,
                  UUID(uuidString: operation) != nil else { throw LedgerDataError.invalidFile }
            prepared.insert(name)
            operations.insert(operation)
        }
        for url in try fm.contentsOfDirectory(at: root,includingPropertiesForKeys: nil) {
            let filename = url.lastPathComponent
            if let match = filename.range(of: "^(restore|fresh)_[a-f0-9]{32}SQLite\\.db(?:-wal|-shm|-journal)?$", options: .regularExpression) {
                let base = String(filename[match]).components(separatedBy: "SQLite.db")[0]
                let name = base
                if !prepared.contains(name) { try discardDatabase(name) }
            }
        }
        let base = try directory(root,"Operations")
        for url in try fm.contentsOfDirectory(at: base,includingPropertiesForKeys: nil) where !operations.contains(url.lastPathComponent) {
            guard UUID(uuidString: url.lastPathComponent) != nil,
                  try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
            for file in try fm.contentsOfDirectory(at: url,includingPropertiesForKeys: nil) {
                guard ["old.db","next.db"].contains(file.lastPathComponent) else { throw LedgerDataError.invalidFile }
                _ = try regularFile(file)
            }
            try fm.removeItem(at: url)
        }
        let snapshots = try directory(root,"Snapshots")
        for url in try fm.contentsOfDirectory(at: snapshots,includingPropertiesForKeys: nil) {
            if url.lastPathComponent.hasPrefix("pending-"), UUID(uuidString: String(url.lastPathComponent.dropFirst(8))) != nil {
                guard try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
                try fm.removeItem(at: url)
            }
        }
    }

    /// 只有共享迁移器/完整性及文件策略通过后才回收原库；中断时标记仍指向可判定状态。
    func releaseCompletedPins(_ name: String) throws {
        do {
            for (folder, var info) in try snapshotManifests() where info["database"] as? String == name && info["pinned"] as? Bool == true {
                info["pinned"] = false
                try writeJSON(info,folder.appendingPathComponent("manifest.json"))
            }
            try rotateSnapshots(database: name)
        } catch {
            // 旧快照维护不是主库就绪条件；保留未清完对象和明确提示，不牵连已校验的健康账本。
            snapshotWarning(error)
        }
    }

    func finishSwitch(_ name: String) throws {
        guard let (state, folder) = try switchState(name) else { try releaseCompletedPins(name); return }
        let committed = try hash(database(name)) == state["newSha256"] as? String
        if committed && state["clear"] as? Bool == true {
            for leaf in ["Snapshots","Transfers","QuarantinedSnapshots"] {
                let url = root.appendingPathComponent(leaf, isDirectory: true)
                if fm.fileExists(atPath: url.path) {
                    guard try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
                    try fm.removeItem(at: url)
                }
            }
        }
        try discardDatabase(state["prepared"] as! String)
        try observe("result-ready")
        try writeJSON(["lastResult": committed ? (state["clear"] as? Bool == true ? "本机数据已清空" : "备份已恢复") : "替换未提交，已保留原账本"], root.appendingPathComponent("data-status.json"))
        // 验证通过后持久化 cleanup 阶段，允许已删除旧副本的收尾在重启后继续。
        var finalState = state
        finalState["phase"] = "cleanup"
        try writeJSON(finalState, marker(name))
        try observe("cleanup-recorded")
        if fm.fileExists(atPath: folder.path) { try fm.removeItem(at: folder) }
        try observe("old-files-removed")
        try fm.removeItem(at: marker(name))
        try syncDirectory(try directory(root,"Switches"))
        try releaseCompletedPins(name)
        if committed && state["clear"] as? Bool == true { try cleanupOrphans() }
    }

    /// 维护故障保留可见提示及安全诊断；警告落盘失败也不能把旧快照故障扩大成主库不可用。
    func snapshotWarning(_ error: Error) {
        let fault = error as NSError
        Logger(subsystem: "com.mybill.offline", category: "storage").error("Snapshot maintenance incomplete: domain=\(fault.domain, privacy: .public), code=\(fault.code)")
        do {
            let folder = try directory(root,"Snapshots")
            try writeJSON(["message": "内部快照维护未完成或存在已隔离副本；账本仍可使用，请创建外部备份后核对。"],folder.appendingPathComponent("warning.json"))
        } catch {
            Logger(subsystem: "com.mybill.offline", category: "storage").error("Snapshot warning could not be persisted: code=\((error as NSError).code)")
        }
    }

    /// 隔离最多七份异常副本，不直接删除可能仍含可救援数据的旧文件。达到上限时停止新增快照。
    func quarantineSnapshot(_ folder: URL, error: Error) {
        do {
            let quarantine = try directory(root,"QuarantinedSnapshots")
            let children = try fm.contentsOfDirectory(at: quarantine,includingPropertiesForKeys: nil)
            guard children.count < 7 else { throw LedgerDataError.conflict }
            let target = quarantine.appendingPathComponent(folder.lastPathComponent)
            guard !fm.fileExists(atPath: target.path), Darwin.rename(folder.path,target.path) == 0 else { throw LedgerDataError.conflict }
            try syncDirectory(quarantine)
            try syncDirectory(folder.deletingLastPathComponent())
        } catch {
            // 权限等暂态故障时留在原地，后续维护再尝试，不假定异常副本已删除。
            snapshotWarning(error)
        }
        snapshotWarning(error)
    }

    func assertSnapshotCapacity() throws {
        let quarantine = try directory(root,"QuarantinedSnapshots")
        guard try fm.contentsOfDirectory(at: quarantine,includingPropertiesForKeys: nil).count < 7 else { throw LedgerDataError.conflict }
    }

    /// 轮换先原子移出有效集合；递归删除中断只留下 retiring-UUID，重开继续回收。
    func recoverRetiredSnapshots(_ base: URL) throws {
        for folder in try fm.contentsOfDirectory(at: base,includingPropertiesForKeys: nil) {
            guard folder.lastPathComponent.hasPrefix("retiring-"),
                  UUID(uuidString: String(folder.lastPathComponent.dropFirst(9))) != nil else { continue }
            do {
                guard try folder.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
                try fm.removeItem(at: folder)
                try syncDirectory(base)
            } catch { snapshotWarning(error) }
        }
    }

    func snapshotManifests() throws -> [(URL, [String: Any])] {
        let base = try directory(root, "Snapshots")
        try recoverRetiredSnapshots(base)
        return try fm.contentsOfDirectory(at: base, includingPropertiesForKeys: nil).compactMap { url in
            guard UUID(uuidString: url.lastPathComponent) != nil else { return nil }
            do {
                guard try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
                let info = try json(url.appendingPathComponent("manifest.json"))
                guard info["id"] as? String == url.lastPathComponent,
                      let bytes = info["bytes"] as? Int, try regularFile(url.appendingPathComponent("ledger.db")) == bytes,
                      info["sha256"] is String, info["createdAt"] is String else { throw LedgerDataError.invalidFile }
                return (url, info)
            } catch {
                quarantineSnapshot(url,error: error)
                return nil
            }
        }.sorted { ($0.1["createdAt"] as! String, $0.0.lastPathComponent) > ($1.1["createdAt"] as! String, $1.0.lastPathComponent) }
    }

    func rotateSnapshots(database: String) throws {
        // 测试数据库/临时升级库各自作用域，不能轮换正式账本的快照。
        let all = try snapshotManifests().filter { $0.1["database"] as? String == database }
        var excess = all.count - 7
        for (url, info) in all.reversed() where excess > 0 && info["pinned"] as? Bool != true {
            let retired = url.deletingLastPathComponent().appendingPathComponent("retiring-" + url.lastPathComponent)
            guard !fm.fileExists(atPath: retired.path), Darwin.rename(url.path,retired.path) == 0 else { throw LedgerDataError.conflict }
            try syncDirectory(url.deletingLastPathComponent())
            try observe("snapshot-retired")
            try fm.removeItem(at: retired)
            try syncDirectory(url.deletingLastPathComponent())
            try observe("snapshot-files-removed")
            excess -= 1
        }
        guard excess <= 0 else { throw LedgerDataError.conflict }
        let base = try directory(root,"Snapshots"), quarantine = try directory(root,"QuarantinedSnapshots")
        if try fm.contentsOfDirectory(at: quarantine,includingPropertiesForKeys: nil).isEmpty,
           !(try fm.contentsOfDirectory(atPath: base.path)).contains(where: { $0.hasPrefix("retiring-") }) {
            let warning = base.appendingPathComponent("warning.json")
            if fm.fileExists(atPath: warning.path) { try fm.removeItem(at: warning) }
        }
    }

    func finishSnapshot(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw LedgerDataError.invalidFile }
        let folder = try directory(root,"Snapshots").appendingPathComponent(id)
        if !fm.fileExists(atPath: folder.path) { return } // 已完成并被轮换，重复收尾保持幂等。
        var info = try json(folder.appendingPathComponent("manifest.json"))
        info["pinned"] = false
        try writeJSON(info,folder.appendingPathComponent("manifest.json"))
        guard let database = info["database"] as? String else { throw LedgerDataError.invalidFile }
        try rotateSnapshots(database: database)
    }
}

extension LedgerFilesPlugin: UIDocumentPickerDelegate {
    func store(_ id: String? = nil) throws -> LedgerDataStore {
        let root = try root()
        if !FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        }
        try protectURL(root)
        return LedgerDataStore(root: root, protect: self.protectURL, hash: self.digest, check: { [weak self] in
            guard let self, let id else { return }
            self.cancellationLock.lock()
            let cancelled = self.cancelledTransfers.contains(id)
            self.cancellationLock.unlock()
            if cancelled { throw LedgerDataError.cancelled }
        })
    }

    func dataWork(_ call: CAPPluginCall, _ body: @escaping () throws -> [String: Any]) {
        worker.async {
            do { call.resolve(try body()) }
            catch {
                let code = (error as? LedgerDataError)?.rawValue ?? "DATA_FILE_FAILED"
                let message = error as? LedgerDataError == .authentication ? "备份密码不正确或文件已损坏。"
                    : error as? LedgerDataError == .cancelled ? "操作已取消。" : "数据文件操作未完成，原账本及可用备份已保留。"
                call.reject(message, code, error)
            }
        }
    }

    @objc func createTransfer(_ call: CAPPluginCall) {
        dataWork(call) { [self] in ["id": try store().begin(call.getString("kind") ?? "")] }
    }

    @objc func appendTransfer(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let id = call.getString("id") ?? ""
            guard let text = call.getString("text") else { throw LedgerDataError.invalidFile }
            try store(id).append(id,text: text)
            return [:]
        }
    }

    @objc func exportBackup(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let id = call.getString("id") ?? ""
            guard let info = call.getObject("manifest"), let password = call.getString("password"), let name = call.getString("name") else { throw LedgerDataError.invalidFile }
            try store(id).seal(id,name: name,password: password,manifest: info)
            return ["id": id]
        }
    }

    @objc func prepareRestore(_ call: CAPPluginCall) {
        cancellationLock.lock()
        cancelledTransfers.remove(call.getString("id") ?? "")
        cancellationLock.unlock()
        dataWork(call) { [self] in
            let id = call.getString("id") ?? ""
            let (name, manifest) = try store(id).unseal(id,password: call.getString("password") ?? "")
            return ["name": name,"manifest": manifest]
        }
    }

    @objc func cancelTransfer(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), UUID(uuidString: id) != nil else { call.reject("操作标识无效。"); return }
        cancellationLock.lock()
        guard cancelledTransfers.count < 32 || cancelledTransfers.contains(id) else {
            cancellationLock.unlock()
            call.reject("取消操作数量已达上限，请完成当前操作后重试。", "DATA_OPERATION_CONFLICT")
            return
        }
        cancelledTransfers.insert(id)
        cancellationLock.unlock()
        call.resolve()
    }

    @objc func discardTransfer(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let id = call.getString("id") ?? ""
            try store().discard(id)
            cancellationLock.lock()
            cancelledTransfers.remove(id)
            cancellationLock.unlock()
            return [:]
        }
    }

    @objc func discardDatabase(_ call: CAPPluginCall) {
        dataWork(call) { [self] in try store().discardDatabase(call.getString("name") ?? ""); return [:] }
    }

    @objc func replaceLedger(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            try store().replace(name: call.getString("name") ?? "",prepared: call.getString("prepared") ?? "",
                operationId: call.getString("operationId") ?? "",clear: call.getBool("clear") ?? false,expectedSHA256: call.getString("sha256") ?? "")
            return [:]
        }
    }

    @objc func hashDatabase(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let storage = try store(), url = try storage.database(call.getString("name") ?? "")
            try LedgerFilesPlugin.verifyClosedSidecars(database: url)
            _ = try storage.regularFile(url)
            return ["sha256": try digest(url)]
        }
    }

    @objc func recover(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let storage = try store(), name = call.getString("name") ?? ""
            try storage.recover(name)
            if name == "ledger" && !cleanedLaunchTransfers {
                // 只在本 App 冷启动首次打开时回收上个进程的能力，不清理本轮活跃导出。
                for leaf in ["Transfers"] {
                    let directory = try storage.directory(storage.root,leaf)
                    for child in try storage.fm.contentsOfDirectory(at: directory,includingPropertiesForKeys: nil) {
                        guard UUID(uuidString: child.lastPathComponent) != nil,
                              try child.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw LedgerDataError.invalidFile }
                        try storage.discard(child.lastPathComponent)
                    }
                }
                try storage.cleanupOrphans()
                let status = storage.root.appendingPathComponent("data-status.json")
                if FileManager.default.fileExists(atPath: status.path), try storage.json(status)["lastResult"] as? String == "数据操作进行中" {
                    try storage.writeJSON(["lastResult": "上次数据操作中断，请核对账本与外部文件后重试"],status)
                }
                cleanedLaunchTransfers = true
            }
            return [:]
        }
    }

    @objc func finishSwitch(_ call: CAPPluginCall) {
        dataWork(call) { [self] in try store().finishSwitch(call.getString("name") ?? ""); return [:] }
    }

    @objc func finishSnapshot(_ call: CAPPluginCall) {
        dataWork(call) { [self] in try store().finishSnapshot(call.getString("id") ?? ""); return [:] }
    }

    @objc func dataStatus(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let storage = try store(), state = storage.root.appendingPathComponent("data-status.json")
            let snapshots = try storage.snapshotManifests().filter { $0.1["database"] as? String == "ledger" }.count
            let warning = try storage.directory(storage.root,"Snapshots").appendingPathComponent("warning.json")
            let message = FileManager.default.fileExists(atPath: warning.path) ? try storage.json(warning)["message"] as? String : nil
            let lastResult = FileManager.default.fileExists(atPath: state.path) ? try storage.json(state)["lastResult"] as? String : nil
            return ["snapshots": snapshots,
                    "lastResult": message ?? lastResult ?? "暂无恢复或清空记录"]
        }
    }

    @objc func recordDataResult(_ call: CAPPluginCall) {
        dataWork(call) { [self] in
            let labels = ["restore-ready": "备份已校验，等待确认恢复", "data-running": "数据操作进行中",
                          "data-failed": "最近数据操作未完成，请核对账本与文件后重试", "data-cancelled": "数据操作已取消"]
            guard let result = call.getString("result"), let label = labels[result] else { throw LedgerDataError.invalidFile }
            let storage = try store()
            try storage.writeJSON(["lastResult": label],storage.root.appendingPathComponent("data-status.json"))
            return [:]
        }
    }

    @objc func saveTransfer(_ call: CAPPluginCall) {
        dataWorkPreparation(call, exporting: true)
    }

    @objc func pickBackup(_ call: CAPPluginCall) {
        dataWorkPreparation(call, exporting: false)
    }

    private func dataWorkPreparation(_ call: CAPPluginCall, exporting: Bool) {
        // UIKit 在主线程，文件校验/复制和加密均在有界串行 worker，不阻塞页面主线程。
        worker.async {
            do {
                let id = exporting ? call.getString("id") : nil
                var source: URL?
                if let id {
                    let storage = try self.store(id), payload = try storage.payload(id)
                    let filename = call.getString("filename") ?? ""
                    guard filename.count <= 120, !filename.contains("/"), !filename.contains("\\"),
                          filename.hasSuffix(payload.pathExtension == "csv" ? ".csv" : ".mybill") else { throw LedgerDataError.invalidFile }
                    let display = payload.deletingLastPathComponent().appendingPathComponent(filename)
                    if FileManager.default.fileExists(atPath: display.path) { try FileManager.default.removeItem(at: display) }
                    try FileManager.default.copyItem(at: payload,to: display)
                    try self.protectURL(display)
                    source = display
                } else if exporting { throw LedgerDataError.invalidFile }
                guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { throw LedgerDataError.invalidFile }
                try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
                DispatchQueue.main.async {
                    guard self.documentCall == nil, let host = self.bridge?.viewController else { call.reject("请先完成当前文件选择。"); return }
                    self.documentCall = call
                    self.documentExportId = id
                    let picker = source.map { UIDocumentPickerViewController(forExporting: [$0],asCopy: true) }
                        ?? UIDocumentPickerViewController(forOpeningContentTypes: [.data],asCopy: false)
                    // 默认本机目录，离线打开不依赖系统记忆的云端/最近位置；用户仍可另选。
                    picker.directoryURL = documents
                    picker.delegate = self
                    picker.allowsMultipleSelection = false
                    host.present(picker,animated: true)
                }
            } catch { call.reject("文件暂不可用，请重新生成或选择。", "DATA_FILE_FAILED",error) }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = documentCall else { return }
        let exporting = documentExportId
        documentCall = nil
        documentExportId = nil
        dataWork(call) { [self] in
            let storage = try store()
            try storage.writeJSON(["lastResult": exporting == nil ? "已取消文件选择，账本未改变" : "已取消文件保存，账本未改变"],storage.root.appendingPathComponent("data-status.json"))
            return exporting == nil ? ["cancelled": true] : ["saved": false]
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = documentCall, urls.count == 1 else { return }
        let exporting = documentExportId
        documentCall = nil
        documentExportId = nil
        dataWork(call) { [self] in
            let source = urls[0], scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            let storage = try store(exporting)
            if let exporting {
                _ = try storage.regularFile(source, maximum: LedgerDataStore.maximum + 131072)
                guard try digest(source) == digest(storage.payload(exporting)) else { throw LedgerDataError.invalidFile }
                let kind = try storage.json(storage.transfer(exporting).appendingPathComponent("receipt.json"))["kind"] as? String
                try storage.writeJSON(["lastResult": kind == "csv" ? "CSV 已保存" : "完整备份已保存"],storage.root.appendingPathComponent("data-status.json"))
                return ["saved": true]
            }
            let imported = try storage.importFile(source)
            try storage.writeJSON(["lastResult": "已选择备份文件，等待校验"],storage.root.appendingPathComponent("data-status.json"))
            return ["id": imported,"cancelled": false]
        }
    }
}
