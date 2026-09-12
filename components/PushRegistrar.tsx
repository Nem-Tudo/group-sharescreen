"use client";

import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "@/lib/AuthContext";
import { ensurePushRegistration, ensureServiceWorker } from "@/lib/pushRegistration";
import { signalingClient } from "@/lib/signalingClient";
import { openDirectMessages } from "@/lib/dmWindow";
import { useGroupNavigation } from "@/lib/groupNavigation";

// Three jobs, all of them invisible, all of them about the app being *closed*.
//
//   1. Keep this device registered for push. Not once on first permission —
//      every app open, because a browser may rotate a push subscription at any
//      time without telling anybody, and a stale endpoint is a device that
//      quietly stopped ringing months ago.
//   2. Tell the server when the app goes behind something. That is what turns
//      a ring from "shout down the socket" into "wake the phone", and without
//      it a locked phone is the one device a call never reaches — its socket
//      stays open while its WebView is frozen solid.
//   3. Handle a click on a notification when a tab *is* already open, so it
//      focuses what is running instead of opening a second copy of the app.
//
// Mounted once at the layout root, like SocialNotifier and DmNotifier: a call
// arrives whenever it arrives, and a device that only registered itself while
// somebody happened to be inside a room would be one that never rings.

export function PushRegistrar() {
  const { account } = useAuth();
  const navigation = useGroupNavigation();

  // ─── Registration ───────────────────────────────────────────────────────
  useEffect(() => {
    // The worker is worth having even with no account and no permission: it is
    // what receives a click on a notification, and registering it early means
    // it is already installed by the time somebody first says yes.
    void ensureServiceWorker();
    if (!account) return;
    // Never interactive: this runs on load, and asking for permission outside
    // a gesture is how the one prompt a browser will ever show gets spent on a
    // moment nobody asked for. The bell is the gesture (see
    // lib/useNotifications.ts's enable); this only re-registers a device whose
    // permission is already granted.
    void ensurePushRegistration();
  }, [account]);

  // ─── Foreground / background ────────────────────────────────────────────
  useEffect(() => {
    const report = (background: boolean) => signalingClient.reportAppState(background);

    // The web answer. `visibilitychange` covers a tab going behind another
    // tab, a window being minimised and a phone browser being backgrounded,
    // which is every case that matters here.
    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      report(hidden);
      if (!hidden && document.hasFocus()) signalingClient.reportFocus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();

    // Which of several open windows is the one in use — two browser windows
    // side by side are both visible, and only a click into one says which.
    // It is what decides where a notification is announced (see
    // signalingClient.reportFocus).
    const onFocus = () => signalingClient.reportFocus();
    window.addEventListener("focus", onFocus);

    // The Android shell's answer, which is not the same event: a Capacitor app
    // sent to the background does fire visibilitychange, but the app being
    // *resumed* from a notification tap is what appStateChange reports first
    // and most reliably — and being wrong about the resume is what leaves a
    // phone marked unreachable while somebody is looking straight at it.
    let remove: (() => void) | null = null;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        report(!isActive);
        if (isActive) signalingClient.reportFocus();
      }).then((handle) => {
        remove = () => void handle.remove();
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      remove?.();
    };
  }, []);

  // ─── Opened *by* a notification ─────────────────────────────────────────
  //
  // The case above covers a tab that was already open. This is the other one:
  // the browser was closed, the service worker opened a new window at the
  // notification's own URL, and the conversation to show is in the query
  // string. Consumed on read — the parameter is an instruction for this one
  // load, and leaving it in the address bar would re-open the thread on every
  // subsequent navigation back to the home page.
  //
  // A call needs nothing here: the ringing screen asks the API what is
  // ringing on every start (see components/CallHost.tsx), which also covers
  // the app being opened from the launcher rather than the notification.
  useEffect(() => {
    if (!account) return;
    const params = new URLSearchParams(window.location.search);
    const dm = params.get("dm");
    if (!dm) return;
    openDirectMessages(dm);
    params.delete("dm");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    );
  }, [account]);

  // ─── Clicking a notification ────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { source?: string; type?: string; payload?: Record<string, unknown> }
        | null;
      if (!data || data.source !== "golive-sw") return;
      if (data.type !== "notification-click") return;
      const payload = data.payload ?? {};
      try {
        window.focus();
      } catch {
        // Some engines refuse focus() from here; the rest still runs.
      }
      // A call needs nothing done: the ring is already on screen (or arrives
      // over the socket the moment this tab is looked at), and CallHost owns
      // it. A message opens the conversation it came from, which is the only
      // thing somebody clicking it could have meant.
      if (payload.kind === "dm" && typeof payload.fromId === "string") {
        openDirectMessages(payload.fromId);
      }
      // A group message opens its text room. A client-side navigation, so a
      // group voice call already running in this tab is not dropped by a reload
      // — and with the group shell already open, one that never waits on the
      // server (see lib/groupNavigation). Only a site-relative group path is
      // followed.
      if (
        payload.kind === "group-message" &&
        typeof payload.url === "string" &&
        payload.url.startsWith("/groups/")
      ) {
        navigation.push(payload.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigation]);

  return null;
}
