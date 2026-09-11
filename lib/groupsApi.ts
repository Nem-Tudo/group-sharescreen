"use client";

import { getAccountToken } from "./accountApi";
import { getStoredGuestToken } from "./guestToken";
import { getSignalingHttpBase } from "./roomsApi";

// The groups client. Same division of labour as lib/dmApi.ts: **the server is
// the group**, every list here is read over HTTP, and the socket only ever says
// "something changed" (see lib/useGroups.ts, which re-reads on those nudges).
//
// Unlike the DM and social clients this one also speaks for guests: a guest can
// be a member (see the API's groupStore MAX_GUEST_GROUPS), so the token sent is
// the account's when there is one and the guest's otherwise.

export type GroupRole = "owner" | "admin" | "member";
export type GroupChannelKind = "text" | "voice";
export type GroupNotifyLevel = "all" | "mentions" | "none";

export interface GroupSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  /** "VERIFIED" draws the badge beside the name — see components/groups/GroupName. */
  flags: string[];
  role: GroupRole;
  unread: boolean;
  mentions: number;
}

export interface GroupChannel {
  id: string;
  kind: GroupChannelKind;
  name: string;
  position: number;
  unread: boolean;
  mentions: number;
}

export interface GroupVoiceParticipant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  mic: boolean;
  sharing: boolean;
}

export type GroupVoiceMap = Record<string, GroupVoiceParticipant[]>;

export interface GroupInfo {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  /** The group's theme by id, or null for each person's own. See the API's groupModels. */
  theme: string | null;
  /** "VERIFIED" draws the badge beside the name — see components/groups/GroupName. */
  flags: string[];
  /** Where the group is on the public map, or null for none. See /worldmap. */
  location: { lat: number; lng: number } | null;
  ownerId: string;
  admins: string[];
  memberCount: number;
  createdAt: number;
}

export interface GroupDetail {
  group: GroupInfo;
  channels: GroupChannel[];
  voice: GroupVoiceMap;
  me: { id: string; role: GroupRole; notify: GroupNotifyLevel; guest: boolean };
  /** False on an installation without a database — the text rooms are off there. */
  chatAvailable: boolean;
}

export interface GroupUser {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  nameColor: string | null;
  flags: string[];
  guest: boolean;
}

export interface GroupMember extends GroupUser {
  role: GroupRole;
  online: boolean;
  joinedAt: number;
}

export interface GroupBan {
  userId: string;
  name: string;
  bannedAt: number;
  by: string;
}

export interface GroupReplyTo {
  id: string;
  userId?: string;
  name: string;
  text?: string;
  kind?: "text" | "gif" | "image";
  images?: string[];
}

export interface GroupMessage {
  id: string;
  groupId: string;
  channelId: string;
  from: string;
  fromName: string;
  text: string;
  kind?: "text" | "gif" | "image";
  url?: string;
  images?: string[];
  replyTo?: GroupReplyTo | null;
  mentions?: string[];
  ts: number;
}

export interface GroupInvite {
  code: string;
  createdBy: string;
  createdByName?: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
}

export type InviteLifetime = "30m" | "1h" | "6h" | "1d" | "7d" | "never";

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

/** The token groups are asked about with: the account's, or the guest's. */
export function groupAuthToken(): string | null {
  return getAccountToken() ?? getStoredGuestToken();
}

