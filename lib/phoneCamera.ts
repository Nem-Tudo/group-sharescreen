"use client";

import { useSyncExternalStore } from "react";
import { iceConfigFor } from "./iceConfig";
import { ensureIceServers } from "./iceServers";
import { getSignalingWsUrl } from "./roomsApi";
import { trackFeatureEvent } from "./features";

// "Celular como câmera" — the computer's side (the phone's is app/cam).
//
// A phone opens a link (from a QR code shown here) and becomes this
// computer's camera. It never joins the room: it connects to this browser
// alone, over one WebRTC connection, and the video it sends is handed to the
// room's ordinary camera channel (see the capture in lib/useRoomMedia.ts),
// which is what the room sees. To everyone else it is just this person's
// camera.
//
// The API's phoneCamera.ts is the go-between: a socket of its own (not the
// room's "/ws") that knows which phones belong to which computer and relays
// the SDP/ICE between them. This browser is a "host", named by a random id
// kept in localStorage — no account needed, on either end.
//
// Two ways in:
//   - "uso único": the link works once, for one session, and is forgotten;
//   - "salvar": the phone is remembered. Next time, opening the same link on
//     it (or turning the camera on here, while its page is open) is enough —
//     no code. Asked from here, the phone asks its holder before it starts.
// Either way the first time shows a code on the phone, typed here, so a link
// that leaked cannot turn a stranger's phone into this person's camera
// without them noticing.
//
// The socket only exists while a room has the experiment's switch on (see
// usePhoneCameraHost), and only the newest tab of this browser holds it.

export const PHONE_CAMERA_FEATURE = "phone-camera";

export const PHONE_CAMERA_EVENTS = {
  modeOn: "phone_camera_on",
  modeOff: "phone_camera_off",
  qrOpen: "phone_camera_qr_open", // the QR dialog was opened
  paired: "phone_camera_paired", // a code was confirmed (value 1 = saved, 0 = once)
  start: "phone_camera_start", // video from the phone reached the room's camera
  seconds: "phone_camera_seconds", // value: seconds the phone was the camera
  declined: "phone_camera_declined", // the phone said no to a request
  failed: "phone_camera_failed", // the connection to the phone never came up
  remote: "phone_camera_remote", // a phone control (camera, flip, torch) pressed on the computer
  offlineScreen: "phone_camera_offline_screen", // the camera came on with the "phone not connected" screen
  reconnected: "phone_camera_reconnected", // the phone's video replaced that screen
  pickerClick: "phone_camera_picker_click", // "Usar o celular" picked in the camera list
  errorOffer: "phone_camera_error_offer", // a camera error offered the phone instead
  errorClick: "phone_camera_error_click", // ...and the offer was taken
} as const;

const HOST_KEY = "sharescreen:phoneCamHost";
const SOURCE_KEY = "sharescreen:phoneCamSource";
/** How long turning the camera on waits for the phone to answer. */
const REQUEST_TIMEOUT_MS = 90_000;
/** How long an offered connection has to come up before it is given up. */
const CONNECT_TIMEOUT_MS = 25_000;

