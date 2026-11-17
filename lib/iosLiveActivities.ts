"use client";

// "Fulano está ao vivo" on the iPhone's Dynamic Island and lock screen.
//
// The card is started by the server with a push (sharescreen-api/server/
// friendLive.ts) and drawn by the app's widget extension (ios/App/Widgets); no
// page is involved in showing it. What the page does is the one thing the
// native side cannot work out alone: who is signed in. The app needs that to
// hand the server its tokens (ios/App/App/LiveActivityRegistrar.swift), so the
// session goes over to it here — the same shape as the Android shell's
// setNativeNotificationSession.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { isIOSApp } from "./desktop";
import { getDeviceId } from "./deviceId";
import { getLocale } from "./i18n";
import { trackFeatureEvent } from "./features";

/** The feature's key in the admin panel (decided on the receiving side, by the API). Target: user. */
export const FRIEND_LIVE_FEATURE = "friend-live-activity";

/** Every event this reports — each must be a site event of the feature. */
export const FRIEND_LIVE_EVENTS = {
  /** A card was put on this person's phone (counted by the API). */
  sent: "friend_live_sent",
  /** The room was opened from the card. */
  open: "friend_live_open",
} as const;

interface LiveActivitiesPlugin {
  /** The session the app sends its tokens with; null signs this device out of the cards. */
  configure(options: { apiBase: string; authToken: string | null; deviceId: string | null; lang: string }): Promise<void>;
}

const LiveActivities = registerPlugin<LiveActivitiesPlugin>("LiveActivities");

export function setIOSLiveActivitySession(authToken: string | null, apiBase: string) {
  if (!isIOSApp() || !Capacitor.isPluginAvailable("LiveActivities")) return;
  void LiveActivities.configure({
    apiBase,
    authToken,
    deviceId: getDeviceId(),
    lang: getLocale(),
  }).catch(() => {});
}

/**
 * The card's "Entrar" opens /watch/<room>?via=live-activity (see
 * lib/capacitorBridge.ts). Counted once, and the marker taken off the address
 * so a reload or a shared link does not count again.
 */
export function trackLiveActivityOpen() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("via") !== "live-activity") return;
  trackFeatureEvent(FRIEND_LIVE_EVENTS.open, { feature: FRIEND_LIVE_FEATURE });
  url.searchParams.delete("via");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
