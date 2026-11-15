"use client";

// "Controle remoto": somebody in the room drives the computer of somebody who
// shares their screen from the desktop app — with that person's say-so.
//
// Two sides, one module:
//
//   host        the person whose computer is controlled. Only on the Windows
//               app (golive.remoteControl). Takes requests when their switch
//               is on, or offers control to someone from the member menu.
//               Every session starts with a click in the shell's own window
//               (electron/remoteControl.ts) — this page can only ask for it.
//   controller  anybody with an account, on any platform with a mouse and
//               keyboard. Asks, or accepts an offer, then drives through the
//               host's screen tile (components/RemoteControlSurface.tsx).
//
// The server introduces them and tells the room who is controlling whom
// ("remote-control-*" messages, see the API's signaling.ts). The input itself
// goes peer to peer, over a data-only RTCPeerConnection negotiated through
// the ordinary signal relay with `channel: "remote-control"` — the media
// channels ignore it, since each one only reads its own channel. Separate from
// the screen's connection so it never renegotiates media, and peer to peer so
// a mouse move costs no server anything and arrives as fast as the picture
// does: if the video gets through, so does this.
//
// Two data channels on that connection:
//   rc-pointer  unordered, no retransmits. Pointer moves only, numbered; the
//               host drops anything older than what it already applied. A lost
//               move is replaced by the next one 16 ms later, so waiting for a
//               retransmit would only ever add lag.
//   rc-input    reliable and ordered. Buttons, wheel, keys and pings. Every
//               button event carries its own position, so a click lands where
//               it was made whatever happened to the moves around it.
//
// The host accepts a connection only from the connection id it said yes to —
// the id the server stamps on every relayed signal, which nobody can forge.
// When that person drops and comes back (a new connection id, the same
// account) within RESUME_MS, the host takes their new connection without
// asking again; anybody else is ignored.

import { useEffect, useSyncExternalStore } from "react";
import {
  getDesktopBridge,
  type RemoteControlConsent,
  type RemoteControlInputEvent,
  type RemoteControlShellEvent,
} from "./desktop";
import { connectionRegistry } from "./connectionRegistry";
import { trackFeatureEvent } from "./features";
import { iceConfigFor } from "./iceConfig";
import { signalingClient, type PeerInfo } from "./signalingClient";
import {
  BLOCKED_WHY,
  CURSORS,
  T_BLOCKED,
  T_BYE,
  T_CURSOR,
  T_LOCAL,
  T_READY,
  T_ZONE,
  ZONES,
  decode,
  encodeButton,
  encodeKey,
  encodeMove,
  encodePing,
  encodePong,
  encodeSimple,
  encodeWheel,
  newer,
  type RemoteControlBlocked,
  type RemoteControlCursor,
  type RemoteControlZone,
} from "./remoteControlWire";

export type { RemoteControlBlocked, RemoteControlCursor, RemoteControlZone };

export const REMOTE_CONTROL_FEATURE = "remote-control";

/** Usage stats. Each name has to be in the feature's "site events" to count. */
export const REMOTE_CONTROL_EVENTS = {
  openOn: "rc_open_on",
  openOff: "rc_open_off",
  request: "rc_request",
  offer: "rc_offer",
  granted: "rc_granted",
  declined: "rc_declined",
  resume: "rc_resume",
  sessionEnd: "rc_session_end", // value: seconds
  stopHotkey: "rc_stop_hotkey",
  stopSharer: "rc_stop_sharer",
  stopViewer: "rc_stop_viewer",
  helperFail: "rc_helper_fail",
  shortcut: "rc_shortcut", // a Windows shortcut sent from the bar's menu
  fullscreen: "rc_fullscreen", // the bar's fullscreen button
  dockClick: "rc_dock_click", // the button in the room's bottom bar
  block: "rc_block", // "Bloquear" in the prompt or the member menu
} as const;

// ---------------------------------------------------------------------------
// Blocks: people this person does not take requests from, for an hour or for
// good. Kept on this computer (the one that would be controlled), per
// account. A blocked request is answered "closed" without asking anybody —
// the same answer as a switch that is off, so the block is never announced.

const BLOCKS_KEY = "golive:remoteControl:blocks";
const BLOCK_HOUR_MS = 60 * 60_000;

/** userId -> when the block ends (0: never), and the name it had. */
type Blocks = Record<string, { until: number; name: string | null }>;

const blockListeners = new Set<() => void>();
// Bumped on every change, so the hook below re-reads.
let blocksVersion = 0;

function blocksOwner(): string {
  return signalingClient.state.selfUserId ?? "";
}

function readAllBlocks(): Record<string, Blocks> {
  try {
    const all = JSON.parse(window.localStorage.getItem(BLOCKS_KEY) ?? "{}") as unknown;
    return all && typeof all === "object" ? (all as Record<string, Blocks>) : {};
  } catch {
    return {};
  }
}

function readBlocks(): Blocks {
  const mine = readAllBlocks()[blocksOwner()];
  return mine && typeof mine === "object" ? mine : {};
}

function writeBlocks(blocks: Blocks) {
  const all = readAllBlocks();
  // Expired hour-long ones go whenever anything is written.
  const now = Date.now();
  for (const [id, entry] of Object.entries(blocks)) {
    if (!entry || typeof entry.until !== "number" || (entry.until !== 0 && entry.until <= now)) delete blocks[id];
  }
  all[blocksOwner()] = blocks;
  try {
    window.localStorage.setItem(BLOCKS_KEY, JSON.stringify(all));
  } catch {
    // No storage: the block lasts as long as nothing — said in the menu by
    // it simply not showing as blocked.
  }
  blocksVersion += 1;
  for (const listener of blockListeners) listener();
}

export function isRemoteControlBlocked(userId: string): boolean {
  const entry = readBlocks()[userId];
  return Boolean(entry && typeof entry.until === "number" && (entry.until === 0 || entry.until > Date.now()));
}

/** "Bloquear pedidos de controle": for an hour, or until unblocked. */
export function blockRemoteControl(userId: string, name: string | null, length: "hour" | "forever") {
  if (!userId) return;
  const blocks = readBlocks();
  blocks[userId] = { until: length === "hour" ? Date.now() + BLOCK_HOUR_MS : 0, name };
  writeBlocks(blocks);
}

