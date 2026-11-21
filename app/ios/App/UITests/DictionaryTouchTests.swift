import XCTest
import Vision
import UIKit

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
            if !name.contains("test00PrepareReportApp") && !name.contains("test00PrepareDimensionReport") {
                activateWebContent()
                appears("记一笔", timeout: 20)
            }
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
            guard let text = $0.topCandidates(1).first?.string else {
                return false
            }
            return containing ? text.contains(label) : text == label
        }?.boundingBox
    }

    private func tap(_ label: String) {
        var target: XCUIElement?
        var visualTarget: CGRect?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let candidates = self.matching(label).allElementsBoundByIndex
            // 冷启动 WebKit 可能先返回没有有效 frame 的同名 Any 节点。
            // 先找实际控件，避免对这些占位节点读取 isHittable 时由 XCTest 直接判失败。
            let controls = candidates.filter { $0.elementType == .button || $0.elementType == .link }
            let elements = (controls.isEmpty ? candidates : controls).filter {
                let frame = $0.frame
                return !frame.isNull && !frame.isInfinite && frame.width > 0 && frame.height > 0 && $0.isHittable
            }
            // 优先按钮/链接，避免点到同名标题或整个区域；同名确认按钮选最下层。
            target = elements.last
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

    private func appears(_ label: String, timeout: TimeInterval = 10, containing: Bool = false) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.matching(label).firstMatch.exists || self.visualText(label, containing: containing) != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: timeout), .completed, "没有显示 \(label)\n\(app.debugDescription)")
    }

    private func disappears(_ element: XCUIElement) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed)
    }

    private func expectValue(_ field: XCUIElement, _ value: String) {
        // WKWebView 的 AX 值可短暂落后于已完成的原生输入；等精确值，不重放输入或改写页面。
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: field)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 3), .completed,
                       "输入值未就绪：期望 \(value)，实际 \(String(describing: field.value))，类型 \(field.value.map { String(reflecting: type(of: $0)) } ?? "nil")")
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

    /// 直接通过现有常驻搜索建立键盘会话并清空；不绕行字典编辑，不写业务数据。
    /// 完整套件已有新增输入步骤，不选中此局部准备方法。
    func test00DebugKeyboardReady() {
        tap("收支明细")
        let field = app.searchFields.firstMatch
        field.tap()
        field.typeText("Debug Ready")
        expectValue(field, "Debug Ready")
        // 只准备键盘，不验收条件显示的清空按钮；真实退格后核对空输入，再收键盘返回导航。
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Debug Ready".count))
        let empty = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let value = field.value as? String ?? ""
            return value.isEmpty || value == field.placeholderValue
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [empty], timeout: 3), .completed)
        dismissSearchKeyboard()
        tap("记一笔")
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

    /// 定位指定字典项前走原搜索控件，不假设该项在未筛选列表的可见区域。
    private func searchDictionary(kind: String, text: String) {
        openKind(kind)
        let field = app.searchFields.matching(NSPredicate(format: "label == %@", "搜索" + kind)).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        if let value = field.value as? String, !value.isEmpty, value != field.placeholderValue {
            tap("清空搜索")
        }
        field.tap()
        field.typeText(text)
        expectValue(field, text)
        dismissSearchKeyboard()
    }

    /// 搜索清空后输入仍保持焦点；离开前显式收起软键盘，不能依赖底部导航仍可触摸。
    private func dismissSearchKeyboard() {
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
    }

    private func searchAndGoToLastPage(kind: String, prefix: String) {
        searchDictionary(kind: kind, text: prefix)
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
        guard let old = field.value as? String else {
            XCTFail("无法读取\(label)的原值")
            return
        }
        // 右端内侧的原生点按将光标放到末尾；空框的占位值也可安全退格，不依赖编辑菜单。
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: max(1, old.count)))
        field.typeText(value)
        // 结束原生编辑后再核对 AX 值，避免编辑中的 WebKit 快照仍显示旧值；不重复输入。
        dismissEntryKeyboard()
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
        let button = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        let text = app.staticTexts.matching(NSPredicate(format: "label == %@", title)).firstMatch
        var box: CGRect?
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            if button.exists && button.isHittable || text.exists && text.isHittable || row.exists && row.isHittable {
                return true
            }
            // 原明细行会把类型、名称及金额识别为同一文本块；只在该行内定位唯一合成名称。
            box = self.visualText(title, containing: true)
            return box != nil
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed, "找不到账目行 \(title)")
        if row.exists && row.isHittable {
            row.tap()
        } else if button.exists && button.isHittable {
            button.tap()
        } else if text.exists && text.isHittable {
            text.tap()
        } else if let box {
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
        // 完整入口与 entry-cycle 连续执行下一条；明确关闭原编辑抽屉，交回底部导航。
        tap("关闭")
        disappears(matching("编辑支出").firstMatch)
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

    func test17ExpenseTemplateUpsert() {
        tap("明细")
        tapLedgerRow("日常苹果", kind: "支出")
        appears("编辑支出")
        for _ in 0..<2 {
            tap("更多操作")
            tap("保存为日常支出")
            disappears(app.buttons.matching(NSPredicate(format: "label == %@", "保存为日常支出")).firstMatch)
        }
        tap("关闭")
        disappears(matching("编辑支出").firstMatch)
        print("PERSONAL_TOUCH_EXPENSE_TEMPLATE_UPSERT")
    }

    func test18ExpenseTemplateFill() {
        tap("记一笔")
        tap("支出")
        tap("日常支出")
        tap("日常苹果")
        expectValue(entryField("expense-paid-amount", "实付金额"), "15")
        expectValue(entryField("expense-unit-price", "单价"), "12.3456")
        tap("补充信息")
        let note = app.textViews.firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 3))
        XCTAssertTrue((note.value as? String) == "" || (note.value as? String) == note.placeholderValue)
        print("PERSONAL_TOUCH_EXPENSE_TEMPLATE_FILL")
    }

    func test19DisableTemplateUnit() {
        searchDictionary(kind: "单位", text: "日常份")
        tap("管理日常份")
        tap("停用")
        appears("停用日常份？")
        tap("停用")
        disappears(matching("停用日常份？").firstMatch)
        print("PERSONAL_TOUCH_TEMPLATE_UNIT_DISABLED")
    }

    func test20TemplateFallbackRemove() {
        tap("记一笔")
        tap("支出")
        tap("日常支出")
        tap("日常苹果")
        appears("模板中的部分选项已不可用")
        expectValue(entryField("expense-paid-amount", "实付金额"), "15")
        tap("日常支出")
        tap("移除日常模板：日常苹果")
        disappears(app.buttons.matching(NSPredicate(format: "label == %@", "移除日常模板：日常苹果")).firstMatch)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "移除日常模板：")).firstMatch.exists)
        tap("关闭")
        print("PERSONAL_TOUCH_TEMPLATE_FALLBACK_REMOVE")
    }

    func test21IncomeTemplateCycle() {
        tap("明细")
        tapLedgerRow("日常工资", kind: "收入")
        appears("编辑收入")
        tap("更多操作")
        tap("保存为日常收入")
        disappears(app.buttons.matching(NSPredicate(format: "label == %@", "保存为日常收入")).firstMatch)
        tap("关闭")
        tap("记一笔")
        tap("收入")
        tap("日常收入")
        tap("日常工资")
        expectValue(entryField("income-amount", "收入金额"), "1000")
        tap("日常收入")
        tap("移除日常模板：日常工资")
        appears("还没有日常模板")
        tap("关闭")
        print("PERSONAL_TOUCH_INCOME_TEMPLATE_CYCLE")
    }

    func test22PrepareDualDrafts() {
        tap("记一笔")
        tap("支出")
        // 空输入/零值与小数旧值都必须完整替换，最终草稿仍分别为 77 和 222。
        replaceEntryField("expense-paid-amount", "实付金额", "0")
        replaceEntryField("expense-paid-amount", "实付金额", "77")
        tap("收入")
        replaceEntryField("income-amount", "收入金额", "1234.56")
        replaceEntryField("income-amount", "收入金额", "222")
        dismissEntryKeyboard()
        // 真实 Home/终止 App；不派发 JS 或直接写库来代替后台落盘。
        XCUIDevice.shared.press(.home)
        app.terminate()
        print("PERSONAL_TOUCH_DUAL_DRAFTS_BACKGROUND_TERMINATED")
    }

    func test23SaveThemePreference() {
        tap("我的")
        tap("外观")
        tap("夜晚")
        tap("关闭")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "外观", "夜晚")).firstMatch.waitForExistence(timeout: 5))
        tap("明细默认范围")
        tapVisibleText("今天")
        tap("本周")
        tap("关闭")
        print("PERSONAL_TOUCH_THEME_SAVED")
    }

    func test24RelaunchPersonalState() {
        app.terminate()
        app.launch()
        activateWebContent()
        appears("记一笔")
        expectValue(entryField("income-amount", "收入金额"), "222")
        tap("支出")
        expectValue(entryField("expense-paid-amount", "实付金额"), "77")
        tap("收入")
        tap("我的")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "外观", "夜晚")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "明细默认范围", "本周")).firstMatch.waitForExistence(timeout: 5))
        tap("记一笔")
        expectValue(entryField("income-amount", "收入金额"), "222")
        print("PERSONAL_TOUCH_DRAFTS_THEME_RELAUNCH_VERIFIED")
    }

    func test25ResetPreferencesKeepsDrafts() {
        tap("我的")
        tap("恢复默认偏好")
        tap("确认恢复")
        disappears(app.buttons.matching(NSPredicate(format: "label == %@", "确认恢复")).firstMatch)
        tap("记一笔")
        expectValue(entryField("expense-paid-amount", "实付金额"), "77")
        print("PERSONAL_TOUCH_RESET_KEEPS_DRAFTS")
    }

    func test26AdjustmentCreate() {
        tap("明细")
        tap("有效账单")
        tapLedgerRow("生命周期苹果", kind: "支出")
        tap("更多操作")
        tap("记录退款/报销")
        replaceEntryField("adjustment-amount", "调整金额", "3")
        dismissEntryKeyboard()
        tap("保存调整")
        disappears(app.textFields.matching(NSPredicate(format: "identifier == %@ OR label == %@", "adjustment-amount", "调整金额")).firstMatch)
        tap("关闭")
        tap("关闭")
        appears("已调整", timeout: 5, containing: true)
        print("LIFECYCLE_TOUCH_REFUND_SAVED")
    }

    func test27AdjustmentLimits() {
        tap("明细")
        tapLedgerRow("生命周期苹果", kind: "支出")
        tap("更多操作")
        tap("记录退款/报销")
        replaceEntryField("adjustment-amount", "调整金额", "13")
        dismissEntryKeyboard()
        tap("保存调整")
        appears("当前最多还可调整")
        tap("关闭")
        tap("放弃并离开")
        // 关闭原上下文层，返回原编辑层；原实付保护继续生效。
        tap("关闭")
        replaceEntryField("expense-paid-amount", "实付金额", "2")
        dismissEntryKeyboard()
        tap("保存修改")
        appears("实付金额不能低于已生效退款/报销合计")
        tap("关闭")
        tap("放弃并离开")
        print("LIFECYCLE_TOUCH_LIMITS_PRESERVED")
    }

    func test28SourceTrashRestore() {
        tap("明细")
        tap("有效账单")
        tapLedgerRow("生命周期苹果", kind: "支出")
        tap("更多操作")
        tap("移入回收站")
        disappears(matching("编辑支出").firstMatch)
        tap("回收站")
        tapLedgerRow("生命周期苹果", kind: "支出")
        tap("更多操作")
        tap("恢复到账目")
        tap("有效账单")
        tapLedgerRow("生命周期苹果", kind: "支出")
        expectValue(entryField("expense-paid-amount", "实付金额"), "15")
        tap("更多操作")
        tap("移入回收站")
        tap("回收站")
        print("LIFECYCLE_TOUCH_SOURCE_FREEZE_RESTORE")
    }

    func test29LinkedPurgeCancelConfirm() {
        tap("明细")
        tap("回收站")
        tapLedgerRow("生命周期苹果", kind: "支出")
        tap("更多操作")
        tap("永久删除并联动清理 1 条调整")
        appears("确认永久删除？")
        tap("取消")
        tap("永久删除并联动清理 1 条调整")
        appears("确认永久删除？")
        tap("永久删除")
        disappears(matching("确认永久删除？").firstMatch)
        disappears(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "支出 生命周期苹果")).firstMatch)
        print("LIFECYCLE_TOUCH_LINKED_PURGE_CONFIRMED")
    }

    func test30AutomaticCleanup() {
        tap("明细")
        tap("回收站")
        tapLedgerRow("生命周期保留收入", kind: "收入")
        appears("恢复期限")
        tap("关闭")
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "生命周期到期收入")).firstMatch.exists)
        print("LIFECYCLE_TOUCH_AUTOMATIC_CLEANUP")
    }

    private func scrollLedgerEnd() {
        for _ in 0..<7 {
            let more = app.buttons.matching(NSPredicate(format: "label == %@", "加载更多")).firstMatch
            let end = matching("已显示全部结果").firstMatch
            if more.exists && more.isHittable || end.exists && end.isHittable { return }
            app.webViews.firstMatch.swipeUp()
        }
    }

    func test31LedgerPagingSearch() {
        tap("收支明细")
        scrollLedgerEnd()
        appears("已加载 20 笔")
        tap("加载更多")
        scrollLedgerEnd()
        appears("已加载 23 笔")
        tapLedgerRow("查询工资00", kind: "收入")
        appears("编辑收入")
        tap("关闭")
        let search = app.searchFields.firstMatch
        search.tap()
        search.typeText("查询工资20")
        dismissEntryKeyboard()
        appears("已加载 1 笔")
        appears("超长名称用于检查", containing: true)
        tap("清空搜索")
        print("LEDGER_QUERY_TOUCH_PAGING_SEARCH_VERIFIED")
    }

    func test32LedgerFilterReset() {
        tap("收支明细")
        let search = app.searchFields.firstMatch
        search.tap()
        search.typeText("查询工资20")
        dismissEntryKeyboard()
        appears("已加载 1 笔")
        tap("筛选")
        tapVisibleText("今天")
        tap("本月")
        tapVisibleText("全部")
        tap("收入")
        tap("不限")
        tap("明细现金")
        tap("应用筛选")
        appears("已加载 1 笔")
        tap("清空搜索")
        search.tap()
        search.typeText("no-matching-t9")
        dismissEntryKeyboard()
        appears("没有匹配的明细")
        tap("清除筛选")
        scrollLedgerEnd()
        appears("已加载 20 笔")
        print("LEDGER_QUERY_TOUCH_FILTER_RESET_VERIFIED")
    }

    func test33LedgerEditReturn() {
        tap("收支明细")
        scrollLedgerEnd()
        tap("加载更多")
        scrollLedgerEnd()
        tapLedgerRow("查询工资00", kind: "收入")
        appears("编辑收入")
        tap("补充信息")
        let note = app.textViews.firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 3))
        note.tap()
        note.typeText("T9 edited")
        dismissEntryKeyboard()
        tap("保存修改")
        disappears(matching("编辑收入").firstMatch)
        appears("已加载 23 笔")
        tap("我的")
        appears("默认资金渠道")
        tap("收支明细")
        tapLedgerRow("查询工资00", kind: "收入")
        appears("编辑收入")
        tap("补充信息")
        XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 3))
        expectValue(app.textViews.firstMatch, "T9 edited")
        tap("关闭")
        print("LEDGER_QUERY_TOUCH_EDIT_RETURN_VERIFIED")
    }

    func test34LedgerUnicodeInput() {
        tap("收支明细")
        let search = app.searchFields.firstMatch
        search.tap()
        let full = String(repeating: "😀", count: 200)
        search.typeText(full)
        expectValue(search, full)
        search.typeText("新")
        expectValue(search, full)
        tap("清空搜索")
        print("LEDGER_QUERY_TOUCH_UNICODE_INPUT_200_ACCEPTED_201_REJECTED")
    }

    private func pasteIntoSearch(_ field: XCUIElement, text: String) {
        UIPasteboard.general.string = text
        field.tap()
        field.press(forDuration: 1.1)
        // 走系统编辑菜单的真实粘贴，不使用 typeText 或 JS 模拟剪贴板。
        let paste = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", "粘贴", "Paste"))
            .allElementsBoundByIndex.first { $0.isHittable }
        if let paste { paste.tap() } else { tap("粘贴") }
        let allow = app.alerts.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "允许粘贴", "Allow Paste")).firstMatch
        if allow.waitForExistence(timeout: 1) { allow.tap() }
    }

    func test35LedgerUnicodePaste() {
        tap("收支明细")
        let search = app.searchFields.firstMatch
        // 单用例与组合运行都从空查询开始；不依赖 test34 的结果。
        let clear = app.buttons.matching(NSPredicate(format: "label == %@", "清空搜索")).firstMatch
        if clear.exists { clear.tap() }
        let full = String(repeating: "😀", count: 199) + "中"
        pasteIntoSearch(search, text: full + "多")
        XCTAssertTrue((search.value as? String ?? "").isEmpty || search.value as? String == "搜索账目")
        pasteIntoSearch(search, text: full)
        expectValue(search, full)
        search.typeText("多")
        expectValue(search, full)
        tap("清空搜索")
        print("LEDGER_QUERY_TOUCH_UNICODE_PASTE_200_ACCEPTED_201_REJECTED")
    }

    private func reportControl(_ id: String, label: String) -> XCUIElement {
        let field = app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", id, label)).firstMatch
        XCTAssertTrue(field.exists || field.waitForExistence(timeout: 3), "缺少报表选择器 \(label)")
        return field
    }

    private func selectReportControl(_ id: String, label: String, option: String) {
        let field = reportControl(id, label: label)
        // 原生 select 的当前项由 value 表达；已选目标无需再打开同一菜单。
        if field.value as? String == option { return }
        field.tap()
        tap(option)
        expectValue(field, option)
    }

    /// 仅测试资源，和 Python 夹具/真实 SQLite 回归共用；生产 App 不包含该文件。
    private struct ReportTouchFixture: Decodable {
        let startDate: String
        let endDate: String
        let periods: [String: String]
    }

    private func reportFixture() throws -> ReportTouchFixture {
        let url = try XCTUnwrap(Bundle(for: DictionaryTouchTests.self).url(forResource: "reportTouchFixture", withExtension: "json"))
        return try JSONDecoder().decode(ReportTouchFixture.self, from: Data(contentsOf: url))
    }

    private func setReportDate(_ id: String, label: String, date: String) throws {
        // FormField 的标签组和真正日期输入同名；选后面的输入，避免先点击标签再异步转焦点。
        let fields = app.otherElements.matching(NSPredicate(format: "identifier == %@ OR label == %@", id, label))
        XCTAssertTrue(fields.firstMatch.waitForExistence(timeout: 3))
        let field = try XCTUnwrap(fields.allElementsBoundByIndex.last)
        field.tap()
        let parts = date.split(separator: "-").map { Int($0)! }
        let picker = app.datePickers.firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 3))
        // 直接选年/月，不按距今天的月数循环翻页；范围长期固定也不增加用例耗时。
        let heading = picker.buttons.matching(NSPredicate(format: "identifier IN %@", ["DatePicker.Show", "DatePicker.Hide"])).firstMatch
        // 已显示夹具的绝对年/月时只选择日；否则仍显式选年/月，不读取执行日期或循环翻页。
        if heading.value as? String != "\(parts[0])年\(parts[1])月" {
            heading.tap()
            let wheels = picker.pickerWheels.allElementsBoundByIndex
            let year = try XCTUnwrap(wheels.first { ($0.value as? String ?? "").filter(\.isNumber).count == 4 })
            let month = try XCTUnwrap(wheels.first { $0 != year })
            let yearValue = year.value as? String ?? ""
            year.adjust(toPickerWheelValue: "\(parts[0])" + (yearValue.hasSuffix("年") ? "年" : ""))
            let monthValue = month.value as? String ?? ""
            let formatter = DateFormatter()
            let targetMonth = monthValue.first?.isNumber == true
                ? monthValue.replacingOccurrences(of: "[0-9]+", with: "\(parts[1])", options: .regularExpression)
                : (formatter.shortMonthSymbols.contains(monthValue) ? formatter.shortMonthSymbols : formatter.monthSymbols)[parts[1] - 1]
            month.adjust(toPickerWheelValue: targetMonth)
            heading.tap()
        }
        picker.buttons.containing(.staticText, identifier: "\(parts[2])").firstMatch.tap()
        app.buttons.matching(NSPredicate(format: "label IN %@", ["完成", "Done"])).firstMatch.tap()
        XCTAssertFalse(picker.exists, "日期选择未完成")
    }

    private func reportFixtureScope() throws {
        let fixture = try reportFixture()
        let dimension = app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "report-dimension", "维度")).firstMatch
        if !dimension.exists { tap("收支报表") }
        tap("全部")
        let range = app.buttons["修改日期，当前\(fixture.startDate) 至 \(fixture.endDate)"]
        let funding = app.buttons["修改资金渠道，当前报表现金"]
        // 只复用真实页面已应用的同一绝对范围和专用渠道，不沿用默认或任意旧条件。
        if range.exists && funding.exists { return }
        let clear = app.buttons.matching(NSPredicate(format: "label == %@", "清除全部筛选")).firstMatch
        if clear.exists && clear.isHittable { clear.tap() }
        tap("筛选")
        tap("不限")
        tap("报表现金")
        selectReportControl("report-range", label: "日期范围", option: "指定日期")
        try setReportDate("report-start-date", label: "开始日期", date: fixture.startDate)
        try setReportDate("report-end-date", label: "结束日期", date: fixture.endDate)
        tap("应用筛选")
        XCTAssertTrue(range.waitForExistence(timeout: 3), "必须应用夹具的精确绝对日期范围")
    }

    private func expectReportAmount(_ label: String) {
        // MoneyValue 的 AX 标签包含正负号。用精确金额节点验收，不走 Any/OCR 的通用后备。
        let amount = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(amount.waitForExistence(timeout: 3), "报表金额必须为 \(label)")
    }

    func test36ReportOverview() throws {
        try reportFixtureScope()
        selectReportControl("report-dimension", label: "维度", option: "收支概览")
        for amount in ["+¥1,000", "-¥15", "+¥3", "-¥12", "+¥988"] {
            expectReportAmount(amount)
        }
        print("REPORT_TOUCH_OVERVIEW_EXACT_TOTALS")
    }

    func test00PrepareReportApp() {
        // 先等真实导航链接，避免页面尚未呈现时触摸及无谓加载 OCR；冷 AX 才用既有截图后备。
        // 只有真实维度控件出现且可用才算启动就绪，不依赖可能被既有提示挡住的页首标题。
        let report = app.links.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", "收支报表", "收支报表 ")).firstMatch
        if report.waitForExistence(timeout: 10) { report.tap() }
        else { tapVisibleText("报表") }
        let dimension = app.buttons.matching(NSPredicate(format: "identifier == %@ OR label == %@", "report-dimension", "维度")).firstMatch
        XCTAssertTrue(dimension.waitForExistence(timeout: 3), "报表页面尚未就绪")
        XCTAssertTrue(dimension.isEnabled)
        print("REPORT_TOUCH_APP_READY")
    }

    // XCTest 按名称排序：总览之后、test37 粒度之前准备；参数排列不能保证执行顺序。
    // 准备与粒度断言分别受原有 60 秒预算约束，仍走真实筛选/选择器。
    func test36ReportTimePreparation() throws {
        try reportFixtureScope()
        selectReportControl("report-dimension", label: "维度", option: "时间趋势")
        selectReportControl("report-metric", label: "查看指标", option: "结余")
        appears("结余趋势")
        print("REPORT_TOUCH_TIME_PREPARED")
    }

    private func verifyReportGrains(_ grains: [String]) throws {
        appears("结余趋势")
        expectValue(reportControl("report-dimension", label: "维度"), "时间趋势")
        expectValue(reportControl("report-metric", label: "查看指标"), "结余")
        let fixture = try reportFixture()
        for grain in grains {
            selectReportControl("report-grain", label: "时间粒度", option: grain)
            let expected = try XCTUnwrap(fixture.periods[grain], "未知粒度 \(grain)")
            let period = reportControl("time-point", label: "查看时段")
            let drill = app.buttons.matching(NSPredicate(format: "label == %@", "查看\(expected)的结余明细")).firstMatch
            // 刷新/失败保留旧快照及相同金额：必须等对应时段发布且 fieldset 内控件重新可用。
            let amounts = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "¥988"))
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                period.value as? String == expected && period.isEnabled
                    && drill.exists && drill.isEnabled && amounts.count == 3
            }, object: nil)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 3), .completed, "粒度 \(grain) 必须发布 \(expected) 并恢复下钻，范围/当期/累计均为 988.00")
            appears("累计至该时段")
            print("REPORT_TOUCH_GRAIN_VERIFIED \(grain) period=\(expected) ready=true range=988.00 current=988.00 cumulative=988.00")
        }
    }

    func test37ReportTimeGrains() throws {
        try verifyReportGrains(["按日", "按周", "按月"])
        print("REPORT_TOUCH_DAY_WEEK_MONTH_AND_CUMULATIVE")
    }

    // 与日/周/月分开，各自可在原有 60 秒预算内定位，不放宽全套超时。
    func test37ReportTimeGrainsQuarterYear() throws {
        try verifyReportGrains(["按季", "按年"])
        print("REPORT_TOUCH_QUARTER_YEAR_AND_CUMULATIVE")
    }

    func test38ReportDrillReturn() throws {
        try reportFixtureScope()
        selectReportControl("report-dimension", label: "维度", option: "时间趋势")
        selectReportControl("report-metric", label: "查看指标", option: "净支出")
        let detail = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "的净支出明细")).firstMatch
        XCTAssertTrue(detail.waitForExistence(timeout: 3))
        detail.tap()
        appears("已加载 2 笔")
        tapLedgerRow("报表苹果", kind: "支出")
        replaceEntryField("expense-paid-amount", "实付金额", "16")
        dismissEntryKeyboard()
        tap("保存修改")
        disappears(matching("编辑支出").firstMatch)
        tap("返回报表")
        appears("净支出趋势")
        expectReportAmount("-¥13")
        print("REPORT_TOUCH_NET_DRILL_EDIT_RETURN_REFRESH")
    }

    func test00PrepareDimensionReport() throws {
        test00PrepareReportApp()
        try reportFixtureScope()
        print("REPORT_DIMENSION_SCOPE_READY")
    }

    /// WKWebView 可把被固定底栏遮挡的行报告为 hittable；触摸前还需让行中心进入内容视口。
    private func revealReportRow(_ row: XCUIElement) {
        for _ in 0..<5 {
            let frame = row.frame
            if row.isHittable && frame.midY > app.frame.minY + 100 && frame.midY < app.frame.maxY - 140 { return }
            if frame.midY < app.frame.minY + 100 { app.webViews.firstMatch.swipeDown() }
            else { app.webViews.firstMatch.swipeUp() }
        }
        XCTAssertTrue(row.isHittable && row.frame.midY > app.frame.minY + 100 && row.frame.midY < app.frame.maxY - 140,
                      "排行行必须位于内容视口，避免误点固定底栏")
    }

    /// 仅触摸原排行和返回入口；金额/组成由随后的 SQLite 只读回读校验。
    private func verifyDimension(_ title: String, group: String) {
        selectReportControl("report-dimension", label: "维度", option: title)
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", group, "条")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "\(title) 必须读取本地排行")
        revealReportRow(row)
        XCTAssertTrue(row.isEnabled && row.isHittable, "新快照就绪后才允许下钻")
        row.tap()
        let counts = ["分类结构": 7, "商品排行": 3, "支付方式": 7, "购买渠道": 6, "常用地点": 6,
                      "消费习惯": 7, "价格观察": 1, "消费频次": 4]
        let count = counts[title] ?? 1
        appears("已加载 \(count) 笔", timeout: 5)
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "返回报表")).firstMatch.exists)
        tap("返回报表")
        expectValue(reportControl("report-dimension", label: "维度"), title)
        print("REPORT_DIMENSION_DRILL_RETURN " + title + " count=\(count)")
    }

    func test40ExpenseDimensionGroups() throws {
        try reportFixtureScope()
        tap("支出")
        for (title, group) in [("分类结构", "一级分类"), ("商品排行", "商品与单位")] {
            verifyDimension(title, group: group)
        }
    }

    func test41ExpenseDimensionAnalysis() throws {
        try reportFixtureScope()
        tap("支出")
        for (title, group) in [("消费习惯", "星期分布"), ("价格观察", "商品价格")] {
            verifyDimension(title, group: group)
        }
    }

    func test42IncomeDimensions() throws {
        try reportFixtureScope()
        tap("收入")
        for (title, group) in [("收入分类", "收入分类"), ("收款方式", "收款方式")] {
            verifyDimension(title, group: group)
        }
    }

    func test40ExpensePaymentChannels() throws {
        try reportFixtureScope()
        tap("支出")
        verifyDimension("支付方式", group: "支付方式")
        verifyDimension("购买渠道", group: "购买渠道")
    }

    func test40ExpenseLocations() throws {
        try reportFixtureScope()
        tap("支出")
        verifyDimension("常用地点", group: "常用地点")
    }

    func test41ExpenseFrequencyQuality() throws {
        try reportFixtureScope()
        tap("支出")
        verifyDimension("消费频次", group: "高频商品")
        verifyDimension("数据质量", group: "数据质量")
    }

    func test42IncomePayerName() throws {
        try reportFixtureScope()
        tap("收入")
        verifyDimension("付款方", group: "付款方")
        verifyDimension("收入名称", group: "收入名称")
    }

    func test42IncomeFrequency() throws {
        try reportFixtureScope()
        tap("收入")
        verifyDimension("收入频次", group: "收入频次")
    }

    func test43QualityThresholdDrill() throws {
        try reportFixtureScope()
        tap("支出")
        selectReportControl("report-dimension", label: "维度", option: "数据质量")
        appears("规则 expense-quality-v1")
        let high = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "异常高价线索", "15.01")).firstMatch
        XCTAssertTrue(high.waitForExistence(timeout: 5))
        revealReportRow(high)
        high.tap()
        appears("已加载 1 笔")
        // 明细金额合并在原行的 AX 控件中；通过既有编辑表单核对精确实付，不依赖独立 StaticText。
        tapLedgerRow("报表苹果", kind: "支出")
        appears("编辑支出")
        expectValue(entryField("expense-paid-amount", "实付金额"), "15.01")
        tap("关闭")
        tap("返回报表")
        expectValue(reportControl("report-dimension", label: "维度"), "数据质量")
        print("REPORT_QUALITY_THRESHOLD_DRILL_READONLY")
    }

    func test39ReportComparison() throws {
        try reportFixtureScope()
        selectReportControl("report-dimension", label: "维度", option: "时间趋势")
        tap("范围对比")
        appears("账本可信历史覆盖晚于", containing: true)
        let evidence = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        evidence.name = "report-incomplete-history"
        evidence.lifetime = .keepAlways
        add(evidence)
        tap("知道了")
        print("REPORT_TOUCH_INCOMPLETE_HISTORY_REASON")
    }

}
