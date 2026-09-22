// The broadcaster's half of a connection report, delivered to the viewer.
//
// Whoever is looking at a bad picture is the viewer, but most of what explains
// it lives on the other machine: whether *their* encoder is in software,
// whether *their* CPU or uplink is what holds it back. A viewer cannot read
// another browser's getStats(), so while a viewer has the stats panel open it
// asks, and the sender answers every couple of seconds with its own reading of
// the connection to that one viewer.
//
// It rides the existing signalling relay, the same way quality requests do
// (see qualityNegotiation.ts): the server forwards a "signal" message's `data`
// untouched and only reads `data.kind` to label a metric, so neither kind below
// needed a backend change.
//
// It is deliberately request-driven with a short lease rather than always on.
// A request is renewed every REQUEST_EVERY_MS while the panel is open, and a
// sender that stops hearing renewals stops answering after LEASE_MS — so a
// viewer that closes the tab, loses its socket or simply closes the panel never
// leaves a broadcaster sampling getStats() on its behalf for the rest of the
// room.

import { signalingClient } from "./signalingClient";
import { connectionRegistry, createStatsSampler } from "./connectionRegistry";
import type { RouteInfo, SendVideoStats } from "./connectionDiagnostics";
import type { QualityChannel } from "./qualityNegotiation";

const REQUEST_EVERY_MS = 5000;
const REPLY_EVERY_MS = 2000;
const LEASE_MS = 10_000;
// A broadcaster answers at most this many viewers at once per channel. Each
// answer is a getStats() pass on the machine that is already the bottleneck in
// a mesh room; past a handful, whoever asked last simply gets no sender half.
const MAX_RESPONDERS = 8;

/** What the sender knows about its own side, beyond the connection itself. */
export interface SenderContext {
  /** Tier this viewer is being served at. */
  tier?: string;
  /** "text" | "balanced" | "motion". */
  profile?: string;
  /** The broadcaster's dials: capture height, frame rate, bitrate ceiling. */
  height?: number;
  frameRate?: number;
  maxBitrateKbps?: number;
}

export interface RemoteDiag extends SenderContext {
  send: SendVideoStats | null;
  route: RouteInfo | null;
  /** The sender is a relay re-encoding somebody else's stream. */
  relayed: boolean;
  cores: number | null;
  receivedAt: number;
}

type DiagListener = (diag: RemoteDiag) => void;

// Sender and origin both, because a relay can be sending one viewer two
// pictures on the same channel — its own share and somebody else's re-encoded
// (see connectionRegistry's originId).
function keyOf(channel: QualityChannel, senderId: string, originId: string) {
  return `${channel} ${senderId} ${originId}`;
}

function sanitize(raw: unknown): Omit<RemoteDiag, "receivedAt"> | null {
  // Anything in a room can send us a "diag"; it is only ever displayed, but it
  // still has to be the shape the panel expects before it gets there.
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : undefined);
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    send: r.send && typeof r.send === "object" ? (r.send as SendVideoStats) : null,
    route: r.route && typeof r.route === "object" ? (r.route as RouteInfo) : null,
    relayed: r.relayed === true,
    cores: count(r.cores) ?? null,
    tier: text(r.tier),
    profile: text(r.profile),
    height: count(r.height),
    frameRate: count(r.frameRate),
    maxBitrateKbps: count(r.maxBitrateKbps),
  };
}

class ConnectionDiagLink {
  // Viewer side.
  private listeners = new Map<string, Set<DiagListener>>();
  private requestTimers = new Map<string, ReturnType<typeof setInterval>>();
  private latest = new Map<string, RemoteDiag>();

  // Sender side.
  private responders = new Map<string, { expiresAt: number; timer: ReturnType<typeof setInterval> }>();
  private sample = createStatsSampler();