export function unblockRemoteControl(userId: string) {
  const blocks = readBlocks();
  if (!(userId in blocks)) return;
  delete blocks[userId];
  writeBlocks(blocks);
}

/** Whether `userId` is blocked from asking, kept current — for the member menu. */
export function useRemoteControlBlocked(userId: string | null | undefined): boolean {
  const version = useSyncExternalStore(
    (onChange) => {
      blockListeners.add(onChange);
      return () => {
        blockListeners.delete(onChange);
      };
    },
    () => blocksVersion,
    () => 0
  );
  // `version` is what makes this re-read after a change; an hour-long block
  // running out is picked up the next time the menu draws.
  return version >= 0 && userId ? isRemoteControlBlocked(userId) : false;
}

const CHANNEL = "remote-control";
const RESUME_MS = 20_000;
/** The host holds input when it has heard nothing for this long. */
const SILENCE_MS = 4000;
const PING_MS = 1000;
/** How long the controller waits for the host to answer a request. */
const ANSWER_TIMEOUT_MS = 45_000;
/** How long the host waits for the controller's connection after a yes. */
const CONNECT_TIMEOUT_MS = 40_000;

// ---------------------------------------------------------------------------
// Shared bits

function peerById(id: string): PeerInfo | undefined {
  return signalingClient.state.peers.find((p) => p.id === id);
}

function sendSignal(to: string, data: Record<string, unknown>) {
  signalingClient.sendSignal(to, { channel: CHANNEL, ...data });
}

function closePc(pc: RTCPeerConnection | null) {
  if (!pc) return;
  try {
    pc.close();
  } catch {
    // Already closed.
  }
}

/** Candidates that arrive before the description they belong to wait here. */
async function addCandidate(pc: RTCPeerConnection, queue: RTCIceCandidateInit[], candidate: unknown) {
  if (!candidate || typeof candidate !== "object") return;
  const init = candidate as RTCIceCandidateInit;
  if (!pc.remoteDescription) {
    queue.push(init);
    return;
  }
  try {
    await pc.addIceCandidate(init);
  } catch {
    // A stale candidate is not worth failing over.
  }
}

async function flushCandidates(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
  const pending = queue.splice(0);
  for (const candidate of pending) {
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      // As above.
    }
  }
}

// ---------------------------------------------------------------------------
// Settings the room hands in (see useRemoteControl)

let room: string | null = null;
let forceRelay = false;
let lang: "pt" | "en" | "es" = "pt";
/** The feature is on for this room and the person has an account. */
let featureOn = false;
/** This page can be controlled: the feature, the app's bridge, an account. */
let hostCapable = false;
/** The host's own switch: take requests. */
let hostOpen = false;
/** The host is sharing a screen right now. */
let hostSharing = false;

function track(name: string, value?: number) {
  trackFeatureEvent(name, { room, feature: REMOTE_CONTROL_FEATURE, ...(value ? { value } : {}) });
}

/** For the UI's own events (REMOTE_CONTROL_EVENTS): counted against this room, like the rest. */
export function trackRemoteControlEvent(name: string) {
  track(name);
}

// ---------------------------------------------------------------------------
// Store for the UI

export type HostPhase = "consent" | "waiting" | "active" | "paused";
export type ControllerPhase = "requesting" | "offered" | "connecting" | "active" | "reconnecting";

export interface RemoteControlSnapshot {
  /** The feature is on in this room (see useRemoteControl). */
  enabled: boolean;
  host: { phase: HostPhase; peerId: string; name: string | null } | null;
  controller: {
    phase: ControllerPhase;
    hostId: string;
    hostName: string | null;
    /** The person at the computer moved their mouse a moment ago. */
    localActive: boolean;
    /** The last thing the host dropped, and when — for a short hint. */
    blocked: { why: RemoteControlBlocked; at: number } | null;
    /** The remote pointer's shape — this side's pointer takes it (see RemoteControlTile). */
    cursor: RemoteControlCursor;
    /** What is under the remote pointer; anything but "ok" draws the "no entry" pointer. */
    zone: RemoteControlZone;
    /** Round trip of the input connection, in ms; null until measured (or an older host). */
    rtt: number | null;
  } | null;
  /** A short message for the room to show once (refused, ended...). */
  notice: { key: string; name: string | null; at: number; seconds?: number } | null;
}

let snapshot: RemoteControlSnapshot = { enabled: false, host: null, controller: null, notice: null };
const listeners = new Set<() => void>();

