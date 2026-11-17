import Foundation
import ActivityKit
import Capacitor

/// Hands the server what it needs to put "fulano está ao vivo" cards on this
/// phone and take them down again (sharescreen-api/server/friendLive.ts):
///
///   - the push-to-start token (iOS 17.2+), which lets the server *start* a
///     card here with nothing running;
///   - each started card's own push token, the only way to *end* it.
///
/// Both come from ActivityKit as async streams, at any time — including when
/// iOS wakes the app in the background right after a card was started — so
/// this listens from launch (AppDelegate), not from the page. What it needs
/// from the page is only who is signed in, kept in UserDefaults
/// (lib/iosLiveActivities.ts → LiveActivityPlugin.configure).
final class LiveActivityRegistrar {
    static let shared = LiveActivityRegistrar()

    private struct Session: Codable, Equatable {
        var apiBase: String
        var authToken: String
        var deviceId: String
        var lang: String
    }

    private static let sessionKey = "liveActivity.session"
    private static let sentStartTokenKey = "liveActivity.sentStartToken"
    private var started = false

    private var session: Session? {
        get {
            guard let data = UserDefaults.standard.data(forKey: Self.sessionKey) else { return nil }
            return try? JSONDecoder().decode(Session.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: Self.sessionKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.sessionKey)
            }
        }
    }

    /// From AppDelegate, once per launch.
    func start() {
        guard !started else { return }
        started = true
        guard #available(iOS 17.2, *) else { return }
        Task {
            for await data in Activity<FriendLiveAttributes>.pushToStartTokenUpdates {
                let token = Self.hex(data)
                UserDefaults.standard.set(token, forKey: "liveActivity.startToken")
                self.sendStartToken(token)
            }
        }
        Task {
            for activity in Activity<FriendLiveAttributes>.activities { self.watch(activity) }
            for await activity in Activity<FriendLiveAttributes>.activityUpdates { self.watch(activity) }
        }
    }

    /// The page's say on who is signed in. nil signs this device out of the
    /// cards — telling the server first, while there is still a login to do it with.
    func configure(apiBase: String, authToken: String?, deviceId: String?, lang: String) {
        let previous = session
        guard let authToken, let deviceId, !authToken.isEmpty, !deviceId.isEmpty else {
            if let previous { request(previous, method: "DELETE", path: "/live-activities/start-token?deviceId=\(previous.deviceId)", body: nil) }
            session = nil
            UserDefaults.standard.removeObject(forKey: Self.sentStartTokenKey)
            return
        }
        let next = Session(apiBase: apiBase, authToken: authToken, deviceId: deviceId, lang: lang)
        guard next != previous else { return }
        session = next
        // A new login (or language) is told the current token again.
        UserDefaults.standard.removeObject(forKey: Self.sentStartTokenKey)
        if let token = UserDefaults.standard.string(forKey: "liveActivity.startToken") { sendStartToken(token) }
    }

    private func sendStartToken(_ token: String) {
        guard let session else { return }
        let marker = "\(session.authToken.suffix(16))|\(session.lang)|\(token)"
        guard UserDefaults.standard.string(forKey: Self.sentStartTokenKey) != marker else { return }
        request(session, method: "POST", path: "/live-activities/start-token",
                body: ["token": token, "deviceId": session.deviceId, "lang": session.lang]) { ok in
            if ok { UserDefaults.standard.set(marker, forKey: Self.sentStartTokenKey) }
        }
    }

    @available(iOS 16.2, *)
    private func watch(_ activity: Activity<FriendLiveAttributes>) {
        let key = activity.attributes.broadcastKey
        Task {
            for await data in activity.pushTokenUpdates {
                guard let session = self.session else { continue }
                self.request(session, method: "POST", path: "/live-activities/update-token",
                             body: ["token": Self.hex(data), "broadcastKey": key])
            }
        }
    }

    private func request(_ session: Session, method: String, path: String, body: [String: String]?, done: ((Bool) -> Void)? = nil) {
        guard let url = URL(string: session.apiBase + path) else {
            done?(false)
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer " + session.authToken, forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        URLSession.shared.dataTask(with: request) { _, response, _ in
            done?(((response as? HTTPURLResponse)?.statusCode ?? 0) / 100 == 2)
        }.resume()
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivities"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
    ]

    @objc func configure(_ call: CAPPluginCall) {
        LiveActivityRegistrar.shared.configure(
            apiBase: call.getString("apiBase") ?? "",
            authToken: call.getString("authToken"),
            deviceId: call.getString("deviceId"),
            lang: call.getString("lang") ?? "pt"
        )
        call.resolve()
    }
}
