import UIKit
import ReplayKit
import Capacitor

/// "Compartilhar tela" in the iPhone app — the native half of
/// lib/iosScreenBroadcast.ts.
///
/// The share itself runs in the Broadcast extension (ios/App/Broadcast), a
/// separate process iOS starts once the person confirms the system's
/// broadcast sheet. This plugin only does the three things the page cannot:
/// leaves the extension its instructions in the App Group, opens that sheet,
/// and relays the extension's state back to the page as "stateChange" events.
@objc(ScreenBroadcastPlugin)
public class ScreenBroadcastPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenBroadcastPlugin"
    public let jsName = "ScreenBroadcast"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    ]

    private var lastSent: (String, String?)?
    /// While a broadcast runs: catches the one ending the extension cannot
    /// announce — iOS killing it outright — by watching its heartbeat go stale.
    private var staleTimer: Timer?

    override public func load() {
        let observer = Unmanaged.passUnretained(self).toOpaque()
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            observer,
            { _, observer, _, _, _ in
                guard let observer else { return }
                let plugin = Unmanaged<ScreenBroadcastPlugin>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async { plugin.relayState() }
            },
            BroadcastShared.stateChanged as CFString,
            nil,
            .deliverImmediately
        )
    }

    deinit {
        CFNotificationCenterRemoveEveryObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque()
        )
    }

    private func relayState() {
        let (state, message) = BroadcastShared.readState()
        if state == "connecting" || state == "live" {
            if staleTimer == nil {
                staleTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                    self?.relayState()
                }
            }
        } else {
            staleTimer?.invalidate()
            staleTimer = nil
        }
        if let last = lastSent, last.0 == state, last.1 == message { return }
        lastSent = (state, message)
        var payload: [String: Any] = ["state": state]
        if let message { payload["message"] = message }
        notifyListeners("stateChange", data: payload)
    }

    @objc func getState(_ call: CAPPluginCall) {
        let (state, message) = BroadcastShared.readState()
        var payload: [String: Any] = ["state": state]
        if let message { payload["message"] = message }
        call.resolve(payload)
        DispatchQueue.main.async { self.relayState() }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let config = call.getString("config"), let defaults = BroadcastShared.defaults else {
            call.reject("unavailable")
            return
        }
        defaults.set(config, forKey: BroadcastShared.configKey)
        // A previous share's error must not be what the page reads next.
        if BroadcastShared.readState().state == "error" { BroadcastShared.writeState("idle") }

        DispatchQueue.main.async { [weak self] in
            guard let host = self?.bridge?.viewController?.view else {
                call.reject("no-view")
                return
            }
            // The only way into the system's broadcast sheet is this view's own
            // button: there is no API to present it. So the picker is added
            // invisibly and its button pressed for the person, who just pressed
            // ours. preferredExtension makes the sheet list only GoLive.
            let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
            picker.preferredExtension = BroadcastShared.extensionBundleId
            picker.showsMicrophoneButton = false
            picker.alpha = 0.011
            picker.isUserInteractionEnabled = false
            host.addSubview(picker)
            guard let button = Self.firstButton(in: picker) else {
                picker.removeFromSuperview()
                call.reject("no-picker")
                return
            }
            button.sendActions(for: .touchUpInside)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { picker.removeFromSuperview() }
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        BroadcastShared.post(BroadcastShared.stopRequested)
        call.resolve()
    }

    private static func firstButton(in view: UIView) -> UIButton? {
        for subview in view.subviews {
            if let button = subview as? UIButton { return button }
            if let nested = firstButton(in: subview) { return nested }
        }
        return nil
    }
}
