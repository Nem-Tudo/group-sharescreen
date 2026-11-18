import Foundation
import CoreImage
import CoreMedia
import ImageIO
import ReplayKit
import WebRTC

// The iPhone's screen, sent into a GoLive room.
//
// This process is a client of the signalling server in its own right, the
// same way a browser tab is: it registers with the person's login, joins the
// room as one more of their devices ("Nome (2)") and plays the *broadcaster*
// half of lib/useRoomMedia.ts — one RTCPeerConnection per viewer, on the
// "screen" channel, offer from here, answer from them. Viewers cannot tell it
// from a share made in a browser, which is the point: nothing on their side
// had to change.
//
// The join skips the captcha and the "another device?" question by presenting
// a "screen-companion" token the app's own session got from the server for
// this room (see the API's "screen-companion-token").
//
// Constraints this is written around:
//   - an upload extension is killed past ~50 MB of memory, so frames are
//     scaled down before encoding and there is a cap on simultaneous viewers;
//   - every viewer is a separate hardware H.264 encoder (mesh, like the site);
//   - everything below runs on one serial queue, so no state needs a lock.

struct BroadcastConfig: Decodable {
    struct IceServer: Decodable {
        let urls: [String]
        let username: String?
        let credential: String?

        private enum CodingKeys: String, CodingKey { case urls, username, credential }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if let many = try? container.decode([String].self, forKey: .urls) {
                urls = many
            } else {
                urls = [try container.decode(String.self, forKey: .urls)]
            }
            username = try container.decodeIfPresent(String.self, forKey: .username)
            credential = try container.decodeIfPresent(String.self, forKey: .credential)
        }
    }

    let wsUrl: String
    let room: String
    let companionToken: String
    let loginToken: String?
    let name: String
    let iceServers: [IceServer]
    /// Where to send the rooms list's hover picture, in a group voice room
    /// with that experiment on (the site's lib/streamPreview.ts) — else nil.
    let preview: Preview?
    let version: String?

    struct Preview: Decodable {
        let url: String
        let token: String?
    }
    /// Milliseconds since 1970, from the page's Date.now().
    let createdAt: Double
}

/// What the person reads when a broadcast ends on its own — iOS shows it in
/// its "transmissão encerrada" alert. In the phone's language.
enum Strings {
    private static func pick(_ pt: String, _ en: String, _ es: String) -> String {
        let lang = Locale.preferredLanguages.first?.prefix(2) ?? "pt"
        switch lang {
        case "en": return en
        case "es": return es
        default: return pt
        }
    }

    static var openFromRoom: String {
        pick("Para compartilhar a tela, entre numa sala no GoLive e toque em Compartilhar tela.",
             "To share your screen, join a room in GoLive and tap Share screen.",
             "Para compartir la pantalla, entra en una sala en GoLive y toca Compartir pantalla.")
    }
    static var stoppedFromApp: String {
        pick("Você parou de compartilhar a tela.", "You stopped sharing your screen.", "Dejaste de compartir la pantalla.")
    }
    static var couldNotJoin: String {
        pick("Não foi possível entrar na sala para compartilhar a tela. Tente de novo pelo GoLive.",
             "Couldn't join the room to share your screen. Try again from GoLive.",
             "No se pudo entrar en la sala para compartir la pantalla. Inténtalo de nuevo desde GoLive.")
    }
    static var connectionLost: String {
        pick("A conexão caiu e a transmissão da tela foi encerrada.",
             "The connection dropped and the screen share ended.",
             "La conexión se cayó y se terminó de compartir la pantalla.")
    }
    static var notAllowed: String {
        pick("Esta sala não permite que você compartilhe a tela.",
             "This room doesn't let you share your screen.",
             "Esta sala no te permite compartir la pantalla.")
    }
    static var openAppToContinue: String {
        pick("Abra o GoLive para continuar compartilhando a tela.",
             "Open GoLive to keep sharing your screen.",
             "Abre GoLive para seguir compartiendo la pantalla.")
    }
    static var guestLimit: String {
        pick("Acabou o tempo de transmissão para convidados. Crie uma conta no GoLive para continuar.",
             "Guest sharing time is over. Create a GoLive account to keep going.",
             "Se acabó el tiempo de transmisión para invitados. Crea una cuenta en GoLive para seguir.")
    }
    static var removed: String {
        pick("Você saiu da sala, então a transmissão da tela foi encerrada.",
             "You left the room, so the screen share ended.",
             "Saliste de la sala, así que se terminó de compartir la pantalla.")
    }
    static var removedByRoom: String {
        pick("Você foi removido da sala, e a transmissão da tela foi encerrada.",
             "You were removed from the room, and the screen share ended.",
             "Te sacaron de la sala y se terminó de compartir la pantalla.")
    }
    static var roomChanged: String {
        pick("Você mudou de sala. Toque em Compartilhar tela de novo para mostrar a tela na sala nova.",
             "You moved to another room. Tap Share screen again to show your screen there.",
             "Cambiaste de sala. Toca Compartir pantalla de nuevo para mostrarla en la sala nueva.")
    }
}

