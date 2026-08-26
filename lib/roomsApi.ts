const WS_URL = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";

// The signaling server also serves plain HTTP endpoints (health, room
// directory) on the same host — derive that base from the WS URL instead of
// needing a second env var for what's really the same server.
export function getSignalingHttpBase(): string {
  return WS_URL.replace(/^ws/, "http").replace(/\/ws\/?$/, "");
}

export const PRIVATE_ROOM_PREFIX = "priv-";

export function toRoomHandle(rawHandle: string, isPrivate: boolean): string {
  return isPrivate ? `${PRIVATE_ROOM_PREFIX}${rawHandle}` : rawHandle;
}

export function isPrivateRoomHandle(handle: string): boolean {
  return handle.startsWith(PRIVATE_ROOM_PREFIX);
}

// A private room's handle carries its own access code: "priv-<nome>-<123456>".
// The client mints the code when creating the room and the server simply
// parses it back out of the handle (see server/signaling.ts's
// roomCodeFromHandle), which is what makes the room's URL the entirety of
// its secret — there is nothing else to pass around, and no second value
// that could drift out of step with the one in the link.
export const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_RE = /^\d{6}$/;

// Whether a private room is *required* to carry its code in its handle.
// The client half of the server flag of the same name (see
// server/signaling.ts, which has the full reasoning) — the two are meant to
// be flipped together, and both default to off.
//
// What it governs here is narrow but important: whether the home page's
// "Entrar em sala" refuses a bare name with no code. While it's off, a name
// alone is accepted, which is the only way into a private room created
// before this scheme existed — those handles are code-less forever, and a
// client that insisted on a code would lock people out of rooms they have
// been using for months. The room still has to actually exist either way
// (see roomExists), so accepting a bare name costs nothing: a typo is
// caught by that check rather than by the shape of what was typed.
export const ENFORCE_NEW_ROOM_CODE_SYSTEM =
  process.env.NEXT_PUBLIC_ENFORCE_NEW_ROOM_CODE_SYSTEM === "true";
// The server's HANDLE_RE caps a handle at 32 characters, and a private one
// spends "priv-" (5) plus "-" plus the 6 digits (7) on structure — so this
// is what's left for the name someone actually types.
export const MAX_PRIVATE_ROOM_NAME_LENGTH = 32 - PRIVATE_ROOM_PREFIX.length - 1 - ROOM_CODE_LENGTH;

// Uses crypto rather than Math.random: this is the whole of a private room's
// secret, so it should be as unguessable as six digits can be (one in a
// million) instead of merely as unpredictable as a seeded PRNG.
export function generateRoomCode(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return (n % 1_000_000).toString().padStart(ROOM_CODE_LENGTH, "0");
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_RE.test(value);
}

// Builds "priv-<nome>-<codigo>". Kept next to the parser below so the two
// can't drift apart.
export function toPrivateRoomHandle(name: string, code: string): string {
  return `${PRIVATE_ROOM_PREFIX}${name}-${code}`;
}

// Splits a private handle back into the parts a person recognizes — used to
// show a room's name and code separately rather than making someone read
// them out of the raw handle. Returns null for a public handle, or for a
// private one with no trailing code (rooms predating this scheme).
export function splitPrivateRoomHandle(
  handle: string
): { name: string; code: string } | null {
  if (!isPrivateRoomHandle(handle)) return null;
  const withoutPrefix = handle.slice(PRIVATE_ROOM_PREFIX.length);
  const separator = withoutPrefix.lastIndexOf("-");
  if (separator <= 0) return null;
  const code = withoutPrefix.slice(separator + 1);
  if (!isRoomCode(code)) return null;
  return { name: withoutPrefix.slice(0, separator), code };
}

// Whether this exact room already exists — see the server route of the same
// path for why it answers about private rooms too. Only used to stop
// "Entrar em sala" from silently creating the room someone meant to join
// (a mistyped digit is otherwise indistinguishable from a fresh room).
export async function roomExists(handle: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(
    `${getSignalingHttpBase()}/rooms/${encodeURIComponent(handle)}/exists`,
    { signal }
  );
  if (!res.ok) throw new Error(`Falha ao verificar a sala (status ${res.status})`);
  const data = (await res.json()) as { exists: boolean };
  return data.exists;
}

export type PublicRoom = {
  handle: string;
  peopleCount: number;
  createdAt: number;
  // Where the room's owner/admins pinned it on the world map (see
  // components/WorldMap and the /mapa page) — null, or absent entirely from
  // a server that predates the field, for a room nobody has placed. Only the
  // map reads it; the plain /rooms list ignores it.
  location?: { lat: number; lng: number } | null;
};

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
