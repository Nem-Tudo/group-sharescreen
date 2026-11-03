// Per-session connection-quality reports, sent to the API.
//
// The stats panel answers "why is *this* stream bad" for whoever opens it. It
// cannot answer the question behind the reports that prompted it — is it the
// broadcaster's machine, the pair's route, or our TURN server — because that
// needs many sessions side by side, including the ones nobody complained
// about. This collects exactly that: one compact summary per video connection
// when it ends.
//
// What is sent, and what is deliberately not:
//   - every *bad* session (see connectionTelemetrySummary's rule), and a
//     random QUALITY_SAMPLE_RATE of the good ones. The good sample is the control
//     group: "80% of bad sessions go through TURN" means nothing without
//     knowing how many sessions go through TURN at all;
//   - no IP address and nothing from a candidate but its type;
//   - nothing for the mic mesh, and nothing for a session under
//     MIN_SESSION_S, which is a reconnect or a glance, not a stream.
//
// Cost is kept flat in a big room the same way mediaStats keeps it: one timer,
// a bounded round-robin window of connections per pass, sequential getStats().

import { connectionRegistry, createStatsSampler, type RegisteredConnection } from "./connectionRegistry";
import {
  addSnapshot,
  createAccumulator,
  noteIceAttempt,
  QUALITY_SAMPLE_RATE,
  summarize,
  type SessionAccumulator,
  type SessionSummary,
} from "./connectionTelemetrySummary";
import { signalingClient } from "./signalingClient";
import { getSignalingHttpBase } from "./roomsApi";
import { getAccountToken } from "./accountApi";
import { getStoredGuestToken } from "./guestToken";
import { isDesktopApp, isMobileApp } from "./desktop";
import {
  getEffectiveForceRelayIce,
  getStoredShareBitrate,
  getStoredShareFps,
  getStoredShareProfile,
  getStoredShareResolution,
} from "./mediaPreferences";
import { turnProvider } from "./iceConfig";
import { trackFeatureEvent } from "./features";
import { isClassicSend, NEW_SEND_FEATURE } from "./classicSend";
import { defaultShareProfile, screenCodecTag } from "./screenCodec";
import { H264_SEND_FEATURE, isH264Send } from "./h264Send";
import { senderQualityState } from "./peerQualityController";
import { qualityNegotiator } from "./qualityNegotiation";
import { nativeSinkPaused, nativeSinkStats } from "./nativeVideoCapture";

// One of each per session of our own screen, at its end, from both groups of
// experiments sq-new-send and sq-h264-send (see lib/classicSend, lib/h264Send), so
// the admin compares like with like. The GPU capture, which no group changes, is left
// out.
//   send_session            a connection carrying our screen
//   send_session_fps        ...its average fps (value)
//   send_session_height     ...its average height (value)
//   send_session_slideshow  ...averaged under 10 fps while carrying real bitrate
//   send_link_held          ...spent over a tenth of its time held down by its link
//   send_machine_held       ...spent over a tenth of its time held down by the machine
//   send_paused             ...spent over a tenth of its time with nobody looking
//   send_moving_picture     ...settled in the camera mode of the costly codec at some point
export const SEND_SESSION_EVENTS = {
  session: "send_session",
  fps: "send_session_fps",
  height: "send_session_height",
  slideshow: "send_session_slideshow",
  linkHeld: "send_link_held",
  machineHeld: "send_machine_held",
  paused: "send_paused",
  movingPicture: "send_moving_picture",
} as const;

const ENABLED = process.env.NEXT_PUBLIC_QUALITY_TELEMETRY_ENABLED !== "false";

const POLL_MS = 10_000;
const MAX_PER_PASS = 8;
const MIN_SESSION_S = 20;
// Connections per pass to look at while they have not come up. They live for 20 or
// 30 seconds at a time, so a pass every 10 seconds finds each one at least once.
const MAX_STUCK_PER_PASS = 4;
// Reports are batched rather than sent the moment a session ends: a share
// stopping ends every viewer's session at once, and that should be one request.
const FLUSH_DELAY_MS = 5000;
const MAX_BATCH = 20;
// A session whose report never got sent (offline, API down) is not retried
// forever; the queue keeps the newest.
const MAX_QUEUE = 60;

