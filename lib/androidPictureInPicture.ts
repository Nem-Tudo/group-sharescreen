"use client";

// Picture-in-picture on the Android shell.
//
// The web app already has PiP, through `HTMLVideoElement.requestPictureInPicture()`
// — see components/VideoTile. That API is desktop-only: in a WebView, and in
// Chrome for Android, `document.pictureInPictureEnabled` is false, which is
// why the existing button correctly hides itself on a phone. It is not a bug
// and there is no flag that turns it on.
//
// Android's picture-in-picture is a property of the *activity*: the whole app
// window shrinks into the floating box. That difference decides everything
// about how this is used. The floating window will show whatever the page is
// rendering at that moment, so the caller strips the page down to a single
// tile *before* asking to enter (see WatchRoom's `pipActive` and the
// `[data-pip]` rules in app/globals.css). Skip that and "picture in picture"
// puts a header, a chat column and a participant list into a box the size of
// a playing card.
//
// Everything here is a no-op off the Android shell, so call sites do not have
// to branch: isAndroidPipAvailable() answers false and enterAndroidPip()
// resolves false.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface PictureInPictureModeEvent {
  /** True when the window just entered PiP, false when it left. */
  active: boolean;
}

interface PictureInPicturePluginInterface {
  isSupported(): Promise<{ supported: boolean }>;
  /**
   * `aspectRatio` is width/height of the thing being watched, so the floating
   * window is not a different shape from the video inside it. The native side
   * clamps it to the range Android accepts.
   */
  enter(options: { aspectRatio: number }): Promise<{ entered: boolean }>;
  addListener(
    eventName: "modeChange",
    listener: (event: PictureInPictureModeEvent) => void
  ): Promise<PluginListenerHandle>;
}

// No web implementation registered, for the same reason ScreenCapture
// registers none: every call below is guarded by isAndroidPipAvailable(), so
// a missing implementation elsewhere is never exercised.
const PictureInPicture = registerPlugin<PictureInPicturePluginInterface>("PictureInPicture");

function onAndroidShell(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "android"
  );
}

// Answered by the device once and remembered. The question is about hardware
// and OS version (see the plugin's deviceSupportsPip) — neither changes while
// the app is running — and the button that reads it renders on every tile in
// the room, which is not somewhere to put a bridge round trip.
let supported: boolean | null = null;

/**
 * Whether this device can float the app window at all.
 *
 * Starts as false and becomes true once the device has answered, so a caller
 * rendering before that shows no button rather than a button that does
 * nothing. `refreshAndroidPipSupport` below is what resolves it.
 */
export function isAndroidPipAvailable(): boolean {
  return supported === true;
}

/**
 * Asks the device whether it supports PiP, once. Safe to call repeatedly —
 * every call after the first returns the remembered answer without touching
 * the bridge.
 *
 * Returns the answer so a caller can re-render on it.
 */
export async function refreshAndroidPipSupport(): Promise<boolean> {
  if (supported !== null) return supported;
  if (!onAndroidShell()) {
    supported = false;
    return false;
  }
  try {
    const result = await PictureInPicture.isSupported();
    supported = result.supported === true;
  } catch {
    // An older shell without this plugin — the site is loaded live, so a
    // build from before this existed is a real possibility for as long as
    // people put off updating the app.
    supported = false;
  }
  return supported;
}

/**
 * Puts the app window into the floating box. Resolves whether it worked.
 *
 * False is an ordinary answer, not an error: the user can switch PiP off for
 * an app in Android's settings, and the system refuses in a few states of its
 * own. The caller is expected to undo whatever layout change it made in
 * anticipation — see WatchRoom, which drops back out of its stripped view.
 */
export async function enterAndroidPip(aspectRatio: number): Promise<boolean> {
  if (!onAndroidShell()) return false;
  try {
    const result = await PictureInPicture.enter({ aspectRatio });
    return result.entered === true;
  } catch {
    return false;
  }
}

/**
 * Subscribes to the window entering and leaving PiP.
 *
 * The leaving half is the one that has to exist: the person closes the
 * floating window or taps back into the app, and nothing on this side would
 * otherwise know to put the full room back.
 */
export function onAndroidPipModeChange(cb: (active: boolean) => void): () => void {
  if (!onAndroidShell()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  void PictureInPicture.addListener("modeChange", (event) => cb(event.active === true))
    .then((h) => {
      // Unsubscribed before the listener finished attaching — remove it now
      // rather than leaving one bound to a component that is gone.
      if (cancelled) void h.remove();
      else handle = h;
    })
    .catch(() => {
      // Older shell without the plugin; nothing to listen to.
    });
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
