"use client";

import { useSyncExternalStore } from "react";
import { iceConfigFor } from "./iceConfig";
import { ensureIceServers } from "./iceServers";
import { getSignalingWsUrl } from "./roomsApi";
import { trackFeatureEvent } from "./features";

// "Celular como câmera" (and as microphone) — the computer's side (the
// phone's is app/cam).
//
// A phone opens a link (from a QR code shown here) and becomes this
// computer's camera, its microphone, or both at once. It never joins the
// room: it connects to this browser alone, over one WebRTC connection, and
// what it sends is handed to the room's ordinary camera and mic channels
// (see the captures in lib/useRoomMedia.ts), which is what the room sees and
// hears. To everyone else it is just this person's camera and mic.
//
// One connection per phone carries both: a video and an audio transceiver
// from the start, and this side tells the phone which of the two it wants
// right now (the "use" message, see syncUse). The phone opens and closes its
// camera and microphone to match, swapping tracks in place — no
// renegotiation. A phone page from before the microphone knows nothing of
// "use" and just sends its camera, which is all that was ever asked of it.
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
// Only one phone at a time: the camera and the mic can come from the same
// phone, but picking a different phone for one of them puts the other back
// on this computer's own device.
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
  micStart: "phone_mic_start", // audio from the phone reached the room's mic
  micPickerClick: "phone_mic_picker_click", // "Usar o celular" picked in the mic list
  micOffline: "phone_mic_offline", // the mic came on (silent) waiting for the phone
} as const;

/** What a phone is to this computer: its camera, its microphone. */
export type PhoneKind = "camera" | "mic";

const HOST_KEY = "sharescreen:phoneCamHost";
const SOURCE_KEY = "sharescreen:phoneCamSource";
const MIC_SOURCE_KEY = "sharescreen:phoneMicSource";
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

export type PhoneCameraErrorCode =
  | "offline"
  | "declined"
  | "timeout"
  | "failed"
  | "cancelled"
  | "unavailable"
  // The phone's page predates the microphone, or its mic would not open.
  | "nomic";

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
  /** Its page knows the microphone (and "use"). False on an older page. */
  micCapable: boolean;
  /** What it is sending right now: an older page always sends its camera. */
  sendingCamera: boolean;
  sendingMic: boolean;
  /** The mic is muted on the phone (sending silence). */
  micMuted: boolean;
  /** The phone's microphone would not open (permission refused, in use). */
  micError: boolean;
}

function readPhoneState(raw: Record<string, unknown>): PhoneCameraPhoneState {
  return {
    camera: raw.camera !== false,
    torch: raw.torch === true,
    torchSupported: raw.torchSupported === true,
    facing: raw.facing === "user" ? "user" : "environment",
    micCapable: raw.micCapable === true,
    sendingCamera: raw.sendingCamera !== false,
    sendingMic: raw.sendingMic === true,
    micMuted: raw.micMuted === true,
    micError: raw.micError === true,
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
  /**
   * Which list the QR was opened from: the phone confirmed becomes that.
   * "extra": the "+" of "Várias câmeras" — the phone becomes one more camera
   * (see lib/extraPhoneCameras) and the main camera and mic stay as they are.
   */
  linkFor: PhoneKind | "extra";
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
    /** What the phone says about itself (camera off, torch, facing, mic). */
    phone: PhoneCameraPhoneState | null;
  } | null;
  /** When a phone was last confirmed with its code (the QR can go). */
  pairedAt: number;
  /** Which phone the camera should come from: a saved one's id, "once", or null (a webcam). */
  source: string | null;
  /** The same, for the microphone: null is this computer's own mic. */
  micSource: string | null;
  /**
   * "Usar o celular" was asked for from outside the panel (a device list, a
   * camera error), and for which: the panel picks the last saved phone, or
   * shows the QR when there is none — once the relay is up (see
   * requestPhoneCameraUse).
   */
  useRequested: PhoneKind | null;
}

// ── Store ──────────────────────────────────────────────────────────────────