export interface ConnectionQualityReport extends SessionSummary {
  v: 1;
  roomId: string;
  channel: string;
  direction: "send" | "recv";
  selfPeerId: string;
  peerId: string;
  /**
   * The other end's stable identity (account id, or "guest:…"), from the room
   * state the server sent us. A claim, not a proof — the API verifies only the
   * reporter's own — but it is what lets reports about the same broadcaster
   * be grouped across their reconnects, which a peer id never survives.
   */
  peerUserId: string | null;
  originId: string | null;
  startedAt: number;
  endedBy: "close" | "pagehide";
  forceRelay: boolean;
  /** Whose TURN server our end relayed through, when it did. */
  turnProvider: "own" | "cloudflare" | null;
  /** Our side of the transport experiments: "sq-new-send=on", or "screen-codec=auto" outside it. */
  experiments: string | null;
  /**
   * Send only, the desktop app's GPU capture (native-video-capture): how its
   * keyframe slots went on this connection — held for a fresh IDR, filled
   * with a stale one, and restarts of the frame chain. Null on any other share.
   */
  nativeKeyHolds: number | null;
  nativeKeyStale: number | null;
  nativeResyncs: number | null;
  settings: ShareSettings | null;
  device: {
    cores: number | null;
    memoryGb: number | null;
    browser: string;
    app: "web" | "desktop" | "android";
  };
}

export interface ShareSettings {
  resolution: string;
  fps: number;
  bitrate: string;
  profile: string;
}

// The screen share's dials as useRoomMedia is actually running them. The
// stored values alone were not enough: they are only written when somebody
// moves a dial, so a person who never opened the picker was reported with
// whatever default this file guessed — "text" for the profile, when the real
// default had become "balanced". Every analysis by profile was split on that
// mislabel. Null until useRoomMedia says (the stored values stand in).
let liveShareSettings: ShareSettings | null = null;

/** The screen share's dials as they are really set. Called by useRoomMedia. */
export function setTelemetryShareSettings(settings: ShareSettings | null) {
  liveShareSettings = settings;
}

function experimentsTag(): string | null {
  if (isClassicSend()) return screenCodecTag();
  const on = [NEW_SEND_FEATURE, isH264Send() && H264_SEND_FEATURE].filter(Boolean);
  return on.map((key) => `${key}=on`).join(";");
}

interface Session {
  connection: RegisteredConnection;
  roomId: string;
  selfPeerId: string;
  peerUserId: string | null;
  acc: SessionAccumulator;
  movingPicture: boolean;
}

function browserOf(ua: string): string {
  const pick = (name: string, re: RegExp) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  return (
    pick("Edge", /Edg\/(\d+)/) ??
    pick("Opera", /OPR\/(\d+)/) ??
    pick("Firefox", /Firefox\/(\d+)/) ??
    pick("Chrome", /Chrome\/(\d+)/) ??
    pick("Safari", /Version\/(\d+).*Safari/) ??
    "other"
  );
}

class ConnectionTelemetry {
  private sessions = new Map<RTCPeerConnection, Session>();
  private queue: ConnectionQualityReport[] = [];
  private sample = createStatsSampler();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cursor = 0;
  private passing = false;
  private started = false;

  start() {
    if (this.started || !ENABLED || typeof window === "undefined") return;
    this.started = true;
    connectionRegistry.subscribe((event, connection) => {
      if (event === "open") this.open(connection);
      else this.close(connection.pc, "close");
    });
    for (const connection of connectionRegistry.list()) this.open(connection);
    // pagehide, not unload/beforeunload: it is the one that fires reliably on
    // mobile and when a tab is discarded, and sendBeacon is made for it.
    window.addEventListener("pagehide", () => this.onPageHide());
  }

  private open(connection: RegisteredConnection) {
    if (this.sessions.has(connection.pc)) return;
    const acc = createAccumulator(Date.now());
    // Whether this pc ever came up — the half of "no video" that is the path's
    // fault (see connectionTelemetrySummary). Never removed: a closed pc
    // fires nothing more, and the session is gone with it.
    const pc = connection.pc;
    const noteConnected = () => {
      if (pc.connectionState === "connected") acc.connectedAt ??= Date.now();
    };
    noteConnected();
    pc.addEventListener("connectionstatechange", noteConnected);
    this.sessions.set(connection.pc, {
      connection,
      // Read at open, not at close: by the time a session ends the room may
      // already be the next one.
      roomId: signalingClient.state.room ?? "",
      selfPeerId: signalingClient.state.selfId ?? "",
      peerUserId: signalingClient.state.peers.find((p) => p.id === connection.peerId)?.userId ?? null,
      acc,
      movingPicture: false,
    });
    if (!this.timer) {
      this.timer = setInterval(() => {
        // One pass at a time: a slow one (a busy main thread, eight
        // connections read in sequence) must not have the next start on top
        // of it and read the same counters twice.
        if (this.passing) return;
        this.passing = true;
        void this.pass().finally(() => {
          this.passing = false;
        });
      }, POLL_MS);
    }
  }

