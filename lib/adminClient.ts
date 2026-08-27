"use client";

import type { ChatMessage } from "./signalingClient";
import type { VideoSource } from "./videoSource";

const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";

export type AdminPeerInfo = {
  id: string;
  name: string;
  sharing: boolean;
  // Same fields/meaning as WatchRoom's PeerInfo.screen/camera — see their
  // doc comment in signalingClient.ts. null when the peer's client didn't
  // report which channel it is, undefined from an older server.
  screen?: boolean | null;
  camera?: boolean | null;
  mic: boolean;
  // Stable per-account/per-guest identity (see server/signaling.ts's
  // stableUserId) — same field WatchRoom's PeerInfo carries, used the same
  // way here to key persisted per-peer volume dials across reconnects.
  userId?: string;
  // Same field/meaning as WatchRoom's PeerInfo.isGuest — see its doc
  // comment in signalingClient.ts.
  isGuest?: boolean;
};

export type AdminClientStatus = "idle" | "connecting" | "open" | "closed" | "unauthorized";

export type AdminClientState = {
  status: AdminClientStatus;
  room: string | null;
  selfId: string | null;
  peers: AdminPeerInfo[];
  chatMessages: ChatMessage[];
  // The room's video sources (see lib/videoSource.ts). A moderator both
  // embeds these (the same VideoSourceTile a participant gets, read-only —
  // see AdminRoomViewer) and reads `addedById` off them, to mark who in the
  // participant list put a video on everyone's screen, which is a different
  // kind of transmitting from a screen or camera share.
  videoSources: VideoSource[];
  error: string | null;
};

type Listener = () => void;
type SignalListener = (from: string, data: Record<string, unknown>) => void;

const initialState: AdminClientState = {
  status: "idle",
  room: null,
  selfId: null,
  peers: [],
  chatMessages: [],
  videoSources: [],
  error: null,
};

