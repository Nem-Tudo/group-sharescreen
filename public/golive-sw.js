/* GoLive's service worker.
 *
 * It exists for exactly one reason: to be the part of this app that is still
 * running when none of the rest of it is. A push message wakes it with no
 * page, no React, no session and no guarantee of a network — so everything it
 * needs in order to draw a notification travels *inside* the message.
 *
 * It does now reach the network, for two things that cannot be done any other
 * way: minting a replacement subscription when the browser retires one, and
 * acting on a notification's buttons while nothing of the app is running.
 * Both need a session, and a worker cannot read localStorage — so the app
 * leaves one in IndexedDB for it (see lib/swSession.ts). Everything that uses
 * it degrades to doing nothing when it is not there.
 *
 * Deliberately not a caching/offline worker. GoLive is a real-time app and is
 * useless without a connection (the same reasoning as electron/main.ts's "this
 * is a shell around the deployed site"), so an offline cache would buy a shell
 * of a page that cannot do anything, at the cost of the single hardest class
 * of bug this codebase could take on — a stale asset served to somebody who
 * has no way to clear it.
 *
 * Plain JavaScript in public/ rather than something the bundler produces: a
 * service worker is fetched by URL, by the browser, outside of everything
 * Next.js does, and a build step between this file and that fetch is a build
 * step that can put a broken worker in front of every user with no way back.
 */

/** The picture on the notification, when it carries none of its own. */
const DEFAULT_ICON = "/icon.png";

/* The little mark in the status bar next to the notification.
 *
 * Its own file, and monochrome, because `badge` is drawn as a *mask*: Android
 * throws away every colour in it and keeps only the alpha. The app icon was
 * being used here, and a full-colour PNG with an opaque background masks down
 * to exactly that — an opaque square. A grey blob next to every notification
 * is what that looked like. */
const BADGE_ICON = "/badge-96.png";

self.addEventListener("install", () => {
  // Take over immediately instead of waiting for every tab of the old worker
  // to close. Nothing here is versioned or cached, so there is no old state
  // for a new worker to be inconsistent with — and waiting would mean a fix
  // to this file reaching people days later.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── The session the app leaves behind ──────────────────────────────────────
//
// One record in one store. Written by the page (lib/swSession.ts), read here,
// and every failure answered with "there is no session" — a browser in private
// mode may refuse the database outright, and the only consequence is that the
// two features that need it quietly do nothing.

const SESSION_DB = "golive-sw";
const SESSION_STORE = "session";
const SESSION_KEY = "current";

function readSession() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = indexedDB.open(SESSION_DB, 1);
      // The worker never *creates* the database: if the page has not written a
      // session yet there is nothing to act on anyway, and creating an empty
      // store here would only race the page's own upgrade.
      request.onupgradeneeded = () => done(null);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains(SESSION_STORE)) return done(null);
          const tx = db.transaction(SESSION_STORE, "readonly");
          const get = tx.objectStore(SESSION_STORE).get(SESSION_KEY);
          get.onsuccess = () => done(get.result || null);
          get.onerror = () => done(null);
        } catch {
          done(null);
        }
      };
    } catch {
      done(null);
    }
  });
}

// ─── Receiving ──────────────────────────────────────────────────────────────

/**
 * The buttons on a notification, by what it is about.
 *
 * Web notifications take actions but no text input — that is an Android-only
 * feature, which is why "Responder" exists in the native shell's own renderer
 * (see GoLiveNotifications.java) and not here. What is left is the two
 * decisions worth making without opening the app: answering a call, and
 * getting a conversation off the screen.
 *
 * Titles are in the payload's language rather than the worker's, because the
 * worker has none — it is woken with no page and no way to read a preference.
 * The server has already written the rest of the notification in the language
 * this device asked for (see the API's pushText.ts), so these ride along with
 * it in the same field.
 */
function actionsFor(payload) {
  if (payload.kind === "call") {
    return [
      { action: "accept", title: payload.acceptLabel || "Atender" },
      { action: "decline", title: payload.declineLabel || "Recusar" },
    ];
  }
  if (payload.kind === "dm" || payload.kind === "group-message") {
    return [{ action: "read", title: payload.readLabel || "Marcar como lida" }];
  }
  return [];
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A push whose body is not our JSON is not ours to draw. Showing a
    // generic notification for it would be worse than silence: it would be an
    // alert nobody can act on.
    return;
  }
  if (!payload || !payload.title) return;

  const isCall = payload.kind === "call";
  const options = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    badge: BADGE_ICON,
    // Same collapse behaviour the in-app notifications use: a burst from one
    // person is one line, and the "call-ended" that follows a ring replaces
    // it rather than leaving a call that is over sitting on the lock screen.
    tag: payload.tag || payload.kind || "golive",
    renotify: true,
    // A ring stays until it is dealt with; a message does not. This is the
    // one place the difference between "somebody is waiting for you right
    // now" and "somebody wrote to you" is expressed to the operating system.
    requireInteraction: isCall,
    // Vibration is the half of a ring that works with the phone on silent.
    vibrate: isCall ? [400, 200, 400, 200, 400] : [120],
    actions: actionsFor(payload),
    // Handed back on click — it is how the tab that opens knows which call or
    // conversation this was about.
    data: payload,
  };

  event.waitUntil(
    (async () => {
      // A ring that has already been answered somewhere else must not still be
      // ringing here. The "call-ended" push is what says so, and closing the
      // original by its tag is the only way to take a notification back.
      if (payload.kind === "call-ended" && payload.tag) {
        const open = await self.registration.getNotifications({ tag: payload.tag });
        for (const notification of open) notification.close();
      }
      await self.registration.showNotification(payload.title, options);
      await refreshAppBadge();
    })()
  );
});

