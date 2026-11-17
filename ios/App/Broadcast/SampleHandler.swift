import ReplayKit

/// The entry point iOS calls once the person confirms "Iniciar transmissão"
/// for GoLive. Everything about the room lives in ScreenSession; this class
/// only connects ReplayKit's callbacks to it and ends the broadcast with a
/// message when the session gives up (iOS shows that message itself).
class SampleHandler: RPBroadcastSampleHandler {
    private var session: ScreenSession?
    private var observingStop = false

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        guard let config = Self.takeConfig() else {
            BroadcastShared.writeState("idle")
            end(Strings.openFromRoom)
            return
        }
        observeStopRequests()
        let session = ScreenSession(config: config) { [weak self] message in
            self?.end(message)
        }
        self.session = session
        session.start()
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        // Video only. App and microphone audio arrive here too, but feeding
        // them into WebRTC needs a custom audio device in this process — left
        // for later; the screen goes out silent.
        guard sampleBufferType == .video else { return }
        session?.push(sampleBuffer)
    }

    override func broadcastFinished() {
        session?.stop()
        session = nil
        BroadcastShared.writeState("idle")
        stopObservingStopRequests()
    }

    /// The config the site left for this broadcast, if it is fresh. Removed as
    /// it is read: a broadcast started later from Control Center, without
    /// going through a room, must not walk back into whatever room this was.
    private static func takeConfig() -> BroadcastConfig? {
        guard let defaults = BroadcastShared.defaults,
              let raw = defaults.string(forKey: BroadcastShared.configKey) else { return nil }
        defaults.removeObject(forKey: BroadcastShared.configKey)
        guard let data = raw.data(using: .utf8),
              let config = try? JSONDecoder().decode(BroadcastConfig.self, from: data) else { return nil }
        // Written the moment "Compartilhar tela" was pressed; the sheet is
        // answered within seconds. Five minutes covers someone hesitating on
        // it, and nothing older than that is a share anybody is waiting for.
        let ageSeconds = Date().timeIntervalSince1970 - config.createdAt / 1000
        guard ageSeconds < 300 else { return nil }
        return config
    }

    private func end(_ message: String) {
        session?.stop()
        session = nil
        stopObservingStopRequests()
        let error = NSError(domain: "me.nemtudo.golive.broadcast", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        finishBroadcastWithError(error)
    }

    // "Parar" pressed in the room, in the app: the only way for the app to end
    // a broadcast that is not its own process.
    private func observeStopRequests() {
        guard !observingStop else { return }
        observingStop = true
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                let handler = Unmanaged<SampleHandler>.fromOpaque(observer).takeUnretainedValue()
                DispatchQueue.main.async {
                    BroadcastShared.writeState("idle")
                    handler.end(Strings.stoppedFromApp)
                }
            },
            BroadcastShared.stopRequested as CFString,
            nil,
            .deliverImmediately
        )
    }

    private func stopObservingStopRequests() {
        guard observingStop else { return }
        observingStop = false
        CFNotificationCenterRemoveEveryObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque()
        )
    }
}
