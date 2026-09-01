"use client";

// System notifications for GoLive — the one module every feature that wants to
// reach a user outside the tab goes through (chat mentions today; "someone
// started sharing", "your room is about to close", a DM, an admin ping, later).
//
// It hides three things behind a single showNotification() call so no caller
// has to know which shell it is running in or re-derive the etiquette:
//
//   1. The backend. A browser tab and the Electron app both have the web
//      Notification API (Electron maps it straight to a native toast), so that
//      is the default path. The Capacitor Android shell's WebView does *not*
//      implement web Notifications usefully, so when the LocalNotifications
//      plugin is present on window.Capacitor we route through it instead. The
//      plugin is looked up at runtime, never imported, so this file builds and
//      runs whether or not that native dependency is installed — the day it is
//      added to the Android project, this starts using it with no code change.
//
//   2. Permission. Asking is a privilege the browser only grants inside a user
//      gesture, so requestPermission() is separate from showNotification() and
//      is meant to be called from a click (see useNotifications + the bell in
//      ChatPanel). showNotification() never prompts; it just stays silent until
//      permission exists.
//
//   3. Etiquette. A notification for something the user is already looking at
//      is noise, so by default we suppress it when the document is focused and
//      visible. And a global mute (stored per browser) lets someone turn the
//      whole thing off without revoking the OS permission.
//
// Everything is SSR-safe: on the server every function degrades to
// "unsupported"/no-op rather than touching window.

