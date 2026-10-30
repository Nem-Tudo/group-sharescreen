"use client";

import { useSyncExternalStore } from "react";
import { iceConfigFor } from "./iceConfig";
import { trackFeatureEvent } from "./features";
import { MULTI_CAMERA_EVENTS } from "./multiCamera";
import {
  getPhoneCameraState,
  PhoneCameraError,
  type PhoneCameraErrorCode,
  sendPhoneCameraRelay,
  setPhoneCameraRouter,
} from "./phoneCamera";

// The phones of "Várias câmeras" (see lib/multiCamera.ts): one more phone per
// extra camera slot, each over a WebRTC connection of its own, alongside the
// one lib/phoneCamera.ts keeps for the room's main camera and mic.
//
// They ride the same host socket — the relay already routes everything by the
// phone's connection id, so several phones on one computer need nothing new
// on the server. What this file adds is the other half of that routing on
// this side: messages about a phone held by an extra slot come here (see
// setPhoneCameraRouter) instead of to the main session, which would otherwise
// take any phone that offers as *the* camera and drop the one it had.
//
// Saved phones only: a one-time phone has no id to tell two of them apart.
// Video only: the mic stays the main session's business.

/** How long a slot waits for its phone to answer. */
const REQUEST_TIMEOUT_MS = 90_000;
/** How long an offered connection has to come up before it is given up. */
const CONNECT_TIMEOUT_MS = 25_000;

