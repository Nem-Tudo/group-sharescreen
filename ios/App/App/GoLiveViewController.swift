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
class GoLiveViewController: CAPBridgeViewController {

    /// Dark until the page says otherwise: the launch screen and the site's
    /// theme-color are both #09090b, so the first frame matches either way.
    private(set) var barColor = UIColor(red: 0x09 / 255.0, green: 0x09 / 255.0, blue: 0x0b / 255.0, alpha: 1)

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppChromePlugin())
        bridge?.registerPluginInstance(InAppReviewPlugin())
        bridge?.registerPluginInstance(WebAuthPlugin())
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
            NSLayoutConstraint.activate([
                web.topAnchor.constraint(equalTo: guide.topAnchor),
                web.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
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
