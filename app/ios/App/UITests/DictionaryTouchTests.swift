import XCTest
import Vision

/// 外部 XCUITest runner 对 Release App 执行原生触摸/键盘；不注入 JS、不替换 API。
@MainActor
final class DictionaryTouchTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.mybill.offline")

    override func setUpWithError() throws {
        continueAfterFailure = false
        executionTimeAllowance = 60
        if app.state != .runningForeground {
            app.launch()
            activateWebContent()
            appears("记一笔", timeout: 20)
        }
    }

    override func tearDownWithError() throws {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    private func activateWebContent() {
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 10))
        // 本套只运行 14 Pro Max；在已核验的原页标题区域触摸一次，激活重启后 WebKit AX 内容。
        // 页面布局不变，坐标落在“记一笔”标题内，不触发表单或导航。
        web.coordinate(withNormalizedOffset: CGVector(dx: 0.10, dy: 0.085)).tap()
        print(app.debugDescription)
    }

    private func matching(_ label: String) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", label, label + " "))
    }

    // iOS 模拟器冷启动时 WebKit 的 AX 树可能尚未包含 HTML；只用截图文字作定位，
    // 实际输入仍由 XCUITest 原生触摸/键盘完成，不注入 JS、不调用业务 API。
    private func visualText(_ label: String) -> CGRect? {
        guard let image = XCUIScreen.main.screenshot().image.cgImage else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        do { try VNImageRequestHandler(cgImage: image).perform([request]) }
        catch { return nil }
        return request.results?.first { $0.topCandidates(1).first?.string == label }?.boundingBox
    }

    private func tap(_ label: String) {
        var target: XCUIElement?
        var visualTarget: CGRect?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let elements = self.matching(label).allElementsBoundByIndex.filter { $0.isHittable }
            // 优先按钮/链接，避免点到同名标题或整个区域；同名确认按钮选最下层。
            let controls = elements.filter { $0.elementType == .button || $0.elementType == .link }
            target = (controls.isEmpty ? elements : controls).last
            if target != nil { return true }
            visualTarget = self.visualText(label)
            return visualTarget != nil && !self.app.frame.isEmpty
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, "不能点按 \(label)")
        // 等待条件本身不产生触摸，防止谓词被重复求值时双击。
        if let target { target.tap() }
        else if let box = visualTarget {
            app.coordinate(withNormalizedOffset: CGVector(dx: box.midX, dy: 1 - box.midY)).tap()
        }
    }

    private func appears(_ label: String, timeout: TimeInterval = 10) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.matching(label).firstMatch.exists || self.visualText(label) != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: timeout), .completed, "没有显示 \(label)")
    }

    private func disappears(_ element: XCUIElement) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed)
    }

    private func openIndex() {
        tap("我的")
        tap("选项管理")
        appears("付款方")
    }

    func test00EightOriginalEntries() {
        openIndex()
        for label in ["商品", "支出分类", "单位", "资金渠道", "购买渠道", "常用地点", "收入分类", "付款方"] {
            appears(label)
        }
        tap("关闭")
    }

    private func openKind(_ label: String) {
        openIndex()
        tap(label)
        appears("新增")
    }

    private func nameField() -> XCUIElement {
        let field = app.textFields.matching(NSPredicate(format: "label == '名称' OR identifier == 'dictionary-name'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), app.debugDescription)
        return field
    }

    private func create(_ value: String) {
        tap("新增")
        let field = nameField()
        field.tap()
        field.typeText(value)
        // 新增页与确认按钮同名；只选择当前顶层可点按控件。
        tap("新增")
        appears("管理" + value)
    }

    func test01CreateProduct() {
        openKind("商品")
        create("Touch Created")
    }

    func test02RenameProduct() {
        openKind("商品")
        tap("管理Touch Created")
        tap("修改名称")
        let field = nameField()
        field.tap()
        // WebKit 聚焦可能将光标放在开头；通过系统编辑菜单全选，不能假定删除键位于末尾。
        field.press(forDuration: 1.2)
        let selectAll = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["全选", "Select All"])).firstMatch
        XCTAssertTrue(selectAll.waitForExistence(timeout: 10), "没有显示系统全选菜单")
        selectAll.tap()
        field.typeText("Touch Renamed")
        XCTAssertEqual(field.value as? String, "Touch Renamed")
        tap("保存名称")
        appears("Touch Renamed")
        tap("关闭")
        appears("管理Touch Renamed")
        XCTAssertFalse(matching("管理Touch Created").firstMatch.exists)
        print("DICTIONARY_TOUCH_CREATED_RENAMED")
    }

    func test03CreateCategory() { openKind("支出分类"); create("Touch Category") }
    func test04CreateUnit() { openKind("单位"); create("Touch Unit") }
    func test05CreateFunding() { openKind("资金渠道"); create("Touch Funding") }

    private func openProducts() {
        tap("记一笔")
        tap("选择或新增商品")
        appears("触摸合并目标")
    }

    func test06DisableCandidates() {
        openKind("商品")
        tap("管理触摸维护商品")
        tap("停用")
        appears("停用触摸维护商品？")
        tap("停用")
        disappears(matching("停用触摸维护商品？").firstMatch)
        openProducts()
        XCTAssertFalse(matching("触摸维护商品").firstMatch.exists, "停用商品仍在新候选")
    }

    func test07RestoreCandidates() {
        openKind("商品")
        tap("管理触摸维护商品")
        tap("恢复")
        openProducts()
        appears("触摸维护商品")
        print("DICTIONARY_TOUCH_DISABLED_RESTORED_CANDIDATES")
    }

    private func previewMerge() {
        tap("管理触摸合并源")
        tap("合并到其他商品")
        tap("请选择")
        let wheel = app.pickerWheels.firstMatch
        if wheel.waitForExistence(timeout: 2) {
            wheel.adjust(toPickerWheelValue: "触摸合并目标")
            if app.buttons["Done"].isHittable {
                app.buttons["Done"].tap()
            } else {
                tap("完成")
            }
        } else {
            tap("触摸合并目标")
        }
        tap("预览合并影响")
        appears("1 条")
        appears("1 项")
        tap("继续合并")
        appears("确认合并商品？")
    }

    func test08MergeCancel() {
        openKind("商品")
        previewMerge()
        tap("取消")
        disappears(matching("确认合并商品？").firstMatch)
        tap("关闭")
        tap("关闭")
        appears("管理触摸合并源")
        print("DICTIONARY_TOUCH_MERGE_CANCELLED")
    }

    func test09MergeConfirm() {
        openKind("商品")
        previewMerge()
        tap("确认合并")
        disappears(matching("管理触摸合并源").firstMatch)
        appears("管理触摸合并目标")
    }

    func test10RelaunchedMergeCandidates() {
        app.terminate()
        app.launch()
        activateWebContent()
        appears("记一笔", timeout: 20)
        // 合并后的管理列表已在 test09 验证；重启后直接验证原记账页的候选重读。
        openProducts()
        XCTAssertFalse(matching("触摸合并源").firstMatch.exists)
        print("DICTIONARY_TOUCH_MERGE_CANCEL_CONFIRMED_RELAUNCHED")
    }
}
