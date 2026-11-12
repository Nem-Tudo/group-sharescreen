import UIKit
import AuthenticationServices
import Capacitor

/// Social login on iOS (see the site's lib/capacitorBridge.ts, startOAuth).
///
/// Google and Discord refuse to sign in inside an embedded web view, so the
/// login runs in a real browser and comes back on golive://oauth#…. On iOS the
/// right tool for that is ASWebAuthenticationSession rather than a plain
/// SFSafariViewController: it shares Safari's cookies (already signed in to
/// Google = one tap), it catches the golive:// redirect itself — no "Open in
/// Go Live?" prompt, no page left open on top of the app — and it is what App
/// Review expects a login to use.
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    private var session: ASWebAuthenticationSession?

    /// start({ url, scheme }) → { url } with the full golive://… callback, or
    /// { url: null } when the person closed the sheet.
    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            call.reject("A http(s) url is required")
            return
        }
        let scheme = call.getString("scheme") ?? "golive"
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.session?.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.resolve(["url": NSNull()])
                } else {
                    call.resolve(["url": NSNull()])
                }
            }
            session.presentationContextProvider = self
            // Keep Safari's cookies: someone already signed in to Google
            // should not have to type a password again.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.resolve(["url": NSNull()])
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.session?.cancel()
            self?.session = nil
            call.resolve()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
