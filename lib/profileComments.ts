"use client";

import { createContext } from "react";
import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

// Comments on a person's profile — experiment "profile-comments".
//
// The API decides who has them, per *profile owner* (see its
// profileCommentRoutes.ts): a profile outside the experiment answers
// `available: false` and the site draws nothing. The site's own useFeature is
// only used to count the owner's exposure, on their own profile.

export const PROFILE_COMMENTS_FEATURE = "profile-comments";

/**
 * The site's events (all at most 40 characters — see CLAUDE.md). The API's
 * own, counted for the profile owner, is `pc_received`.
 */
export const PROFILE_COMMENT_EVENTS = {
  /** Posted a comment. value 1 = text, 2 = GIF, 3 = both. */
  post: "pc_post",
  /** Opened the GIF picker in the composer. */
  gifOpen: "pc_gif_open",
  /** Deleted a comment. value 1 = own, 2 = as the profile owner, 3 = as admin. */
  delete: "pc_delete",
  /** The owner kept somebody from commenting. */
  block: "pc_block",
  /** The owner switched comments off (value 0) or on (value 1). */
  toggleOff: "pc_off",
  toggleOn: "pc_on",
  /** Pressed "load more". value 1 = popup, 2 = page. */
  more: "pc_more",
  /** Put an emoji on a comment. value 1 = joined one already there, 2 = a new one. */
  react: "pc_react",
  /** Took one's own reaction back. */
  unreact: "pc_unreact",
  /** The owner switched reactions off / on. */
  reactionsOff: "pc_react_off",
  reactionsOn: "pc_react_on",
} as const;

/** Also the API's — see its PROFILE_COMMENT_SERVER_EVENTS. */
export const PROFILE_COMMENT_SERVER_EVENTS = ["pc_received"] as const;

export interface ProfileCommentUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  flags: string[];
  nameColor: string | null;
  bot: boolean;
}

export interface ProfileCommentGif {
  url: string;
  width: number;
  height: number;
}

/**
 * One emoji on a comment, as this viewer sees it (see the API's WireReaction):
 * how many, whether one of them is this viewer, and the first few names for
 * the tooltip. Never the ids: on a profile anybody can react.
 */
export interface ProfileCommentReaction {
  emoji: string;
  count: number;
  me: boolean;
  names: string[];
}

/** Different emoji on one comment (the API's PROFILE_COMMENT_MAX_REACTIONS). */
export const PROFILE_COMMENT_MAX_REACTIONS = 12;

export interface ProfileComment {
  id: string;
  text: string;
  gif: ProfileCommentGif | null;
  /** Empty when nobody reacted, and for a visitor when the owner switched reactions off. */
  reactions: ProfileCommentReaction[];
  ts: number;
  author: ProfileCommentUser;
}

export type ProfileCommentBlockReason = "login" | "bot" | "disabled" | "blocked" | null;

export type ProfileCommentsPage =
  | { available: false }
  | {
      available: true;
      /** The owner has comments on. */
      enabled: boolean;
      isOwner: boolean;
      /** The owner, or a site admin: may delete any comment here. */
      canModerate: boolean;
      canComment: boolean;
      reason: ProfileCommentBlockReason;
      /** The owner has reactions on. Absent from an older API, read as on. */
      reactionsEnabled?: boolean;
      /** This viewer may react (same doors as commenting, plus the switch). */
      canReact?: boolean;
      /** Only on the first page. */
      total?: number;
      comments: ProfileComment[];
      hasMore: boolean;
      maxLength?: number;
    };

export const PROFILE_COMMENT_MAX_LENGTH = 500;

/**
 * The first page of comments that came with the profile itself (GET
 * /users/:id?with=comments — the profile popup, see UserProfileCard's
 * `withComments`), for ProfileComments to start from instead of asking.
 * `page` undefined: this read carried none (an older API) — ask as usual.
 */
export const PrefetchedCommentsContext = createContext<{ page: ProfileCommentsPage | undefined } | null>(null);

/** A page as read off the wire: an API from before reactions sends none. */
export function normalizeCommentsPage(page: ProfileCommentsPage): ProfileCommentsPage {
  return page.available ? { ...page, comments: page.comments.map(withReactions) } : page;
}