// A separate, minimal signaling connection for the moderation viewer — it
// deliberately does NOT reuse the regular `signalingClient` singleton,
// since that one is tied to the browser's persisted display name/clientId
// identity. A moderator authenticates with an admin token instead and only
// ever *receives* media (see useAdminRoomViewer), so it needs none of the
// register/rename/reconnect-as-the-same-person machinery the normal client
// carries.
class AdminSignalingClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private signalListeners = new Set<SignalListener>();
  // Clock synchronization, mirroring signalingClient's — see serverNow
  // below for why a moderator needs it at all now that they embed the
  // room's video sources rather than only counting them.
  private clockOffsetMs = 0;
  private clockSampleRttMs = Number.POSITIVE_INFINITY;
  private clockSyncTimer: ReturnType<typeof setInterval> | null = null;
  // Mirrors signalingClient.ts's reconnect-with-backoff — the original
  // version here never retried at all, so any brief network hiccup left a
  // moderator stuck on "Conectando..." forever until they manually left and
  // reopened the viewer (this is most of what read as "a tela demora mais
  // pra carregar").
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private desiredRoom: string | null = null;
  private desiredToken: string | null = null;

  state: AdminClientState = initialState;

  subscribe = (cb: Listener) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = () => this.state;

  onSignal(cb: SignalListener) {
    this.signalListeners.add(cb);
    return () => this.signalListeners.delete(cb);
  }

  private setState(patch: Partial<AdminClientState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  connect(room: string, token: string) {
    if (typeof window === "undefined") return;
    this.desiredRoom = room;
    this.desiredToken = token;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openSocket();
  }

  private openSocket() {
    this.closeSocket();
    this.setState({
      status: "connecting",
      room: this.desiredRoom,
      peers: [],
      chatMessages: [],
      selfId: null,
      error: null,
    });

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState({ status: "open" });
      ws.send(JSON.stringify({ type: "admin-join", room: this.desiredRoom, token: this.desiredToken }));
      this.startClockSync();
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      if (this.state.status === "unauthorized") return;
      this.setState({ status: "closed" });
      this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.desiredRoom || !this.desiredToken) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  // Closes the socket without treating it as a dropped connection — used
  // both by an intentional disconnect() and internally before opening a
  // fresh one, so neither ever schedules a spurious reconnect for a close
  // this client itself initiated.
  private closeSocket() {
    if (this.clockSyncTimer) {
      clearInterval(this.clockSyncTimer);
      this.clockSyncTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      ws.close();
    }
  }

  /**
   * This connection's best estimate of the server's clock — what
   * videoSourcePosition must be given, rather than Date.now(), for the same
   * reason every participant's player uses signalingClient.serverNow(): a
   * video source's position is extrapolated from a *server* timestamp, so a
   * moderator whose machine is ten seconds off would watch ten seconds off
   * and the drift correction could never see it, being self-consistently
   * wrong by its own constant.
   */
  serverNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  // A short burst on connect (the first samples are the noisiest — the
  // socket has just opened) and a slow trickle afterwards. Same shape as
  // signalingClient's, against the same server handler.
  private startClockSync() {
    if (this.clockSyncTimer) clearInterval(this.clockSyncTimer);
    this.clockSampleRttMs = Number.POSITIVE_INFINITY;
    const sample = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "time-sync", t0: Date.now() }));
      }
    };
    sample();
    setTimeout(sample, 400);
    setTimeout(sample, 1200);
    this.clockSyncTimer = setInterval(sample, 30_000);
  }

  disconnect() {
    this.desiredRoom = null;
    this.desiredToken = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.setState(initialState);
  }

  private handleMessage(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "welcome":
        this.setState({ selfId: msg.id as string });
        break;
      case "room-state":
        this.setState({
          room: msg.room as string,
          selfId: msg.selfId as string,
          peers: msg.peers as AdminPeerInfo[],
          chatMessages: Array.isArray(msg.messages) ? (msg.messages as ChatMessage[]) : [],
          videoSources: Array.isArray(msg.videoSources) ? (msg.videoSources as VideoSource[]) : [],
        });
        break;
      case "peer-joined": {
        const alreadyKnown = this.state.peers.some((p) => p.id === msg.id);
        const userId = typeof msg.userId === "string" ? msg.userId : undefined;
        const isGuest = Boolean(msg.isGuest);
        this.setState({
          peers: alreadyKnown
            ? this.state.peers.map((p) =>
                p.id === msg.id
                  ? { ...p, name: msg.name as string, sharing: false, mic: false, userId, isGuest }
                  : p
              )
            : [
                ...this.state.peers,
                { id: msg.id as string, name: msg.name as string, sharing: false, mic: false, userId, isGuest },
              ],
        });
        break;
      }
      case "peer-left":
        this.setState({ peers: this.state.peers.filter((p) => p.id !== msg.id) });
        this.signalListeners.forEach((l) => l(msg.id as string, { kind: "peer-left" }));
        break;
      case "peer-renamed":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, name: msg.name as string } : p
          ),
        });
        break;
      case "peer-sharing":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id
              ? {
                  ...p,
                  sharing: Boolean(msg.sharing),
                  screen: typeof msg.screen === "boolean" ? msg.screen : null,
                  camera: typeof msg.camera === "boolean" ? msg.camera : null,
                }
              : p
          ),
        });
        break;
      case "peer-mic":
        this.setState({
          peers: this.state.peers.map((p) =>
            p.id === msg.id ? { ...p, mic: Boolean(msg.mic) } : p
          ),
        });
        break;
      case "video-source-added":
        this.setState({ videoSources: [...this.state.videoSources, msg.source as VideoSource] });
        break;
      case "video-source-removed":
        this.setState({ videoSources: this.state.videoSources.filter((v) => v.id !== msg.id) });
        break;
      // Play/pause/seek from whoever is driving the source. This used to be
      // dropped ("playback state is for players, and a moderator has none"),
      // which stopped being true the moment the viewer started embedding
      // these: without it a moderator's player is handed the source's
      // opening state and never hears about another one, so it sits frozen
      // at wherever the room was when they walked in. Merged field by field,
      // mirroring signalingClient's handler, since the broadcast carries only
      // what changed and `updatedAt` is what makes the tile re-sync at all.
      case "video-source-state":
        this.setState({
          videoSources: this.state.videoSources.map((v) =>
            v.id === msg.id
              ? {
                  ...v,
                  playing: Boolean(msg.playing),
                  positionSeconds: Number(msg.positionSeconds) || 0,
                  playbackRate: Number(msg.playbackRate) || 1,
                  updatedAt: Number(msg.updatedAt) || Date.now(),
                  playlistIndex:
                    typeof msg.playlistIndex === "number" && Number.isFinite(msg.playlistIndex)
                      ? Math.max(0, Math.floor(msg.playlistIndex))
                      : v.playlistIndex,
                }
              : v
          ),
        });
        break;
      case "time-sync": {
        const t0 = Number(msg.t0) || 0;
        const serverTime = Number(msg.serverTime) || 0;
        if (!t0 || !serverTime) break;
        const rtt = Date.now() - t0;
        if (rtt < 0 || rtt > 5000) break;
        // The server stamped `serverTime` somewhere inside the round trip;
        // assuming it was halfway is the standard approximation. Keeping
        // only the shortest-round-trip sample is the same reason NTP does.
        const offset = serverTime + rtt / 2 - Date.now();
        if (rtt <= this.clockSampleRttMs) {
          this.clockSampleRttMs = rtt;
          this.clockOffsetMs = offset;
        }
        break;
      }
      case "signal":
        this.signalListeners.forEach((l) => l(msg.from as string, msg.data as Record<string, unknown>));
        break;
      case "chat-message": {
        const chatMessage: ChatMessage = {
          id: msg.id as string,
          from: msg.from as string,
          name: msg.name as string,
          isGuest: Boolean(msg.isGuest),
          kind: msg.kind === "gif" ? "gif" : "text",
          text: (msg.text as string) ?? "",
          url: typeof msg.url === "string" ? msg.url : undefined,
          ts: msg.ts as number,
        };
        this.setState({ chatMessages: [...this.state.chatMessages, chatMessage] });
        break;
      }
      case "error":
        // Not worth retrying — an admin token that was rejected once (bad
        // token, insufficient flags) will be rejected again identically, so
        // this drops the desired room/token to stop scheduleReconnect from
        // ever firing for it instead of looping forever against a
        // connection that can never succeed.
        this.desiredRoom = null;
        this.desiredToken = null;
        this.setState({ status: "unauthorized", error: (msg.message as string) ?? "Não autorizado." });
        this.closeSocket();
        break;
      default:
        break;
    }
  }

  sendSignal(to: string, data: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "signal", to, data }));
    }
  }
}

export const adminSignalingClient = new AdminSignalingClient();