let state: PhoneCameraState = {
  connected: false,
  replaced: false,
  devices: [],
  online: [],
  claims: [],
  link: null,
  linkFor: "camera",
  codeWrong: null,
  session: null,
  pairedAt: 0,
  source: readStored(SOURCE_KEY),
  micSource: readStored(MIC_SOURCE_KEY),
  useRequested: null,
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

function readStored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, source: string | null) {
  // A saved choice survives a reload; a one-time phone does not.
  try {
    if (source && source !== "once") window.localStorage.setItem(key, source);
    else window.localStorage.removeItem(key);
  } catch {
    // For this page only.
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

/** The session's phone as a source value: its saved id, or "once". */
function sessionKey(session: NonNullable<PhoneCameraState["session"]>): string {
  return session.deviceId ?? "once";
}

// ── Events the room's camera and mic listen to ──────────────────────────────

type CameraEvent = "arrived" | "ended";
const cameraListeners = new Set<(event: CameraEvent) => void>();
function emitCamera(event: CameraEvent) {
  cameraListeners.forEach((l) => l(event));
}
/**
 * "arrived": a phone started sending without being asked for (its page was
 * opened) — the room's camera (and mic, if it is the mic's phone) should
 * come from it. "ended": the phone in use stopped.
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

/** The host socket, for the extra phones of "Várias câmeras" (lib/extraPhoneCameras). */
export function sendPhoneCameraRelay(msg: Record<string, unknown>) {
  sendRaw(msg);
}

// The phones of "Várias câmeras" share this socket (see lib/extraPhoneCameras).
// `route` sees each message first and answers true for one about a phone an
// extra camera holds, which the main session must then leave alone; `reset`
// runs when the phones are let go of for good (switch off, another tab).
export interface PhoneCameraRouter {
  route: (msg: Record<string, unknown>) => boolean;
  reset: () => void;
}
let router: PhoneCameraRouter | null = null;
export function setPhoneCameraRouter(next: PhoneCameraRouter) {
  router = next;
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
  router?.reset();
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
  // The phones' comings and goings update the list below first; the router
  // looks at those after (see "cam-online" / "cam-offline").
  if (msg.t !== "cam-online" && msg.t !== "cam-offline" && router?.route(msg)) return;
  switch (msg.t) {
    case "host-ok":
      set({ connected: true, replaced: false, devices: (msg.devices as PhoneCameraDevice[]) ?? [] });
      return;
    case "replaced":
      // Another tab is the camera's home now; this one lets go of the phone.
      release();
      router?.reset();
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
      // The phone that was just confirmed is, from now on, what the QR was
      // opened for: the camera, or the microphone.
      // "extra": the router already started it as one more camera.
      const key = device ? device.deviceId : "once";
      if (state.linkFor === "mic") setPhoneMicSource(key);
      else if (state.linkFor === "camera") setPhoneCameraSource(key);
      return;
    }
    case "cam-online": {
      const online: PhoneCameraOnline = {
        conn: String(msg.conn),
        deviceId: typeof msg.deviceId === "string" ? msg.deviceId : null,
        name: String(msg.name ?? ""),
      };
      set({ online: [...state.online.filter((o) => o.conn !== online.conn), online] });
      // One an extra camera holds: none of the main session's business.
      if (router?.route(msg)) return;
      const session = state.session;
      // The phone in use reconnected its socket (the media, peer to peer,
      // never stopped): messages for it go to the new one.
      if (session && session.status !== "waiting" && online.deviceId && online.deviceId === session.deviceId) {
        set({ session: { ...session, conn: online.conn } });
        return;
      }
      // Asked for while its page was closed: now it is open, ask it.
      if (session?.status === "waiting" && online.deviceId === session.deviceId) {
        set({ session: { ...session, conn: online.conn, status: "asking" } });
        sendRaw({ t: "request", conn: online.conn, data: wants() });
      }
      return;
    }
    case "cam-offline": {
      set({ online: state.online.filter((o) => o.conn !== msg.conn) });
      router?.route(msg);
      // A live phone can lose its socket and keep sending; the connection
      // itself (and its data channel) says when the media is really gone.
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
        checkWaiters();
      }
      return;
    }
  }
}

// ── Pairing, from the panel ─────────────────────────────────────────────────

