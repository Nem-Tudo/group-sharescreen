import UIKit
import WebKit
import Capacitor

/// The app's one screen: Capacitor's bridge view controller, with two changes.
///
/// 1. The web view sits inside the safe area instead of under the notch and the
///    home indicator. The site is laid out for a browser, where the browser's
///    own bars keep the page out of those spots; inside the app nothing does,
///    and the header would sit under the clock. The strips left above and
///    below are painted the colour of the page's top bar and tab bar (see
///    AppChromePlugin.setColors, called by the site's setSystemBarColors), so
///    the page still reads as running edge to edge.
///
/// 2. The plugins that live in this target, not in an npm package, are
///    registered here (Capacitor only finds packaged plugins on its own).
///
/// 3. The on-screen keyboard shrinks the web view instead of covering it. The
///    site asks for exactly that (interactive-widget=resizes-content in its
///    viewport), which Chrome honours and WebKit ignores: without this, the
///    chat composer that opened the keyboard ends up underneath it. With the
///    web view shortened to the keyboard's edge, the page's dvh layout
///    becomes as tall as what is left, the same as on Android. The form bar
///    WebKit puts over the keyboard ("^ v ✓") is removed too — the site has
///    no forms to step through, and it hid the composer's first line.
class GoLiveViewController: CAPBridgeViewController {

    /// The web view's bottom edge, moved up by the keyboard's height.
    private var webBottom: NSLayoutConstraint?

    /// Dark until the page says otherwise: the launch screen and the site's
    /// theme-color are both #09090b, so the first frame matches either way.
    private(set) var barColor = UIColor(red: 0x09 / 255.0, green: 0x09 / 255.0, blue: 0x0b / 255.0, alpha: 1)

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppChromePlugin())
        bridge?.registerPluginInstance(InAppReviewPlugin())
        bridge?.registerPluginInstance(WebAuthPlugin())
        bridge?.registerPluginInstance(ScreenBroadcastPlugin())
        bridge?.registerPluginInstance(BackgroundCallPlugin())
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }

    override func viewDidLoad() {
        // loadView() made the web view the root view. Put a plain container in
        // its place and pin the web view to that container's safe area.
        if let web = webView, view === web {
            let container = UIView(frame: web.frame)
            container.backgroundColor = barColor
            view = container
            container.addSubview(web)
            web.translatesAutoresizingMaskIntoConstraints = false
            let guide = container.safeAreaLayoutGuide
            let bottom = web.bottomAnchor.constraint(equalTo: guide.bottomAnchor)
            webBottom = bottom
            NSLayoutConstraint.activate([
                web.topAnchor.constraint(equalTo: guide.topAnchor),
                bottom,
                web.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
                web.trailingAnchor.constraint(equalTo: guide.trailingAnchor),
            ])
            // The page handles its own scrolling; without this, WebKit would
            // add the (now zero) safe-area insets a second time on rotation.
            web.scrollView.contentInsetAdjustmentBehavior = .never
            web.isOpaque = false
            web.backgroundColor = barColor
            web.scrollView.backgroundColor = barColor
        }
        super.viewDidLoad()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        center.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        if let web = webView { InputAccessoryRemover.remove(from: web) }
    }

    // A call in the room keeps going behind other apps: the "audio" background
    // mode keeps the app running while WebKit is recording or playing (iOS
    // 17.5+). What WebKit may still do is mark the page's microphone muted as
    // the page stops being visible; a mic that was open when the app left the
    // screen is opened again, a moment later and once more after that.
    private var micOpenWhenLeaving = false

    @objc private func willResignActive() {
        micOpenWhenLeaving = webView?.microphoneCaptureState == .active
    }

    @objc private func didEnterBackground() {
        guard micOpenWhenLeaving else { return }
        for delay in [0.5, 2.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in self?.reopenMicIfMuted() }
        }
    }

    @objc private func willEnterForeground() {
        if micOpenWhenLeaving { reopenMicIfMuted() }
    }

    private func reopenMicIfMuted() {
        guard let web = webView, web.microphoneCaptureState == .muted else { return }
        web.setMicrophoneCaptureState(.active, completionHandler: nil)
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let bottom = webBottom, let info = note.userInfo else { return }
        var overlap: CGFloat = 0
        if note.name != UIResponder.keyboardWillHideNotification,
           let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue {
            let frame = view.convert(end, from: nil)
            // Measured from the safe area's bottom, which the web view is
            // already pinned to: the home-indicator strip is behind the
            // keyboard anyway. A floating iPad keyboard does not reach the
            // bottom edge and covers nothing that needs moving.
            if frame.maxY >= view.bounds.maxY - 1 {
                overlap = max(0, view.bounds.maxY - frame.minY - view.safeAreaInsets.bottom)
            }
        }
        guard bottom.constant != -overlap else { return }
        bottom.constant = -overlap
        let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
        UIView.animate(withDuration: duration, delay: 0, options: UIView.AnimationOptions(rawValue: curve << 16)) {
            self.view.layoutIfNeeded()
        }
    }

    /// Paints the strips around the web view and picks the status bar's text
    /// colour to stay readable on it.
    func applyBarColor(_ color: UIColor, dark: Bool) {
        barColor = color
        view.backgroundColor = color
        webView?.backgroundColor = color
        webView?.scrollView.backgroundColor = color
        setStatusBarStyle(dark ? .lightContent : .darkContent)
    }
}

/// Takes WebKit's form bar ("^ v ✓") off the keyboard. There is no public
/// switch for it: the bar is the inputAccessoryView of WebKit's private
/// content view, so that one view is moved to a subclass, made at runtime,
/// whose inputAccessoryView is nil — the same technique @capacitor/keyboard's
/// setAccessoryBarVisible uses. Done once per web view; harmless if WebKit
/// ever renames the view (nothing matches, nothing changes).
private enum InputAccessoryRemover {
    final class NoAccessory: NSObject {
        @objc var inputAccessoryView: AnyObject? { nil }
    }

    static func remove(from webView: WKWebView) {
        guard let content = webView.scrollView.subviews.first(where: {
            String(describing: type(of: $0)).hasPrefix("WKContent")
        }), let base = object_getClass(content) else { return }
        let name = String(cString: class_getName(base)) + "_GoLiveNoAccessory"
        var subclass: AnyClass? = NSClassFromString(name)
        if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
            let selector = #selector(getter: NoAccessory.inputAccessoryView)
            if let method = class_getInstanceMethod(NoAccessory.self, selector) {
                class_addMethod(made, selector, method_getImplementation(method), method_getTypeEncoding(method))
            }
            objc_registerClassPair(made)
            subclass = made
        }
        if let subclass { object_setClass(content, subclass) }
    }
}