  private async pass() {
    // A pc closed on a path that never unregistered it fires no event at all
    // (see connectionRegistry.list). Left here it would be reported at
    // pagehide, hours later, with that whole gap counted as its duration.
    for (const [pc] of [...this.sessions]) {
      if (pc.connectionState === "closed") this.close(pc, "close");
    }
    const stuck = [...this.sessions.values()].filter(
      (s) => s.acc.connectedAt === null && s.connection.pc.connectionState !== "connected"
    );
    for (const session of stuck.slice(0, MAX_STUCK_PER_PASS)) {
      const { pc } = session.connection;
      const report = await pc.getStats().catch(() => null);
      if (report && this.sessions.has(pc)) noteIceAttempt(session.acc, report.values() as Iterable<Record<string, unknown>>);
    }
    const live = [...this.sessions.values()].filter((s) => s.connection.pc.connectionState === "connected");
    if (live.length === 0) return;
    let visit = live;
    if (live.length > MAX_PER_PASS) {
      visit = [];
      for (let i = 0; i < MAX_PER_PASS; i += 1) visit.push(live[(this.cursor + i) % live.length]);
      this.cursor = (this.cursor + MAX_PER_PASS) % live.length;
    }
    for (const session of visit) {
      const snapshot = await this.sample(session.connection.pc);
      // Closed while awaiting: close() has already summarised it.
      if (!snapshot || !this.sessions.has(session.connection.pc)) continue;
      // What our quality controller is doing to this viewer, read beside the
      // encoder's own numbers (see SenderControlSample).
      const { connection } = session;
      const control = connection.direction === "send" ? senderQualityState(connection.pc) : null;
      if (control?.movingPicture) session.movingPicture = true;
      const visible =
        connection.direction === "recv" ? qualityNegotiator.isVisible(connection.channel, connection.peerId) : null;
      const paused =
        connection.direction === "send"
          ? control?.paused === true || nativeSinkPaused(connection.pc)
          : qualityNegotiator.isIdle(connection.channel, connection.peerId);
      addSnapshot(session.acc, snapshot, control, visible, paused);
      // Our decoder falling behind steps this tile's request down.
      if (snapshot.recv && snapshot.intervalSeconds > 0 && !paused) {
        qualityNegotiator.noteDecoderDrops(
          connection.channel,
          connection.peerId,
          snapshot.recv.dropShare,
          snapshot.recv.decodeLoad ?? null
        );
      }
    }
  }

