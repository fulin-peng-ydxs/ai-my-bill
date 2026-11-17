import XCTest
import Vision

/// 外部 XCUITest runner 对 Release App 执行原生触摸/键盘；不注入 JS、不替换 API。
@MainActor
final class DictionaryTouchTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.mybill.offline")
    private var sandboxAccepted = false

    override func setUpWithError() throws {
        continueAfterFailure = false
        try OwnedSimulatorTestContext.requireOwnedSimulator()
        sandboxAccepted = true
        executionTimeAllowance = 60
        if app.state != .runningForeground {
            app.launch()
            activateWebContent()
            appears("记一笔", timeout: 20)
        }
    }

    override func tearDownWithError() throws {
        guard sandboxAccepted else { return }
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
    private func visualText(_ label: String, containing: Bool = false) -> CGRect? {
        guard let image = XCUIScreen.main.screenshot().image.cgImage else { return nil }
        let request = VNRecognizeTextRequest()
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        do { try VNImageRequestHandler(cgImage: image).perform([request]) }
        catch { return nil }
        return request.results?.first {
            guard let text = $0.topCandidates(1).first?.string else { return false }
            return containing ? text.contains(label) : text == label
        }?.boundingBox
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

    private func tapVisibleText(_ label: String) {
        var box: CGRect?
        // HTML select 的提示值未必是 AX label；从当前画面定位，再执行原生触摸。
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            box = self.visualText(label)
            return box != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed, "画面未显示 \(label)")
        if let box { app.coordinate(withNormalizedOffset: CGVector(dx: box.midX, dy: 1 - box.midY)).tap() }
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

    private func expectValue(_ field: XCUIElement, _ value: String) {
        // WKWebView 的 AX 值可短暂落后于已完成的原生输入；等精确值，不重放输入或改写页面。
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 3), .completed, "输入值未就绪：\(value)")
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

    /// 独立搜索场景先建立原生键盘会话；取消原编辑弹窗，不新增或修改业务数据。
    /// 完整套件已有新增输入步骤，不选中此局部准备方法。
    func test00DebugKeyboardReady() {
        openKind("单位")
        tap("新增")
        let field = nameField()
        field.tap()
        field.typeText("Debug Ready")
        expectValue(field, "Debug Ready")
        tap("取消")
        disappears(field)
        print("DEBUG_NATIVE_KEYBOARD_READY")
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
        expectValue(field, "Touch Renamed")
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

    private func previewMerge(source: String = "触摸合并源", target: String = "触摸合并目标", entries: String = "1 条", templates: String = "1 项") {
        tap("管理" + source)
        tap("合并到其他商品")
        tapVisibleText("请选择")
        let wheel = app.pickerWheels.firstMatch
        if wheel.waitForExistence(timeout: 2) {
            wheel.adjust(toPickerWheelValue: target)
            if app.buttons["Done"].isHittable {
                app.buttons["Done"].tap()
            } else {
                tap("完成")
            }
        } else {
            tap(target)
        }
        tap("预览合并影响")
        appears(entries)
        appears(templates)
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

    private func searchAndGoToLastPage(kind: String, prefix: String) {
        openKind(kind)
        let field = app.searchFields.matching(NSPredicate(format: "label == %@", "搜索" + kind)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(prefix)
        if app.keyboards.firstMatch.exists {
            let buttons = app.buttons.matching(NSPredicate(format: "label IN %@", ["Done", "完成"]))
            var done: XCUIElement?
            // WebKit 可保留上一编辑器的同名 AX 节点；必须命中当前可触摸的键盘控件。
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                done = buttons.allElementsBoundByIndex.last(where: { $0.isHittable })
                return done != nil
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 3), .completed, "原生搜索键盘缺少可触摸的完成按钮")
            done?.tap()
            disappears(app.keyboards.firstMatch)
        }
        if kind == "单位" {
            // WebKit 将 HTML radio 暴露为 Switch；不能点到列表里同名的状态文案。
            let activeFilter = app.switches.matching(NSPredicate(format: "label == '启用'")).firstMatch
            XCTAssertTrue(activeFilter.waitForExistence(timeout: 10))
            activeFilter.tap()
        }
        appears("管理" + prefix + "00")
        for _ in 0..<8 {
            if matching("下一页").allElementsBoundByIndex.contains(where: { $0.isHittable }) { break }
            app.swipeUp()
        }
        tap("下一页")
        appears("管理" + prefix + "20")
    }

    func test11ProductLastPage() {
        searchAndGoToLastPage(kind: "商品", prefix: "PageProduct")
    }

    func test12MergeLastPageProduct() {
        previewMerge(source: "PageProduct20", target: "PageProduct00", entries: "0 条", templates: "0 项")
        tap("确认合并")
        appears("管理PageProduct00")
        XCTAssertFalse(matching("管理PageProduct20").firstMatch.exists)
        XCTAssertFalse(matching("没有匹配项").firstMatch.exists)
        XCTAssertEqual(app.searchFields.firstMatch.value as? String, "PageProduct")
        print("DICTIONARY_TOUCH_LAST_PAGE_MERGE_RECOVERED")
    }

    func test13UnitLastPage() {
        searchAndGoToLastPage(kind: "单位", prefix: "PageUnit")
    }

    func test14DisableLastPageUnit() {
        tap("管理PageUnit20")
        tap("停用")
        appears("停用PageUnit20？")
        tap("停用")
        disappears(matching("停用PageUnit20？").firstMatch)
        appears("管理PageUnit00")
        XCTAssertFalse(matching("管理PageUnit20").firstMatch.exists)
        XCTAssertFalse(matching("没有匹配项").firstMatch.exists)
        XCTAssertEqual(app.searchFields.firstMatch.value as? String, "PageUnit")
        print("DICTIONARY_TOUCH_LAST_PAGE_DISABLE_RECOVERED")
    }

    private func entryField(_ id: String, _ label: String) -> XCUIElement {
        let field = app.textFields.matching(NSPredicate(format: "identifier == %@ OR label == %@", id, label)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), app.debugDescription)
        return field
    }

    private func replaceEntryField(_ id: String, _ label: String, _ value: String) {
        let field = entryField(id, label)
        field.tap()
        if let old = field.value as? String, !old.isEmpty, old != field.placeholderValue {
            field.press(forDuration: 1.2)
            let selectAll = app.descendants(matching: .any).matching(NSPredicate(format: "label IN %@", ["全选", "Select All"])).firstMatch
            XCTAssertTrue(selectAll.waitForExistence(timeout: 3))
            selectAll.tap()
        }
        field.typeText(value)
        expectValue(field, value)
    }

    private func dismissEntryKeyboard() {
        let done = app.buttons.matching(NSPredicate(format: "label IN %@", ["完成", "Done"])).firstMatch
        if done.exists && done.isHittable {
            done.tap()
        } else {
            // 键盘期间保存区按原契约回到正文流；原生滚动到动作区，不改页面布局。
            app.webViews.firstMatch.swipeUp()
        }
    }

    private func tapLedgerRow(_ title: String, kind: String) {
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", kind + " " + title)).firstMatch
        var box: CGRect?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            if row.exists && row.isHittable { return true }
            // 原明细行会把类型、名称及金额识别为同一文本块；只在该行内定位唯一合成名称。
            box = self.visualText(title, containing: true)
            return box != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed, "找不到账目行 \(title)")
        if row.exists && row.isHittable { row.tap() }
        else if let box {
            app.coordinate(withNormalizedOffset: CGVector(dx: box.midX, dy: 1 - box.midY)).tap()
        }
    }

    func test15ExpenseWriteReopen() {
        tap("记一笔")
        tap("选择或新增商品")
        tap("测试苹果")
        replaceEntryField("expense-quantity", "数量", "1.25")
        replaceEntryField("expense-paid-amount", "实付金额", "15.00")
        dismissEntryKeyboard()
        tap("保存支出")
        appears("支出已保存，可撤销本次保存。")
        app.terminate()
        app.launch()
        activateWebContent()
        tap("明细")
        tapLedgerRow("测试苹果", kind: "支出")
        appears("编辑支出")
        expectValue(entryField("expense-paid-amount", "实付金额"), "15")
        expectValue(entryField("expense-unit-price", "单价"), "12.3456")
        print("ENTRY_TOUCH_EXPENSE_REOPEN_VERIFIED")
    }

    func test16IncomeContinueEdit() {
        tap("记一笔")
        replaceEntryField("expense-unit-price", "单价", "77")
        tap("收入")
        tap("选择或填写收入名称")
        tap("测试工资")
        tap("分类")
        tap("收入分类")
        tap("工资")
        tap("付款方")
        tap("合成公司")
        tap("收款方式")
        tap("测试现金")
        replaceEntryField("income-amount", "收入金额", "1000.00")
        dismissEntryKeyboard()
        tap("保存并继续")
        appears("收入已保存，可撤销本次保存。")
        let amount = entryField("income-amount", "收入金额")
        XCTAssertTrue((amount.value as? String) == "" || (amount.value as? String) == amount.placeholderValue)
        appears("测试现金")
        tap("支出")
        expectValue(entryField("expense-unit-price", "单价"), "77")
        tap("收入")
        tap("明细")
        tapLedgerRow("测试工资", kind: "收入")
        appears("编辑收入")
        tap("补充信息")
        let note = app.textViews.firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 3))
        note.tap()
        note.typeText("T6 edited")
        dismissEntryKeyboard()
        tap("保存修改")
        appears("收入修改已保存。")
        print("ENTRY_TOUCH_INCOME_CONTINUE_EDIT_VERIFIED")
    }

}
