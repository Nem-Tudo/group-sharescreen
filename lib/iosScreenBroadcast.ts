"use client";

// Real screen sharing in the iPhone app.
//
// iOS gives web pages no screen capture at all (no getDisplayMedia in Safari
// or in a WKWebView), so the share does not happen in this page. It happens in
// ios/App/Broadcast: a ReplayKit "Broadcast Upload Extension", a separate
// process iOS starts when the person confirms the system's "Iniciar
// transmissão" sheet, which then receives every frame of the whole screen —
// including while the person is in other apps, which is the point.
//
// That process cannot hand frames to this page (and this page is suspended
// while the person is in another app anyway), so it does the whole job on its
// own: it opens its own socket, registers with this person's login, joins
// this room as another device of theirs ("Nome (2)"), and sends the screen to
// everyone in the room with native WebRTC, speaking the same signalling as
// lib/useRoomMedia.ts's broadcaster. The server lets it in without a captcha
// or the "another device?" question on the strength of a token this session
// asks for first (signalingClient.requestScreenCompanion).
//
// What crosses over to the extension is a small JSON written into the App
// Group both processes share (ios/App/App/ScreenBroadcastPlugin.swift); its
// state comes back the same way, as "stateChange" events.
//
// Behind the experiment below: new, costly for the phone, and only testable on
// a real device.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { isIOSApp } from "./desktop";
import { signalingClient } from "./signalingClient";
import { getSignalingHttpBase, getSignalingWsUrl } from "./roomsApi";
import { groupAuthToken } from "./groupsApi";
import { iceConfigFor } from "./iceConfig";
import { BUILD_VERSION } from "./buildVersion";
import { trackFeatureEvent } from "./features";
import { translate } from "./i18n";

/** The feature's key in the admin panel. Target: user. */
export const IOS_SCREEN_FEATURE = "ios-screen-share";

/** Every event this reports — each must be a site event of the feature. */
export const IOS_SCREEN_EVENTS = {
  /** "Compartilhar tela" pressed and the system sheet asked for. */
  start: "ios_screen_start",
  /** The extension is in the room and sending. */
  live: "ios_screen_live",
  /** It ended with an error (the extension's or ours). */
  fail: "ios_screen_fail",
  /** Stopped from the room's button. */
  stop: "ios_screen_stop",
} as const;

/**
 * "paused": the server stopped the broadcast for an ad (lib/broadcastAdGate.ts),
 * exactly as it does a computer's share. The popup comes up in this page —
 * see the apply() below — and the broadcast resumes when it is answered.
 */
export type IOSScreenState = "idle" | "connecting" | "live" | "paused" | "error";

interface StateEvent {
  state: IOSScreenState;
  /** Human-readable, already in the phone's language (the extension writes it). */
  message?: string;
  /** While "paused": the server's gate message, as JSON. */
  adGate?: string;
}

interface ScreenBroadcastPlugin {
  /** Stores the config for the extension and opens the system's broadcast sheet. */
  start(options: { config: string }): Promise<void>;
  /** Asks a running broadcast to end. */
  stop(): Promise<void>;
  getState(): Promise<StateEvent>;
  /** Hands the ad gate popup's answer to the extension, which sends it as its own. */
  adGate(options: { message: string }): Promise<void>;
  addListener(event: "stateChange", listener: (event: StateEvent) => void): Promise<PluginListenerHandle>;
}

const ScreenBroadcast = registerPlugin<ScreenBroadcastPlugin>("ScreenBroadcast");

/**
 * Whether this app build can do it at all: the iOS app, and a build new enough
 * to carry the plugin (an older install from the store simply does not).
 */
export function isIOSScreenBroadcastAvailable(): boolean {
  return isIOSApp() && Capacitor.isPluginAvailable("ScreenBroadcast");
}

function noopSubscribe() {
  return () => {};
}

/**
 * isIOSScreenBroadcastAvailable as a hook: false on the server and in the
 * first client render, so the markup a page hydrates with never depends on it.
 */
export function useIOSScreenBroadcastAvailable(): boolean {
  return useSyncExternalStore(noopSubscribe, isIOSScreenBroadcastAvailable, () => false);
}

// --- state, shared by every component that shows it ----------------------

type Snapshot = { state: IOSScreenState; message: string | null };
let snapshot: Snapshot = { state: "idle", message: null };
const listeners = new Set<() => void>();
let wired = false;

function setSnapshot(next: Snapshot) {
  if (next.state === snapshot.state && next.message === snapshot.message) return;
  const wasLive = snapshot.state === "live";
  snapshot = next;
  if (next.state === "live" && !wasLive) trackFeatureEvent(IOS_SCREEN_EVENTS.live, { feature: IOS_SCREEN_FEATURE });
  if (next.state === "error") trackFeatureEvent(IOS_SCREEN_EVENTS.fail, { feature: IOS_SCREEN_FEATURE });
  listeners.forEach((listener) => listener());
}