  private close(pc: RTCPeerConnection, endedBy: "close" | "pagehide") {
    const session = this.sessions.get(pc);
    if (!session) return;
    this.sessions.delete(pc);
    if (this.sessions.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const report = this.buildReport(session, endedBy);
    if (!report) return;
    this.queue.push(report);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (endedBy === "close") this.scheduleFlush();
  }

  private buildReport(session: Session, endedBy: "close" | "pagehide"): ConnectionQualityReport | null {
    const { connection, acc } = session;
    const summary = summarize(acc, Date.now(), connection.direction, connection.channel);
    // Too short to be a stream, or never measured over an interval at all —
    // unless that is the finding: a tile that never got a picture.
    const noVideo = summary.causes.includes("no-video");
    if (summary.durationS < MIN_SESSION_S || (summary.kbpsAvg === null && !noVideo)) return null;
    const provider = acc.relayUrl ? turnProvider(acc.relayUrl) : null;
    // Before the sampling below: the experiment counts every session.
    this.countSendSession(summary, connection, session.movingPicture);
    if (!summary.bad && Math.random() >= QUALITY_SAMPLE_RATE) return null;
    const native = connection.direction === "send" ? nativeSinkStats(connection.pc) : null;

    const ownShare = connection.direction === "send";
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    return {
      ...summary,
      v: 1,
      roomId: session.roomId,
      channel: connection.channel,
      direction: connection.direction,
      selfPeerId: session.selfPeerId,
      peerId: connection.peerId,
      peerUserId: session.peerUserId,
      originId: connection.originId,
      startedAt: acc.startedAt,
      endedBy,
      forceRelay: getEffectiveForceRelayIce(),
      turnProvider: provider,
      experiments: experimentsTag(),
      nativeKeyHolds: native?.keyHolds ?? null,
      nativeKeyStale: native?.keyStale ?? null,
      nativeResyncs: native?.resyncs ?? null,
      // The dials as they stand now — see setTelemetryShareSettings. The
      // stored values only until useRoomMedia has said, with the defaults it
      // really uses.
      settings: ownShare
        ? (liveShareSettings ?? {
            resolution: getStoredShareResolution() ?? "1080p",
            fps: getStoredShareFps() ?? 30,
            bitrate: getStoredShareBitrate() ?? "high",
            profile: getStoredShareProfile() ?? defaultShareProfile(),
          })
        : null,
      device: {
        cores: nav?.hardwareConcurrency || null,
        memoryGb: (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory ?? null,
        browser: browserOf(nav?.userAgent ?? ""),
        app: isMobileApp() ? "android" : isDesktopApp() ? "desktop" : "web",
      },
    };
  }

  // See SEND_SESSION_EVENTS.
  private countSendSession(summary: SessionSummary, connection: RegisteredConnection, movingPicture: boolean) {
    if (connection.direction !== "send" || !connection.channel.startsWith("screen")) return;
    const height = summary.heightAvg ?? 0;
    // The GPU capture's stand-in track measures 16 px tall; nothing else does.
    if (height > 0 && height < 40) return;
    for (const feature of [NEW_SEND_FEATURE, H264_SEND_FEATURE]) {
      trackFeatureEvent(SEND_SESSION_EVENTS.session, { feature });
      trackFeatureEvent(SEND_SESSION_EVENTS.fps, { feature, value: summary.fpsAvg === null ? 0 : Math.round(summary.fpsAvg) });
      trackFeatureEvent(SEND_SESSION_EVENTS.height, { feature, value: height });
      if (summary.fpsAvg !== null && summary.fpsAvg < 10 && (summary.kbpsAvg ?? 0) >= 300) {
        trackFeatureEvent(SEND_SESSION_EVENTS.slideshow, { feature });
      }
      if ((summary.linkCapShare ?? 0) >= 0.1) trackFeatureEvent(SEND_SESSION_EVENTS.linkHeld, { feature });
      if ((summary.machineCapShare ?? 0) >= 0.1) trackFeatureEvent(SEND_SESSION_EVENTS.machineHeld, { feature });
      if ((summary.pausedShare ?? 0) >= 0.1) trackFeatureEvent(SEND_SESSION_EVENTS.paused, { feature });
      if (movingPicture) trackFeatureEvent(SEND_SESSION_EVENTS.movingPicture, { feature });
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  private endpoint() {
    return `${getSignalingHttpBase()}/telemetry/connection-quality`;
  }

  private async flush() {
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, MAX_BATCH);
      const token = getAccountToken() ?? getStoredGuestToken();
      try {
        const res = await fetch(this.endpoint(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ reports: batch }),
          keepalive: true,
        });
        // A 4xx will not get better by retrying; drop the batch. Anything
        // else (5xx, rate limit) stays queued for the next session's flush.
        if (!res.ok && (res.status >= 500 || res.status === 429)) return;
      } catch {
        return;
      }
      this.queue.splice(0, batch.length);
    }
  }

  private onPageHide() {
    for (const pc of [...this.sessions.keys()]) this.close(pc, "pagehide");
    if (this.queue.length === 0) return;
    // sendBeacon carries no Authorization header, so these arrive without an
    // account; they still count in every aggregate that is not per person.
    // text/plain keeps it a CORS "simple" request — no preflight to lose.
    const batch = this.queue.splice(0, MAX_BATCH);
    try {
      const body = new Blob([JSON.stringify({ reports: batch })], { type: "text/plain" });
      navigator.sendBeacon?.(this.endpoint(), body);
    } catch {
      // Nothing left to try on a page that is going away.
    }
  }
}

const telemetry = new ConnectionTelemetry();

/** Starts collecting. Idempotent; a no-op on the server and when disabled. */
export function startConnectionTelemetry() {
  telemetry.start();
}