export interface PhoneCameraDevice {
  deviceId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface PhoneCameraClaim {
  conn: string;
  name: string;
  mode: "once" | "save";
}

/** A phone with its page open right now. `deviceId` null: a one-time one. */
export interface PhoneCameraOnline {
  conn: string;
  deviceId: string | null;
  name: string;
}

export type PhoneCameraErrorCode = "offline" | "declined" | "timeout" | "failed" | "cancelled" | "unavailable";

export class PhoneCameraError extends Error {
  constructor(public code: PhoneCameraErrorCode) {
    super(code);
  }
}

/** The phone's own controls, as it reports them — mirrored on the computer. */
export interface PhoneCameraPhoneState {
  camera: boolean;
  torch: boolean;
  torchSupported: boolean;
  facing: "user" | "environment";
}

function readPhoneState(raw: { camera?: unknown; torch?: unknown; torchSupported?: unknown; facing?: unknown }): PhoneCameraPhoneState {
  return {
    camera: raw.camera !== false,
    torch: raw.torch === true,
    torchSupported: raw.torchSupported === true,
    facing: raw.facing === "user" ? "user" : "environment",
  };
}

export interface PhoneCameraState {
  /** The socket is up and this tab is the one holding it. */
  connected: boolean;
  /** Another tab of this browser holds it (see takeHere). */
  replaced: boolean;
  devices: PhoneCameraDevice[];
  online: PhoneCameraOnline[];
  claims: PhoneCameraClaim[];
  link: { token: string; mode: "once" | "save" } | null;
  /** The last code typed was wrong: tries left for that phone. */
  codeWrong: { conn: string; left: number } | null;
  /**
   * The phone in use, or being asked/connected. `waiting`: the phone was
   * asked for but its page is not open — waiting for it to be.
   */
  session: {
    conn: string | null;
    deviceId: string | null;
    name: string;
    status: "waiting" | "asking" | "connecting" | "live";
    /** What the phone says about itself (camera off, torch, facing). */
    phone: PhoneCameraPhoneState | null;
  } | null;
  /** When a phone was last confirmed with its code (the QR can go). */
  pairedAt: number;
  /** Which phone the camera should come from: a saved one's id, "once", or null (a webcam). */
  source: string | null;
  /**
   * "Usar o celular" was asked for from outside the panel (the camera list,
   * a camera error): the panel picks the last saved phone, or shows the QR
   * when there is none — once the relay is up (see requestPhoneCameraUse).
   */
  useRequested: boolean;
}

// ── Store ──────────────────────────────────────────────────────────────────

let state: PhoneCameraState = {
  connected: false,
  replaced: false,
  devices: [],
  online: [],
  claims: [],
  link: null,
  codeWrong: null,
  session: null,
  pairedAt: 0,
  source: readSource(),
  useRequested: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<PhoneCameraState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePhoneCamera(): PhoneCameraState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function getPhoneCameraState(): PhoneCameraState {
  return state;
}

function readSource(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(SOURCE_KEY);
  } catch {
    return null;
  }
}

function hostId(): string {
  try {
    const stored = window.localStorage.getItem(HOST_KEY);
    if (stored && /^[a-f0-9]{32}$/.test(stored)) return stored;
  } catch {
    // Fall through: a host id for this page only.
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    window.localStorage.setItem(HOST_KEY, id);
  } catch {
    // Pairings won't survive a reload — the one-time link still works.
  }
  return id;
}

/** The socket of the phone-camera relay, next to the room's "/ws". */
export function phoneCameraSocketUrl(): string {
  return getSignalingWsUrl().replace(/\/ws\/?$/, "") + "/phonecam/ws";
}

/** What the QR code opens. */
export function phoneCameraLinkUrl(token: string): string {
  return `${window.location.origin}/cam/${token}`;
}

// ── Events the room's camera listens to ─────────────────────────────────────

type CameraEvent = "arrived" | "ended";
const cameraListeners = new Set<(event: CameraEvent) => void>();
function emitCamera(event: CameraEvent) {
  cameraListeners.forEach((l) => l(event));
}
/**
 * "arrived": a phone started sending without being asked for (its page was
 * opened) — the room's camera should come on from it. "ended": the phone in
 * use stopped — the room's camera should stop with it.
 */
export function onPhoneCameraEvent(listener: (event: CameraEvent) => void): () => void {
  cameraListeners.add(listener);
  return () => {
    cameraListeners.delete(listener);
  };
}

// ── Socket ─────────────────────────────────────────────────────────────────

let socket: WebSocket | null = null;
let users = 0;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

function sendRaw(msg: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function open() {
  if (socket || users === 0 || typeof window === "undefined") return;
  ensureIceServers();
  const ws = new WebSocket(phoneCameraSocketUrl());
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ t: "host", hostId: hostId() }));
    pingTimer = setInterval(() => sendRaw({ t: "ping" }), 25_000);
  };
  ws.onmessage = (event) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    onMessage(msg);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    set({ connected: false, online: [], claims: [] });
    if (users === 0 || state.replaced) return;
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, 1000 * 2 ** retry);
  };
}