export function requestPhoneCameraLink(
  mode: "once" | "save",
  fresh = false,
  linkFor: PhoneKind | "extra" = "camera"
) {
  set({ link: null, linkFor });
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
  if (state.micSource === deviceId) setPhoneMicSource(null);
}

export function renamePhoneCameraDevice(deviceId: string, name: string) {
  sendRaw({ t: "rename", deviceId, name });
}

/** Which phone the room's camera comes from — null for a webcam again. */
export function setPhoneCameraSource(source: string | null) {
  writeStored(SOURCE_KEY, source);
  set({ source });
  // One phone at a time: a different one for the camera takes the mic back
  // to this computer's own.
  if (source && state.micSource && state.micSource !== source) setPhoneMicSource(null);
  // Not in use by a camera that is on: nothing to swap away from first.
  if (!cameraInUse) releaseUnlessSource();
  syncUse();
}

/** Which phone the room's microphone comes from — null for this computer's. */
export function setPhoneMicSource(source: string | null) {
  writeStored(MIC_SOURCE_KEY, source);
  set({ micSource: source });
  if (source && state.source && state.source !== source) setPhoneCameraSource(null);
  if (!micInUse) releaseUnlessSource();
  syncUse();
}

/** Asks the panel for "Usar o celular" (see PhoneCameraState.useRequested). */
export function requestPhoneCameraUse(kind: PhoneKind = "camera") {
  set({ useRequested: kind });
}

/**
 * The panel answering that request: the most recently used saved phone, or
 * null when there is none (the QR is what it shows then).
 */
