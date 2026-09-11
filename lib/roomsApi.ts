/**
 * Dynamically resolves the WebSocket signaling URL.
 * In development, if NEXT_PUBLIC_SIGNALING_URL points to localhost/127.0.0.1,
 * but the app is accessed via a remote or LAN IP (e.g. 100.101.38.69),
 * this automatically adapts the host to match the page's host.
 */
export function getSignalingWsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SIGNALING_URL || "ws://localhost:4000/ws";
  if (typeof window === "undefined") {
    return configured;
  }
  try {
    const parsed = new URL(configured);
    if (
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
      window.location.hostname &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      parsed.hostname = window.location.hostname;
      if (window.location.protocol === "https:" && parsed.protocol === "ws:") {
        parsed.protocol = "wss:";
      }
      return parsed.toString();
    }
  } catch {
    // Ignore URL parse error and fall back to configured
  }
  return configured;
}

// The signaling server also serves plain HTTP endpoints (health, room
// directory) on the same host — derive that base from the WS URL instead of
// needing a second env var for what's really the same server.
export function getSignalingHttpBase(): string {
  return getSignalingWsUrl().replace(/^ws/, "http").replace(/\/ws\/?$/, "");
}

export const PRIVATE_ROOM_PREFIX = "priv-";

export function toRoomHandle(rawHandle: string, isPrivate: boolean): string {
  return isPrivate ? `${PRIVATE_ROOM_PREFIX}${rawHandle}` : rawHandle;
}

/**
 * Hosts whose links name a room, and where in the path the name sits.
 *
 * Two shapes because there are two links in circulation: the canonical one
 * the room's own address bar shows, and the short one meant to be read out
 * loud or typed from a phone screen.
 */
const ROOM_LINK_HOSTS: Record<string, { prefix?: string }> = {
  "golive.nemtudo.me": { prefix: "watch" },
  "g.nemtudo.me": {},
};

/**
 * The room somebody meant, from whatever they pasted.
 *
 * Written to be *unsurprising* rather than clever: anything this does not
 * recognise as one of our links comes back exactly as it went in, so the
 * validation and the error messages downstream are unchanged for every input
 * that used to reach them. The only behaviour that is new is that a link now
 * works where only a bare handle did.
 *
 * Nobody should have to know that "the part after /watch/" is the bit to
 * copy. The link is what gets pasted into a group chat, so the link is what
 * gets pasted back in here.
 */
export function roomHandleFromInput(raw: string): string {
  const trimmed = raw.trim();
  // A handle is letters, digits, "-" and "_" (see HANDLE_RE) — none of which
  // is a dot or a slash. Anything without one of those cannot be a link, and
  // is left alone rather than run through a URL parser that would only ever
  // hand it straight back.
  if (!trimmed || !/[./]/.test(trimmed)) return trimmed;

  // A pasted link often arrives bare ("g.nemtudo.me/sala"). The scheme is
  // added rather than required, because URL refuses to parse without one and
  // that is the most common way the link is actually shared.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return trimmed;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const shape = ROOM_LINK_HOSTS[host];
  if (!shape) return trimmed;

  let segments: string[];
  try {
    // Decoded because a room name reaches the address bar percent-encoded and
    // has to come back out as the name. Guarded because a malformed escape
    // throws, and a bad paste should not be an exception.
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return trimmed;
  }

  if (shape.prefix) {
    // Exactly "/watch/<sala>" — any other path on that host is some other
    // page, and guessing a room out of it would send somebody somewhere they
    // never asked to go.
    return segments[0] === shape.prefix && segments[1] ? segments[1] : trimmed;
  }
  return segments.length === 1 && segments[0] ? segments[0] : trimmed;
}

export function isPrivateRoomHandle(handle: string): boolean {
  return handle.startsWith(PRIVATE_ROOM_PREFIX);
}

