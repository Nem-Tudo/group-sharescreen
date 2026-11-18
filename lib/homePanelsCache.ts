"use client";

import type { Conversation } from "@/lib/dmApi";
import type { GroupSummary } from "@/lib/groupsApi";
import type { SocialUser } from "@/lib/socialApi";

// What the home page's side panels last showed, kept in this browser so the
// next visit opens on it instead of on placeholders.
//
// Stale-while-revalidate, and only for drawing: the panels show this while
// their own read is in flight and drop it the moment that read answers. It
// never seeds the shared stores (useSocialGraph, useGroups, the conversation
// list) — SocialNotifier compares one sweep of the graph with the last, and a
// cached sweep fed into it would announce a friend request that is days old.
//
// Tagged with the account it was written for, so a different account signing
// in on the same browser never sees somebody else's friends, and cleared on
// sign-out (see AuthContext's logout) so a shared computer does not keep the
// last person's conversations on disk.

const KEY = "golive.homePanels.v1";

/** Enough rows to fill the tallest panel; the rest arrive with the read. */
const MAX_ITEMS = 40;

export interface HomePanelsSnapshot {
  accountId: string;
  friends?: SocialUser[];
  friendCount?: number;
  incoming?: number;
  groups?: GroupSummary[];
  conversations?: Conversation[];
  totalUnread?: number;
}

// Parsed once per page: every panel reads it on render, and re-parsing a few
// kilobytes of JSON on each of those is waste.
let memo: HomePanelsSnapshot | null | undefined;

function load(): HomePanelsSnapshot | null {
  if (memo !== undefined) return memo;
  memo = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HomePanelsSnapshot;
      if (parsed && typeof parsed.accountId === "string") memo = parsed;
    }
  } catch {
    // Private window, blocked storage, or a value from another version.
  }
  return memo;
}

/** The last snapshot written for `accountId`, or null. */
export function readHomePanels(accountId: string): HomePanelsSnapshot | null {
  if (typeof window === "undefined") return null;
  const snapshot = load();
  return snapshot?.accountId === accountId ? snapshot : null;
}

/** Merges `patch` into this account's snapshot. */
export function writeHomePanels(
  accountId: string,
  patch: Omit<HomePanelsSnapshot, "accountId">
): void {
  if (typeof window === "undefined") return;
  const current = readHomePanels(accountId);
  const next: HomePanelsSnapshot = { ...current, ...patch, accountId };
  if (next.friends) next.friends = next.friends.slice(0, MAX_ITEMS);
  if (next.groups) next.groups = next.groups.slice(0, MAX_ITEMS);
  memo = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Full or blocked: the next visit simply opens on placeholders.
  }
}

export function clearHomePanels(): void {
  memo = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}