function close() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const ws = socket;
  socket = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  ws?.close();
  release();
  set({ connected: false, replaced: false, online: [], claims: [], link: null });
}

/** Holds the host socket open while at least one caller wants it. */
export function retainPhoneCameraHost(): () => void {
  users += 1;
  open();
  return () => {
    users -= 1;
    if (users === 0) close();
  };
}

/** This tab takes the phones back from another tab of the same browser. */
export function takePhoneCameraHere() {
  if (!state.replaced) return;
  set({ replaced: false });
  if (socket) sendRaw({ t: "take" });
  else open();
}

function onMessage(msg: Record<string, unknown>) {
  switch (msg.t) {
    case "host-ok":
      set({ connected: true, replaced: false, devices: (msg.devices as PhoneCameraDevice[]) ?? [] });
      return;
    case "replaced":
      // Another tab is the camera's home now; this one lets go of the phone.
      release();
      set({ replaced: true, connected: false, online: [], claims: [] });
      return;
    case "devices":
      set({ devices: (msg.devices as PhoneCameraDevice[]) ?? [] });
      return;
    case "link":
      set({ link: { token: String(msg.token), mode: msg.mode === "save" ? "save" : "once" } });
      return;
    case "claim": {
      const claim: PhoneCameraClaim = {
        conn: String(msg.conn),
        name: String(msg.name ?? ""),
        mode: msg.mode === "save" ? "save" : "once",
      };
      set({ claims: [...state.claims.filter((c) => c.conn !== claim.conn), claim] });
      return;
    }
    case "claim-gone":
      set({ claims: state.claims.filter((c) => c.conn !== msg.conn) });
      return;
    case "code-wrong":
      set({ codeWrong: { conn: String(msg.conn), left: Number(msg.left) || 0 } });
      return;
    case "paired": {
      const device = msg.device as PhoneCameraDevice | null;
      trackFeatureEvent(PHONE_CAMERA_EVENTS.paired, { value: device ? 1 : 0 });
      set({
        claims: state.claims.filter((c) => c.conn !== msg.conn),
        codeWrong: null,
        pairedAt: Date.now(),
        // A link used once is spent; the QR for it should go.
        link: state.link?.mode === "once" ? null : state.link,
      });
      // The phone that was just confirmed is the camera from now on.
      setPhoneCameraSource(device ? device.deviceId : "once");
      return;
    }
    case "cam-online": {
      const online: PhoneCameraOnline = {
        conn: String(msg.conn),
        deviceId: typeof msg.deviceId === "string" ? msg.deviceId : null,
        name: String(msg.name ?? ""),
      };
      set({ online: [...state.online.filter((o) => o.conn !== online.conn), online] });
      const session = state.session;
      // The phone in use reconnected its socket (the video, peer to peer,
      // never stopped): messages for it go to the new one.
      if (session && session.status !== "waiting" && online.deviceId && online.deviceId === session.deviceId) {
        set({ session: { ...session, conn: online.conn } });
        return;
      }
      // Asked for while its page was closed: now it is open, ask it.
      if (session?.status === "waiting" && online.deviceId === session.deviceId) {
        set({ session: { ...session, conn: online.conn, status: "asking" } });
        sendRaw({ t: "request", conn: online.conn });
      }
      return;
    }
    case "cam-offline": {
      set({ online: state.online.filter((o) => o.conn !== msg.conn) });
      // A live phone can lose its socket and keep sending; the connection
      // itself (and its data channel) says when the video is really gone.
      const session = state.session;
      if (session && session.conn === msg.conn && session.status !== "live") endSession("failed");
      return;
    }
    case "signal":
      void onSignal(String(msg.conn), msg.data as Record<string, unknown>);
      return;
    case "declined":
      if (state.session?.conn === msg.conn) {
        trackFeatureEvent(PHONE_CAMERA_EVENTS.declined);
        endSession("declined");
      }
      return;
    case "stopped":
      if (state.session?.conn === msg.conn) endSession("failed");
      return;
    case "state": {
      const session = state.session;
      if (session && session.conn === msg.conn && msg.state && typeof msg.state === "object") {
        set({ session: { ...session, phone: readPhoneState(msg.state as Record<string, unknown>) } });
      }
      return;
    }
  }
}

