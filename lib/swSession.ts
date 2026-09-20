"use client";

// The little the service worker needs to know, left somewhere it can read it.
//
// A worker woken by a push has no page, no React and no access to anything the
// app keeps in memory or in localStorage — that last one is simply not
// available in a worker context. But two things it now does require a session:
//
//   1. **Re-subscribing.** A browser may retire a push subscription at any
//      time and fires `pushsubscriptionchange` at the worker, which is the one
//      chance to mint a replacement and tell the server about it. Doing that
//      needs the VAPID key and a token to authenticate with. Without this, a
//      rotated subscription meant silence until the person next opened the app
//      — which for somebody who visits once a fortnight is a fortnight of
//      notifications that simply never arrived.
//   2. **The buttons on a notification.** "Marcar como lida" and "Recusar" act
//      while nothing of the app is running, so the worker calls the API
//      itself, and needs the same two things.
//
// IndexedDB because it is the only storage a worker and a page share. Small,
// with one record, and every read and write swallows its own failure: a
// browser in private mode may refuse the database outright, and the only
// consequence is that the worker falls back to doing nothing — which is
// exactly what it did before.

const DB_NAME = "golive-sw";
const STORE = "session";
const KEY = "current";

export interface SwSession {
  /** The account token the worker acts with, or null when signed out. */
  token: string | null;
  /** Where the API is, since the worker cannot read the app's config. */
  apiBase: string;
  /** What a re-subscription must be minted against. */
  vapidPublicKey: string;
  /** Which device this is, for the re-subscribe call. */
  deviceId: string;
  /** The language notifications should be written in. */
  locale: string;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      // A database blocked by another tab's older version resolves to nothing
      // rather than hanging the caller forever.
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Writes what the worker should know. Merged rather than replaced, so a caller
 * that only knows the token does not wipe the VAPID key.
 */
export async function saveSwSession(patch: Partial<SwSession>): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  if (!db) return;
  try {
    const current = await readFrom(db);
    const next = { ...(current ?? {}), ...patch };
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(next, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

function readFrom(db: IDBDatabase): Promise<Partial<SwSession> | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as Partial<SwSession>) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Forgets the token, leaving the rest — what signing out means here. */
export async function clearSwSessionToken(): Promise<void> {
  await saveSwSession({ token: null });
}
