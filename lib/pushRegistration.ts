"use client";

import { Capacitor } from "@capacitor/core";
import {
  fetchPushConfig,
  registerPushSubscription,
  unregisterPushSubscription,
} from "./pushApi";
import { openDirectMessages } from "./dmWindow";
import { isDesktopApp } from "./desktop";

// Getting this device onto the list of places a notification can reach.
//
// There are two ways to be reachable with the app closed and no third:
//
//   1. **Web Push**, in an ordinary browser. A service worker (public/
//      golive-sw.js) plus a subscription the browser mints against our VAPID
//      key. Survives the browser being fully closed on a desktop and Chrome
//      being closed on Android.
//   2. **FCM**, in the Android shell. Capacitor's WebView exposes a Push API
//      that does not work — there is no push service behind it — so the native
//      plugin's registration token is the only path. Looked up on
//      window.Capacitor.Plugins at runtime and never imported, exactly like
//      LocalNotifications in lib/notifications.ts, so this file builds and runs
//      whether or not that native dependency is installed.
//
// The desktop shell is neither, and that is a deliberate, stated gap: Electron
// ships no push service, so there is no message anybody can send to a desktop
// app that is not running. What covers it instead is the shell staying alive —
// see electron/main.ts's tray and "abrir com o sistema", which keep the socket
// connected while the window is closed. The ring then arrives the ordinary
// way, over the connection that never went away.
//
// Everything here is best-effort and silent. A person who refused notification
// permission has said what they want, and an app that reports that back as an
// error is an app arguing with them.

interface CapacitorPushPlugin {
  register(): Promise<void>;
  requestPermissions(): Promise<{ receive?: string }>;
  checkPermissions(): Promise<{ receive?: string }>;
  createChannel(channel: Record<string, unknown>): Promise<void>;
  addListener(
    event: string,
    handler: (payload: Record<string, unknown>) => void
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
  removeAllListeners?(): Promise<void>;
}

function capacitorPush(): CapacitorPushPlugin | null {
  if (typeof window === "undefined") return null;
  if (!Capacitor.isNativePlatform()) return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins;
  return (plugins?.PushNotifications as CapacitorPushPlugin | undefined) ?? null;
}

/**
 * The channels Android draws our notifications in.
 *
 * Named here and referenced by the API (see pushSender's ANDROID_CALL_CHANNEL)
 * — the two must agree exactly or the message lands in the default channel and
 * a ring arrives as a silent line in the shade.
 *
 * They exist because importance is a property of the *channel* on Android, not
 * of the message: once created, only the user can change it. A call therefore
 * needs its own, at max importance with a sound, and a message needs one that
 * is quieter — so that somebody who mutes their messages has not also muted
 * the phone ringing.
 */
const ANDROID_CHANNELS = [
  {
    id: "golive-calls",
    name: "Chamadas",
    description: "Toca quando alguém liga para você.",
    // 5 = IMPORTANCE_HIGH: heads-up, with sound, over whatever is on screen.
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true,
  },
  {
    id: "golive-messages",
    name: "Mensagens",
    description: "Mensagens privadas recebidas.",
    // 4 = IMPORTANCE_DEFAULT with a sound, but no heads-up interruption.
    importance: 4,
    visibility: 1,
    vibration: true,
  },
];

let started = false;
let currentEndpoint: string | null = null;

/**
 * Registers this device, if it can be registered and the person allows it.
 *
 * Safe (and cheap) to call on every app open, which is what
 * components/PushRegistrar.tsx does: a push subscription can be rotated by the
 * browser at any time without telling anybody, and a stale endpoint is a
 * device that quietly stops ringing. Re-registering the same one is an upsert
 * on the server and costs one request.
 *
 * `interactive` is what separates "the app started" from "somebody pressed the
 * button": permission may only be *asked for* inside a user gesture, so the
 * automatic path registers when permission already exists and stays quiet
 * otherwise, rather than burning the one prompt the browser will ever show on
 * a moment nobody asked for it.
 */
export async function ensurePushRegistration(
  options: { interactive?: boolean } = {}
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const config = await fetchPushConfig();
  if (!config?.enabled) return false;

  const native = capacitorPush();
  if (native) return registerNative(native, config.fcm, options.interactive === true);
  return registerWeb(config.vapidPublicKey, options.interactive === true);
}

// ─── Android ──────────────────────────────────────────────────────────────

async function registerNative(
  plugin: CapacitorPushPlugin,
  fcmConfigured: boolean,
  interactive: boolean
): Promise<boolean> {
  // No point asking Android for permission to deliver something this
  // deployment cannot send.
  if (!fcmConfigured) return false;
  try {
    const current = await plugin.checkPermissions();
    let granted = current.receive === "granted";
    if (!granted) {
      // From Android 13 this is a real runtime prompt. Before it, permission
      // is granted on install and this resolves immediately — so the
      // `interactive` gate costs nothing on older phones.
      if (!interactive) return false;
      const asked = await plugin.requestPermissions();
      granted = asked.receive === "granted";
    }
    if (!granted) return false;

    // Idempotent on Android (creating a channel that exists is a no-op that
    // does *not* reset what the user changed about it), so this can run on
    // every start rather than being tracked.
    for (const channel of ANDROID_CHANNELS) {
      try {
        await plugin.createChannel(channel);
      } catch {
        // An older Android with no channels at all. The notification still
        // arrives; it just uses the app-wide defaults.
      }
    }

    if (!started) {
      started = true;
      // The token arrives asynchronously and can arrive *again* later — FCM
      // rotates them — so this is a listener rather than a one-shot read.
      void plugin.addListener("registration", (payload) => {
        const token = typeof payload.value === "string" ? payload.value : "";
        if (!token) return;
        currentEndpoint = token;
        void registerPushSubscription({ kind: "fcm", endpoint: token });
      });
      void plugin.addListener("registrationError", (payload) => {
        console.error("[push] Falha ao registrar no FCM:", payload);
      });
      // Tapping a notification on Android opens the app and nothing else —
      // there is no URL involved, unlike the web path where the service
      // worker can navigate. So the routing happens here, off the `data`
      // block the API sends alongside every notification for exactly this.
      //
      // A call needs nothing done: CallHost asks the API what is ringing the
      // moment the app comes to the front, which is also what covers the case
      // of the app being opened from the launcher rather than the
      // notification.
      void plugin.addListener("pushNotificationActionPerformed", (payload) => {
        const data = (payload.notification as { data?: Record<string, unknown> } | undefined)
          ?.data;
        if (!data) return;
        if (data.kind === "dm" && typeof data.fromId === "string") {
          openDirectMessages(data.fromId);
        }
        // A message in a group's text room: open that room. Only a
        // site-relative path is followed, never an arbitrary address.
        if (data.kind === "group-message" && typeof data.url === "string" && data.url.startsWith("/groups/")) {
          window.location.assign(data.url);
        }
      });
    }
    await plugin.register();
    return true;
  } catch (err) {
    console.error("[push] Erro no registro nativo:", (err as Error).message);
    return false;
  }
}

// ─── Web ──────────────────────────────────────────────────────────────────

function webPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !Capacitor.isNativePlatform() &&
    // Electron exposes PushManager because Chromium does, and subscribing
    // through it fails: the build has no push service behind it, and never
    // will. Excluded here rather than left to throw, so the desktop app does
    // not log a failure on every start for something it was never going to
    // do — its answer is the tray and autostart instead (see
    // electron/background.ts). isDesktopApp is true for the Android shell too,
    // but that one already left through the native path above.
    !isDesktopApp() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Registers the service worker.
 *
 * Exported because the worker is worth having even when push is not: it is
 * what receives the click on a notification and focuses the tab that is
 * already open, instead of the browser opening a second one.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // At the root scope, which is what lets it receive pushes for the whole
    // site rather than only for pages under some subdirectory.
    return await navigator.serviceWorker.register("/golive-sw.js", { scope: "/" });
  } catch (err) {
    console.error("[push] Service worker recusado:", (err as Error).message);
    return null;
  }
}