// ── Pairing, from the panel ─────────────────────────────────────────────────

export function requestPhoneCameraLink(mode: "once" | "save", fresh = false) {
  set({ link: null });
  sendRaw({ t: "link", mode, fresh });
}

export function submitPhoneCameraCode(conn: string, code: string) {
  set({ codeWrong: null });
  sendRaw({ t: "code", conn, code });
}

export function rejectPhoneCameraClaim(conn: string) {
  sendRaw({ t: "reject", conn });
  set({ claims: state.claims.filter((c) => c.conn !== conn) });
}

export function removePhoneCameraDevice(deviceId: string) {
  sendRaw({ t: "remove", deviceId });
  if (state.source === deviceId) setPhoneCameraSource(null);
}

export function renamePhoneCameraDevice(deviceId: string, name: string) {
  sendRaw({ t: "rename", deviceId, name });
}

/** Which phone the room's camera comes from — null for a webcam again. */
export function setPhoneCameraSource(source: string | null) {
  // A saved choice survives a reload; a one-time phone does not.
  try {
    if (source && source !== "once") window.localStorage.setItem(SOURCE_KEY, source);
    else window.localStorage.removeItem(SOURCE_KEY);
  } catch {
    // For this page only.
  }
  set({ source });
  // Not in use by a camera that is on: nothing to swap away from first.
  if (!cameraInUse) releaseUnlessSource();
}

/** Asks the panel for "Usar o celular" (see PhoneCameraState.useRequested). */
export function requestPhoneCameraUse() {
  set({ useRequested: true });
}

/**
 * The panel answering that request: the most recently used saved phone, or
 * null when there is none (the QR is what it shows then).
 */
export function takePhoneCameraUseRequest(): PhoneCameraDevice | null {
  set({ useRequested: false });
  return [...state.devices].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0] ?? null;
}

// Set by the room when its management turned the camera off for this person
// (see WatchRoom's cameraBlockedReason): a phone starting by itself must not
// turn on a camera the room's own button would refuse to.
let startBlocked = false;
export function setPhoneCameraStartBlocked(blocked: boolean) {
  startBlocked = blocked;
}
export function phoneCameraStartBlocked(): boolean {
  return startBlocked;
}

// Set by the room while its camera is fed by the phone (see useRoomMedia),
// so a change of source swaps the room's camera over before the phone is let
// go — the other way round, the room would see the camera end and stop.
let cameraInUse = false;
export function setPhoneCameraInUse(inUse: boolean) {
  cameraInUse = inUse;
}

/** Lets go of a phone that is no longer the chosen source. */
export function releaseUnlessSource() {
  const session = state.session;
  if (session && state.source !== (session.deviceId ?? "once")) release();
}

// ── The connection to the phone ─────────────────────────────────────────────

let pc: RTCPeerConnection | null = null;
// Opened by the phone. Closing it is how either end learns at once that the
// other is gone — no waiting for ICE to time out.
let control: RTCDataChannel | null = null;
let track: MediaStreamTrack | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let liveSince = 0;
// Captures waiting for the phone (a start and a swap can both be asking).
let waiters: { resolve: (track: MediaStreamTrack) => void; reject: (err: PhoneCameraError) => void }[] = [];
let waitTimer: ReturnType<typeof setTimeout> | null = null;