function publish(next: Partial<RemoteControlSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

const NOTICE_MS = 6000;
const BLOCKED_HINT_MS = 4000;

/** A short message for the room; it clears itself. */
function notice(key: string, name: string | null, seconds?: number) {
  const next = { key, name, at: Date.now(), ...(seconds ? { seconds } : {}) };
  publish({ notice: next });
  setTimeout(() => {
    if (snapshot.notice === next) publish({ notice: null });
  }, NOTICE_MS);
}

const drivingListeners = new Set<(hostId: string) => void>();

/**
 * Told once each time this page starts driving somebody's computer — the room
 * brings that screen to the front (see WatchRoom). Returns an unsubscribe.
 */
export function onRemoteControlDriving(listener: (hostId: string) => void): () => void {
  drivingListeners.add(listener);
  return () => {
    drivingListeners.delete(listener);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_SNAPSHOT: RemoteControlSnapshot = { enabled: false, host: null, controller: null, notice: null };

export function useRemoteControlState(): RemoteControlSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}

// ---------------------------------------------------------------------------
// Host

interface HostSession {
  peerId: string;
  userId: string;
  name: string | null;
  kind: "request" | "offer";
  startedAt: number;
  pc: RTCPeerConnection | null;
  input: RTCDataChannel | null;
  candidates: RTCIceCandidateInit[];
  lastSeq: number;
  lastHeardAt: number;
  /** Input held: nothing heard for a while, or their connection is gone. */
  paused: boolean;
  pausedSince: number;
  /** Their connection id left the room; a new one with the same account may take over. */
  awaitingResume: boolean;
  announced: boolean;
  connectTimer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setInterval>;
  queue: RemoteControlInputEvent[];
  flushScheduled: boolean;
  /** The pointer's shape and the zone under it, as the helper last said (index, -1 unknown) — told again on a new connection. */
  cursor: number;
  zone: number;
}

let host: HostSession | null = null;
let hostConsent = false;
let unsubscribeShell: (() => void) | null = null;

function publishHost() {
  if (!host) {
    publish({ host: hostConsent ? snapshot.host : null });
    return;
  }
  const phase: HostPhase = !host.input || host.input.readyState !== "open"
    ? "waiting"
    : host.paused
      ? "paused"
      : "active";
  publish({ host: { phase, peerId: host.peerId, name: host.name } });
}

function hostSend(buffer: ArrayBuffer) {
  const channel = host?.input;
  if (channel && channel.readyState === "open") {
    try {
      channel.send(buffer);
    } catch {
      // Closing; the session notices on its own.
    }
  }
}

function hostQueue(event: RemoteControlInputEvent) {
  const active = host;
  if (!active || active.paused) return;
  // Only the newest move is worth sending.
  if (event.t === "m") {
    const last = active.queue[active.queue.length - 1];
    if (last && last.t === "m") active.queue.pop();
  }
  active.queue.push(event);
  if (active.flushScheduled) return;
  active.flushScheduled = true;
  queueMicrotask(() => {
    if (host !== active) return;
    active.flushScheduled = false;
    const batch = active.queue.splice(0);
    if (batch.length) getDesktopBridge()?.remoteControl?.input(batch);
  });
}

function hostSetPaused(paused: boolean) {
  const active = host;
  if (!active || active.paused === paused) return;
  active.paused = paused;
  active.pausedSince = paused ? Date.now() : 0;
  active.queue.length = 0;
  getDesktopBridge()?.remoteControl?.pause(paused);
  publishHost();
}

function hostAnnounce(controllerId: string | null) {
  signalingClient.sendMessage({ type: "remote-control-state", controller: controllerId });
}

function hostOnMessage(raw: unknown) {
  const active = host;
  if (!active) return;
  const event = decode(raw);
  if (!event) return;
  active.lastHeardAt = Date.now();
  if (active.paused) hostSetPaused(false);
  switch (event.t) {
    case "move":
      if (active.lastSeq >= 0 && !newer(event.seq, active.lastSeq)) return;
      active.lastSeq = event.seq;
      hostQueue({ t: "m", x: event.x, y: event.y });
      return;
    case "button":
      hostQueue({ t: "b", b: event.b, d: event.d, x: event.x, y: event.y });
      return;
    case "wheel":
      hostQueue({ t: "w", dx: event.dx, dy: event.dy });
      return;
    case "key":
      hostQueue({ t: "k", c: event.c, d: event.d });
      return;
    case "ping":
      // A stamped ping is the other side measuring the round trip.
      if (event.stamp !== null) hostSend(encodePong(event.stamp));
      return;
    case "bye":
      endHost("viewer");
      return;
    default:
      return;
  }
}

function hostAttachChannel(active: HostSession, channel: RTCDataChannel) {
  channel.binaryType = "arraybuffer";
  channel.onmessage = (event) => {
    if (host === active) hostOnMessage(event.data);
  };
  if (channel.label === "rc-input") {
    active.input = channel;
    const opened = () => {
      if (host !== active) return;
      active.awaitingResume = false;
      active.lastHeardAt = Date.now();
      hostSetPaused(false);
      if (active.connectTimer) clearTimeout(active.connectTimer);
      active.connectTimer = null;
      hostSend(encodeSimple(T_READY));
      // A new connection starts knowing nothing: tell it the pointer's shape
      // and what is under it, which the helper only reports when they change.
      if (active.cursor >= 0) hostSend(encodeSimple(T_CURSOR, active.cursor));
      if (active.zone >= 0) hostSend(encodeSimple(T_ZONE, active.zone));
      // Told to the room once the connection is really up: before that,
      // nobody is controlling anything.
      hostAnnounce(active.peerId);
      active.announced = true;
      publishHost();
    };
    if (channel.readyState === "open") opened();
    else channel.onopen = opened;
    channel.onclose = () => {
      if (host === active && active.input === channel) hostSetPaused(true);
    };
  }
}

async function hostOnOffer(from: string, sdp: unknown) {
  const active = host;
  if (!active || typeof sdp !== "string") return;
  if (from !== active.peerId) {
    // A different connection: only the same account, coming back. Not only
    // after their old id left — the server holds a dropped connection for a
    // few seconds (see the API's departureHold), so a reload's new connection
    // usually knocks before the old one is gone. What matters is that the
    // current one is not carrying anything.
    const peer = peerById(from);
    const idle = active.awaitingResume || active.paused || !active.input || active.input.readyState !== "open";
    if (!idle || !peer || peer.isGuest || peer.userId !== active.userId) return;
    active.peerId = from;
    active.awaitingResume = false;
    track(REMOTE_CONTROL_EVENTS.resume);
  }
  closePc(active.pc);
  active.input = null;
  active.lastSeq = -1;
  active.candidates = [];
  const pc = new RTCPeerConnection(iceConfigFor(forceRelay));
  active.pc = pc;
  pc.onicecandidate = (event) => {
    if (event.candidate && host === active && active.pc === pc) {
      sendSignal(active.peerId, { kind: "ice", candidate: event.candidate.toJSON() });
    }
  };
  pc.ondatachannel = (event) => {
    if (host === active && active.pc === pc) hostAttachChannel(active, event.channel);
  };
  pc.onconnectionstatechange = () => {
    if (host !== active || active.pc !== pc) return;
    if (pc.connectionState === "failed" || pc.connectionState === "closed") hostSetPaused(true);
  };
  try {
    await pc.setRemoteDescription({ type: "offer", sdp });
    await flushCandidates(pc, active.candidates);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (host === active && active.pc === pc) sendSignal(active.peerId, { kind: "answer", sdp: answer.sdp });
  } catch {
    if (host === active && active.pc === pc) hostSetPaused(true);
  }
}

function hostOnSignal(from: string, data: Record<string, unknown>) {
  const active = host;
  if (!active) return;
  if (data.kind === "peer-left") {
    if (from !== active.peerId) return;
    // Their connection id is gone. The data channel may well still be up — it
    // does not go through the server — and then nothing changes until they
    // come back with a new id. Either way, a new connection from the same
    // account is now welcome.
    active.awaitingResume = true;
    if (!active.input || active.input.readyState !== "open") hostSetPaused(true);
    return;
  }
  if (data.channel !== CHANNEL) return;
  if (data.kind === "offer") {
    void hostOnOffer(from, data.sdp);
    return;
  }
  if (from !== active.peerId) return;
  if (data.kind === "ice" && active.pc) void addCandidate(active.pc, active.candidates, data.candidate);
  else if (data.kind === "bye") endHost("viewer");
}

function hostWatchdog() {
  const active = host;
  if (!active || !active.input) return;
  const now = Date.now();
  if (!active.paused && now - active.lastHeardAt > SILENCE_MS) hostSetPaused(true);
  if (active.paused && active.pausedSince && now - active.pausedSince > RESUME_MS) endHost("lost");
}

function shellEvent(event: RemoteControlShellEvent) {
  if (event.type === "key") {
    // Not about hosting at all: this page controls someone, and the shell
    // kept a system shortcut from this computer for it (see setRemoteKeyGrab).
    controllerShellKey(event.code, event.down);
    return;
  }
  hostShellEvent(event);
}

function hostShellEvent(event: RemoteControlShellEvent) {
  if (event.type === "local") {
    hostSend(encodeSimple(T_LOCAL));
    return;
  }
  if (event.type === "blocked") {
    hostSend(encodeSimple(T_BLOCKED, BLOCKED_WHY.indexOf(event.why)));
    return;
  }
  if (event.type === "cursor") {
    const index = CURSORS.indexOf(event.shape as RemoteControlCursor);
    if (!host || index < 0) return;
    host.cursor = index;
    hostSend(encodeSimple(T_CURSOR, index));
    return;
  }
  if (event.type === "zone") {
    const index = ZONES.indexOf(event.zone);
    if (!host || index < 0) return;
    host.zone = index;
    hostSend(encodeSimple(T_ZONE, index));
    return;
  }
  if (event.type !== "ended") return;
  // The shell ended it: the banner, the tray, the hotkey, the helper...
  if (!host) return;
  const reason =
    event.reason === "hotkey"
      ? "hotkey"
      : event.reason === "banner" || event.reason === "tray"
        ? "sharer"
        : event.reason === "helper"
          ? "helper"
          : "shell";
  endHost(reason, { shellEnded: true });
}

type HostEndReason = "sharer" | "viewer" | "hotkey" | "helper" | "lost" | "shell" | "declined" | "timeout";

function endHost(reason: HostEndReason, options: { shellEnded?: boolean } = {}) {
  const active = host;
  if (!active) return;
  host = null;
  clearInterval(active.watchdog);
  if (active.connectTimer) clearTimeout(active.connectTimer);
  if (!options.shellEnded) getDesktopBridge()?.remoteControl?.stop();
  hostSend(encodeSimple(T_BYE));
  sendSignal(active.peerId, { kind: "bye" });
  // Let the bye leave before the channel goes.
  const pc = active.pc;
  setTimeout(() => closePc(pc), 250);
  if (active.announced) hostAnnounce(null);
  if (active.announced) track(REMOTE_CONTROL_EVENTS.sessionEnd, Math.max(1, Math.round((Date.now() - active.startedAt) / 1000)));
  if (reason === "hotkey") track(REMOTE_CONTROL_EVENTS.stopHotkey);
  else if (reason === "sharer") track(REMOTE_CONTROL_EVENTS.stopSharer);
  else if (reason === "helper") track(REMOTE_CONTROL_EVENTS.helperFail);
  publish({ host: null });
}

function startHostSession(peerId: string, userId: string, name: string | null, kind: "request" | "offer") {
  const now = Date.now();
  const active: HostSession = {
    peerId,
    userId,
    name,
    kind,
    startedAt: now,
    pc: null,
    input: null,
    candidates: [],
    lastSeq: -1,
    lastHeardAt: now,
    paused: false,
    pausedSince: 0,
    awaitingResume: false,
    announced: false,
    connectTimer: null,
    watchdog: setInterval(hostWatchdog, 1000),
    queue: [],
    flushScheduled: false,
    cursor: -1,
    zone: -1,
  };
  active.connectTimer = setTimeout(() => {
    if (host === active && !active.input) endHost("timeout");
  }, CONNECT_TIMEOUT_MS);
  host = active;
  publishHost();
}

async function askShell(
  kind: "request" | "offer",
  peer: { name: string | null; avatar: string | null; handle?: string | null }
): Promise<RemoteControlConsent | null> {
  const bridge = getDesktopBridge()?.remoteControl;
  if (!bridge) return null;
  hostConsent = true;
  publish({ host: { phase: "consent", peerId: "", name: peer.name } });
  try {
    return await bridge.request({
      kind,
      name: peer.name || "?",
      avatar: peer.avatar ?? undefined,
      // Shown as @username under the name: a display name and a picture are
      // easy to copy, the username is not (it comes from the server).
      handle: peer.handle ?? undefined,
      lang,
    });
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    hostConsent = false;
    if (!host) publish({ host: null });
  }
}

async function hostOnRequest(msg: Record<string, unknown>) {
  const from = typeof msg.from === "string" ? msg.from : "";
  const userId = typeof msg.fromUserId === "string" ? msg.fromUserId : "";
  const name = typeof msg.fromName === "string" ? msg.fromName : null;
  const avatar = typeof msg.fromAvatar === "string" ? msg.fromAvatar : null;
  const handle = typeof msg.fromHandle === "string" ? msg.fromHandle : null;
  if (!from || !userId) return;
  const answer = (ok: boolean, reason?: string) =>
    signalingClient.sendMessage({ type: "remote-control-answer", to: from, ok, ...(reason ? { reason } : {}) });
  if (!hostCapable || !hostOpen || !hostSharing) return answer(false, "closed");
  // Somebody this person blocked: answered like a closed door, so the block
  // is not something the other side gets told about.
  if (isRemoteControlBlocked(userId)) return answer(false, "closed");
  if (host || hostConsent) return answer(false, "busy");
  const result = await askShell("request", { name, avatar, handle });
  if (!result) return answer(false, "closed");
  if (!result.ok) {
    if (result.block) {
      blockRemoteControl(userId, name, result.block);
      track(REMOTE_CONTROL_EVENTS.block);
    }
    if (result.reason === "declined" || result.reason === "timeout") track(REMOTE_CONTROL_EVENTS.declined);
    if (result.reason === "failed") track(REMOTE_CONTROL_EVENTS.helperFail);
    return answer(false, result.reason === "timeout" ? "timeout" : result.reason === "declined" ? "declined" : "unavailable");
  }
  // Still here, still sharing? The prompt took a while.
  if (!peerById(from) || !hostSharing) {
    getDesktopBridge()?.remoteControl?.stop();
    return answer(false, "unavailable");
  }
  track(REMOTE_CONTROL_EVENTS.granted);
  startHostSession(from, userId, name, "request");
  answer(true);
}

/** "Dar controle do meu PC", from the member menu. */
export async function offerRemoteControl(peer: PeerInfo): Promise<void> {
  if (!hostCapable || !hostSharing || host || hostConsent) return;
  if (!peer.userId || peer.isGuest) return;
  track(REMOTE_CONTROL_EVENTS.offer);
  const result = await askShell("offer", { name: peer.name, avatar: peer.avatarUrl ?? null });
  if (!result?.ok) {
    if (result?.reason === "failed") track(REMOTE_CONTROL_EVENTS.helperFail);
    return;
  }
  if (!peerById(peer.id) || !hostSharing) {
    getDesktopBridge()?.remoteControl?.stop();
    return;
  }
  track(REMOTE_CONTROL_EVENTS.granted);
  startHostSession(peer.id, peer.userId, peer.name, "offer");
  signalingClient.sendMessage({ type: "remote-control-offer", to: peer.id });
}

/** The host's own "Parar", from the page. */
export function stopHostingRemoteControl() {
  endHost("sharer");
}

// ---------------------------------------------------------------------------
// Controller

interface ControllerSession {
  hostId: string;
  hostUserId: string;
  hostName: string | null;
  phase: ControllerPhase;
  pc: RTCPeerConnection | null;
  pointer: RTCDataChannel | null;
  input: RTCDataChannel | null;
  candidates: RTCIceCandidateInit[];
  seq: number;
  pingTimer: ReturnType<typeof setInterval> | null;
  answerTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  lostSince: number;
  localUntil: number;
  blocked: { why: RemoteControlBlocked; at: number } | null;
  /** Keys this side pressed and has not released — let go of on blur and at the end. */
  keysDown: Set<string>;
  buttonsDown: Set<number>;
  cursor: RemoteControlCursor;
  zone: RemoteControlZone;
  rtt: number | null;
  /** The host's picture is set to play with no added delay (see setLowLatency). */
  lowLatency: boolean;
}

let controller: ControllerSession | null = null;
/** The surface has the keyboard and the shell was asked to grab system shortcuts. */
let keyGrab = false;
// Kept across a reload of this page, so a session survives one: a fresh page
// that finds this, fresh enough, connects again without a new request — and
// the host lets it, being the same account (see hostOnOffer).
const RESUME_KEY = "golive:remoteControl:controller";

function publishController() {
  const active = controller;
  publish({
    controller: active
      ? {
          phase: active.phase,
          hostId: active.hostId,
          hostName: active.hostName,
          localActive: Date.now() < active.localUntil,
          blocked: active.blocked,
          cursor: active.cursor,
          zone: active.zone,
          rtt: active.rtt,
        }
      : null,
  });
}

// The room plays every screen a tenth of a second late on purpose, to ride
// out jitter (see useRoomMedia's playoutDelayHint). Watching, nobody notices;
// driving, it is a tenth of a second between moving the mouse and seeing it
// move, on top of everything else. While this page drives a screen, that
// screen plays as soon as frames arrive; back to normal when it stops.
const WATCH_PLAYOUT_DELAY_S = 0.1;

type TunableReceiver = RTCRtpReceiver & { playoutDelayHint?: number | null; jitterBufferTarget?: number | null };

function setLowLatency(hostId: string, on: boolean) {
  const entry = connectionRegistry.findRecvByOrigin("screen", hostId);
  if (!entry) return;
  for (const receiver of entry.pc.getReceivers() as TunableReceiver[]) {
    if (receiver.track?.kind !== "video") continue;
    try {
      if ("playoutDelayHint" in receiver) receiver.playoutDelayHint = on ? 0 : WATCH_PLAYOUT_DELAY_S;
      if ("jitterBufferTarget" in receiver) receiver.jitterBufferTarget = on ? 0 : null;
    } catch {
      // Not supported here; the default stays.
    }
  }
}

function rememberController(active: ControllerSession | null) {
  try {
    if (active && active.phase === "active") {
      window.sessionStorage.setItem(
        RESUME_KEY,
        JSON.stringify({ room, hostUserId: active.hostUserId, at: Date.now() })
      );
    } else if (!active) {
      window.sessionStorage.removeItem(RESUME_KEY);
    }
  } catch {
    // No storage: a reload simply ends the session.
  }
}

function controllerSend(buffer: ArrayBuffer, pointer = false) {
  const active = controller;
  const channel = pointer ? active?.pointer : active?.input;
  if (!channel || channel.readyState !== "open") return;
  // A congested channel drops moves rather than queueing them up behind.
  if (pointer && channel.bufferedAmount > 1024) return;
  try {
    channel.send(buffer);
  } catch {
    // Closing.
  }
}

function controllerOnMessage(raw: unknown) {
  const active = controller;
  if (!active) return;
  const event = decode(raw);
  if (!event) return;
  switch (event.t) {
    case "ready":
      if (active.phase !== "active") {
        const first = active.phase !== "reconnecting";
        active.phase = "active";
        active.lostSince = 0;
        rememberController(active);
        setLowLatency(active.hostId, true);
        active.lowLatency = true;
        publishController();
        if (first) for (const listener of drivingListeners) listener(active.hostId);
      }
      return;
    case "pong": {
      const sample = (Math.round(performance.now()) - event.stamp) >>> 0;
      // A stamp from before a page reload, or simply nonsense: not a round trip.
      if (sample > 60_000) return;
      active.rtt = active.rtt === null ? sample : Math.round(active.rtt * 0.6 + sample * 0.4);
      publishController();
      return;
    }
    case "cursor":
      if (active.cursor === event.shape) return;
      active.cursor = event.shape;
      publishController();
      return;
    case "zone":
      if (active.zone === event.zone) return;
      active.zone = event.zone;
      publishController();
      return;
    case "local":
      active.localUntil = Date.now() + 1500;
      publishController();
      setTimeout(() => {
        if (controller === active) publishController();
      }, 1600);
      return;
    case "blocked": {
      const blocked = { why: event.why, at: Date.now() };
      active.blocked = blocked;
      publishController();
      setTimeout(() => {
        if (controller === active && active.blocked === blocked) {
          active.blocked = null;
          publishController();
        }
      }, BLOCKED_HINT_MS);
      return;
    }
    case "bye":
      endController("host");
      return;
    default:
      return;
  }
}

async function controllerConnect(active: ControllerSession) {
  closePc(active.pc);
  active.candidates = [];
  const pc = new RTCPeerConnection(iceConfigFor(forceRelay));
  active.pc = pc;
  const pointer = pc.createDataChannel("rc-pointer", { ordered: false, maxRetransmits: 0 });
  const input = pc.createDataChannel("rc-input");
  for (const channel of [pointer, input]) {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => {
      if (controller === active && active.pc === pc) controllerOnMessage(event.data);
    };
  }
  active.pointer = pointer;
  active.input = input;
  input.onclose = () => {
    if (controller === active && active.pc === pc) controllerLost(active);
  };
  pc.onicecandidate = (event) => {
    if (event.candidate && controller === active && active.pc === pc) {
      sendSignal(active.hostId, { kind: "ice", candidate: event.candidate.toJSON() });
    }
  };
  pc.onconnectionstatechange = () => {
    if (controller !== active || active.pc !== pc) return;
    if (pc.connectionState === "failed") controllerLost(active);
  };
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (controller === active && active.pc === pc) sendSignal(active.hostId, { kind: "offer", sdp: offer.sdp });
  } catch {
    if (controller === active) controllerLost(active);
    return;
  }
  // An answer that never comes is a failure too, and only a reconnecting
  // session retries: a first connection has the host's own timeout.
  setTimeout(() => {
    if (controller === active && active.pc === pc && active.phase === "reconnecting") controllerLost(active);
  }, 6000);
}

function controllerLost(active: ControllerSession) {
  if (controller !== active) return;
  releaseHeld(active);
  if (!active.lostSince) active.lostSince = Date.now();
  if (Date.now() - active.lostSince > RESUME_MS) {
    endController("lost");
    return;
  }
  active.phase = "reconnecting";
  publishController();
  if (active.reconnectTimer) return;
  active.reconnectTimer = setTimeout(() => {
    active.reconnectTimer = null;
    if (controller !== active) return;
    // The host may be on a new connection id by now (same account).
    const hostPeer = signalingClient.state.peers.find((p) => p.userId === active.hostUserId && p.screen);
    if (hostPeer) active.hostId = hostPeer.id;
    void controllerConnect(active);
  }, 1500);
}

function controllerOnSignal(from: string, data: Record<string, unknown>) {
  const active = controller;
  if (!active) return;
  if (data.kind === "peer-left") {
    if (from === active.hostId && active.phase !== "active") endController("host");
    return;
  }
  if (data.channel !== CHANNEL || from !== active.hostId) return;
  const pc = active.pc;
  if (data.kind === "answer" && pc && typeof data.sdp === "string") {
    void pc
      .setRemoteDescription({ type: "answer", sdp: data.sdp })
      .then(() => flushCandidates(pc, active.candidates))
      .catch(() => controllerLost(active));
  } else if (data.kind === "ice" && pc) {
    void addCandidate(pc, active.candidates, data.candidate);
  } else if (data.kind === "bye") {
    endController("host");
  }
}

function releaseHeld(active: ControllerSession) {
  for (const code of active.keysDown) {
    const buffer = encodeKey(code, false);
    if (buffer) controllerSend(buffer);
  }
  active.keysDown.clear();
  for (const button of active.buttonsDown) controllerSend(encodeButton(button, false, 0, 0));
  active.buttonsDown.clear();
}

type ControllerEndReason = "viewer" | "host" | "lost" | "declined" | "timeout" | "unavailable";

function endController(reason: ControllerEndReason) {
  const active = controller;
  if (!active) return;
  releaseHeld(active);
  controller = null;
  setRemoteKeyGrab(false);
  if (active.lowLatency) setLowLatency(active.hostId, false);
  if (active.pingTimer) clearInterval(active.pingTimer);
  if (active.answerTimer) clearTimeout(active.answerTimer);
  if (active.reconnectTimer) clearTimeout(active.reconnectTimer);
  if (reason === "viewer") {
    controllerSend(encodeSimple(T_BYE));
    sendSignal(active.hostId, { kind: "bye" });
    track(REMOTE_CONTROL_EVENTS.stopViewer);
  }
  const pc = active.pc;
  // Swap the reference out first so the channel's close is not read as "lost".
  active.pc = null;
  setTimeout(() => closePc(pc), 250);
  rememberController(null);
  publish({ controller: null });
  if (reason !== "viewer") notice(`end.${reason}`, active.hostName);
}

function newController(hostId: string, hostUserId: string, hostName: string | null, phase: ControllerPhase) {
  const active: ControllerSession = {
    hostId,
    hostUserId,
    hostName,
    phase,
    pc: null,
    pointer: null,
    input: null,
    candidates: [],
    seq: 0,
    pingTimer: null,
    answerTimer: null,
    reconnectTimer: null,
    lostSince: 0,
    localUntil: 0,
    blocked: null,
    keysDown: new Set(),
    buttonsDown: new Set(),
    cursor: "default",
    zone: "ok",
    rtt: null,
    lowLatency: false,
  };
  // Stamped, so the host answers and the bar can show the round trip.
  active.pingTimer = setInterval(() => {
    if (controller === active) controllerSend(encodePing(Math.round(performance.now())));
  }, PING_MS);
  controller = active;
  publishController();
  return active;
}

/** "Pedir controle", on the host's screen tile. */
export function requestRemoteControl(peer: PeerInfo) {
  if (!featureOn || controller || !peer.userId) return;
  const active = newController(peer.id, peer.userId, peer.name, "requesting");
  active.answerTimer = setTimeout(() => {
    if (controller === active && active.phase === "requesting") endController("timeout");
  }, ANSWER_TIMEOUT_MS);
  track(REMOTE_CONTROL_EVENTS.request);
  signalingClient.sendMessage({ type: "remote-control-request", to: peer.id });
}

/** "Assumir", on an offer. */
export function acceptRemoteControlOffer() {
  const active = controller;
  if (!active || active.phase !== "offered") return;
  signalingClient.sendMessage({ type: "remote-control-answer", to: active.hostId, ok: true });
  active.phase = "connecting";
  publishController();
  void controllerConnect(active);
}

/** "Recusar" on an offer, "Cancelar" on a request, "Soltar controle" during one. */
export function releaseRemoteControl() {
  const active = controller;
  if (!active) return;
  if (active.phase === "offered") {
    signalingClient.sendMessage({ type: "remote-control-answer", to: active.hostId, ok: false, reason: "declined" });
  }
  endController("viewer");
}

function controllerOnServerMessage(msg: Record<string, unknown>) {
  const active = controller;
  switch (msg.type) {
    case "remote-control-result": {
      if (!active || msg.to !== active.hostId) return;
      if (msg.offer === true) return;
      if (msg.ok !== true) {
        const reason = typeof msg.reason === "string" ? msg.reason : "unavailable";
        controller = null;
        if (active.pingTimer) clearInterval(active.pingTimer);
        if (active.answerTimer) clearTimeout(active.answerTimer);
        publish({ controller: null });
        const retryIn = typeof msg.retryIn === "number" && msg.retryIn > 0 ? Math.ceil(msg.retryIn) : undefined;
        notice(reason === "cooldown" && retryIn ? "refused.cooldownIn" : `refused.${reason}`, active.hostName, retryIn);
      }
      return;
    }
    case "remote-control-answer": {
      if (!active || msg.from !== active.hostId || active.phase !== "requesting") return;
      if (active.answerTimer) clearTimeout(active.answerTimer);
      active.answerTimer = null;
      if (msg.ok !== true) {
        const reason = typeof msg.reason === "string" ? msg.reason : "declined";
        endController(reason === "timeout" ? "timeout" : reason === "declined" ? "declined" : "unavailable");
        return;
      }
      active.phase = "connecting";
      publishController();
      void controllerConnect(active);
      return;
    }
    case "remote-control-offered": {
      const from = typeof msg.from === "string" ? msg.from : "";
      const userId = typeof msg.fromUserId === "string" ? msg.fromUserId : "";
      if (!from || !userId) return;
      if (!featureOn || active) {
        signalingClient.sendMessage({ type: "remote-control-answer", to: from, ok: false, reason: "busy" });
        return;
      }
      const offered = newController(from, userId, typeof msg.fromName === "string" ? msg.fromName : null, "offered");
      offered.answerTimer = setTimeout(() => {
        if (controller === offered && offered.phase === "offered") releaseRemoteControl();
      }, 30_000);
      return;
    }
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// The controller's input, from components/RemoteControlSurface.tsx. Positions
// are 0..65535 across the host's picture.

export function sendRemoteMove(x: number, y: number) {
  const active = controller;
  if (!active || active.phase !== "active") return;
  active.seq = (active.seq + 1) & 0xffff;
  controllerSend(encodeMove(active.seq, x, y), true);
}

export function sendRemoteButton(button: number, down: boolean, x: number, y: number) {
  const active = controller;
  if (!active || active.phase !== "active" || button < 0 || button > 4) return;
  if (down) active.buttonsDown.add(button);
  else if (!active.buttonsDown.delete(button)) return;
  controllerSend(encodeButton(button, down, x, y));
}

export function sendRemoteWheel(dx: number, dy: number) {
  const active = controller;
  if (!active || active.phase !== "active") return;
  controllerSend(encodeWheel(dx, dy));
}

export function sendRemoteKey(code: string, down: boolean) {
  const active = controller;
  if (!active || active.phase !== "active") return;
  if (down) active.keysDown.add(code);
  else if (!active.keysDown.delete(code)) return;
  const buffer = encodeKey(code, down);
  if (buffer) controllerSend(buffer);
}

/** Everything held, let go — the surface lost focus. */
export function releaseRemoteKeys() {
  const active = controller;
  if (active) releaseHeld(active);
}

/**
 * A whole shortcut at once — "Win+R", "Ctrl+Shift+Esc" — from the bar's menu:
 * pressed in order, let go in reverse, the way fingers do it. The way to send
 * what this computer would otherwise act on itself, from any browser.
 */
export function sendRemoteCombo(codes: string[]) {
  const active = controller;
  if (!active || active.phase !== "active") return;
  for (const code of codes) sendRemoteKey(code, true);
  for (const code of [...codes].reverse()) sendRemoteKey(code, false);
  track(REMOTE_CONTROL_EVENTS.shortcut);
}

/** Whether this app can keep the Windows key and friends from this computer (see setRemoteKeyGrab). */
export function canGrabRemoteKeys(): boolean {
  return Boolean(getDesktopBridge()?.remoteControl?.grabKeys);
}

/**
 * The surface has the keyboard (true) or lost it (false). In the Windows app
 * that turns on the shell's grab of the system shortcuts, which then arrive
 * through controllerShellKey instead of acting on this computer.
 */
export function setRemoteKeyGrab(on: boolean) {
  const want = on && controller?.phase === "active";
  if (want === keyGrab) return;
  keyGrab = want;
  getDesktopBridge()?.remoteControl?.grabKeys?.(want);
}

function controllerShellKey(code: string, down: boolean) {
  // A release always goes through (sendRemoteKey only sends one for a key it
  // pressed); a press only while the grab is on — after it ends, the shell
  // can still have one in flight.
  if (down && !keyGrab) return;
  sendRemoteKey(code, down);
}

// ---------------------------------------------------------------------------
// Wiring, once per room page

let wired = 0;
let unwire: (() => void) | null = null;

function wire() {
  const offMessage = signalingClient.onMessage((msg) => {
    if (msg.type === "remote-control-requested") {
      void hostOnRequest(msg);
      return;
    }
    if (msg.type === "remote-control-answer" && host && msg.from === host.peerId && host.kind === "offer") {
      // The other side's answer to an offer: a no ends it, a yes is followed
      // by their connection.
      if (msg.ok !== true) {
        const name = host.name;
        endHost("declined");
        notice("offer.declined", name);
      }
      return;
    }
    if (msg.type === "remote-control-result" && msg.offer === true && host && msg.to === host.peerId && msg.ok !== true) {
      const name = host.name;
      endHost("declined");
      // Offering again and again is held back the same way as asking.
      const retryIn = typeof msg.retryIn === "number" && msg.retryIn > 0 ? Math.ceil(msg.retryIn) : undefined;
      if (msg.reason === "cooldown" && retryIn) notice("refused.cooldownIn", name, retryIn);
      return;
    }
    controllerOnServerMessage(msg);
  });
  const offSignal = signalingClient.onSignal((from, data) => {
    hostOnSignal(from, data);
    controllerOnSignal(from, data);
  });
  // The server forgets "aceito pedidos" with the socket; say it again on
  // every (re)join.
  const offJoined = signalingClient.onRoomJoined(() => {
    if (hostCapable && hostOpen) signalingClient.sendMessage({ type: "remote-control-open", open: true });
    if (host?.announced && host.input?.readyState === "open") hostAnnounce(host.peerId);
    tryResumeController();
  });
  const bridge = getDesktopBridge()?.remoteControl;
  unsubscribeShell = bridge ? bridge.onEvent(shellEvent) : null;
  // While a session is up its timestamp is refreshed now and then, so a
  // reload at any point finds a fresh one (see tryResumeController). The
  // picture's delay is set again too: a dropped and rebuilt screen
  // connection comes back with the room's default.
  const refresh = setInterval(() => {
    if (controller?.phase === "active") {
      rememberController(controller);
      setLowLatency(controller.hostId, true);
    }
  }, 5000);
  return () => {
    clearInterval(refresh);
    offMessage();
    offSignal();
    offJoined();
    unsubscribeShell?.();
    unsubscribeShell = null;
  };
}

/** After a reload: the session this tab had a moment ago, if the host is still here. */
function tryResumeController() {
  if (controller || !featureOn) return;
  let saved: { room?: string; hostUserId?: string; at?: number } | null = null;
  try {
    saved = JSON.parse(window.sessionStorage.getItem(RESUME_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || saved.room !== room || !saved.hostUserId || !saved.at) return;
  if (Date.now() - saved.at > RESUME_MS) {
    rememberController(null);
    return;
  }
  const hostPeer = signalingClient.state.peers.find((p) => p.userId === saved!.hostUserId && p.screen);
  if (!hostPeer) return;
  const active = newController(hostPeer.id, saved.hostUserId, hostPeer.name, "reconnecting");
  active.lostSince = saved.at;
  void controllerConnect(active);
}


/**
 * The room's side of all this. Called once by WatchRoom with what it knows.
 *
 * `hostEnabled`: this page can be controlled (feature, app bridge, account).
 * `open`: the switch "Permitir pedidos de controle remoto".
 * `sharingScreen`: a screen is going out right now.
 */
export function useRemoteControl(options: {
  room: string | null;
  enabled: boolean;
  hostEnabled: boolean;
  open: boolean;
  sharingScreen: boolean;
  forceRelay: boolean;
  lang: "pt" | "en" | "es";
}) {
  const { enabled, hostEnabled, open, sharingScreen } = options;

  useEffect(() => {
    room = options.room;
    forceRelay = options.forceRelay;
    lang = options.lang;
  }, [options.room, options.forceRelay, options.lang]);

  useEffect(() => {
    if (!enabled) return;
    if (wired++ === 0) unwire = wire();
    return () => {
      if (--wired === 0) {
        unwire?.();
        unwire = null;
        endHost("sharer");
        endController("viewer");
      }
    };
  }, [enabled]);

  useEffect(() => {
    featureOn = enabled;
    publish({ enabled });
    if (!enabled) endController("viewer");
  }, [enabled]);

  useEffect(() => {
    hostCapable = enabled && hostEnabled;
    const wantOpen = hostCapable && open;
    if (wantOpen !== hostOpen) {
      hostOpen = wantOpen;
      signalingClient.sendMessage({ type: "remote-control-open", open: wantOpen });
    }
    if (!hostCapable) endHost("sharer");
  }, [enabled, hostEnabled, open]);

  useEffect(() => {
    hostSharing = sharingScreen;
    if (!sharingScreen) endHost("sharer");
  }, [sharingScreen]);

  // A request answered with yes after the host left, or a host whose
  // announcement no longer names this page: the session is over.
  useEffect(() => {
    if (!enabled) return;
    const off = signalingClient.subscribe(() => {
      // Controller: the host now names somebody else as controlling.
      const active = controller;
      if (active && active.phase === "active") {
        const hostPeer = peerById(active.hostId);
        const self = signalingClient.state.selfUserId;
        if (hostPeer?.rcBy && self && hostPeer.rcBy.userId !== self) endController("host");
      }
      // Host: the controller's connection came back under a new id while the
      // data channel stayed up — the room's label follows them there.
      const hosting = host;
      if (hosting?.awaitingResume && hosting.input?.readyState === "open") {
        const peers = signalingClient.state.peers;
        if (!peers.some((p) => p.id === hosting.peerId)) {
          const back = peers.find((p) => p.userId === hosting.userId && !p.isGuest);
          if (back) {
            hosting.peerId = back.id;
            hosting.awaitingResume = false;
            hostAnnounce(back.id);
            publishHost();
          }
        }
      }
    });
    return () => {
      off();
    };
  }, [enabled]);

  useEffect(() => {
    if (enabled) tryResumeController();
  }, [enabled]);
}
