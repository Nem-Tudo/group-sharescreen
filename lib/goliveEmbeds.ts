import { GROUP_VOICE_PREFIX, parseGroupsPath } from "@/lib/groupLinks";

// GoLive's own links, pasted into a GoLive chat, drawn as a card you can act
// on without leaving where you are (experiment "golive-embeds"). This file is
// only the reading of the links; the cards are components/GoLiveEmbeds.tsx.
//
// Group invites are not here: they had their card before this experiment
// (components/groups/InviteEmbed) and keep it for everybody.

export const GOLIVE_EMBEDS_FEATURE = "golive-embeds";

export type GoLiveLink =
  | { kind: "room"; handle: string }
  | { kind: "gift"; code: string }
  | { kind: "user"; id: string }
  | { kind: "group"; groupId: string; roomId: string | null }
  | { kind: "effect"; id: string };

/** Numbers sent as `value` with the events, so the admin can split them by kind. */
export const EMBED_KIND_VALUE: Record<GoLiveLink["kind"], number> = {
  room: 1,
  gift: 2,
  user: 3,
  group: 4,
  effect: 5,
};

/** The site's long and short hosts, plus wherever this page itself is served from (dev, previews). */
const LONG_HOSTS = new Set(["golive.nemtudo.me", "localhost", "127.0.0.1"]);
const SHORT_HOST = "g.nemtudo.me";

function isOwnHost(host: string): boolean {
  if (LONG_HOSTS.has(host) || host === SHORT_HOST) return true;
  return typeof window !== "undefined" && window.location.hostname.toLowerCase() === host;
}

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const GIFT_CODE_RE = /^[A-Za-z0-9]{4,40}$/;
const USER_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const EFFECT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/** A room handle a /watch link may name — never a group's voice room, which opens through its group. */
function roomHandle(value: string): string | null {
  return HANDLE_RE.test(value) && !value.startsWith(GROUP_VOICE_PREFIX) ? value : null;
}

/** What one pasted address is, or null when it is not one of the links that get a card. */
export function parseGoLiveLink(raw: string): GoLiveLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!isOwnHost(host)) return null;
  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length === 0) return null;

  // The short host only ever carries a room ("g.nemtudo.me/sala") or an invite.
  if (host === SHORT_HOST && segments.length === 1 && segments[0] !== "invite") {
    const handle = roomHandle(segments[0]);
    return handle ? { kind: "room", handle } : null;
  }

  const [first, second] = segments;
  if (first === "watch" && segments.length === 2) {
    const handle = roomHandle(second);
    return handle ? { kind: "room", handle } : null;
  }
  if (first === "gift" && segments.length === 2 && GIFT_CODE_RE.test(second)) {
    return { kind: "gift", code: second.toUpperCase() };
  }
  if (first === "user" && segments.length === 2 && USER_ID_RE.test(second)) {
    return { kind: "user", id: second };
  }
  if (first === "effect" && segments.length === 2 && EFFECT_ID_RE.test(second)) {
    return { kind: "effect", id: second };
  }
  if (first === "groups") {
    const route = parseGroupsPath(url.pathname);
    if (route?.kind === "group") return { kind: "group", groupId: route.groupId, roomId: null };
    if (route?.kind === "room") return { kind: "group", groupId: route.groupId, roomId: route.roomId };
  }
  return null;
}

export function embedKey(link: GoLiveLink): string {
  switch (link.kind) {
    case "room":
      return `room:${link.handle}`;
    case "gift":
      return `gift:${link.code}`;
    case "user":
      return `user:${link.id.toLowerCase()}`;
    case "group":
      return `group:${link.groupId}:${link.roomId ?? ""}`;
    case "effect":
      return `effect:${link.id}`;
  }
}

/** More than this many in one message is a list, not a message worth a card each. */
const MAX_EMBEDS = 3;
const LINK_RE = /https?:\/\/[^\s<>"']+/gi;

/** The links in a message that get a card, in order, each once. */
export function goLiveLinksIn(text: string): GoLiveLink[] {
  if (!text.includes("://")) return [];
  const found: GoLiveLink[] = [];
  const keys = new Set<string>();
  for (const match of text.matchAll(LINK_RE)) {
    // A sentence's punctuation after the link is not part of it.
    const link = parseGoLiveLink(match[0].replace(/[)\].,!?;:'"]+$/, ""));
    if (!link) continue;
    const key = embedKey(link);
    if (keys.has(key)) continue;
    keys.add(key);
    found.push(link);
    if (found.length >= MAX_EMBEDS) break;
  }
  return found;
}

/** Whether an address is one of ours that gets a card of its own (invites included). */
export function isEmbeddedGoLiveLink(raw: string): boolean {
  if (parseGoLiveLink(raw)) return true;
  try {
    const url = new URL(raw);
    return isOwnHost(url.hostname.toLowerCase().replace(/^www\./, "")) && url.pathname.startsWith("/invite/");
  } catch {
    return false;
  }
}