function settle(result: MediaStreamTrack | PhoneCameraError) {
  if (waitTimer) clearTimeout(waitTimer);
  waitTimer = null;
  const current = waiters;
  waiters = [];
  for (const waiter of current) {
    if (result instanceof PhoneCameraError) waiter.reject(result);
    else waiter.resolve(result);
  }
  return current.length > 0;
}

function closePc() {
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = null;
  try {
    if (control?.readyState === "open") control.send(JSON.stringify({ t: "bye" }));
  } catch {
    // Closing anyway.
  }
  control = null;
  pc?.close();
  pc = null;
  track = null;
  if (liveSince) {
    trackFeatureEvent(PHONE_CAMERA_EVENTS.seconds, {
      value: Math.max(1, Math.round((Date.now() - liveSince) / 1000)),
    });
  }
  liveSince = 0;
}

function endSession(reason: PhoneCameraErrorCode) {
  const wasLive = state.session?.status === "live";
  closePc();
  set({ session: null });
  if (!settle(new PhoneCameraError(reason)) && wasLive) emitCamera("ended");
}

/**
 * Presses one of the phone's own controls from the computer: turn the camera
 * off/on, flip it, or the torch. Sent on the connection itself; the phone
 * answers with its new state, which is what the buttons here show.
 */
export function sendPhoneCameraCommand(action: "camera" | "flip" | "torch") {
  if (control?.readyState !== "open") return;
  try {
    control.send(JSON.stringify({ t: "cmd", action }));
    trackFeatureEvent(PHONE_CAMERA_EVENTS.remote);
  } catch {
    // Closing — the session ends on its own.
  }
}

/** Lets go of the phone: it is told to stop, and its camera turns off. */
export function release() {
  const session = state.session;
  if (!session) return;
  if (session.conn) sendRaw({ t: "stop", conn: session.conn });
  closePc();
  set({ session: null });
  settle(new PhoneCameraError("cancelled"));
  // A room camera still fed by it stops (one already swapped away is not).
  if (session.status === "live") emitCamera("ended");
}

/** The panel's "cancelar" while waiting for the phone. */
export function cancelPhoneCameraRequest() {
  release();
}

async function onSignal(conn: string, data: Record<string, unknown> | undefined) {
  if (!data || typeof data !== "object") return;
  if (data.type === "offer" && typeof data.sdp === "string") {
    const known = state.online.find((o) => o.conn === conn);
    if (!known) return;
    // The phone started on its own (its page was opened) or answered a
    // request — either way this is the camera now. Another phone already in
    // use gives way: the newest one is the one being held up.
    // A request still waiting for this very phone's page is answered by it.
    const session = state.session;
    const answersWait = session?.status === "waiting" && session.deviceId === known.deviceId;
    if (session && session.conn !== conn && !answersWait) release();
    closePc();
    const asked = waiters.length > 0;
    set({
      session: { conn, deviceId: known.deviceId, name: known.name, status: "connecting", phone: null },
    });
    if (state.source !== (known.deviceId ?? "once")) {
      try {
        if (known.deviceId) window.localStorage.setItem(SOURCE_KEY, known.deviceId);
      } catch {
        // For this page only.
      }
      set({ source: known.deviceId ?? "once" });
    }
    const peer = new RTCPeerConnection(iceConfigFor(false));
    pc = peer;
    peer.onicecandidate = (event) => {
      if (event.candidate) sendRaw({ t: "signal", conn, data: { candidate: event.candidate.toJSON() } });
    };
    peer.ondatachannel = (event) => {
      if (pc !== peer) return;
      const channel = event.channel;
      control = channel;
      channel.onmessage = (e) => {
        let data: { t?: unknown; camera?: unknown; torch?: unknown; torchSupported?: unknown; facing?: unknown };
        try {
          data = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (pc !== peer) return;
        if (data.t === "bye") endSession("failed");
        else if (data.t === "state" && state.session) {
          set({ session: { ...state.session, phone: readPhoneState(data) } });
        }
      };
      channel.onclose = () => {
        if (pc === peer) endSession("failed");
      };
    };
    peer.ontrack = (event) => {
      if (event.track.kind !== "video" || pc !== peer) return;
      track = event.track;
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === "connected" && track && state.session?.status !== "live") {
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        liveSince = Date.now();
        set({ session: state.session ? { ...state.session, status: "live" } : null });
        trackFeatureEvent(PHONE_CAMERA_EVENTS.start);
        if (!settle(track) && !asked) emitCamera("arrived");
      } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        if (state.session?.status !== "live") trackFeatureEvent(PHONE_CAMERA_EVENTS.failed);
        sendRaw({ t: "stop", conn });
        endSession("failed");
      }
    };
    connectTimer = setTimeout(() => {
      if (pc !== peer || state.session?.status === "live") return;
      trackFeatureEvent(PHONE_CAMERA_EVENTS.failed);
      sendRaw({ t: "stop", conn });
      endSession("failed");
    }, CONNECT_TIMEOUT_MS);
    try {
      await peer.setRemoteDescription({ type: "offer", sdp: data.sdp });
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendRaw({ t: "signal", conn, data: { type: "answer", sdp: answer.sdp } });
    } catch {
      if (pc === peer) endSession("failed");
    }
    return;
  }
  if (data.candidate && pc && state.session?.conn === conn) {
    try {
      await pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
    } catch {
      // A late candidate for a description already replaced.
    }
  }
}