async function request<T extends object>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<Result<T>> {
  const token = groupAuthToken();
  try {
    const res = await fetch(`${getSignalingHttpBase()}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      return { ok: false, status: res.status, error: data.error ?? "Algo deu errado. Tente de novo." };
    }
    return { ok: true, ...data };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    return { ok: false, status: 0, error: "Sem conexão com o servidor." };
  }
}

const enc = encodeURIComponent;

// ─── Groups ──────────────────────────────────────────────────────────────

export const fetchMyGroups = (signal?: AbortSignal) =>
  request<{ groups: GroupSummary[] }>("GET", "/groups", undefined, signal);

export const createGroup = (name: string) =>
  request<{ group: GroupInfo }>("POST", "/groups", { name });

export const fetchGroup = (groupId: string, signal?: AbortSignal) =>
  request<GroupDetail>("GET", `/groups/${enc(groupId)}`, undefined, signal);

export const fetchGroupVoice = (groupId: string, signal?: AbortSignal) =>
  request<{ voice: GroupVoiceMap }>("GET", `/groups/${enc(groupId)}/voice`, undefined, signal);

export const updateGroup = (groupId: string, patch: { name?: string; description?: string }) =>
  request<{ group: GroupInfo }>("PATCH", `/groups/${enc(groupId)}`, patch);

/** `image` is a data URL, already downscaled by lib/avatarImage's prepareAvatarImage. */
export const uploadGroupIcon = (groupId: string, image: string) =>
  request<{ group: GroupInfo }>("POST", `/groups/${enc(groupId)}/icon`, { image });

export const removeGroupIcon = (groupId: string) =>
  request<{ group: GroupInfo }>("DELETE", `/groups/${enc(groupId)}/icon`);

/** Puts the group on the public map (owner/admins), or takes it off with null. */
export const setGroupLocation = (groupId: string, location: { lat: number; lng: number } | null) =>
  request<{ group: GroupInfo }>("PUT", `/groups/${enc(groupId)}/location`, { location });

/** A group on the public map — what /groups/map answers with. */
export interface GroupMapPin {
  id: string;
  name: string;
  iconUrl: string | null;
  flags: string[];
  description: string;
  memberCount: number;
  onlineCount: number;
  location: { lat: number; lng: number };
}

/** Every group on the public map. Needs no identity. */
export const fetchGroupMap = (signal?: AbortSignal) =>
  request<{ groups: GroupMapPin[] }>("GET", "/groups/map", undefined, signal);

/** Repaints the whole group for everybody (Pro Max, owner/admins). Null clears it. */
export const setGroupTheme = (groupId: string, theme: string | null) =>
  request<{ group: GroupInfo }>("PUT", `/groups/${enc(groupId)}/theme`, { theme });

export const deleteGroup = (groupId: string) =>
  request<object>("DELETE", `/groups/${enc(groupId)}`);

export const transferGroup = (groupId: string, userId: string) =>
  request<{ group: GroupInfo }>("POST", `/groups/${enc(groupId)}/transfer`, { userId });

export const leaveGroup = (groupId: string) =>
  request<object>("POST", `/groups/${enc(groupId)}/leave`);

export const setGroupNotify = (groupId: string, level: GroupNotifyLevel) =>
  request<{ notify: GroupNotifyLevel }>("PUT", `/groups/${enc(groupId)}/notify`, { level });

// ─── Members ─────────────────────────────────────────────────────────────

export const fetchMembers = (groupId: string, signal?: AbortSignal) =>
  request<{ members: GroupMember[] }>("GET", `/groups/${enc(groupId)}/members`, undefined, signal);

export const setGroupAdmin = (groupId: string, userId: string, admin: boolean) =>
  request<{ group: GroupInfo }>(admin ? "POST" : "DELETE", `/groups/${enc(groupId)}/admins/${enc(userId)}`);

export const kickMember = (groupId: string, userId: string) =>
  request<object>("POST", `/groups/${enc(groupId)}/members/${enc(userId)}/kick`);

export const banMember = (groupId: string, userId: string) =>
  request<object>("POST", `/groups/${enc(groupId)}/bans/${enc(userId)}`);

export const unbanMember = (groupId: string, userId: string) =>
  request<{ bans: GroupBan[] }>("DELETE", `/groups/${enc(groupId)}/bans/${enc(userId)}`);

export const fetchBans = (groupId: string) =>
  request<{ bans: GroupBan[] }>("GET", `/groups/${enc(groupId)}/bans`);

// ─── Rooms ───────────────────────────────────────────────────────────────

export const createChannel = (groupId: string, kind: GroupChannelKind, name: string) =>
  request<{ channel: GroupChannel }>("POST", `/groups/${enc(groupId)}/channels`, { kind, name });

export const renameChannel = (groupId: string, channelId: string, name: string) =>
  request<{ channel: GroupChannel }>("PATCH", `/groups/${enc(groupId)}/channels/${enc(channelId)}`, { name });

export const deleteChannel = (groupId: string, channelId: string) =>
  request<object>("DELETE", `/groups/${enc(groupId)}/channels/${enc(channelId)}`);

export const reorderChannels = (groupId: string, ids: string[]) =>
  request<object>("PUT", `/groups/${enc(groupId)}/channels/order`, { ids });

// ─── Invites ─────────────────────────────────────────────────────────────

export const fetchInvites = (groupId: string) =>
  request<{ invites: GroupInvite[] }>("GET", `/groups/${enc(groupId)}/invites`);

export const createInvite = (groupId: string, expiresIn: InviteLifetime, maxUses: number | null) =>
  request<{ invite: GroupInvite }>("POST", `/groups/${enc(groupId)}/invites`, {
    expiresIn,
    ...(maxUses ? { maxUses } : {}),
  });

export const revokeInvite = (groupId: string, code: string) =>
  request<object>("DELETE", `/groups/${enc(groupId)}/invites/${enc(code)}`);

/** `name` is a guest's display name — ignored for an account. */
export const acceptInvite = (code: string, name?: string | null) =>
  request<{ groupId: string }>("POST", `/invites/${enc(code)}/accept`, name ? { name } : {});

// ─── Messages ────────────────────────────────────────────────────────────

export const fetchMessages = (
  groupId: string,
  channelId: string,
  before?: number,
  signal?: AbortSignal
) =>
  request<{ messages: GroupMessage[]; authors: Record<string, GroupUser> }>(
    "GET",
    `/groups/${enc(groupId)}/channels/${enc(channelId)}/messages${before ? `?before=${before}` : ""}`,
    undefined,
    signal
  );

export const sendGroupMessage = (
  groupId: string,
  channelId: string,
  payload: {
    text?: string;
    url?: string;
    images?: string[];
    replyTo?: GroupReplyTo | null;
    mentions?: string[];
    /** A guest's current name, so their messages carry it. */
    name?: string | null;
  }
) =>
  request<{ message: GroupMessage; author: GroupUser }>(
    "POST",
    `/groups/${enc(groupId)}/channels/${enc(channelId)}/messages`,
    {
      text: payload.text ?? "",
      ...(payload.url ? { url: payload.url } : {}),
      ...(payload.images && payload.images.length > 0 ? { images: payload.images } : {}),
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
      ...(payload.mentions && payload.mentions.length > 0 ? { mentions: payload.mentions } : {}),
      ...(payload.name ? { name: payload.name } : {}),
    }
  );

export const deleteGroupMessage = (groupId: string, channelId: string, messageId: string) =>
  request<object>("DELETE", `/groups/${enc(groupId)}/channels/${enc(channelId)}/messages/${enc(messageId)}`);

/** Moves this person's bookmark in one text room to now. Fire-and-forget, like the DM one. */
export function markChannelRead(groupId: string, channelId: string): void {
  void request<object>("POST", `/groups/${enc(groupId)}/channels/${enc(channelId)}/read`).catch(() => {});
}
