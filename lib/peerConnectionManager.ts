/** Recovery for one broadcaster -> viewer connection. The caller owns the PC
 * and the map of live peers; this manager owns its timeout and ICE restart. */
export function manageSendPeerConnection({
  pc,
  isCurrent,
  sendOffer,
  onFailure,
  onClosed,
  onConnected,
  onPeerFailure,
  connectTimeoutMs,
  restartTimeoutMs,
}: {
  pc: RTCPeerConnection;
  isCurrent: () => boolean;
  sendOffer: (offer: RTCSessionDescriptionInit, iceRestart: boolean) => Promise<void>;
  onFailure: () => void;
  onClosed: () => void;
  onConnected: () => void;
  onPeerFailure: () => void;
  connectTimeoutMs: number;
  restartTimeoutMs: number;
}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let disconnected: ReturnType<typeof setTimeout> | undefined;
  let iceRestartTried = false;
  let disposed = false;

  const current = () => !disposed && isCurrent();
  const clearConnectTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = undefined;
  };
  const armConnectTimeout = (ms: number) => {
    clearConnectTimeout();
    timeout = setTimeout(() => {
      timeout = undefined;
      if (current() && pc.connectionState !== "connected") onFailure();
    }, ms);
  };
  const restartIce = () => {
    if (!current() || pc.connectionState === "closed" || pc.signalingState !== "stable") return false;
    try {
      pc.restartIce?.();
    } catch {
      return false;
    }
    pc.createOffer({ iceRestart: true })
      .then(async (offer) => {
        if (!current()) return;
        await sendOffer(offer, true);
        if (current()) armConnectTimeout(restartTimeoutMs);
      })
      .catch(() => {
        if (current()) onFailure();
      });
    return true;
  };
  const tryRestart = () => {
    if (iceRestartTried) return false;
    iceRestartTried = true;
    return restartIce();
  };
  const recover = () => {
    if (!current()) return;
    onPeerFailure();
    if (tryRestart()) return;
    onFailure();
  };

  pc.onconnectionstatechange = () => {
    if (!current()) return;
    if (pc.connectionState === "failed") recover();
    else if (pc.connectionState === "disconnected") {
      // A brief interruption can repair itself; only restart after 4 seconds.
      if (disconnected) clearTimeout(disconnected);
      disconnected = setTimeout(() => {
        disconnected = undefined;
        if (current() && pc.connectionState === "disconnected") recover();
      }, 4000);
    } else if (pc.connectionState === "closed") onClosed();
    else if (pc.connectionState === "connected") {
      clearConnectTimeout();
      if (disconnected) clearTimeout(disconnected);
      disconnected = undefined;
      iceRestartTried = false;
      onConnected();
    }
  };
  armConnectTimeout(connectTimeoutMs);

  return {
    tryRestart,
    dispose() {
      disposed = true;
      clearConnectTimeout();
      if (disconnected) clearTimeout(disconnected);
      disconnected = undefined;
      pc.onconnectionstatechange = null;
    },
  };
}

/** One retry queue per broadcast channel; a successful connection resets only
 * that peer's backoff. clearAll lets a later share start with a clean queue. */
export function createSendRetryScheduler(
  shouldRetry: (peerId: string) => boolean,
  openPeer: (peerId: string) => void,
  baseDelayMs: number,
  maxDelayMs: number
) {
  const attempts = new Map<string, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    schedule(peerId: string) {
      const attempt = attempts.get(peerId) ?? 0;
      attempts.set(peerId, attempt + 1);
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (shouldRetry(peerId)) openPeer(peerId);
      }, delay);
      timers.add(timer);
    },
    reset(peerId: string) { attempts.delete(peerId); },
    clearAll() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      attempts.clear();
    },
  };
}

/** Viewer-side recovery holds the existing PC open long enough for the
 * broadcaster's ICE restart; only after that budget does it ask for a rebuild. */
export function manageRecvPeerConnection({
  pc,
  isCurrent,
  onState,
  onClosed,
  requestReconnect,
  rebuild,
  recoveryTimeoutMs,
}: {
  pc: RTCPeerConnection;
  isCurrent: () => boolean;
  onState: (state: RTCPeerConnectionState) => void;
  onClosed: () => void;
  requestReconnect: () => void;
  rebuild: () => void;
  recoveryTimeoutMs: number;
}) {
  let recovery: ReturnType<typeof setTimeout> | undefined;
  let disconnected: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const current = () => !disposed && isCurrent();
  const clearRecovery = () => {
    if (recovery) clearTimeout(recovery);
    recovery = undefined;
  };
  const recover = () => {
    if (!current() || recovery) return;
    requestReconnect();
    recovery = setTimeout(() => {
      recovery = undefined;
      if (current() && pc.connectionState !== "connected") rebuild();
    }, recoveryTimeoutMs);
  };
  pc.onconnectionstatechange = () => {
    if (!current()) return;
    onState(pc.connectionState);
    if (pc.connectionState === "closed") onClosed();
    else if (pc.connectionState === "failed") recover();
    else if (pc.connectionState === "disconnected") {
      if (disconnected) clearTimeout(disconnected);
      disconnected = setTimeout(() => {
        disconnected = undefined;
        if (current() && pc.connectionState === "disconnected") recover();
      }, 4000);
    } else if (pc.connectionState === "connected") {
      clearRecovery();
      if (disconnected) clearTimeout(disconnected);
      disconnected = undefined;
    }
  };
  return {
    dispose() {
      disposed = true;
      clearRecovery();
      if (disconnected) clearTimeout(disconnected);
      disconnected = undefined;
      pc.onconnectionstatechange = null;
    },
  };
}
