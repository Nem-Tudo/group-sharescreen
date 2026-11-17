import UIKit
import AVFoundation
import WebKit
import CallKit
import Capacitor

/// Keeps a room's voice going with the app in the background — the native
/// half of lib/iosBackgroundCall.ts.
///
/// The voice itself stays where it is, in the page (WebRTC in the WKWebView).
/// What changes is how iOS sees the app while it is in a room: as an ongoing
/// call, registered with CallKit. A call is what iOS keeps alive behind other
/// apps, with its microphone and sound; it gets the green pill, the lock
/// screen controls, and the system's mute — which is wired both ways to the
/// room's mic, and its hang-up to leaving the room.
///
/// One more guard on top: WebKit mutes the capture of a page that stops being
/// visible. When the app goes to the background (or CallKit takes the audio
/// session over) with the room's mic on, the capture is set active again.
@objc(BackgroundCallPlugin)
public class BackgroundCallPlugin: CAPPlugin, CAPBridgedPlugin, CXProviderDelegate {
    public let identifier = "BackgroundCallPlugin"
    public let jsName = "BackgroundCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMuted", returnType: CAPPluginReturnPromise),
    ]

    private var provider: CXProvider?
    private let controller = CXCallController()
    private var callId: UUID?
    private var muted = true
    /// Actions this plugin asked for, so their callbacks are not mistaken for
    /// the person using the system's controls.
    private var ownActions: Set<UUID> = []

    override public func load() {
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.keepMicrophoneLive()
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.keepMicrophoneLive()
        }
    }

    /// CallKit may not be used by apps on the App Store in mainland China.
    private static var callKitAllowed: Bool {
        let region: String?
        if #available(iOS 16, *) {
            region = Locale.current.region?.identifier
        } else {
            region = Locale.current.regionCode
        }
        return region != "CN"
    }

    private func makeProvider() -> CXProvider {
        if let provider { return provider }
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        // Not a phone call anybody needs in the Phone app's history.
        configuration.includesCallsInRecents = false
        let provider = CXProvider(configuration: configuration)
        provider.setDelegate(self, queue: .main)
        self.provider = provider
        return provider
    }

    @objc func start(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Go Live"
        muted = call.getBool("muted") ?? true
        DispatchQueue.main.async {
            guard Self.callKitAllowed else {
                call.resolve(["supported": false])
                return
            }
            if self.callId != nil {
                call.resolve(["supported": true])
                return
            }
            let provider = self.makeProvider()
            let id = UUID()
            let start = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: title))
            start.isVideo = false
            self.ownActions.insert(start.uuid)
            self.controller.request(CXTransaction(action: start)) { error in
                DispatchQueue.main.async {
                    if let error {
                        self.ownActions.remove(start.uuid)
                        call.reject("CallKit refused the call: \(error.localizedDescription)")
                        return
                    }
                    self.callId = id
                    let update = CXCallUpdate()
                    update.remoteHandle = CXHandle(type: .generic, value: title)
                    update.localizedCallerName = title
                    update.hasVideo = false
                    update.supportsHolding = false
                    update.supportsGrouping = false
                    update.supportsUngrouping = false
                    update.supportsDTMF = false
                    provider.reportCall(with: id, updated: update)
                    provider.reportOutgoingCall(with: id, startedConnectingAt: nil)
                    provider.reportOutgoingCall(with: id, connectedAt: nil)
                    // Says where the room's mic stands from the first moment.
                    self.requestMuted(self.muted)
                    call.resolve(["supported": true])
                }
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let id = self.callId else {
                call.resolve()
                return
            }
            self.callId = nil
            let end = CXEndCallAction(call: id)
            self.ownActions.insert(end.uuid)
            self.controller.request(CXTransaction(action: end)) { _ in }
            call.resolve()
        }
    }

    @objc func setMuted(_ call: CAPPluginCall) {
        let value = call.getBool("muted") ?? false
        DispatchQueue.main.async {
            let changed = value != self.muted
            self.muted = value
            if changed { self.requestMuted(value) }
            if !value { self.keepMicrophoneLive() }
            call.resolve()
        }
    }

    private func requestMuted(_ value: Bool) {
        guard let id = callId else { return }
        let action = CXSetMutedCallAction(call: id, muted: value)
        ownActions.insert(action.uuid)
        controller.request(CXTransaction(action: action)) { _ in }
    }

    /// WebKit mutes the microphone of a page that is no longer on screen.
    /// During a call with the room's mic on, that is never what is meant.
    private func keepMicrophoneLive() {
        guard callId != nil, !muted, let webView = bridge?.webView else { return }
        if webView.microphoneCaptureState == .muted {
            webView.setMicrophoneCaptureState(.active, completionHandler: nil)
        }
    }

    // MARK: - CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        guard callId != nil else { return }
        callId = nil
        notifyListeners("ended", data: [:])
    }

    public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        ownActions.remove(action.uuid)
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let ours = ownActions.remove(action.uuid) != nil
        action.fulfill()
        // Hung up from the system — the pill, the lock screen, another call
        // taking over: the person has left the call, so they leave the room.
        if !ours {
            callId = nil
            notifyListeners("ended", data: [:])
        }
    }

    public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        let ours = ownActions.remove(action.uuid) != nil
        action.fulfill()
        guard !ours else { return }
        muted = action.isMuted
        notifyListeners("muteChanged", data: ["muted": action.isMuted])
        if !action.isMuted { keepMicrophoneLive() }
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // CallKit has taken the audio session over; the page's capture can
        // read that as an interruption. Put it back if the mic is meant on.
        keepMicrophoneLive()
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}