interface Session {
  slot: string;
  deviceId: string;
  name: string;
  conn: string | null;
  status: "waiting" | "asking" | "connecting" | "live";
  pc: RTCPeerConnection | null;
  control: RTCDataChannel | null;
  track: MediaStreamTrack | null;
  connectTimer: ReturnType<typeof setTimeout> | null;
  waiters: { resolve: (track: MediaStreamTrack) => void; reject: (err: PhoneCameraError) => void }[];
  waitTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, Session>();

// ── Store, for the panels (which phones are taken, and how each is doing) ───

export type ExtraPhoneStatus = Session["status"];
let snapshot: Record<string, { deviceId: string; name: string; status: ExtraPhoneStatus }> = {};
const listeners = new Set<() => void>();

function publish() {
  snapshot = Object.fromEntries(
    [...sessions.values()].map((s) => [s.slot, { deviceId: s.deviceId, name: s.name, status: s.status }])
  );
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: typeof snapshot = {};

/** Every extra slot fed by a phone right now, by slot. */
export function useExtraPhoneCameras() {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** Saved phone ids an extra slot holds — not to be offered anywhere else. */
export function extraPhoneDeviceIds(): Set<string> {
  return new Set([...sessions.values()].map((s) => s.deviceId));
}

// ── Events the slots listen to ──────────────────────────────────────────────

const endedListeners = new Set<(slot: string) => void>();
/** A live phone of a slot went away (closed, lost, stopped on the phone). */
export function onExtraPhoneEnded(listener: (slot: string) => void): () => void {
  endedListeners.add(listener);
  return () => {
    endedListeners.delete(listener);
  };
}

const pairedListeners = new Set<(deviceId: string, name: string) => void>();
/**
 * A phone just linked from the "+" (see lib/phoneCamera's linkFor "extra").
 * Called synchronously, before the phone can offer: a listener that acquires
 * it right there holds it before the main session could take it.
 */
export function onExtraPhonePaired(listener: (deviceId: string, name: string) => void): () => void {
  pairedListeners.add(listener);
  return () => {
    pairedListeners.delete(listener);
  };
}

// ── The connection to one phone ─────────────────────────────────────────────

const USE = { camera: true, mic: false };

function sendUse(session: Session) {
  if (session.control?.readyState !== "open") return;
  try {
    session.control.send(JSON.stringify({ t: "use", ...USE }));
  } catch {
    // Closing — the session ends on its own.
  }
}

function closePc(session: Session) {
  if (session.connectTimer) clearTimeout(session.connectTimer);
  session.connectTimer = null;
  try {
    if (session.control?.readyState === "open") session.control.send(JSON.stringify({ t: "bye" }));
  } catch {
    // Closing anyway.
  }
  session.control = null;
  session.pc?.close();
  session.pc = null;
  session.track = null;
}

function finish(session: Session, reason: PhoneCameraErrorCode, notifyRelay: boolean) {
  if (sessions.get(session.slot) !== session) return;
  const wasLive = session.status === "live";
  if (notifyRelay && session.conn) sendPhoneCameraRelay({ t: "stop", conn: session.conn });
  closePc(session);
  if (session.waitTimer) clearTimeout(session.waitTimer);
  sessions.delete(session.slot);
  const waiters = session.waiters;
  session.waiters = [];
  if (waiters.length > 0 && reason !== "cancelled") {
    trackFeatureEvent(MULTI_CAMERA_EVENTS.phoneFailed);
  }
  for (const waiter of waiters) waiter.reject(new PhoneCameraError(reason));
  publish();
  if (wasLive) endedListeners.forEach((l) => l(session.slot));
}

function ask(session: Session, conn: string) {
  session.conn = conn;
  session.status = "asking";
  sendPhoneCameraRelay({ t: "request", conn, data: USE });
  publish();
}

async function onOffer(session: Session, conn: string, sdp: string) {
  closePc(session);
  session.conn = conn;
  session.status = "connecting";
  publish();
  const peer = new RTCPeerConnection(iceConfigFor(false));
  session.pc = peer;
  const current = () => session.pc === peer && sessions.get(session.slot) === session;
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendPhoneCameraRelay({ t: "signal", conn, data: { candidate: event.candidate.toJSON() } });
    }
  };
  peer.ondatachannel = (event) => {
    if (!current()) return;
    const channel = event.channel;
    session.control = channel;
    if (channel.readyState === "open") sendUse(session);
    else channel.onopen = () => current() && sendUse(session);
    channel.onmessage = (e) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(e.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (current() && data.t === "bye") finish(session, "failed", false);
    };
    channel.onclose = () => {
      if (current()) finish(session, "failed", false);
    };
  };
  peer.ontrack = (event) => {
    if (current() && event.track.kind === "video") session.track = event.track;
  };
  peer.onconnectionstatechange = () => {
    if (!current()) return;
    if (peer.connectionState === "connected" && session.track && session.status !== "live") {
      if (session.connectTimer) clearTimeout(session.connectTimer);
      session.connectTimer = null;
      if (session.waitTimer) clearTimeout(session.waitTimer);
      session.waitTimer = null;
      session.status = "live";
      publish();
      trackFeatureEvent(MULTI_CAMERA_EVENTS.phoneLive);
      const track = session.track;
      const waiters = session.waiters;
      session.waiters = [];
      for (const waiter of waiters) waiter.resolve(track);
    } else if (peer.connectionState === "failed" || peer.connectionState === "closed") {
      finish(session, "failed", true);
    }
  };
  session.connectTimer = setTimeout(() => {
    if (current() && session.status !== "live") finish(session, "failed", true);
  }, CONNECT_TIMEOUT_MS);
  try {
    await peer.setRemoteDescription({ type: "offer", sdp });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendPhoneCameraRelay({ t: "signal", conn, data: { type: "answer", sdp: answer.sdp } });
  } catch {
    if (current()) finish(session, "failed", true);
  }
}

function sessionForConn(conn: string): Session | null {
  for (const session of sessions.values()) if (session.conn === conn) return session;
  // A phone of ours that reconnected (new connection id) and offered on its
  // own: still ours, by its saved id.
  const online = getPhoneCameraState().online.find((o) => o.conn === conn);
  if (!online?.deviceId) return null;
  for (const session of sessions.values()) if (session.deviceId === online.deviceId) return session;
  return null;
}

// What the host socket hands over before the main session sees it. True:
// handled here, the main session must not act on it.
setPhoneCameraRouter({
  route(msg) {
    switch (msg.t) {
      case "cam-online": {
        const deviceId = typeof msg.deviceId === "string" ? msg.deviceId : null;
        if (!deviceId) return false;
        for (const session of sessions.values()) {
          if (session.deviceId !== deviceId) continue;
          if (session.status === "waiting") ask(session, String(msg.conn));
          else session.conn = String(msg.conn);
          // The main session never holds a phone a slot does: nothing for it.
          return true;
        }
        return false;
      }
      case "cam-offline": {
        for (const session of sessions.values()) {
          if (session.conn === msg.conn && session.status !== "live") {
            session.conn = null;
            session.status = "waiting";
            publish();
          }
        }
        return false;
      }
      case "signal": {
        const conn = String(msg.conn);
        const session = sessionForConn(conn);
        if (!session) return false;
        const data = msg.data as Record<string, unknown> | undefined;
        if (data?.type === "offer" && typeof data.sdp === "string") {
          void onOffer(session, conn, data.sdp);
        } else if (data?.candidate && session.pc && session.conn === conn) {
          session.pc.addIceCandidate(data.candidate as RTCIceCandidateInit).catch(() => {
            // A late candidate for a description already replaced.
          });
        }
        return true;
      }
      case "declined":
      case "stopped": {
        const session = [...sessions.values()].find((s) => s.conn === msg.conn);
        if (!session) return false;
        finish(session, msg.t === "declined" ? "declined" : "failed", false);
        return true;
      }
      case "state":
        return [...sessions.values()].some((s) => s.conn === msg.conn);
      case "paired": {
        const device = msg.device as { deviceId?: string; name?: string } | null;
        if (getPhoneCameraState().linkFor !== "extra") return false;
        if (device?.deviceId) {
          trackFeatureEvent(MULTI_CAMERA_EVENTS.pair);
          const id = device.deviceId;
          const name = String(device.name ?? msg.name ?? "");
          pairedListeners.forEach((l) => l(id, name));
        }
        return false;
      }
    }
    return false;
  },
  // The socket is gone for good (the switch went off) or another tab took
  // the phones: every slot lets go of its phone.
  reset() {
    for (const session of [...sessions.values()]) finish(session, "cancelled", true);
  },
});

/**
 * The video of the saved phone `deviceId` for an extra slot: what is already
 * coming in, or the phone asked for it — waiting for its page to be opened
 * if it is not, up to REQUEST_TIMEOUT_MS. A slot asking for another phone
 * lets go of the one it had first.
 */
export function acquireExtraPhoneCamera(slot: string, deviceId: string, name: string): Promise<MediaStreamTrack> {
  const state = getPhoneCameraState();
  if (!state.connected) return Promise.reject(new PhoneCameraError("unavailable"));
  let session = sessions.get(slot);
  if (session && session.deviceId !== deviceId) {
    finish(session, "cancelled", true);
    session = undefined;
  }
  if (session?.status === "live" && session.track?.readyState === "live") {
    return Promise.resolve(session.track);
  }
  return new Promise<MediaStreamTrack>((resolve, reject) => {
    if (!session) {
      session = {
        slot,
        deviceId,
        name,
        conn: null,
        status: "waiting",
        pc: null,
        control: null,
        track: null,
        connectTimer: null,
        waiters: [],
        waitTimer: null,
      };
      sessions.set(slot, session);
      const created = session;
      created.waitTimer = setTimeout(() => {
        if (created.status !== "live") finish(created, created.status === "waiting" ? "offline" : "timeout", true);
      }, REQUEST_TIMEOUT_MS);
      const online = state.online.find((o) => o.deviceId === deviceId);
      if (online) ask(created, online.conn);
      else publish();
    }
    session.waiters.push({ resolve, reject });
  });
}

/** The slot's phone video, when it is coming in. */
export function extraPhoneCameraTrack(slot: string): MediaStreamTrack | null {
  const session = sessions.get(slot);
  if (session?.status !== "live" || session.track?.readyState !== "live") return null;
  return session.track;
}

/** The slot is done with its phone: it is told to stop filming. */
export function releaseExtraPhoneCamera(slot: string) {
  const session = sessions.get(slot);
  if (session) finish(session, "cancelled", true);
}
