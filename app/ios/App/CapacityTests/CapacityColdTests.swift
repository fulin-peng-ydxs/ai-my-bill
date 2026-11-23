import XCTest

/// XCTest 原生启动与可用表单的保守上界；不把首帧或空壳响应误当账本可用。
@MainActor final class CapacityColdTests:XCTestCase {
    private func coldLaunch(_ sampleIndex:Int) throws {
        let raw = ProcessInfo.processInfo.environment["MYBILL_CAPACITY_CONTEXT"] ?? ""
        guard raw.utf8.count <= 4096,let data = raw.data(using:.utf8),
              var context = try JSONSerialization.jsonObject(with:data) as? [String:Any],
              let id = context["runId"] as? String,UUID(uuidString:id) != nil,
              [10000,100000].contains(context["count"] as? Int ?? 0) else {
            throw NSError(domain:"CapacityGuard",code:1)
        }
        #if targetEnvironment(simulator)
        guard context["mode"] as? String == "simulator",context["deviceId"] as? String == ProcessInfo.processInfo.environment["SIMULATOR_UDID"] else {
            throw NSError(domain:"CapacityGuard",code:3)
        }
        #else
        guard context["mode"] as? String == "device" else { throw NSError(domain:"CapacityGuard",code:3) }
        #endif
        let app = XCUIApplication(bundleIdentifier:"com.mybill.offline.capacity")
        defer { app.terminate() }
        app.terminate()
        let start = ProcessInfo.processInfo.systemUptime
        let epoch = Date().timeIntervalSince1970*1000
        app.launch()
        let price = app.textFields.matching(NSPredicate(format:"identifier == %@ OR label == %@","expense-unit-price","单价")).firstMatch
        // 使用既有 60 秒单例的剩余预算，预留 5 秒收尾；不将内部等待另加到总时限。
        // 耗时仍从真正启动前计算，慢启动不会被隐藏或记为真机性能通过。
        let readyBudget = max(0,55-(ProcessInfo.processInfo.systemUptime-start))
        guard readyBudget > 0,price.waitForExistence(timeout:readyBudget),price.isEnabled else {
            throw NSError(domain:"CapacityGuard",code:5,userInfo:[NSLocalizedDescriptionKey:"冷启动后实际账本表单不可用"])
        }
        let elapsed = (ProcessInfo.processInfo.systemUptime-start)*1000
        context["sampleIndex"] = sampleIndex
        context["samples"] = [elapsed]
        context["spans"] = [["start":epoch,"end":epoch+elapsed]]
        context["clockDefinition"] = "automation-upper-bound"
        print("IOS_CAPACITY_COLD_SAMPLE "+String(decoding:try JSONSerialization.data(withJSONObject:context,options:[.sortedKeys]),as:UTF8.self))
    }
    func testColdLaunch01() throws { try coldLaunch(0) }
    func testColdLaunch02() throws { try coldLaunch(1) }
    func testColdLaunch03() throws { try coldLaunch(2) }
    func testColdLaunch04() throws { try coldLaunch(3) }
    func testColdLaunch05() throws { try coldLaunch(4) }
}
