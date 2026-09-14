"use client";

import { getAccountToken } from "./accountApi";
import { getSignalingHttpBase } from "./roomsApi";
import { translate } from "@/lib/i18n";

// Adding a bot to a group — the page a bot's "add to group" link opens (see
// app/bots/[id]/add). Everything else about bots — creating them, their
// tokens, their profile — lives in the developer dashboard, a separate app
// (see DEVELOPERS_URL); this is the one part that has to be here, because it
// is done by whoever runs the group, and they are signed in *here*.
//
// Always the account's token, never a guest's: a guest does not run a group,
// and the API answers a guest exactly as it answers nobody.

/**
 * Where the developer dashboard lives. Overridable for a staging deploy; the
 * default is the production one.
 */
export const DEVELOPERS_URL = (
  process.env.NEXT_PUBLIC_DEVELOPERS_URL || "https://golive-developers.nemtudo.me"
).replace(/\/+$/, "");

/** The link a bot's owner hands out so group managers can add it. */
export function botAddPath(botId: string): string {
  return `/bots/${encodeURIComponent(botId)}/add`;
}

export type BotInstallGroup = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  suspended?: boolean;
  /** The bot is already in it. */
  member: boolean;
};

export type BotInstallInfo = {
  bot: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    bio: string | null;
    flags: string[];
    groupCount: number;
    createdAt: number;
  };
  /** Anybody who manages a group may add it — otherwise only its owner. */
  public: boolean;
  /** The person asking is the bot's owner. */
  owner: boolean;
  /** The person asking may add it at all (public, or theirs). */
  canInstall: boolean;
  signedIn: boolean;
  /** The groups the person asking manages — empty when signed out or not allowed. */
  groups: BotInstallGroup[];
};

function authHeaders(): Record<string, string> {
  const token = getAccountToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Null when there is no such bot. */
export async function fetchBotInstall(id: string, signal?: AbortSignal): Promise<BotInstallInfo | null> {
  const res = await fetch(`${getSignalingHttpBase()}/bots/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(translate("groupsApi.somethingWentWrongTryAgain"));
  return (await res.json()) as BotInstallInfo;
}

export async function addBotToGroup(
  groupId: string,
  botId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getSignalingHttpBase()}/groups/${encodeURIComponent(groupId)}/bots`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ botId }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: data?.error ?? translate("groupsApi.somethingWentWrongTryAgain") };
  } catch {
    return { ok: false, error: translate("common.noConnectionToTheServer") };
  }
}
