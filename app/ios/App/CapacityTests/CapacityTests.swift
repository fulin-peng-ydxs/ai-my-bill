import XCTest
import UIKit
import WebKit
import CryptoKit

/// 独立验收 App 的 Release hosted driver；不放宽原有正式 App/模拟器测试守卫。
@MainActor final class CapacityTests: XCTestCase {
    private func context() throws -> [String:Any] {
        let raw = ProcessInfo.processInfo.environment["MYBILL_CAPACITY_CONTEXT"] ?? ""
        guard raw.utf8.count <= 4096, let data = raw.data(using: .utf8),
              let context = try JSONSerialization.jsonObject(with: data) as? [String:Any],
              let run = context["runId"] as? String, UUID(uuidString:run) != nil,
              Bundle.main.bundleIdentifier == "com.mybill.offline.capacity",
              let count = context["count"] as? Int, [10000,100000].contains(count) else {
            throw NSError(domain:"CapacityGuard",code:1,userInfo:[NSLocalizedDescriptionKey:"拒绝非隔离容量 App 或无效执行清单"])
        }
        #if targetEnvironment(simulator)
        guard context["mode"] as? String == "simulator",context["deviceId"] as? String == ProcessInfo.processInfo.environment["SIMULATOR_UDID"] else {
            throw NSError(domain:"CapacityGuard",code:3)
        }
        #else
        guard context["mode"] as? String == "device" else { throw NSError(domain:"CapacityGuard",code:3) }
        #endif
        return context
    }
    private func run(_ function:String) async throws -> ([String:Any],[String:Any]) {
        let context = try context()
        let web = try await readyWebView()
        let source = try XCTUnwrap(Bundle(for:Self.self).url(forResource:"sqlite-probe",withExtension:"js"))
        _ = try await web.evaluateJavaScript(String(contentsOf:source,encoding:.utf8)+";void 0;")
        print("CAPACITY_APP_PROCESS \(ProcessInfo.processInfo.processIdentifier)")
        let value = try await web.callAsyncJavaScript("return await MyBillNativeProbe."+function+"(count,mode,datasetId)",
            arguments:["count":try XCTUnwrap(context["count"]),"mode":context["mode"] as? String ?? "","datasetId":context["datasetId"] as? String ?? ""],in:nil,contentWorld:.page)
        return (try XCTUnwrap(value as? [String:Any]),context)
    }
    private func record(_ value:[String:Any],_ context:[String:Any],_ label:String) throws {
        var value = value
        value["runId"] = context["runId"]
        value["sourceHash"] = context["sourceHash"]
        value["artifactHash"] = context["artifactHash"]
        let result = try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys])
        let attachment = XCTAttachment(data:result,uniformTypeIdentifier:"public.json")
        attachment.name = "capacity-"+(context["runId"] as? String ?? ""); attachment.lifetime = .keepAlways; add(attachment)
        print(label+" "+String(decoding:result,as:UTF8.self))
    }
    func testNativeCapacity() async throws {
        let (result,context) = try await run("capacity")
        try record(result,context,"IOS_CAPACITY_OBSERVATION")
    }
    func testPageCapacity() async throws {
        let (result,context) = try await run("capacityPages")
        try record(result,context,"IOS_CAPACITY_PAGES")
    }
    func testPrepareCapacityFixture() async throws {
        var (result,context) = try await run("prepareCapacity")
        let snapshot = try XCTUnwrap(result["snapshot"] as? [String:Any])
        let id = try XCTUnwrap(snapshot["id"] as? String)
        guard UUID(uuidString:id) != nil else { throw NSError(domain:"CapacityGuard",code:4) }
        let fm = FileManager.default, library = try XCTUnwrap(fm.urls(for:.libraryDirectory,in:.userDomainMask).first)
        let source = library.appendingPathComponent("OfflineLedger/Snapshots/"+id+"/ledger.db")
        let input = try FileHandle(forReadingFrom:source)
        defer { try? input.close() }
        var digest = SHA256()
        while let data = try input.read(upToCount:131072), !data.isEmpty { digest.update(data:data) }
        let hash = digest.finalize().map { String(format:"%02x",$0) }.joined()
        XCTAssertEqual(hash,snapshot["sha256"] as? String)
        let folder = library.appendingPathComponent("Capacity/"+(context["runId"] as? String ?? ""))
        try fm.createDirectory(at:folder,withIntermediateDirectories:true)
        var url = folder
        var properties = URLResourceValues(); properties.isExcludedFromBackup = true
        try url.setResourceValues(properties)
        let target = folder.appendingPathComponent("fixture.sqlite")
        try fm.copyItem(at:source,to:target)
        try fm.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:target.path)
        result["fixturePath"] = "Library/Capacity/"+(context["runId"] as? String ?? "")+"/fixture.sqlite"
        result["sha256"] = hash
        try record(result,context,"IOS_CAPACITY_FIXTURE")
    }
    private func find(_ view:UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.find($0) }.first
    }
    private func readyWebView() async throws -> WKWebView {
        for _ in 0..<200 {
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
            if let view = windows.compactMap({ $0.rootViewController?.view }).first,let web = find(view),web.url != nil {
                let ready = try await web.evaluateJavaScript("document.readyState==='complete' && !!document.querySelector('[data-page-key=ledger-entry] h1')")
                if ready as? Bool == true { return web }
            }
            try await Task.sleep(for:.milliseconds(100))
        }
        throw NSError(domain:"CapacityGuard",code:2,userInfo:[NSLocalizedDescriptionKey:"离线入口未在 20 秒内就绪"])
    }
}