function wire() {
  if (wired || !isIOSScreenBroadcastAvailable()) return;
  wired = true;
  const apply = (event: StateEvent) => {
    setSnapshot({ state: event.state ?? "idle", message: event.message ? String(event.message) : null });
    relayAdGate(event);
  };
  void ScreenBroadcast.addListener("stateChange", apply).catch(() => {});
  // A broadcast can already be running when this page loads (the app was
  // reopened mid-share); the button has to say so from the first frame.
  void ScreenBroadcast.getState().then(apply).catch(() => {});
}

// The broadcast's ad gate, shown in this page with the same popup a
// computer's share gets (signalingClient.showRelayedBroadcastAdGate). Its
// answer goes back to the extension, whose connection is the paused one.
function relayAdGate(event: StateEvent) {
  if (event.state === "paused" && event.adGate) {
    try {
      const gate = JSON.parse(event.adGate) as { totalSeconds?: unknown; firstHours?: unknown; intervalHours?: unknown };
      signalingClient.showRelayedBroadcastAdGate(
        {
          totalSeconds: typeof gate.totalSeconds === "number" ? gate.totalSeconds : 0,
          firstHours: typeof gate.firstHours === "number" ? gate.firstHours : 6,
          intervalHours: typeof gate.intervalHours === "number" ? gate.intervalHours : 2,
        },
        (msg) => void ScreenBroadcast.adGate({ message: JSON.stringify(msg) }).catch(() => {})
      );
      return;
    } catch {
      // Unreadable: fall through and treat the gate as gone.
    }
  }
  signalingClient.clearRelayedBroadcastAdGate();
}

function subscribe(listener: () => void) {
  wire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const IDLE: Snapshot = { state: "idle", message: null };

/** The extension's state, live. Always idle outside the iOS app. */
export function useIOSScreenBroadcast(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => IDLE);
}

/** True while a broadcast is starting or running — what the share button shows as "on". */
export function isIOSScreenActive(state: IOSScreenState): boolean {
  return state === "connecting" || state === "live" || state === "paused";
}

// --- actions -----------------------------------------------------------------

function refusalMessage(reason: string): string {
  if (reason === "permission") return translate("iosScreen.notAllowedInRoom");
  if (reason === "banned") return translate("iosScreen.banned");
  return translate("iosScreen.couldNotStart");
}

/**
 * Starts the broadcast for `room`: gets the server's token, hands the
 * extension everything it needs, and opens the system sheet. Resolves once the
 * sheet is up; what happens next (the person confirming or not, the extension
 * joining) arrives through useIOSScreenBroadcast.
 */
export async function startIOSScreenBroadcast(
  room: string,
  options: {
    /**
     * A group voice room with the stream-preview experiment on: the extension
     * sends the rooms list's hover picture itself, as the page does for a
     * computer's share (lib/streamPreview.ts).
     */
    preview?: { groupId: string; channelId: string } | null;
  } = {}
): Promise<void> {
  trackFeatureEvent(IOS_SCREEN_EVENTS.start, { feature: IOS_SCREEN_FEATURE });
  let companion: Awaited<ReturnType<typeof signalingClient.requestScreenCompanion>>;
  try {
    companion = await signalingClient.requestScreenCompanion(room);
  } catch (err) {
    // The server's reason code (see the API's "screen-companion-token").
    setSnapshot({ state: "error", message: refusalMessage(err instanceof Error ? err.message : "") });
    return;
  }
  const config = {
    v: 1,
    wsUrl: getSignalingWsUrl(),
    room,
    companionToken: companion.companionToken,
    loginToken: companion.loginToken,
    name: companion.name,
    // The exact servers this page would use right now — TURN included only
    // when this account may use it (see lib/iceConfig.ts). The extension has
    // no way to work that out on its own.
    iceServers: iceConfigFor(false).iceServers ?? [],
    preview: options.preview
      ? {
          url: `${getSignalingHttpBase()}/groups/${encodeURIComponent(options.preview.groupId)}/channels/${encodeURIComponent(options.preview.channelId)}/stream-preview`,
          token: groupAuthToken(),
        }
      : null,
    version: BUILD_VERSION,
    createdAt: Date.now(),
  };
  try {
    await ScreenBroadcast.start({ config: JSON.stringify(config) });
    // Cleared here rather than set to "connecting": nothing is running until
    // the person confirms the sheet, and they may well close it instead.
    setSnapshot({ state: snapshot.state === "error" ? "idle" : snapshot.state, message: null });
  } catch {
    setSnapshot({ state: "error", message: translate("iosScreen.couldNotStart") });
  }
}

/** Ends a running broadcast. iOS shows its own "transmissão encerrada" note. */
export async function stopIOSScreenBroadcast(): Promise<void> {
  trackFeatureEvent(IOS_SCREEN_EVENTS.stop, { feature: IOS_SCREEN_FEATURE });
  try {
    await ScreenBroadcast.stop();
  } catch {
    // Nothing running, or the extension already gone: either way it is off.
  }
  setSnapshot({ state: "idle", message: null });
}

/** Forgets an error once it has been read (the ✕ on the notice). */
export function dismissIOSScreenError() {
  if (snapshot.state === "error") setSnapshot({ state: "idle", message: null });
}