  /**
   * Viewer: receive the sender's half of the connection carrying `originId`'s
   * picture from `senderId`, for as long as the returned function has not been
   * called.
   */
  watch(
    channel: QualityChannel,
    senderId: string,
    originId: string,
    listener: DiagListener
  ): () => void {
    const key = keyOf(channel, senderId, originId);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    const cached = this.latest.get(key);
    if (cached) listener(cached);
    if (!this.requestTimers.has(key)) {
      const request = () =>
        signalingClient.sendSignal(senderId, { channel, role: "viewer", kind: "diag-request", originId });
      request();
      this.requestTimers.set(key, setInterval(request, REQUEST_EVERY_MS));
    }
    return () => {
      const current = this.listeners.get(key);
      current?.delete(listener);
      if (current && current.size > 0) return;
      this.listeners.delete(key);
      this.latest.delete(key);
      const timer = this.requestTimers.get(key);
      if (timer) clearInterval(timer);
      this.requestTimers.delete(key);
    };
  }

  /** Viewer: a "diag" about `originId`'s picture arrived from `from`. */
  accept(channel: QualityChannel, from: string, originId: string | undefined, raw: unknown) {
    const key = keyOf(channel, from, originId ?? from);
    const set = this.listeners.get(key);
    // Nobody asked — a late reply after the panel closed, or noise.
    if (!set || set.size === 0) return;
    const clean = sanitize(raw);
    if (!clean) return;
    const diag: RemoteDiag = { ...clean, receivedAt: Date.now() };
    this.latest.set(key, diag);
    for (const listener of set) listener(diag);
  }

  /**
   * Sender: `from` asked for our side of the connection carrying `originId`'s
   * picture to them. `context` is read on every reply, so it follows dial
   * changes; it describes our own share and is left out of a relayed one.
   */
  respond(
    channel: QualityChannel,
    from: string,
    originId: string | undefined,
    context: () => SenderContext
  ) {
    const selfId = signalingClient.state.selfId;
    // An older request names no origin; it can only mean our own share.
    const origin = originId ?? selfId ?? "";
    const lookupOrigin = origin === selfId ? null : origin;
    const key = keyOf(channel, from, origin);
    const expiresAt = Date.now() + LEASE_MS;
    const existing = this.responders.get(key);
    if (existing) {
      existing.expiresAt = expiresAt;
      return;
    }
    let active = 0;
    for (const k of this.responders.keys()) if (k.startsWith(`${channel} `)) active += 1;
    if (active >= MAX_RESPONDERS) return;
    // Only someone we are actually sending that picture to can be told anything.
    if (!connectionRegistry.findSend(channel, from, lookupOrigin)) return;

    const reply = async () => {
      const entry = this.responders.get(key);
      if (!entry) return;
      const connection = connectionRegistry.findSend(channel, from, lookupOrigin);
      if (Date.now() > entry.expiresAt || !connection) {
        this.stopResponding(key);
        return;
      }
      const snapshot = await this.sample(connection.pc);
      if (!snapshot || !this.responders.has(key)) return;
      signalingClient.sendSignal(from, {
        channel,
        role: "broadcaster",
        kind: "diag",
        originId: origin,
        diag: {
          send: snapshot.send,
          route: snapshot.route,
          relayed: connection.viaRelay,
          cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency || null : null,
          ...(connection.viaRelay ? {} : context()),
        },
      });
    };
    // One reply at a time: this runs on the broadcaster's machine, the one
    // already busy encoding, where a slow getStats is most likely.
    let busy = false;
    const run = () => {
      if (busy) return;
      busy = true;
      void reply().finally(() => {
        busy = false;
      });
    };
    this.responders.set(key, { expiresAt, timer: setInterval(run, REPLY_EVERY_MS) });
    run();
  }

  private stopResponding(key: string) {
    const entry = this.responders.get(key);
    if (entry) clearInterval(entry.timer);
    this.responders.delete(key);
  }
}

export const connectionDiagLink = new ConnectionDiagLink();
