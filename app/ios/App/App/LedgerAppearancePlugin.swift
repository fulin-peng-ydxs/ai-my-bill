import UIKit
import Capacitor

/// 原生外观只承接系统文字大小和状态栏，不修改系统主题、账本或持久化偏好。
@objc(LedgerAppearancePlugin)
public class LedgerAppearancePlugin:CAPPlugin,CAPBridgedPlugin {
    public let identifier = "LedgerAppearancePlugin"
    public let jsName = "LedgerAppearance"
    public let pluginMethods:[CAPPluginMethod] = [
        CAPPluginMethod(name:"getTextScale",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"setTheme",returnType:CAPPluginReturnPromise)
    ]
    private var observer:NSObjectProtocol?
    public override func load() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = NotificationCenter.default.addObserver(forName:UIContentSizeCategory.didChangeNotification,object:nil,queue:.main) { [weak self] notification in
            let category = notification.userInfo?[UIContentSizeCategory.newValueUserInfoKey] as? UIContentSizeCategory
                ?? UIApplication.shared.preferredContentSizeCategory
            self?.notifyListeners("textScale",data:["scale":Self.scale(category)])
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    static func scale(_ category:UIContentSizeCategory) -> Double {
        Double(UIFontMetrics(forTextStyle:.body).scaledValue(for:17,
            compatibleWith:UITraitCollection(preferredContentSizeCategory:category))/17)
    }
    @objc func getTextScale(_ call:CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["scale":Self.scale(UIApplication.shared.preferredContentSizeCategory)]) }
    }
    @objc func setTheme(_ call:CAPPluginCall) {
        guard let theme = call.getString("theme"),["light","dark"].contains(theme) else { call.reject("外观参数无效。"); return }
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController as? CAPBridgeViewController else { call.reject("外观容器不可用。"); return }
            let style:UIStatusBarStyle = theme == "dark" ? .lightContent : .darkContent
            if controller.statusBarStyle != style {
                if UIAccessibility.isReduceMotionEnabled {
                    controller.statusBarStyle = style; controller.setNeedsStatusBarAppearanceUpdate()
                } else { controller.setStatusBarStyle(style) }
            }
            call.resolve()
        }
    }
}