export function takePhoneCameraUseRequest(): PhoneCameraDevice | null {
  set({ useRequested: null });
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

// Set by the room while its camera / mic is fed by the phone (see
// useRoomMedia), so a change of source swaps the room's capture over before
// the phone is let go — the other way round, the room would see it end and
// stop. Also what the phone is told to keep open (see syncUse).
let cameraInUse = false;
let micInUse = false;
export function setPhoneCameraInUse(inUse: boolean) {
  cameraInUse = inUse;
  syncUse();
}
export function setPhoneMicInUse(inUse: boolean) {
  micInUse = inUse;
  syncUse();
}

/** Lets go of a phone that is no longer the chosen source of anything. */
export function releaseUnlessSource() {
  const session = state.session;
  if (!session) return;
  const key = sessionKey(session);
  if (state.source !== key && state.micSource !== key) release();
}

/**
 * The room is done with the phone for one of the two (its camera or mic went
 * off a while ago): let go of it if the other is not using it either, or just
 * tell it to close what is no longer used.
 */
export function releasePhoneIfIdle() {
  if (cameraInUse || micInUse || waiters.length > 0) {
    syncUse();
    return;
  }
  release();
}

// ── The connection to the phone ─────────────────────────────────────────────

let pc: RTCPeerConnection | null = null;
// Opened by the phone. Closing it is how either end learns at once that the
// other is gone — no waiting for ICE to time out.
let control: RTCDataChannel | null = null;
let track: MediaStreamTrack | null = null;
let audioTrack: MediaStreamTrack | null = null;
// Chrome only feeds a remote audio track into Web Audio (the mic's graph)
// while something plays it: a muted element does, and is otherwise silent.
let audioSink: HTMLAudioElement | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let liveSince = 0;
// What the phone was last told to have open (see syncUse).
let lastUse = "";

// Captures waiting for the phone: the camera's for its video, the mic's for
// its audio. Each with its own deadline.
interface Waiter {
  kind: PhoneKind;
  resolve: (track: MediaStreamTrack) => void;
  reject: (err: PhoneCameraError) => void;
  timer: ReturnType<typeof setTimeout>;
}
let waiters: Waiter[] = [];

/** What the room wants from the phone right now. */
function wants(): { camera: boolean; mic: boolean } {
  return {
    camera: cameraInUse || waiters.some((w) => w.kind === "camera"),
    mic: micInUse || waiters.some((w) => w.kind === "mic"),
  };
}

/** Tells the phone what to keep open, when that changed (or `force`). */
function syncUse(force = false) {
  if (control?.readyState !== "open") return;
  const use = wants();
  const key = `${use.camera}:${use.mic}`;
  if (!force && key === lastUse) return;
  lastUse = key;
  try {
    control.send(JSON.stringify({ t: "use", ...use }));
  } catch {
    // Closing — the session ends on its own.
  }
}

function dropWaiter(waiter: Waiter) {
  clearTimeout(waiter.timer);
  waiters = waiters.filter((w) => w !== waiter);
}

/** Every waiter fails at once (the session is over). True if there were any. */
function rejectAll(err: PhoneCameraError): boolean {
  const current = waiters;
  waiters = [];
  for (const waiter of current) {
    clearTimeout(waiter.timer);
    waiter.reject(err);
  }
  return current.length > 0;
}

/** Hands the waiting captures what the live phone has for them now. */
function checkWaiters() {
  const session = state.session;
  if (session?.status !== "live") return;
  const phone = session.phone;
  for (const waiter of [...waiters]) {
    if (waiter.kind === "camera") {
      // An older page never reports what it sends: it sends its camera.
      if (track && (!phone || phone.sendingCamera)) {
        dropWaiter(waiter);
        waiter.resolve(track);
      }
      continue;
    }
    if (!phone) continue;
    if (!phone.micCapable || !audioTrack || phone.micError) {
      dropWaiter(waiter);
      waiter.reject(new PhoneCameraError("nomic"));
    } else if (phone.sendingMic) {
      dropWaiter(waiter);
      trackFeatureEvent(PHONE_CAMERA_EVENTS.micStart);
      waiter.resolve(audioTrack);
    }
  }
  syncUse();
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
  lastUse = "";
  pc?.close();
  pc = null;
  track = null;
  audioTrack = null;
  if (audioSink) {
    audioSink.pause();
    audioSink.srcObject = null;
    audioSink = null;
  }
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
  rejectAll(new PhoneCameraError(reason));
  // While live something may be using it (the camera, the mic) even with
  // the other still waiting: both hear it.
  if (wasLive) emitCamera("ended");
}

/**
 * Presses one of the phone's own controls from the computer: turn the camera
 * off/on, flip it, the torch, or mute its mic. Sent on the connection itself;
 * the phone answers with its new state, which is what the buttons here show.
 */
export function sendPhoneCameraCommand(action: "camera" | "flip" | "torch" | "mic") {
  if (control?.readyState !== "open") return;
  try {
    control.send(JSON.stringify({ t: "cmd", action }));
    trackFeatureEvent(PHONE_CAMERA_EVENTS.remote);
  } catch {
    // Closing — the session ends on its own.
  }
}

/** Lets go of the phone: it is told to stop, and its camera and mic turn off. */
export function release() {
  const session = state.session;
  if (!session) return;
  if (session.conn) sendRaw({ t: "stop", conn: session.conn });
  closePc();
  set({ session: null });
  rejectAll(new PhoneCameraError("cancelled"));
  // A room camera / mic still fed by it moves off it (one already swapped
  // away is not).
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
    // request — either way this is the phone in use now. Another phone
    // already in use gives way: the newest one is the one being held up.
    // A request still waiting for this very phone's page is answered by it.
    const session = state.session;
    const answersWait = session?.status === "waiting" && session.deviceId === known.deviceId;
    if (session && session.conn !== conn && !answersWait) release();
    closePc();
    const asked = waiters.length > 0;
    set({
      session: { conn, deviceId: known.deviceId, name: known.name, status: "connecting", phone: null },
    });
    // A phone that started by itself is the camera from now on — unless it
    // is already this computer's microphone and the camera is a webcam: then
    // it came back as the mic, and the camera stays what it was.
    const key = known.deviceId ?? "once";
    if (state.source !== key && !(state.micSource === key && !state.source)) {
      writeStored(SOURCE_KEY, key);
      set({ source: key });
      if (state.micSource && state.micSource !== key) {
        writeStored(MIC_SOURCE_KEY, null);
        set({ micSource: null });
      }
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
      const onOpen = () => {
        if (pc === peer) syncUse(true);
      };
      if (channel.readyState === "open") onOpen();
      else channel.onopen = onOpen;
      channel.onmessage = (e) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(String(e.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (pc !== peer) return;
        if (data.t === "bye") endSession("failed");
        else if (data.t === "state" && state.session) {
          set({ session: { ...state.session, phone: readPhoneState(data) } });
          checkWaiters();
        }
      };
      channel.onclose = () => {
        if (pc === peer) endSession("failed");
      };
    };
    peer.ontrack = (event) => {
      if (pc !== peer) return;
      if (event.track.kind === "video") {
        track = event.track;
      } else if (event.track.kind === "audio") {
        audioTrack = event.track;
        audioSink = new Audio();
        audioSink.muted = true;
        audioSink.srcObject = new MediaStream([event.track]);
        void audioSink.play().catch(() => {});
      }
    };
    peer.onconnectionstatechange = () => {
      if (pc !== peer) return;
      if (peer.connectionState === "connected" && track && state.session?.status !== "live") {
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        liveSince = Date.now();
        set({ session: state.session ? { ...state.session, status: "live" } : null });
        trackFeatureEvent(PHONE_CAMERA_EVENTS.start);
        const hadWaiters = waiters.length > 0;
        checkWaiters();
        if (!hadWaiters && !asked) emitCamera("arrived");
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

/**
 * What the room's camera (`"camera"`, the video) or mic (`"mic"`, the audio)
 * gets from the chosen phone: what is already coming in, or the phone asked
 * for it (it opens its camera / mic to match). Waits for the phone's page to
 * be opened if it is not — up to REQUEST_TIMEOUT_MS.
 */
export function acquirePhoneCamera(kind: PhoneKind = "camera"): Promise<MediaStreamTrack> {
  const source = kind === "camera" ? state.source : state.micSource;
  if (!source || !state.connected) return Promise.reject(new PhoneCameraError("unavailable"));
  if (kind === "camera" && phoneCameraLive()) return Promise.resolve(track!);
  if (kind === "mic" && phoneMicLive()) return Promise.resolve(audioTrack!);
  return new Promise<MediaStreamTrack>((resolve, reject) => {
    const waiter: Waiter = {
      kind,
      resolve,
      reject,
      timer: setTimeout(() => {
        const session = state.session;
        // Live already (the other one is using it): only this ask gives up.
        if (session?.status === "live") {
          dropWaiter(waiter);
          reject(new PhoneCameraError(kind === "mic" ? "nomic" : "timeout"));
          syncUse();
          return;
        }
        if (session?.conn) sendRaw({ t: "stop", conn: session.conn });
        closePc();
        set({ session: null });
        rejectAll(new PhoneCameraError(session?.status === "waiting" ? "offline" : "timeout"));
      }, REQUEST_TIMEOUT_MS),
    };
    waiters.push(waiter);
    const current = state.session;
    // Already on its way (asked, or connecting on its own), or live and
    // only needing to open the other one: tell it what is wanted now.
    if (current && sessionKey(current) === source) {
      if (current.status === "live") checkWaiters();
      else syncUse();
      return;
    }
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
      if (online) sendRaw({ t: "request", conn: online.conn, data: wants() });
      return;
    }
    const device = state.devices.find((d) => d.deviceId === source);
    if (!device) {
      dropWaiter(waiter);
      reject(new PhoneCameraError("unavailable"));
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
    if (online) sendRaw({ t: "request", conn: online.conn, data: wants() });
  });
}

/** Whether the phone's video is coming in (the room's camera can use it as is). */
export function phoneCameraLive(): boolean {
  const session = state.session;
  return Boolean(
    track &&
      track.readyState === "live" &&
      session?.status === "live" &&
      (!session.phone || session.phone.sendingCamera) &&
      state.source === sessionKey(session)
  );
}

/** The same, for its audio and the room's mic. */
export function phoneMicLive(): boolean {
  const session = state.session;
  return Boolean(
    audioTrack &&
      audioTrack.readyState === "live" &&
      session?.status === "live" &&
      session.phone?.sendingMic &&
      state.micSource === sessionKey(session)
  );
}
