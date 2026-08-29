import {
  isPrivateRoomHandle,
  PRIVATE_ROOM_PREFIX,
  splitPrivateRoomHandle,
} from "./roomsApi";

// Rooms this browser has actually been in. localStorage (not sessionStorage)
// so leaving a room — or closing the tab — still leaves a way back from the
// home page. Capped at three because the list sits on the create/join form
// and a longer one would crowd the fields it's meant to skip.
//
// Key is versioned so a later shape can land without colliding with this
// array. Only the handle and when it was last joined are stored — the
// display name is derived from the handle (see recentRoomPresentation).
export const MAX_RECENT_ROOMS = 3;
const STORAGE_KEY = "sharescreen:recentRooms:v1";

// Mirrors server/signaling.ts's HANDLE_RE — a junk string in storage must
// not become a /watch/... link the server will reject.
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

export type RecentRoom = {
  handle: string;
  visitedAt: number;
};

export type RecentRoomPresentation = {
  name: string;
  isPrivate: boolean;
  code: string | null;
};

const listeners = new Set<() => void>();
// Same empty array every time — useSyncExternalStore compares snapshots by
// Object.is, and a fresh `[]` per read is an infinite re-render.
const EMPTY_ROOMS: RecentRoom[] = [];
let cachedRaw: string | null | undefined;
let snapshot: RecentRoom[] = EMPTY_ROOMS;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeRecentRooms(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isRecentRoom(value: unknown): value is RecentRoom {
  if (!value || typeof value !== "object") return false;
  const handle = (value as { handle?: unknown }).handle;
  const visitedAt = (value as { visitedAt?: unknown }).visitedAt;
  return (
    typeof handle === "string" &&
    HANDLE_RE.test(handle) &&
    typeof visitedAt === "number" &&
    Number.isFinite(visitedAt)
  );
}

function parseStoredRooms(raw: string | null): RecentRoom[] {
  if (!raw) return EMPTY_ROOMS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_ROOMS;
    const rooms: RecentRoom[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!isRecentRoom(item) || seen.has(item.handle)) continue;
      seen.add(item.handle);
      rooms.push(item);
      if (rooms.length >= MAX_RECENT_ROOMS) break;
    }
    return rooms.length === 0 ? EMPTY_ROOMS : rooms;
  } catch {
    return EMPTY_ROOMS;
  }
}

export function getRecentRooms(): RecentRoom[] {
  if (typeof window === "undefined") return EMPTY_ROOMS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return snapshot;
    cachedRaw = raw;
    snapshot = parseStoredRooms(raw);
    return snapshot;
  } catch {
    return EMPTY_ROOMS;
  }
}

function persist(next: RecentRoom[]) {
  snapshot = next.length === 0 ? EMPTY_ROOMS : next;
  const serialized = next.length === 0 ? null : JSON.stringify(next);
  cachedRaw = serialized;
  try {
    if (serialized === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
  emit();
}

export function rememberRecentRoom(handle: string, now = Date.now()) {
  if (typeof window === "undefined") return;
  if (!HANDLE_RE.test(handle)) return;
  const existing = getRecentRooms();
  // Already on the list: leave the order alone. Re-entering the second
  // slot would otherwise bump it to the top and shuffle the other two,
  // which is the opposite of a stable "salas recentes" shortcut.
  if (existing.some((room) => room.handle === handle)) return;
  persist([{ handle, visitedAt: now }, ...existing].slice(0, MAX_RECENT_ROOMS));
}

export function forgetRecentRoom(handle: string) {
  if (typeof window === "undefined") return;
  const existing = getRecentRooms();
  if (!existing.some((room) => room.handle === handle)) return;
  persist(existing.filter((room) => room.handle !== handle));
}

// What the home-page buttons show instead of the raw handle: a private
// room's URL is "priv-<nome>-<codigo>", which nobody typed and nobody
// would recognize in a list of three.
export function recentRoomPresentation(handle: string): RecentRoomPresentation {
  if (!isPrivateRoomHandle(handle)) {
    return { name: handle, isPrivate: false, code: null };
  }
  const split = splitPrivateRoomHandle(handle);
  if (split) return { name: split.name, isPrivate: true, code: split.code };
  return {
    name: handle.slice(PRIVATE_ROOM_PREFIX.length) || handle,
    isPrivate: true,
    code: null,
  };
}