/** Whether the room's camera should come from a phone right now. */
export function phoneCameraSelected(): boolean {
  return Boolean(state.source) && (state.connected || Boolean(track));
}

/**
 * The phone's video for the room's camera: the one already coming in, or
 * the chosen phone asked for (its holder accepts on the phone). Waits for its
 * page to be opened if it is not — up to REQUEST_TIMEOUT_MS.
 */
export function acquirePhoneCamera(): Promise<MediaStreamTrack> {
  const source = state.source;
  if (!source || !state.connected) return Promise.reject(new PhoneCameraError("unavailable"));
  if (phoneCameraLive()) return Promise.resolve(track!);
  return new Promise<MediaStreamTrack>((resolve, reject) => {
    waiters.push({ resolve, reject });
    // Already on its way (asked, or the phone is connecting on its own).
    if (state.session && (state.session.deviceId ?? "once") === source) return;
    waitTimer = setTimeout(() => {
      const session = state.session;
      if (session?.conn) sendRaw({ t: "stop", conn: session.conn });
      closePc();
      set({ session: null });
      settle(new PhoneCameraError(session?.status === "waiting" ? "offline" : "timeout"));
    }, REQUEST_TIMEOUT_MS);
    if (source === "once") {
      // A one-time phone just confirmed may not have said it is online yet.
      const online = state.online.find((o) => o.deviceId === null);
      set({
        session: {
          conn: online?.conn ?? null,
          deviceId: null,
          name: online?.name ?? "",
          status: online ? "asking" : "waiting",
          phone: null,
        },
      });
      if (online) sendRaw({ t: "request", conn: online.conn });
      return;
    }
    const device = state.devices.find((d) => d.deviceId === source);
    if (!device) {
      settle(new PhoneCameraError("unavailable"));
      return;
    }
    const online = state.online.find((o) => o.deviceId === source);
    set({
      session: {
        conn: online?.conn ?? null,
        deviceId: source,
        name: device.name,
        status: online ? "asking" : "waiting",
        phone: null,
      },
    });
    if (online) sendRaw({ t: "request", conn: online.conn });
  });
}

/** Whether the phone's connection is live (the room's camera can use it as is). */
export function phoneCameraLive(): boolean {
  return Boolean(track && track.readyState === "live" && state.session?.status === "live");
}
