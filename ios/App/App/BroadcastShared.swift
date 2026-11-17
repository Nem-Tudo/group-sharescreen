import Foundation

/// What the app and its screen broadcast extension (ios/App/Broadcast) agree
/// on. Compiled into both targets, so the two can never disagree about a key.
///
/// The two are separate processes that share nothing but an App Group: a
/// UserDefaults suite both can read and write. Values go through it; Darwin
/// notifications (which carry no payload) only say "go and read it again".
enum BroadcastShared {
    static let appGroup = "group.me.nemtudo.golive"
    static let extensionBundleId = "me.nemtudo.golive.broadcast"

    /// JSON written by the site (lib/iosScreenBroadcast.ts) right before the
    /// system sheet opens; read once, then removed, by the extension.
    static let configKey = "screenBroadcast.config"
    static let stateKey = "screenBroadcast.state"
    static let messageKey = "screenBroadcast.message"
    /// Refreshed every few seconds while a broadcast runs. An extension iOS
    /// killed outright never gets to say "idle", so a state this old is read
    /// as over.
    static let heartbeatKey = "screenBroadcast.heartbeat"
    static let heartbeatStaleAfter: TimeInterval = 12

    /// While "paused": the server's ad gate message (JSON), for the app to
    /// show the same popup a computer's share gets.
    static let adGateKey = "screenBroadcast.adGate"
    /// The popup's answer (JSON), left by the app for the extension to send.
    static let adGateReplyKey = "screenBroadcast.adGateReply"

    static let stateChanged = "me.nemtudo.golive.broadcast.state"
    static let stopRequested = "me.nemtudo.golive.broadcast.stop"
    static let adGateReplied = "me.nemtudo.golive.broadcast.adGateReply"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    static func post(_ name: String) {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(name as CFString),
            nil,
            nil,
            true
        )
    }

    /// "idle", "connecting", "live" or "error" — the same words the site uses.
    static func writeState(_ state: String, message: String? = nil) {
        guard let defaults else { return }
        defaults.set(state, forKey: stateKey)
        if let message {
            defaults.set(message, forKey: messageKey)
        } else {
            defaults.removeObject(forKey: messageKey)
        }
        defaults.set(Date().timeIntervalSince1970, forKey: heartbeatKey)
        post(stateChanged)
    }

    static func touchHeartbeat() {
        defaults?.set(Date().timeIntervalSince1970, forKey: heartbeatKey)
    }

    static func readState() -> (state: String, message: String?) {
        guard let defaults else { return ("idle", nil) }
        let state = defaults.string(forKey: stateKey) ?? "idle"
        let message = defaults.string(forKey: messageKey)
        if state == "connecting" || state == "live" || state == "paused" {
            let beat = defaults.double(forKey: heartbeatKey)
            if Date().timeIntervalSince1970 - beat > heartbeatStaleAfter { return ("idle", nil) }
        }
        return (state, message)
    }
}
