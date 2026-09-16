"use client";

import { getAccountToken, subscribeAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import {
  cleanRecentRooms,
  forgetRecentRoom as forgetLocalRoom,
  getRecentRooms as getLocalRooms,
  rememberRecentRoom as rememberLocalRoom,
  subscribeRecentRooms as subscribeLocalRooms,
  takeLocalRecentRooms,
  withRecentRoom,
  type RecentRoom,
} from "./recentRooms";

// "Salas recentes" that follow the account: signed in, the list lives on the
// API (GET/POST/DELETE /account/recent-rooms), so the desktop app, the phone
// and the browser all show the same three rooms. Signed out, it is the
// browser's own list, exactly as before (lib/recentRooms).
//
// The first time an account's list loads in a browser, whatever that browser
// kept on its own is handed to the account and cleared locally, so nothing
// somebody had before signing in is lost.
//
// The last answer is cached in localStorage, tagged with the session it
// belongs to, so the home page draws the list at once and refreshes it behind.
// It is fetched again whenever the window comes back into view — that is when
// another device may have changed it.

const CACHE_KEY = "sharescreen:recentRooms:account:v1";
const REFRESH_MIN_GAP_MS = 10_000;
const EMPTY: RecentRoom[] = [];

let token: string | null | undefined;
let rooms: RecentRoom[] = EMPTY;
// False when the API refused this session (a bot, an expired token): the
// browser's own list is used instead.
let remote = false;
let lastRefreshAt = 0;
let refreshing: Promise<void> | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readCache(forToken: string): RecentRoom[] {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { token?: unknown; rooms?: unknown } | null;
    return cached?.token === forToken ? cleanRecentRooms(cached.rooms) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function setRooms(next: RecentRoom[]) {
  rooms = next.length === 0 ? EMPTY : next;
  try {
    if (token) localStorage.setItem(CACHE_KEY, JSON.stringify({ token, rooms }));
  } catch {
    // Only the cache; the API still has the list.
  }
  emit();
}

/** Follows sign-in and sign-out; true when the account's list is in use. */
function sync(): boolean {
  if (typeof window === "undefined") return false;
  const current = getAccountToken();
  if (current !== token) {
    token = current;
    remote = Boolean(current);
    rooms = current ? readCache(current) : EMPTY;
    lastRefreshAt = 0;
    if (current) void refresh();
  }
  return remote;
}

async function request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<RecentRoom[] | null> {
  const sentWith = token;
  if (!sentWith) return null;
  const res = await fetch(`${getSignalingHttpBase()}/account/recent-rooms${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${sentWith}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Signed out or into another account meanwhile: the answer is not for now.
  if (sentWith !== token) return null;
  if (res.status === 401) {
    remote = false;
    rooms = EMPTY;
    emit();
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { rooms?: unknown } | null;
  return data ? cleanRecentRooms(data.rooms) : null;
}

function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  lastRefreshAt = Date.now();
  refreshing = (async () => {
    try {
      let next = await request("GET", "");
      if (!next) return;
      const local = takeLocalRecentRooms();
      if (local.length > 0) next = (await request("POST", "", { rooms: local })) ?? next;
      setRooms(next);
    } catch {
      // Offline or the API is down: the cached list stays on screen.
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function onVisible() {
  if (document.visibilityState !== "visible") return;
  if (!sync() || Date.now() - lastRefreshAt < REFRESH_MIN_GAP_MS) return;
  void refresh();
}

let unsubscribeOthers: (() => void) | null = null;

export function subscribeRecentRooms(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribeOthers) {
    const onChange = () => {
      sync();
      emit();
    };
    const offToken = subscribeAccountToken(onChange);
    const offLocal = subscribeLocalRooms(emit);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    unsubscribeOthers = () => {
      offToken();
      offLocal();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }
  onVisible();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeOthers) {
      unsubscribeOthers();
      unsubscribeOthers = null;
    }
  };
}

export function getRecentRooms(): RecentRoom[] {
  return sync() ? rooms : getLocalRooms();
}

export function getRecentRoomsServer(): RecentRoom[] {
  return EMPTY;
}

export function rememberRecentRoom(handle: string): void {
  if (!sync()) {
    rememberLocalRoom(handle);
    return;
  }
  const now = Date.now();
  const next = withRecentRoom(rooms, handle, now);
  if (!next) return;
  setRooms(next);
  void request("POST", "", { rooms: [{ handle, visitedAt: now }] })
    .then((saved) => {
      if (saved) setRooms(saved);
    })
    .catch(() => {});
}

export function forgetRecentRoom(handle: string): void {
  if (!sync()) {
    forgetLocalRoom(handle);
    return;
  }
  setRooms(rooms.filter((room) => room.handle !== handle));
  void request("DELETE", `/${encodeURIComponent(handle)}`)
    .then((saved) => {
      if (saved) setRooms(saved);
    })
    .catch(() => {});
}