/**
 * The number on the app's icon, from what is on screen right now.
 *
 * Counted from the notifications this worker has showing rather than tracked,
 * which is what makes it self-correcting: a notification the person dismissed
 * without opening, one replaced by its own tag, one the system dropped — all
 * of them are simply not in the list the next time this runs, and the number
 * follows. Nothing has to remember anything between wake-ups.
 *
 * Unsupported nearly everywhere but an installed app, which is exactly where
 * an icon with a number on it exists to be seen.
 */
async function refreshAppBadge() {
  if (!self.navigator || typeof self.navigator.setAppBadge !== "function") return;
  try {
    const open = await self.registration.getNotifications();
    // A ring is not a thing to count: it is either happening or it is not, and
    // leaving a "1" on the icon after a call nobody answered would be a number
    // that never goes away.
    const count = open.filter((n) => (n.data || {}).kind !== "call").length;
    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch {
    // A badge nobody can set is a badge nobody sees. Nothing else depends on
    // this having worked.
  }
}

// ─── Clicking ───────────────────────────────────────────────────────────────

/**
 * Acts on one of the buttons, by calling the API the way the app would.
 *
 * Only reached with a session in the database, and every one of these is
 * idempotent on the server — a call already declined, a conversation already
 * read — because the one thing that cannot be arranged here is a retry that
 * knows what already happened.
 */
async function runAction(action, payload) {
  const session = await readSession();
  if (!session || !session.token || !session.apiBase) return false;
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
  const post = (path, body) =>
    fetch(`${session.apiBase}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    }).catch(() => null);

  if (action === "decline" && payload.callId) {
    await post(`/calls/${encodeURIComponent(payload.callId)}/decline`, {});
    return true;
  }
  if (action === "read") {
    // A group's text room and a conversation are read through different
    // routes; which one this is comes from the payload the server built.
    if (payload.groupId && payload.channelId) {
      await post(
        `/groups/${encodeURIComponent(payload.groupId)}/channels/${encodeURIComponent(
          payload.channelId
        )}/read`,
        {}
      );
      return true;
    }
    if (payload.fromId) {
      await post(`/dm/${encodeURIComponent(payload.fromId)}/read`, {});
      return true;
    }
  }
  return false;
}

self.addEventListener("notificationclick", (event) => {
  const payload = event.notification.data || {};
  const action = event.action || "";
  event.notification.close();

  // The two that are answered here and never open anything. "Atender" is not
  // one of them: accepting a call means joining it, which needs the app.
  if (action === "decline" || action === "read") {
    event.waitUntil(
      (async () => {
        const done = await runAction(action, payload);
        await refreshAppBadge();
        // A button that could not act — no session, an unreachable API — falls
        // back to opening the app, where the person can do it themselves.
        // Silently doing nothing would be the one outcome that looks broken.
        if (!done) await openApp(payload, action);
      })()
    );
    return;
  }

  event.waitUntil(
    (async () => {
      await openApp(payload, action);
      await refreshAppBadge();
    })()
  );
});

async function openApp(payload, action) {
  const target = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  // Focus what is already open rather than opening a second window: the
  // app is a single-page one holding a socket (and possibly a call), and a
  // duplicate tab would be a second connection fighting the first for the
  // same client id.
  for (const client of clients) {
    if (!client.url.startsWith(self.location.origin)) continue;
    await client.focus();
    // Told rather than navigated: navigating throws away the running app
    // — socket, media permissions, whatever room it is in — to show a
    // screen the page can perfectly well open by itself.
    client.postMessage({ source: "golive-sw", type: "notification-click", payload, action });
    return;
  }
  await self.clients.openWindow(target);
}

self.addEventListener("notificationclose", (event) => {
  // Dismissing one is as much a change to the count as opening it.
  event.waitUntil(refreshAppBadge());
});

// ─── Keeping the subscription alive ─────────────────────────────────────────

/**
 * The browser retired this device's subscription; mint another and say so.
 *
 * Browsers rotate subscriptions on their own schedule and give exactly one
 * notice: this event, fired at the worker, usually with the app nowhere near
 * running. Before this there was no handler at all, so the replacement was
 * only ever minted the next time somebody opened the app — and a person who
 * opens GoLive once a fortnight spent that fortnight unreachable without a
 * single sign that anything was wrong.
 *
 * `event.newSubscription` is provided by some browsers and not others; where
 * it is missing the only way forward is to subscribe again from the key the
 * app left behind, which is half of why the session record exists.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const session = await readSession();
      if (!session || !session.token || !session.apiBase) return;
      let subscription = event.newSubscription || null;
      if (!subscription) {
        if (!session.vapidPublicKey) return;
        try {
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(session.vapidPublicKey),
          });
        } catch {
          // Permission revoked along with the subscription, most likely.
          // Nothing to register, and nothing anybody here can do about it.
          return;
        }
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth) return;
      // The old endpoint is already gone as far as the push service is
      // concerned, so it is left for the server's own 410 sweep rather than
      // unsubscribed here — `event.oldSubscription` is not always given, and
      // deleting the wrong row would be worse than leaving a dead one.
      await fetch(`${session.apiBase}/push/subscribe`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: "webpush",
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          deviceId: session.deviceId || "",
          locale: session.locale || "",
        }),
      }).catch(() => null);
    })()
  );
});

/**
 * VAPID keys travel as base64url; subscribe() wants raw bytes.
 *
 * The same conversion the app does (see lib/pushRegistration.ts) — duplicated
 * rather than shared because a service worker is fetched by URL and imports
 * nothing the bundler produces.
 */
function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