final class ScreenSession: NSObject {
    // How many pixels are encoded, at most — about 720p's worth. The phone's
    // screen is ~1170×2530; a quarter of that keeps text readable on a
    // viewer's screen while leaving the extension room under its memory
    // ceiling with several encoders running. The *shape* is the screen's own
    // (see fitOutputFormat): asked for as 1280×720, WebRTC's adapter crops a
    // ~9:19.5 phone screen down to 9:16, which cut off the status bar and the
    // dock.
    private static let maxPixels = 1280 * 720
    private static let maxFps: Int32 = 24
    private static let maxBitrateBps = 2_500_000
    /// Viewers served at once. Past this, later arrivals wait for a slot.
    private static let maxViewers = 8
    private static let connectTimeout: TimeInterval = 20
    private static let channel = "screen"

    private let config: BroadcastConfig
    private let onEnd: (String) -> Void
    private let queue = DispatchQueue(label: "me.nemtudo.golive.broadcast.session")

    private let factory: RTCPeerConnectionFactory
    private let videoSource: RTCVideoSource
    private let videoTrack: RTCVideoTrack
    private let capturer: RTCVideoCapturer

    private var urlSession: URLSession?
    private var socket: URLSessionWebSocketTask?
    private var ended = false
    private var joined = false
    private var reconnectAttempts = 0
    private var heartbeat: DispatchSourceTimer?

    private var selfId: String?
    private var selfUserId: String?
    /// Everyone else in the room, by connection id → their identity.
    private var peers: [String: String] = [:]
    private var connections: [String: RTCPeerConnection] = [:]
    private var delegates: [String: PeerDelegate] = [:]
    private var pendingCandidates: [String: [RTCIceCandidate]] = [:]
    /// Viewers who said "stop" (tile hidden, left the stage): not offered to
    /// again until they say "resume".
    private var paused: Set<String> = []
    private var retryAttempts: [String: Int] = [:]
    /// Offers from other people's broadcasts already declined (peer|channel).
    private var declined: Set<String> = []
    /// The server paused this broadcast for an ad (see the site's
    /// lib/broadcastAdGate.ts). No frames go out until it says it is over —
    /// what a computer's share does is blank its picture the same way.
    /// Written on the session queue, read on ReplayKit's; a frame either side
    /// of the flip is harmless.
    private var adPaused = false
    /// In the room and announced as sharing — when a preview picture is
    /// worth sending. Same cross-thread rule as adPaused.
    private var live = false

    // The hover picture (see BroadcastConfig.preview): one small JPEG every
    // so often, made off the frame path on a queue of its own.
    private static let previewWidth: CGFloat = 320
    private static let previewEveryNs: Int64 = 15_000_000_000
    private static let previewRetryNs: Int64 = 4_000_000_000
    private let previewQueue = DispatchQueue(label: "me.nemtudo.golive.broadcast.preview", qos: .utility)
    private lazy var previewContext = CIContext()
    private var previewDueNs: Int64 = 0
    private var previewBusy = false
    private var previewUploaded = false
    private var observingAdGateReplies = false