import { Capacitor } from "@capacitor/core";

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export interface NotifyOptions {
  title: string;
  body?: string;
  /** Small image (URL). Defaults to the app icon. */
  icon?: string;
  /**
   * Collapse key. A second notification with the same tag replaces the first
   * instead of stacking — e.g. all mentions from one room share a tag so a
   * burst is one toast, not ten.
   */
  tag?: string;
  /** Suppress the notification sound/vibration. */
  silent?: boolean;
  /** Re-alert even when replacing a notification of the same tag. */
  renotify?: boolean;
  /** Keep the toast up until the user dismisses it (web/Electron only). */
  requireInteraction?: boolean;
  /** Opaque payload handed back to onClick — useful for routing on click. */
  data?: unknown;
  /**
   * Run when the user clicks the notification. The window is focused first,
   * so a handler that navigates or opens a panel lands on a foreground tab.
   * Web/Electron only — the Capacitor click path is wired separately by the
   * native shell if/when it needs deep-linking.
   */
  onClick?: () => void;
  /**
   * Skip the notification when the tab is already focused and visible. On by
   * default because that is almost always the right call for a chat-style
   * alert; pass false for something that must always surface.
   */
  skipWhenFocused?: boolean;
  /**
   * Bypass the user's global mute. Reserved for genuinely important, rare
   * alerts (not chatter). Off by default.
   */
  ignoreMutePreference?: boolean;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// The Capacitor LocalNotifications plugin, if the native shell registered it.
// Typed loosely on purpose: this module never depends on the package, it only
// uses the plugin's shape when it happens to be there.
interface CapacitorLocalNotifications {
  requestPermissions(): Promise<{ display?: string }>;
  checkPermissions(): Promise<{ display?: string }>;
  schedule(options: { notifications: Array<Record<string, unknown>> }): Promise<unknown>;
}

function capacitorLocalNotifications(): CapacitorLocalNotifications | null {
  if (!isBrowser()) return null;
  if (!Capacitor.isNativePlatform()) return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins;
  const plugin = plugins?.LocalNotifications as CapacitorLocalNotifications | undefined;
  return plugin ?? null;
}

function webNotificationsSupported(): boolean {
  // Deliberately not on a Capacitor native platform: an Android WebView exposes
  // a `Notification` global that mostly does nothing, so trusting it there would
  // show a bell that silently fails. On that platform the plugin path is the
  // only real one — if the plugin isn't installed we report unsupported and the
  // UI hides itself. Electron is *not* a native Capacitor platform, so it keeps
  // this web path (which it renders as native toasts).
  if (isBrowser() && Capacitor.isNativePlatform()) return false;
  return isBrowser() && "Notification" in window && typeof window.Notification === "function";
}

export function isNotificationSupported(): boolean {
  return capacitorLocalNotifications() !== null || webNotificationsSupported();
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

// Capacitor reports permission as "granted" | "denied" | "prompt" |
// "prompt-with-rationale"; fold the two "prompt" shapes onto the web's
// "default" so callers see one vocabulary.
function normalizeCapacitorDisplay(display: string | undefined): NotificationPermissionState {
  if (display === "granted") return "granted";
  if (display === "denied") return "denied";
  return "default";
}

export function getNotificationPermission(): NotificationPermissionState {
  const cap = capacitorLocalNotifications();
  if (cap) {
    // checkPermissions is async; the last value observed by
    // refreshNotificationPermission() is cached here so the getter stays sync
    // for render paths. Before the first refresh we optimistically report
    // "default" (never "granted"), so nothing assumes access it may not have.
    return capacitorCachedPermission;
  }
  if (webNotificationsSupported()) {
    return window.Notification.permission as NotificationPermissionState;
  }
  return "unsupported";
}

let capacitorCachedPermission: NotificationPermissionState = "default";

// Pulls the current Capacitor permission into the cache the sync getter reads.
// Safe to call on web (no-ops).
export async function refreshNotificationPermission(): Promise<NotificationPermissionState> {
  const cap = capacitorLocalNotifications();
  if (!cap) return getNotificationPermission();
  try {
    const { display } = await cap.checkPermissions();
    capacitorCachedPermission = normalizeCapacitorDisplay(display);
  } catch {
    // Leave the cache as-is; a failed check should not flip a known-granted
    // permission back to default.
  }
  emitPermissionChange();
  return capacitorCachedPermission;
}

/**
 * Ask the user for permission. Must be called from a user gesture on the web,
 * or the browser rejects it silently. Resolves to the resulting state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  const cap = capacitorLocalNotifications();
  if (cap) {
    try {
      const { display } = await cap.requestPermissions();
      capacitorCachedPermission = normalizeCapacitorDisplay(display);
    } catch {
      capacitorCachedPermission = "denied";
    }
    emitPermissionChange();
    return capacitorCachedPermission;
  }

  if (webNotificationsSupported()) {
    try {
      // Older Safari only supports the callback form; the promise form is
      // universal now but the catch keeps a legacy engine from throwing.
      const result = await window.Notification.requestPermission();
      emitPermissionChange();
      return result as NotificationPermissionState;
    } catch {
      return getNotificationPermission();
    }
  }

  return "unsupported";
}

// A tiny synchronous subscription so React (useNotifications) and anything else
// can re-render when permission or the mute preference changes. No external
// dependency for what is a one-line observer.
type Listener = () => void;
const permissionListeners = new Set<Listener>();

export function onNotificationStateChange(listener: Listener): () => void {
  permissionListeners.add(listener);
  return () => permissionListeners.delete(listener);
}

function emitPermissionChange() {
  for (const l of permissionListeners) l();
}

// ---------------------------------------------------------------------------
// Global mute preference (per browser)
// ---------------------------------------------------------------------------

const MUTE_KEY = "sharescreen:notificationsMuted";

export function areNotificationsMuted(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotificationsMuted(muted: boolean): void {
  if (!isBrowser()) return;
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    // Private-mode/quota — the preference just won't persist, which is fine.
  }
  emitPermissionChange();
}

// ---------------------------------------------------------------------------
// Showing
// ---------------------------------------------------------------------------

// The app icon shipped in public/ and advertised by app/manifest.ts.
const DEFAULT_ICON = "/icon.png";

function documentIsFocused(): boolean {
  if (!isBrowser() || typeof document === "undefined") return false;
  const visible = document.visibilityState === "visible";
  const focused = typeof document.hasFocus === "function" ? document.hasFocus() : visible;
  return visible && focused;
}

/**
 * Show a notification, self-gating on everything that should stop it: no
 * support, no permission, the global mute, or the user already looking at the
 * tab. Returns whether a notification was actually shown, so a caller can fall
 * back (e.g. an in-app toast) when it wasn't — but callers are free to ignore
 * the result and fire-and-forget.
 */
export async function showNotification(opts: NotifyOptions): Promise<boolean> {
  if (!isBrowser()) return false;
  if (!opts.ignoreMutePreference && areNotificationsMuted()) return false;
  if ((opts.skipWhenFocused ?? true) && documentIsFocused()) return false;
  if (getNotificationPermission() !== "granted") return false;

  const cap = capacitorLocalNotifications();
  if (cap) {
    try {
      await cap.schedule({
        notifications: [
          {
            // A stable-ish 32-bit id from the tag keeps same-tag notifications
            // collapsing the way the web `tag` does; a random id otherwise.
            id: opts.tag ? hashTo31Bit(opts.tag) : Math.floor(Math.random() * 2_147_483_647),
            title: opts.title,
            body: opts.body ?? "",
            smallIcon: undefined,
            silent: opts.silent ?? false,
            extra: opts.data ?? null,
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  if (webNotificationsSupported()) {
    try {
      const n = new window.Notification(opts.title, {
        body: opts.body,
        icon: opts.icon ?? DEFAULT_ICON,
        tag: opts.tag,
        silent: opts.silent,
        // `renotify` requires a tag; guard it so a browser that validates the
        // pair doesn't throw.
        ...(opts.tag && opts.renotify ? { renotify: true } : {}),
        requireInteraction: opts.requireInteraction,
        data: opts.data,
      } as NotificationOptions);
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          // Ignore — some engines disallow focus() from here; onClick still runs.
        }
        opts.onClick?.();
        n.close();
      };
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Manual test hook
// ---------------------------------------------------------------------------

/**
 * Fire a sample notification on demand — the "does this work at all?" probe.
 * Requests permission first if it isn't granted yet, then shows a toast that
 * bypasses the focus and mute gates a real alert respects, so a successful
 * call always surfaces something. Returns whether a notification was shown.
 *
 * Exposed as window.testNotification() (see below) so it can be run straight
 * from the console while diagnosing "nothing appears".
 */
export async function testNotification(): Promise<boolean> {
  if (getNotificationPermission() !== "granted") {
    await requestNotificationPermission();
  }
  return showNotification({
    title: "Notificação de teste",
    body: "Se você está vendo isso, as notificações funcionam.",
    tag: "notifications-test",
    skipWhenFocused: false,
    ignoreMutePreference: true,
  });
}

// Attached on import (this module is always loaded on the client, via
// signalingClient), so window.testNotification() is available everywhere for
// manual verification without wiring any UI.
if (isBrowser()) {
  (window as unknown as { testNotification?: typeof testNotification }).testNotification =
    testNotification;
}

// FNV-1a folded into a positive 31-bit int — Capacitor notification ids must be
// a Java int, and this gives one tag the same id every time so it collapses.
function hashTo31Bit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2_147_483_647;
}
