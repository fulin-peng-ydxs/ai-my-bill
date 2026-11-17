#if !targetEnvironment(simulator)
#error("本回归测试仅允许独立 iPhone 模拟器；禁止构建/安装到真实设备，正式 App target 不受影响。")
#endif

import Foundation

/// 两个测试 target 共用的前置守卫；生产 App 不编译此文件或读取测试清单。
/// 清单由 ios-app.sh 为本轮 create 的设备产生，Xcode 直接运行缺少清单时明确拒绝。
enum OwnedSimulatorTestContext {
    private struct Manifest: Codable {
        let simulatorId: UUID
        let runId: UUID
        let appId: String
        let scenario: String?
    }

    private static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }

    static func requireOwnedSimulator() throws {
        try validate(environment: ProcessInfo.processInfo.environment, simulator: isSimulator)
    }

    /// 可变场景只存于已校验的测试清单，缓存 xctestrun 无需重建或加入生产开关。
    static func requestedScenario() throws -> String {
        try requireOwnedSimulator()
        let path = ProcessInfo.processInfo.environment["MYBILL_TEST_CONTEXT_FILE"]!
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        guard let scenario = manifest.scenario, !scenario.isEmpty else { throw refusal("missing-scenario") }
        return scenario
    }

    /// 可注入环境仅供负例验证；在任何 App 操作或页面探针注入之前调用。
    static func validate(environment: [String: String], simulator: Bool) throws {
        guard simulator else { throw refusal("non-simulator") }
        guard let actual = environment["SIMULATOR_UDID"].flatMap(UUID.init(uuidString:)) else {
            throw refusal("missing-simulator-id")
        }
        guard let path = environment["MYBILL_TEST_CONTEXT_FILE"], path.hasPrefix("/") else {
            throw refusal("missing-context-file")
        }
        let url = URL(fileURLWithPath: path)
        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 4096 else {
            throw refusal()
        }
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
        guard manifest.simulatorId == actual, manifest.appId == "com.mybill.offline" else {
            throw refusal()
        }
    }

    private static func refusal(_ reason: String = "invalid-context") -> NSError {
        NSError(domain: "OwnedSimulatorTestContext", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "测试仅允许脚本创建的本轮独立模拟器；缺少或不匹配的隔离清单已拒绝（\(reason)）。"])
    }
}
