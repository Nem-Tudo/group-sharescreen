"use client";

import { useSyncExternalStore } from "react";
import { getSignalingHttpBase } from "./signalingEndpoints";

export { getSignalingHttpBase } from "./signalingEndpoints";

// The signaling server also serves plain HTTP endpoints (health, room
// directory) on the same host — derive that base from the WS URL instead of
// needing a second env var for what's really the same server.
export const PRIVATE_ROOM_PREFIX = "priv-";

export function toRoomHandle(rawHandle: string, isPrivate: boolean): string {
  return isPrivate ? `${PRIVATE_ROOM_PREFIX}${rawHandle}` : rawHandle;
}

export function isPrivateRoomHandle(handle: string): boolean {
  return handle.startsWith(PRIVATE_ROOM_PREFIX);
}

export type PublicRoom = {
  handle: string;
  peopleCount: number;
  createdAt: number;
};

export type RoomAccessGrant = {
  accessToken: string;
  expiresAt: number;
};

export type RoomAccessInfo = {
  exists: boolean;
  private: boolean;
  requiresPassword: boolean;
};

export class RoomsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code);
  }
}

async function readApiError(response: Response): Promise<never> {
  let code = "request-failed";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // The status remains enough for a safe generic client-side message.
  }
  throw new RoomsApiError(response.status, code);
}

export async function createPrivateRoom(
  handle: string,
  password: string
): Promise<RoomAccessGrant> {
  const response = await fetch(`${getSignalingHttpBase()}/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, password }),
  });
  if (!response.ok) return readApiError(response);
  return response.json() as Promise<RoomAccessGrant>;
}

export async function fetchRoomAccessInfo(
  handle: string,
  signal?: AbortSignal
): Promise<RoomAccessInfo> {
  const response = await fetch(
    `${getSignalingHttpBase()}/rooms/${encodeURIComponent(handle)}/access`,
    { signal }
  );
  if (!response.ok) return readApiError(response);
  return response.json() as Promise<RoomAccessInfo>;
}

export async function authenticatePrivateRoom(
  handle: string,
  password: string
): Promise<RoomAccessGrant> {
  const response = await fetch(
    `${getSignalingHttpBase()}/rooms/${encodeURIComponent(handle)}/auth`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }
  );
  if (!response.ok) return readApiError(response);
  return response.json() as Promise<RoomAccessGrant>;
}

function roomAccessStorageKey(handle: string) {
  return `sharescreen-room-access:${handle}`;
}

const roomAccessListeners = new Set<() => void>();

function notifyRoomAccessChanged() {
  roomAccessListeners.forEach((listener) => listener());
}

export function storeRoomAccessGrant(handle: string, grant: RoomAccessGrant) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(roomAccessStorageKey(handle), JSON.stringify(grant));
    notifyRoomAccessChanged();
  } catch {
    // Session storage can be disabled; entry still works until navigation,
    // but a refresh will require the password again.
  }
}

export function getStoredRoomAccessToken(handle: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(roomAccessStorageKey(handle));
    if (!raw) return null;
    const grant = JSON.parse(raw) as Partial<RoomAccessGrant>;
    if (
      typeof grant.accessToken !== "string" ||
      typeof grant.expiresAt !== "number" ||
      grant.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(roomAccessStorageKey(handle));
      return null;
    }
    return grant.accessToken;
  } catch {
    return null;
  }
}

export function clearStoredRoomAccess(handle: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(roomAccessStorageKey(handle));
    notifyRoomAccessChanged();
  } catch {
    // Nothing else to clear if session storage is unavailable.
  }
}

function subscribeRoomAccess(listener: () => void) {
  roomAccessListeners.add(listener);
  return () => roomAccessListeners.delete(listener);
}

export function useStoredRoomAccessToken(handle: string): string | null {
  return useSyncExternalStore(
    subscribeRoomAccess,
    () => getStoredRoomAccessToken(handle),
    () => null
  );
}

export async function fetchPublicRooms(signal?: AbortSignal): Promise<PublicRoom[]> {
  const res = await fetch(`${getSignalingHttpBase()}/rooms`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar salas (status ${res.status})`);
  const data = (await res.json()) as { rooms: PublicRoom[] };
  return data.rooms;
}

// Total people connected across every room, public and private — the
// server only ever returns the aggregate count here, never room handles.
export async function fetchPeopleOnline(signal?: AbortSignal): Promise<number> {
  const res = await fetch(`${getSignalingHttpBase()}/stats`, { signal });
  if (!res.ok) throw new Error(`Falha ao carregar estatísticas (status ${res.status})`);
  const data = (await res.json()) as { peopleOnline: number };
  return data.peopleOnline;
}
