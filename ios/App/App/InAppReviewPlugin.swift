import UIKit
import StoreKit
import Capacitor

/// The iOS twin of android/…/InAppReviewPlugin.java: same JS name, same one
/// method. When to ask is decided by the site (lib/appReview.ts); iOS itself
/// then decides whether the prompt actually appears (at most three times a
/// year), so this resolves either way and never says whether it was shown.
@objc(InAppReviewPlugin)
public class InAppReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InAppReviewPlugin"
    public let jsName = "InAppReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
    ]

    @objc func request(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            if let scene = self?.bridge?.viewController?.view.window?.windowScene {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }
}
