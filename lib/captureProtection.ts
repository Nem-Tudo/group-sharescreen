"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getDesktopBridge, isDesktopApp } from "./desktop";

// Keeping what is on screen out of screenshots and screen recorders — for a
// protected room (see WatchRoom) and a view-once file (see ViewOnceViewer).
//
// A website cannot do this at all: no browser offers a page any say over
// Print Screen, the Snipping Tool or OBS. The desktop app can, through the
// OS's own switch (electron/main.ts's capture protection section), so
// protected content is only ever shown there. Everywhere else the caller
// shows a gate instead of the content.
//
// The switch is per window and there is one window, so it is counted here:
// a view-once file closed inside a protected room must not turn the room's
// protection off with it.

export type CaptureProtectionLevel =
  /** Windows: left out of every ordinary capture. */
  | "full"
  /** macOS: older capture APIs respect it, ScreenCaptureKit does not. */
  | "partial"
  /** In the app, but this OS (Linux) or this shell (too old) cannot. */
  | "unsupported"
  /** A browser: nothing can be protected here. */
  | "browser";

export function captureProtectionLevel(): CaptureProtectionLevel {
  const bridge = getDesktopBridge();
  if (!bridge || !isDesktopApp()) return "browser";
  return bridge.captureProtection?.level ?? "unsupported";
}

export function canProtectCapture(): boolean {
  const level = captureProtectionLevel();
  return level === "full" || level === "partial";
}

let holders = 0;
// The one request that turns it on, shared by everybody who asks while it is
// on its way, so "ready" means the OS has actually taken it.
let applied: Promise<boolean> | null = null;

function acquire(): Promise<boolean> {
  holders += 1;
  const bridge = getDesktopBridge()?.captureProtection;
  if (!bridge) return Promise.resolve(false);
  if (!applied) applied = bridge.set(true).catch(() => false);
  return applied;
}

function release() {
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  applied = null;
  void getDesktopBridge()?.captureProtection?.set(false).catch(() => {});
}

export type CaptureProtectionState =
  /** Not asked for. */
  | "off"
  /** Asked for; the content must stay hidden until it is "on". */
  | "pending"
  | "on"
  /** Could not be turned on — the content must not be shown. */
  | "failed";

/**
 * Holds the window's protection for as long as `active` is true, and says
 * when it is actually in place. Whatever is being protected renders only on
 * "on": drawing it first and protecting it a moment later would leave a
 * frame for a recorder to catch.
 */
export function useCaptureProtection(active: boolean): CaptureProtectionState {
  // What the OS answered for the current hold, or null while it has not.
  const [answer, setAnswer] = useState<boolean | null>(null);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void acquire().then((ok) => {
      if (alive) setAnswer(ok);
    });
    return () => {
      alive = false;
      release();
      setAnswer(null);
    };
  }, [active]);
  if (!active) return "off";
  if (answer === null) return "pending";
  return answer ? "on" : "failed";
}

// ── The protected room, for whoever needs to know ──────────────────────────
//
// A protected room turns off everything in the app that would record it or
// carry it out of the protected window: call recording, clips, picture-in-
// picture (a separate window the OS protection does not cover) and the OBS
// source. Those live in components far from WatchRoom, so the fact is kept
// here rather than threaded through as props.

let protectedRoom = false;
const roomListeners = new Set<() => void>();

export function setProtectedRoomActive(on: boolean) {
  if (protectedRoom === on) return;
  protectedRoom = on;
  roomListeners.forEach((listener) => listener());
}

export function isProtectedRoomActive(): boolean {
  return protectedRoom;
}

function subscribeProtectedRoom(listener: () => void) {
  roomListeners.add(listener);
  return () => {
    roomListeners.delete(listener);
  };
}

export function useProtectedRoom(): boolean {
  return useSyncExternalStore(subscribeProtectedRoom, isProtectedRoomActive, () => false);
}
