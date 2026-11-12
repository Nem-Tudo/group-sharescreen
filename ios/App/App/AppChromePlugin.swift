import UIKit
import Capacitor

/// The iOS twin of android/…/AppChromePlugin.java — same JS name ("AppChrome"),
/// same three methods, same arguments, so lib/nativeApp.ts talks to both
/// shells with one code path.
///
/// - setColors: paints the strips above and below the web view (see
///   GoLiveViewController) and flips the status bar text to stay readable.
/// - haptic: the Taptic Engine, for the same three kinds the site asks for.
/// - share: the system share sheet.
@objc(AppChromePlugin)
public class AppChromePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppChromePlugin"
    public let jsName = "AppChrome"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setColors", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    @objc func setColors(_ call: CAPPluginCall) {
        let hex = call.getString("background") ?? "#ffffff"
        let dark = call.getBool("dark") ?? false
        guard let color = UIColor.capacitor.color(fromHex: hex) else {
            call.reject("Invalid colour: \(hex)")
            return
        }
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? GoLiveViewController)?.applyBarColor(color, dark: dark)
            call.resolve()
        }
    }

    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "tap"
        DispatchQueue.main.async {
            switch kind {
            case "confirm":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "reject":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
            call.resolve()
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        var items: [Any] = []
        let text = [call.getString("title"), call.getString("text")]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        if !text.isEmpty { items.append(text) }
        if let raw = call.getString("url"), let url = URL(string: raw) { items.append(url) }
        if items.isEmpty {
            call.resolve(["shared": false])
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.resolve(["shared": false])
                return
            }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            // iPad shows the sheet as a popover, which needs an anchor or it crashes.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 80, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["shared": completed])
            }
            presenter.present(sheet, animated: true)
        }
    }
}
