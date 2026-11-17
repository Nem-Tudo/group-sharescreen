"use client";

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

export interface ProfileComment {
  id: string;
  text: string;
  gif: ProfileCommentGif | null;
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
      /** Only on the first page. */
      total?: number;
      comments: ProfileComment[];
      hasMore: boolean;
      maxLength?: number;
    };

export const PROFILE_COMMENT_MAX_LENGTH = 500;

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
  return (await res.json()) as ProfileCommentsPage;
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
    return { ok: true, comment: data.comment };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
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

export async function setProfileCommentsDisabled(disabled: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/account/profile-comments`, {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({ disabled }),
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