function authHeaders(json = false): Record<string, string> {
  const token = getAccountToken();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function errorOf(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
  if (data.reason === "slow_down") return translate("profileComments.slowDown");
  if (data.reason === "blocked") return translate("profileComments.cannotComment");
  if (data.reason === "disabled") return translate("profileComments.disabledVisitor");
  if (data.reason === "reactions_disabled") return translate("profileComments.reactionsDisabled");
  if (data.reason === "limit") return translate("profileComments.reactionLimit");
  return data.error ?? translate("common.couldNotComplete");
}

export async function fetchProfileComments(
  profileId: string,
  before?: number,
  signal?: AbortSignal
): Promise<ProfileCommentsPage> {
  const query = before ? `?before=${before}` : "";
  const res = await fetch(
    `${getSignalingHttpBase()}/users/${encodeURIComponent(profileId)}/comments${query}`,
    { headers: authHeaders(), signal }
  );
  if (res.status === 404) return { available: false };
  if (!res.ok) throw new Error(await errorOf(res));
  return normalizeCommentsPage((await res.json()) as ProfileCommentsPage);
}

/**
 * An API from before reactions sends none; the site may be deployed first
 * (the two are separate deploys), so a missing list reads as empty.
 */
function withReactions(comment: ProfileComment): ProfileComment {
  return Array.isArray(comment.reactions) ? comment : { ...comment, reactions: [] };
}

export async function postProfileComment(
  profileId: string,
  input: { text: string; gif: ProfileCommentGif | null }
): Promise<{ ok: true; comment: ProfileComment } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/users/${encodeURIComponent(profileId)}/comments`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
    if (!res.ok) return { ok: false, error: await errorOf(res) };
    const data = (await res.json()) as { comment: ProfileComment };
    return { ok: true, comment: withReactions(data.comment) };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/** Puts this account's emoji on a comment (`on`) or takes it back. */
export async function reactToProfileComment(
  profileId: string,
  commentId: string,
  emoji: string,
  on: boolean
): Promise<{ ok: true; reactions: ProfileCommentReaction[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/users/${encodeURIComponent(profileId)}/comments/${encodeURIComponent(commentId)}/reactions`,
      { method: "POST", headers: authHeaders(true), body: JSON.stringify({ emoji, on }) }
    );
    if (!res.ok) return { ok: false, error: await errorOf(res) };
    const data = (await res.json()) as { reactions: ProfileCommentReaction[] };
    return { ok: true, reactions: data.reactions };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

/**
 * The comment's reactions with this viewer put on `emoji` or taken off it,
 * ahead of the server (the chip lights up on the click). The API's answer
 * replaces it. Same order rule as the server: an emoji keeps its place while
 * anybody is on it, a new one goes at the end, one nobody is left on goes.
 */
export function toggleProfileReaction(
  reactions: ProfileCommentReaction[],
  emoji: string,
  on: boolean,
  myName: string
): ProfileCommentReaction[] {
  const index = reactions.findIndex((r) => r.emoji === emoji);
  if (on) {
    if (index < 0) return [...reactions, { emoji, count: 1, me: true, names: [myName] }];
    const current = reactions[index];
    if (current.me) return reactions;
    return reactions.map((r, i) =>
      i === index ? { ...r, count: r.count + 1, me: true, names: [...r.names, myName].slice(0, 5) } : r
    );
  }
  if (index < 0 || !reactions[index].me) return reactions;
  const current = reactions[index];
  if (current.count <= 1) return reactions.filter((_, i) => i !== index);
  const names = [...current.names];
  const at = names.indexOf(myName);
  if (at >= 0) names.splice(at, 1);
  return reactions.map((r, i) => (i === index ? { ...r, count: r.count - 1, me: false, names } : r));
}

export async function deleteProfileComment(
  profileId: string,
  commentId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/users/${encodeURIComponent(profileId)}/comments/${encodeURIComponent(commentId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    if (!res.ok) return { ok: false, error: await errorOf(res) };
    return { ok: true };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export interface ProfileCommentSettings {
  disabled: boolean;
  /** Absent from an older API, read as on. */
  reactionsDisabled?: boolean;
  blocked: ProfileCommentUser[];
}

export async function fetchProfileCommentSettings(): Promise<ProfileCommentSettings | null> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/account/profile-comments`, { headers: authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as ProfileCommentSettings;
  } catch {
    return null;
  }
}

/** Saves the owner's switches; a field left out is left alone. */
export async function setProfileCommentSwitches(patch: {
  disabled?: boolean;
  reactionsDisabled?: boolean;
}): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/account/profile-comments`, {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(patch),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function blockProfileCommenter(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/account/profile-comments/blocks/${encodeURIComponent(userId)}`,
      { method: "POST", headers: authHeaders() }
    );
    if (!res.ok) return { ok: false, error: await errorOf(res) };
    return { ok: true };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}

export async function unblockProfileCommenter(userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${getSignalingHttpBase()}/account/profile-comments/blocks/${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: authHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}