/**
 * Whether a handle is a room a call turned into.
 *
 * Mirrors the API's own isCallRoomHandle (see its callStore.ts), shape and
 * all: "priv-call-<10 aleatórios>-<6 dígitos>". Matched strictly rather than
 * by the "priv-call-" prefix alone, so a room somebody deliberately named
 * "priv-call-me-maybe" is still an ordinary room they get to keep.
 *
 * What it is for is deciding where a room does *not* belong. A call room is
 * generated, single-use and named after nothing: it has no place in a list of
 * rooms somebody would want to go back to.
 */
export function isCallRoomHandle(handle: string): boolean {
  return /^priv-call-[a-z0-9]{10}-\d{6}$/.test(handle);
}

/**
 * The name halves of the rooms the theme pages open. See lib/roomThemes, which
 * builds the links; kept here so the builder and the rule below read the same
 * two strings.
 */
export const THEME_CREATION_ROOM_NAME = "theme-creation";
export const THEME_VIEW_ROOM_NAME = "theme-view";

/**
 * Which theme a room is being shown in (see lib/roomThemes' themeViewRoomLink).
 * A parameter of its own rather than the editor's `tema`.
 *
 * Lives here, not beside the link builder, because the watch page reads it on
 * the *server* and lib/roomThemes is a client module — a server component
 * calling a function from one is a runtime error that neither the type check
 * nor the build notices. This file carries no "use client", so both can.
 */
export const THEME_VIEW_PARAM = "theme_id";

/**
 * The theme a room was opened to show, from its query string — or null.
 *
 * Takes the already-parsed value rather than a search string, because it is
 * read on the server so the first render and the browser's agree. Only the
 * shape is checked; whether the id names a theme at all is for the fetch to
 * find out, and a bad one simply shows the site's own look.
 */
export function viewedThemeId(value: string | string[] | undefined): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) return null;
  const trimmed = id.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * Whether a handle is a room a theme page opened — "priv-theme-creation-<6>"
 * or "priv-theme-view-<6>".
 *
 * Same reasoning as isCallRoomHandle, and matched as strictly: these are
 * minted per press, named after a task rather than a place, and nobody goes
 * back to one — the way back to a theme is the theme's page, not the room it
 * was once looked at in. Somebody who deliberately calls their own room
 * "priv-theme-view-da-galera" keeps it, because that is not six digits.
 */
export function isThemeRoomHandle(handle: string): boolean {
  // [0-9] rather than a backslash-d: this pattern is built from a template
  // literal, where an unrecognised escape quietly becomes the bare letter and
  // the rule would match "priv-theme-view-dddddd" instead of the six digits.
  return new RegExp(
    `^${PRIVATE_ROOM_PREFIX}(?:${THEME_CREATION_ROOM_NAME}|${THEME_VIEW_ROOM_NAME})-[0-9]{6}$`
  ).test(handle);
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
export const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
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
  // How many people have the mic open, how many are transmitting a screen,
  // how many have a camera on, and how many videos the room has queued up
  // (see the server's /rooms). Screen and camera are two separate channels
  // there and stay two separate numbers here — a room being presented to and
  // a room of faces are not the same room to walk into.
  //
  // Optional because a server that predates them sends none of the four —
  // the room list reads them through roomActivity, which treats a missing
  // field as 0 rather than showing "undefined" on every card.
  micCount?: number;
  screenCount?: number;
  cameraCount?: number;
  videoSourceCount?: number;
  createdAt: number;
  // Where the room's owner/admins pinned it on the world map (see
  // components/WorldMap and the /worldmap page) — null, or absent entirely from
  // a server that predates the field, for a room nobody has placed. Only the
  // map reads it; the plain /rooms list ignores it.
  location?: { lat: number; lng: number } | null;
  // The room's blurb and category (see lib/roomCategories) — shown by both
  // the list and the map. Absent entirely from a server that predates them.
  description?: string;
  category?: string | null;
};

// The four counters above, as a plain number — one place to decide what a
// server that never sent the field means, instead of a `?? 0` at every use.
export function roomActivity(
  room: PublicRoom,
  metric: "micCount" | "screenCount" | "cameraCount" | "videoSourceCount"
): number {
  return room[metric] ?? 0;
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
