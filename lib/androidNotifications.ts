"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

// The Android shell's own notifications — the conversation-style ones with the
// sender's face, "Responder" and a real ringing screen for calls. Drawn by
// android/app/src/main/java/me/nemtudo/golive/GoLiveNotifications.java; this
// file is the little the site has to tell it.
//
// Two things:
//
//   1. Whether the shell can draw them at all. Only then does the device
//      register with `renderer: "native"` (see lib/pushRegistration.ts), which
//      is what makes the API send data-only pushes — an older APK receiving
//      those would draw nothing, so the plugin's presence is the check.
//   2. The session. The notification's buttons send a reply, mark a
//      conversation read or refuse a call while the app may not be running,
//      so they need the account token and the API's address, handed over here
//      whenever either changes.

interface GoLiveNotificationsPlugin {
  setSession(options: { token: string | null; apiBase: string | null }): Promise<void>;
  clear(): Promise<void>;
}

const GoLiveNotifications = registerPlugin<GoLiveNotificationsPlugin>("GoLiveNotifications");

/** True in an Android build that draws its own notifications. */
export function hasNativeNotifications(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("GoLiveNotifications")
  );
}

/** Hands the notification buttons the session to act with; null forgets it. */
export function setNativeNotificationSession(token: string | null, apiBase: string): void {
  if (!hasNativeNotifications()) return;
  void GoLiveNotifications.setSession({ token, apiBase: token ? apiBase : null }).catch(() => {
    // The buttons fall back to doing nothing; the notifications still show.
  });
}

// ─── "Atender" pressed on the notification ────────────────────────────────
//
// The press opens the app, and the app has to accept the call itself — it is
// the side with the connection. But on a cold start the ring is not known yet
// when the tap is delivered: CallHost asks the API what is ringing only once
// it has loaded. So the press is held here, by call id, until CallHost has
// that call on screen and can act on it.

let pendingAccept: { callId: string; at: number } | null = null;
const acceptListeners = new Set<() => void>();

/** How long a press waits for its call to show up before it is dropped. */
const PENDING_ACCEPT_MS = 60_000;

export function requestNativeCallAccept(callId: string): void {
  pendingAccept = { callId, at: Date.now() };
  acceptListeners.forEach((listener) => listener());
}

/**
 * Takes the held press if it is for this call. One-shot, so a call accepted
 * this way is not accepted again on the next render.
 */
export function consumeNativeCallAccept(callId: string): boolean {
  if (!pendingAccept || pendingAccept.callId !== callId) return false;
  const fresh = Date.now() - pendingAccept.at < PENDING_ACCEPT_MS;
  pendingAccept = null;
  return fresh;
}

export function onNativeCallAccept(listener: () => void): () => void {
  acceptListeners.add(listener);
  return () => {
    acceptListeners.delete(listener);
  };
}