async function registerWeb(vapidPublicKey: string, interactive: boolean): Promise<boolean> {
  if (!webPushSupported() || !vapidPublicKey) return false;

  if (Notification.permission !== "granted") {
    if (!interactive || Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    if (result !== "granted") return false;
  }

  const registration = await ensureServiceWorker();
  if (!registration) return false;
  // A worker that is still installing has no pushManager worth subscribing
  // through yet, and `ready` is the only reliable way to wait for one — the
  // registration object resolves long before the worker is active.
  await navigator.serviceWorker.ready;

  try {
    const existing = await registration.pushManager.getSubscription();
    // Reused rather than re-created: unsubscribing and subscribing again mints
    // a *different* endpoint, which would leave the old one on the server as a
    // row that can only ever fail.
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        // Non-negotiable on every current browser: a subscription that is not
        // user-visible (i.e. that does not show a notification) is refused
        // outright rather than merely discouraged.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    currentEndpoint = json.endpoint;
    return await registerPushSubscription({
      kind: "webpush",
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  } catch (err) {
    console.error("[push] Não foi possível assinar:", (err as Error).message);
    return false;
  }
}

/** Stops this device receiving anything. */
export async function disablePush(): Promise<void> {
  const endpoint = currentEndpoint;
  if (endpoint) {
    currentEndpoint = null;
    await unregisterPushSubscription(endpoint);
  }
  if (!webPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    // Told to the server *before* being thrown away above: once the
    // subscription is gone the endpoint is unrecoverable, and the row would
    // sit there until it failed enough times to be swept.
    await subscription?.unsubscribe();
  } catch {
    // Nothing to undo — the server-side removal above is what actually stops
    // the notifications.
  }
}

/**
 * VAPID keys travel as base64url; subscribe() wants raw bytes.
 *
 * The padding and the two swapped characters are the whole of the difference,
 * and getting either wrong produces an `InvalidCharacterError` from atob that
 * says nothing about which key was bad — which is why this is spelled out
 * rather than inlined.
 */
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  // Built over an explicit ArrayBuffer rather than `new Uint8Array(length)`:
  // the latter is typed as backed by ArrayBufferLike, which includes
  // SharedArrayBuffer, and applicationServerKey will not take one of those.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
