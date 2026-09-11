import { getSignalingHttpBase } from "./roomsApi";

// The parts of groups that have to work on the server as well as in the
// browser: the shape of their links, and the one read an invite page makes
// before anybody has an identity. No "use client" and no token — the invite
// page reads the preview during its server render (see app/invite/[code]),
// and everything that needs to know who is asking lives in lib/groupsApi.ts.

/**
 * The handle a group's voice room goes by inside the room system.
 *
 * Mirrors the API's groupVoiceHandle (see its groupStore.ts). The prefix does
 * not by itself make a room a group's — the server decides that by looking the
 * id up — so nothing here should ever treat a handle as a group room merely
 * because of how it starts. This is only for building one from a room id the
 * group itself handed out.
 */
export const GROUP_VOICE_PREFIX = "grp-";

export function groupVoiceHandle(channelId: string): string {
  return `${GROUP_VOICE_PREFIX}${channelId}`;
}

/** Group and room ids are lowercase letters and digits (see the API's newGroupId/newChannelId). */
const GROUP_ID_RE = /^[a-z0-9]{6,32}$/;
// Either kind of invite: a random code (letters and digits, case matters) or
// a group's own link, which may also have hyphens — never at either end. See
// CUSTOM_INVITE_RE for the stricter shape a custom link is saved in.
const INVITE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,30}[A-Za-z0-9]$/;

/**
 * What a group's custom invite link may be (see the API's groupStore): 3 to 32
 * lowercase letters, digits or hyphens, no hyphen at either end. Typed in any
 * case — it is lowered before it is saved or looked up.
 */
export const CUSTOM_INVITE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function isGroupId(value: string): boolean {
  return GROUP_ID_RE.test(value);
}

export function isInviteCode(value: string): boolean {
  return INVITE_CODE_RE.test(value);
}

export function groupPath(groupId: string, channelId?: string | null): string {
  return channelId ? `/groups/${groupId}/${channelId}` : `/groups/${groupId}`;
}

/** What a path under /groups names — groupPath read back. See lib/groupNavigation. */
export type GroupsRoute =
  | { kind: "home" }
  | { kind: "group"; groupId: string }
  | { kind: "room"; groupId: string; roomId: string };

export function parseGroupsPath(pathname: string | null | undefined): GroupsRoute | null {
  if (!pathname) return null;
  const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts[0] !== "groups" || parts.length > 3) return null;
  if (parts.length === 1) return { kind: "home" };
  const groupId = decodeURIComponent(parts[1]);
  if (parts.length === 2) return { kind: "group", groupId };
  return { kind: "room", groupId, roomId: decodeURIComponent(parts[2]) };
}

export function invitePath(code: string): string {
  return `/invite/${code}`;
}

/** Hosts whose links can carry an invite. Same two as the room links (see roomsApi). */
const INVITE_HOSTS = new Set(["golive.nemtudo.me", "g.nemtudo.me", "localhost", "127.0.0.1"]);

/**
 * The invite code somebody meant, from whatever they pasted — a bare code or
 * a full "…/invite/<code>" link. Null when it is neither.
 *
 * Same philosophy as roomHandleFromInput: a link is what gets pasted into a
 * chat, so a link is what gets pasted back in, and nobody should have to know
 * which part of it is "the code".
 */
export function inviteCodeFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isInviteCode(trimmed)) return trimmed;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!INVITE_HOSTS.has(host)) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "invite" || !segments[1]) return null;
  return isInviteCode(segments[1]) ? segments[1] : null;
}

export type InviteState = "ok" | "expired" | "revoked" | "exhausted";

export interface InvitePreview {
  /** `custom` for a group's own link: it never expires and is never used up. */
  invite: { code: string; state: InviteState; expiresAt: number | null; custom?: boolean };
  group: {
    id: string;
    name: string;
    description: string;
    iconUrl: string | null;
    /** "VERIFIED" draws the badge beside the name. Absent from an older API. */
    flags?: string[];
    memberCount: number;
    onlineCount: number;
    /** Suspended by the site's administrators — nobody gets in until it is lifted. */
    suspended?: boolean;
  };
  /** Whether whoever asked is already in the group. Always false without a token. */
  member: boolean;
}

/**
 * What an invite leads to. Takes an optional token so the browser can ask
 * "am I already in?" with the same call the server render makes without one.
 */
export async function fetchInvitePreview(
  code: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<InvitePreview | null> {
  if (!isInviteCode(code)) return null;
  try {
    const res = await fetch(`${getSignalingHttpBase()}/invites/${encodeURIComponent(code)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as InvitePreview;
  } catch {
    return null;
  }
}

/** What a public group's page shows somebody not in it yet — an invite's preview, without the invite. */
export interface PublicGroupPreview {
  group: InvitePreview["group"];
  member: boolean;
}

/** A public group's card, or null for a private group, a missing one, or a failed read — all alike. */
export async function fetchPublicGroupPreview(
  groupId: string,
  token?: string | null,
  signal?: AbortSignal
): Promise<PublicGroupPreview | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/groups/${encodeURIComponent(groupId)}/preview`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicGroupPreview;
  } catch {
    return null;
  }
}

/** What an invite's lifetime says, in words — "expira em 3 h", "nunca expira". */
export function describeInviteExpiry(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt === null) return "Nunca expira";
  const left = expiresAt - now;
  if (left <= 0) return "Expirado";
  const minutes = Math.ceil(left / 60_000);
  if (minutes < 60) return `Expira em ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Expira em ${hours} h`;
  return `Expira em ${Math.round(hours / 24)} dias`;
}

/** Initials for a group with no icon: the first letter of up to two words. */
export function groupInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? "");
  return (letters.join("") || "?").toUpperCase();
}