    init(config: BroadcastConfig, onEnd: @escaping (String) -> Void) {
        self.config = config
        self.onEnd = onEnd
        RTCInitializeSSL()
        let encoders = RTCDefaultVideoEncoderFactory()
        let decoders = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoders, decoderFactory: decoders)
        videoSource = factory.videoSource(forScreenCast: true)
        videoTrack = factory.videoTrack(with: videoSource, trackId: "golive-ios-screen")
        capturer = RTCVideoCapturer(delegate: videoSource)
        super.init()
    }

    // MARK: - lifecycle

    func start() {
        queue.async {
            BroadcastShared.defaults?.removeObject(forKey: BroadcastShared.adGateKey)
            BroadcastShared.writeState("connecting")
            self.startHeartbeat()
            self.observeAdGateReplies()
            self.connect()
        }
    }

    // The ad gate's popup is shown by the app, which has a screen; its answer
    // comes back here to be sent on this connection, the one that was paused.
    private func observeAdGateReplies() {
        guard !observingAdGateReplies else { return }
        observingAdGateReplies = true
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                let session = Unmanaged<ScreenSession>.fromOpaque(observer).takeUnretainedValue()
                session.onQueue { session.sendAdGateReply() }
            },
            BroadcastShared.adGateReplied as CFString,
            nil,
            .deliverImmediately
        )
    }

    private func sendAdGateReply() {
        guard !ended, let defaults = BroadcastShared.defaults,
              let raw = defaults.string(forKey: BroadcastShared.adGateReplyKey) else { return }
        defaults.removeObject(forKey: BroadcastShared.adGateReplyKey)
        guard let data = raw.data(using: .utf8),
              let reply = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = reply["type"] as? String,
              ["ad-gate-cleared", "ad-gate-no-ad", "ad-gate-pro-click"].contains(type) else { return }
        send(reply)
    }

    /// Returns at once. Closing every viewer's connection can take seconds
    /// (WebRTC closes them one by one), and the caller is iOS waiting to call
    /// the broadcast over — the system sheet spun until it was. The block
    /// keeps this object alive until the teardown is done.
    func stop() {
        queue.async {
            guard !self.ended else { return }
            self.ended = true
            self.teardown()
        }
    }

    private func fail(_ message: String) {
        guard !ended else { return }
        ended = true
        teardown()
        BroadcastShared.writeState("error", message: message)
        let onEnd = self.onEnd
        DispatchQueue.main.async { onEnd(message) }
    }

    private func teardown() {
        // Said before the socket goes, so the room drops this screen at once
        // rather than after the server's hold on a vanished connection.
        if joined { send(["type": "leave"]) }
        live = false
        removePreview()
        heartbeat?.cancel()
        heartbeat = nil
        if observingAdGateReplies {
            observingAdGateReplies = false
            CFNotificationCenterRemoveObserver(
                CFNotificationCenterGetDarwinNotifyCenter(),
                Unmanaged.passUnretained(self).toOpaque(),
                CFNotificationName(BroadcastShared.adGateReplied as CFString),
                nil
            )
        }
        BroadcastShared.defaults?.removeObject(forKey: BroadcastShared.adGateKey)
        for id in Array(connections.keys) { closeConnection(id) }
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
    }

    private func startHeartbeat() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 3, repeating: 3)
        timer.setEventHandler { BroadcastShared.touchHeartbeat() }
        timer.resume()
        heartbeat = timer
    }

    // MARK: - frames (called on ReplayKit's thread)

    private var lastFrameNs: Int64 = 0
    /// The buffer size the output format was fitted to (see fitOutputFormat).
    private var fittedSize: (Int, Int) = (0, 0)

    /// Asks WebRTC for the screen's own aspect ratio at no more than maxPixels.
    /// The adapter takes one landscape size and applies it to either
    /// orientation, so the long side goes first; even numbers, which the
    /// hardware encoder wants.
    private func fitOutputFormat(width: Int, height: Int) {
        guard width > 0, height > 0, (width, height) != fittedSize else { return }
        fittedSize = (width, height)
        let scale = min(1, (Double(Self.maxPixels) / Double(width * height)).squareRoot())
        let even = { (value: Double) -> Int32 in Int32(max(2, Int(value) / 2 * 2)) }
        let long = even(Double(max(width, height)) * scale)
        let short = even(Double(min(width, height)) * scale)
        videoSource.adaptOutputFormat(toWidth: long, height: short, fps: Self.maxFps)
    }

    func push(_ sampleBuffer: CMSampleBuffer) {
        if adPaused { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        fitOutputFormat(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
        let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        let timeNs = Int64(seconds * 1_000_000_000)
        // ReplayKit can deliver up to 60 fps; anything past the cap is work
        // the adapter would only throw away after the copy.
        if timeNs - lastFrameNs < 1_000_000_000 / Int64(Self.maxFps) { return }
        lastFrameNs = timeNs
        var rotation = RTCVideoRotation._0
        var imageOrientation = CGImagePropertyOrientation.up
        if let raw = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber,
           let orientation = CGImagePropertyOrientation(rawValue: raw.uint32Value) {
            imageOrientation = orientation
            switch orientation {
            case .left, .leftMirrored: rotation = ._90
            case .down, .downMirrored: rotation = ._180
            case .right, .rightMirrored: rotation = ._270
            default: rotation = ._0
            }
        }
        let buffer = RTCCVPixelBuffer(pixelBuffer: pixelBuffer)
        let frame = RTCVideoFrame(buffer: buffer, rotation: rotation, timeStampNs: timeNs)
        videoSource.capturer(capturer, didCapture: frame)

        if config.preview != nil, live, !previewBusy, timeNs >= previewDueNs {
            previewBusy = true
            previewDueNs = timeNs + Self.previewRetryNs
            previewQueue.async { [weak self] in
                self?.uploadPreview(of: pixelBuffer, orientation: imageOrientation, at: timeNs)
            }
        }
    }

    private func uploadPreview(of pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation, at timeNs: Int64) {
        defer { previewBusy = false }
        guard let preview = config.preview, let url = URL(string: preview.url) else { return }
        var image = CIImage(cvPixelBuffer: pixelBuffer).oriented(orientation)
        let scale = Self.previewWidth / max(image.extent.width, 1)
        if scale < 1 { image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) }
        guard let jpeg = previewContext.jpegRepresentation(
            of: image,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.6]
        ) else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = preview.token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["image": jpeg.base64EncodedString()])
        let semaphore = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            ok = ((response as? HTTPURLResponse)?.statusCode ?? 0) / 100 == 2
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 10)
        if ok {
            previewUploaded = true
            // Next one in the regular interval; a refusal (not announced as
            // sharing yet, a blip) is retried sooner, like the site does.
            previewDueNs = timeNs + Self.previewEveryNs
        }
    }

    /// The broadcast is over: its picture goes with it rather than lingering
    /// until it expires.
    private func removePreview() {
        guard previewUploaded, let preview = config.preview, let url = URL(string: preview.url) else { return }
        previewUploaded = false
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        if let token = preview.token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        URLSession.shared.dataTask(with: request).resume()
    }

    // MARK: - signalling socket

    private func connect() {
        guard !ended, let url = URL(string: config.wsUrl) else {
            fail(Strings.couldNotJoin)
            return
        }
        joined = false
        selfId = nil
        peers = [:]
        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: url)
        urlSession = session
        socket = task
        task.resume()
        receive(on: task)
        var register: [String: Any] = [
            "type": "register",
            "name": config.name,
            "device": "mobile-app",
        ]
        if let token = config.loginToken { register["token"] = token }
        if let version = config.version { register["version"] = version }
        send(register)
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard task === self.socket, !self.ended else { return }
                switch result {
                case .failure:
                    self.socketDropped()
                case .success(let message):
                    if case .string(let text) = message,
                       let data = text.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        self.handle(json)
                    }
                    self.receive(on: task)
                }
            }
        }
    }

    private func send(_ payload: [String: Any]) {
        guard let socket,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }

    private func sendSignal(to peerId: String, _ data: [String: Any]) {
        send(["type": "signal", "to": peerId, "data": data])
    }

    /// The socket closed under a live broadcast. Everyone's connections to
    /// this device are gone with it (the server says peer-left), so they are
    /// dropped here too and rebuilt after the rejoin.
    private func socketDropped() {
        live = false
        for id in Array(connections.keys) { closeConnection(id) }
        socket = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        reconnectAttempts += 1
        guard reconnectAttempts <= 5 else {
            fail(Strings.connectionLost)
            return
        }
        BroadcastShared.writeState("connecting")
        let delay = min(pow(2.0, Double(reconnectAttempts)), 20)
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connect() }
    }

    // MARK: - server messages

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "registered":
            send([
                "type": "join",
                "room": config.room,
                "screenCompanionToken": config.companionToken,
                "confirmDevice": true,
                "streamerMode": false,
            ])
        case "register-error", "captcha-required":
            fail(Strings.couldNotJoin)
        case "join-error":
            fail((msg["reason"] as? String) == "group-forbidden" ? Strings.notAllowed : Strings.couldNotJoin)
        case "room-state":
            roomJoined(msg)
        case "peer-joined":
            if let id = msg["id"] as? String { peerArrived(id: id, summary: msg) }
        case "peer-left":
            if let id = msg["id"] as? String { peerLeft(id) }
        case "signal":
            if let from = msg["from"] as? String, let data = msg["data"] as? [String: Any] {
                handleSignal(from: from, data: data)
            }
        case "room-permission-denied":
            // Also sent for the mic, the camera and the rest; only a refusal
            // of the screen is about this broadcast.
            if (msg["permission"] as? String) == "screen" { fail(Strings.notAllowed) }
        case "screen-share-ban":
            // Sent to every connection right after "registered", with
            // banned: false when there is no ban — the state, not a verdict.
            if (msg["banned"] as? Bool) == true { fail(Strings.notAllowed) }
        case "broadcast-ad-gate":
            adPaused = true
            var gate = msg
            gate.removeValue(forKey: "type")
            if let data = try? JSONSerialization.data(withJSONObject: gate),
               let text = String(data: data, encoding: .utf8) {
                BroadcastShared.defaults?.set(text, forKey: BroadcastShared.adGateKey)
            }
            BroadcastShared.writeState("paused", message: Strings.openAppToContinue)
        case "broadcast-ad-gate-cleared":
            adPaused = false
            BroadcastShared.defaults?.removeObject(forKey: BroadcastShared.adGateKey)
            BroadcastShared.writeState("live")
        case "guest-broadcast-limit":
            fail(Strings.guestLimit)
        case "room-removed":
            fail((msg["ownerLeft"] as? Bool) == true ? Strings.removed : Strings.removedByRoom)
        case "banned":
            fail(Strings.removedByRoom)
        case "group-moved", "room-converted":
            // Its person went to another room; the token this broadcast holds
            // opens only this one, so it ends and says how to share again.
            fail(Strings.roomChanged)
        default:
            break
        }
    }

    private func roomJoined(_ msg: [String: Any]) {
        joined = true
        reconnectAttempts = 0
        // A fresh connection starts unpaused; if the gate still applies, the
        // server says so again and the case above puts it back.
        adPaused = false
        BroadcastShared.defaults?.removeObject(forKey: BroadcastShared.adGateKey)
        selfId = msg["selfId"] as? String
        selfUserId = msg["selfUserId"] as? String
        peers = [:]
        // Announced before any offer goes out, so a viewer's room already
        // shows this device as sharing a screen when its offer lands.
        send([
            "type": "sharing",
            "sharing": true,
            "screen": true,
            "camera": false,
            "files": [Any](),
            "screens": 1,
            "cameras": 0,
        ])
        BroadcastShared.writeState("live")
        live = true
        let list = msg["peers"] as? [[String: Any]] ?? []
        var delay: TimeInterval = 0
        for summary in list {
            guard let id = summary["id"] as? String else { continue }
            // Spread out, like the site's openSendPCsStaggered: a full room's
            // worth of encoders and ICE gathers starting in one instant is a
            // spike this process cannot afford.
            queue.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.peerArrived(id: id, summary: summary)
            }
            delay += 0.15
        }
    }

    /// Whether this peer should get the screen at all. Not this person's own
    /// phone app — the iPhone it is coming from, which would only be watching
    /// itself (it shows its own tile instead) — but any other device of theirs
    /// does, the way a share reaches your own second computer. And not another
    /// phone's screen broadcast, which never watches.
    private func isViewer(_ summary: [String: Any]) -> Bool {
        if let userId = summary["userId"] as? String, userId == selfUserId,
           (summary["mobileApp"] as? Bool) == true { return false }
        if let screenOf = summary["screenOf"] as? String, !screenOf.isEmpty { return false }
        return true
    }

    private func peerArrived(id: String, summary: [String: Any]) {
        guard joined, id != selfId else { return }
        guard isViewer(summary) else {
            peers.removeValue(forKey: id)
            return
        }
        peers[id] = (summary["userId"] as? String) ?? id
        openConnection(to: id)
    }

    private func peerLeft(_ id: String) {
        peers.removeValue(forKey: id)
        paused.remove(id)
        retryAttempts.removeValue(forKey: id)
        declined = declined.filter { !$0.hasPrefix("\(id)|") }
        closeConnection(id)
        fillFreeSlots()
    }

    // MARK: - signals

    private func handleSignal(from: String, data: [String: Any]) {
        let kind = data["kind"] as? String
        if kind == "peer-left" {
            closeConnection(from)
            return
        }
        let role = data["role"] as? String
        let channel = data["channel"] as? String ?? ""
        if role == "broadcaster" {
            // Somebody else's mic, camera or screen offering itself to this
            // device, which only sends. Declined once with "stop", the way a
            // browser declines a share it is not watching — otherwise their
            // side keeps retrying a connection that never comes up.
            if kind == "offer" {
                let key = "\(from)|\(channel)"
                if !declined.contains(key) {
                    declined.insert(key)
                    sendSignal(to: from, ["channel": channel, "role": "viewer", "kind": "stop"])
                }
            }
            return
        }
        guard role == "viewer", channel == Self.channel else { return }
        switch kind {
        case "answer":
            guard let pc = connections[from],
                  let sdp = (data["sdp"] as? [String: Any])?["sdp"] as? String else { return }
            pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [weak self] _ in
                self?.queue.async { self?.flushCandidates(for: from, on: pc) }
            }
        case "ice":
            guard let candidate = Self.candidate(from: data["candidate"]) else { return }
            if let pc = connections[from], pc.remoteDescription != nil {
                pc.add(candidate) { _ in }
            } else {
                pendingCandidates[from, default: []].append(candidate)
            }
        case "stop":
            paused.insert(from)
            closeConnection(from)
            fillFreeSlots()
        case "resume":
            paused.remove(from)
            closeConnection(from)
            openConnection(to: from)
        case "reconnect-request":
            guard !paused.contains(from), peers[from] != nil else { return }
            closeConnection(from)
            openConnection(to: from)
        case "quality":
            applyQualityRequest(from, tier: data["tier"] as? String, idle: data["idle"] as? Bool == true)
        default:
            // "route", "diag-request": tuning this side does not do.
            break
        }
    }

    /// A viewer saying what it needs (the site's qualityNegotiation.ts). The
    /// picture is already capped at 720p here, so the size it asks for changes
    /// little; what is honoured is the frame rate in the tier ("576p15" → 15)
    /// and "idle" — a viewer not looking at all (its tab hidden, the tile off
    /// screen) is sent nothing until it looks again, as a computer's share does.
    private func applyQualityRequest(_ peerId: String, tier: String?, idle: Bool) {
        guard let pc = connections[peerId] else { return }
        var fps = Self.maxFps
        if let tier, let p = tier.firstIndex(of: "p"), let requested = Int32(tier[tier.index(after: p)...]) {
            fps = max(1, min(Self.maxFps, requested))
        }
        for sender in pc.senders where sender.track?.kind == "video" {
            let parameters = sender.parameters
            for encoding in parameters.encodings {
                encoding.isActive = !idle
                encoding.maxFramerate = NSNumber(value: fps)
            }
            sender.parameters = parameters
        }
    }

    private static func candidate(from value: Any?) -> RTCIceCandidate? {
        guard let json = value as? [String: Any], let sdp = json["candidate"] as? String, !sdp.isEmpty else { return nil }
        let index = (json["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
        return RTCIceCandidate(sdp: sdp, sdpMLineIndex: index, sdpMid: json["sdpMid"] as? String)
    }

    private func flushCandidates(for peerId: String, on pc: RTCPeerConnection) {
        guard connections[peerId] === pc, let queued = pendingCandidates.removeValue(forKey: peerId) else { return }
        for candidate in queued { pc.add(candidate) { _ in } }
    }

    // MARK: - peer connections

    private func openConnection(to peerId: String) {
        guard joined, !ended, connections[peerId] == nil, !paused.contains(peerId), peers[peerId] != nil else { return }
        guard connections.count < Self.maxViewers else { return }

        let rtcConfig = RTCConfiguration()
        rtcConfig.iceServers = config.iceServers.map {
            RTCIceServer(urlStrings: $0.urls, username: $0.username, credential: $0.credential)
        }
        rtcConfig.sdpSemantics = .unifiedPlan
        rtcConfig.bundlePolicy = .maxBundle
        rtcConfig.continualGatheringPolicy = .gatherContinually
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let delegate = PeerDelegate(peerId: peerId, session: self)
        // Typed optional on purpose: whether the factory returns one differs
        // between WebRTC releases, and this compiles against either.
        let created: RTCPeerConnection? = factory.peerConnection(with: rtcConfig, constraints: constraints, delegate: delegate)
        guard let pc = created else { return }
        connections[peerId] = pc
        delegates[peerId] = delegate

        let added: RTCRtpSender? = pc.add(videoTrack, streamIds: ["golive-ios-screen"])
        if let sender = added {
            let parameters = sender.parameters
            for encoding in parameters.encodings {
                encoding.maxBitrateBps = NSNumber(value: Self.maxBitrateBps)
                encoding.maxFramerate = NSNumber(value: Self.maxFps)
            }
            sender.parameters = parameters
        }

        pc.offer(for: constraints) { [weak self] offer, _ in
            guard let self, let offer else { return }
            self.queue.async {
                guard self.connections[peerId] === pc else { return }
                pc.setLocalDescription(offer) { [weak self] error in
                    guard let self, error == nil else { return }
                    self.queue.async {
                        guard self.connections[peerId] === pc else { return }
                        self.sendSignal(to: peerId, [
                            "channel": Self.channel,
                            "role": "broadcaster",
                            "kind": "offer",
                            "sdp": ["type": "offer", "sdp": offer.sdp],
                        ])
                    }
                }
            }
        }

        queue.asyncAfter(deadline: .now() + Self.connectTimeout) { [weak self] in
            guard let self, self.connections[peerId] === pc else { return }
            let state = pc.iceConnectionState
            if state != .connected && state != .completed { self.connectionFailed(peerId, pc) }
        }
    }

    private func closeConnection(_ peerId: String) {
        pendingCandidates.removeValue(forKey: peerId)
        delegates.removeValue(forKey: peerId)
        guard let pc = connections.removeValue(forKey: peerId) else { return }
        pc.close()
    }

    /// A slot freed up: offer it to whoever has been waiting longest for one.
    private func fillFreeSlots() {
        for id in peers.keys where connections[id] == nil && !paused.contains(id) {
            if connections.count >= Self.maxViewers { break }
            openConnection(to: id)
        }
    }

    fileprivate func connectionFailed(_ peerId: String, _ pc: RTCPeerConnection) {
        guard connections[peerId] === pc else { return }
        closeConnection(peerId)
        let attempt = (retryAttempts[peerId] ?? 0) + 1
        retryAttempts[peerId] = attempt
        // Backed off like the site's scheduleSendRetry: an unreachable viewer
        // must not cost a fresh encoder every couple of seconds forever.
        let delay = min(2 * pow(2.0, Double(attempt - 1)), 30)
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.peers[peerId] != nil else { return }
            self.openConnection(to: peerId)
        }
    }

    fileprivate func connected(_ peerId: String) {
        retryAttempts.removeValue(forKey: peerId)
    }

    fileprivate func generated(_ candidate: RTCIceCandidate, for peerId: String) {
        var json: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": candidate.sdpMLineIndex]
        if let mid = candidate.sdpMid { json["sdpMid"] = mid }
        sendSignal(to: peerId, [
            "channel": Self.channel,
            "role": "broadcaster",
            "kind": "ice",
            "candidate": json,
        ])
    }

    fileprivate func onQueue(_ work: @escaping () -> Void) {
        queue.async(execute: work)
    }
}

/// One per viewer, so every callback knows whose connection it is about.
private final class PeerDelegate: NSObject, RTCPeerConnectionDelegate {
    let peerId: String
    weak var session: ScreenSession?

    init(peerId: String, session: ScreenSession) {
        self.peerId = peerId
        self.session = session
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        let peerId = self.peerId
        guard let session else { return }
        session.onQueue { [weak session] in
            switch newState {
            case .connected, .completed:
                session?.connected(peerId)
            case .failed:
                session?.connectionFailed(peerId, peerConnection)
            default:
                break
            }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        let peerId = self.peerId
        session?.onQueue { [weak session] in session?.generated(candidate, for: peerId) }
    }
}
