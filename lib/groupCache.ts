"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  fetchMembers,
  fetchMessages,
  type GroupMember,
  type GroupMessage,
  type GroupUser,
} from "./groupsApi";

// What the group screens have already read, kept for the life of the tab, so
// moving between rooms and groups shows something at once instead of a
// skeleton — and re-reads in the background, so what is shown catches up
// within a moment. Stale-while-revalidate, in short.
//
// Two caches:
//
//   messages — the last page or so of each text room recently opened, kept
//              current by the socket while it is not on screen (see
//              lib/useGroups' handleEvent), so reopening a room is instant and
//              already has whatever arrived in between.
//   members  — each group's member list, shared by every screen that needs it
//              (the members column, @mention suggestions) instead of each one
//              fetching its own.
//
// Bounded on purpose: the most recently used rooms only, and a capped number of
// messages in each. A tab left open for a week must not become the database.

const PAGE_SIZE = 50;
const MAX_CHANNELS = 30;
const MAX_MESSAGES_PER_CHANNEL = 300;
/** How old a cached room may be before opening it re-reads it. */
const CHANNEL_STALE_MS = 15_000;
/** How old a cached member list may be before a screen asking for it re-reads it. */
const MEMBERS_STALE_MS = 30_000;

// ─── Messages ────────────────────────────────────────────────────────────

export interface ChannelCacheEntry {
  messages: GroupMessage[];
  authors: Record<string, GroupUser>;
  /** Whether there is older history than what is held. */
  hasMore: boolean;
  fetchedAt: number;
}

/** Insertion-ordered, so the first key is the least recently used. */
const channels = new Map<string, ChannelCacheEntry>();

export function getCachedChannel(channelId: string): ChannelCacheEntry | null {
  const entry = channels.get(channelId);
  if (!entry) return null;
  // Touched: moved to the most-recently-used end.
  channels.delete(channelId);
  channels.set(channelId, entry);
  return entry;
}

export function putCachedChannel(channelId: string, entry: ChannelCacheEntry): void {
  let { messages, hasMore } = entry;
  if (messages.length > MAX_MESSAGES_PER_CHANNEL) {
    messages = messages.slice(messages.length - MAX_MESSAGES_PER_CHANNEL);
    hasMore = true;
  }
  channels.delete(channelId);
  channels.set(channelId, { ...entry, messages, hasMore });
  while (channels.size > MAX_CHANNELS) {
    const oldest = channels.keys().next().value;
    if (oldest === undefined) break;
    channels.delete(oldest);
  }
}

/** A live message for a room held here but not on screen. */
export function appendCachedMessage(message: GroupMessage, author: GroupUser | null): void {
  const entry = channels.get(message.channelId);
  if (!entry || entry.messages.some((m) => m.id === message.id)) return;
  channels.set(message.channelId, {
    ...entry,
    messages: [...entry.messages, message].sort((a, b) => a.ts - b.ts),
    authors: author ? { ...entry.authors, [author.id]: author } : entry.authors,
  });
}

/** A change to one held message — its reactions, today — for a room not on screen. */
export function updateCachedMessage(channelId: string, messageId: string, patch: Partial<GroupMessage>): void {
  const entry = channels.get(channelId);
  if (!entry || !entry.messages.some((m) => m.id === messageId)) return;
  channels.set(channelId, {
    ...entry,
    messages: entry.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  });
}

export function removeCachedMessage(channelId: string, messageId: string): void {
  const entry = channels.get(channelId);
  if (!entry) return;
  channels.set(channelId, { ...entry, messages: entry.messages.filter((m) => m.id !== messageId) });
}

export function forgetCachedChannel(channelId: string): void {
  channels.delete(channelId);
}

const channelInFlight = new Map<string, Promise<ChannelCacheEntry | null>>();

/**
 * Reads the newest page of a room and folds it into what is held.
 *
 * When the new page overlaps the cached one, the two are merged and the older
 * history already held is kept. When it does not — more than a page arrived
 * while the room was out of sight — the cache is replaced, because a gap in the
 * middle of a conversation is worse than having to scroll up for older lines.
 */
export function loadLatestMessages(groupId: string, channelId: string): Promise<ChannelCacheEntry | null> {
  const pending = channelInFlight.get(channelId);
  if (pending) return pending;
  const run = fetchMessages(groupId, channelId)
    .then((result) => {
      if (!result.ok) return null;
      const fresh = result.messages;
      const cached = channels.get(channelId);
      let entry: ChannelCacheEntry;
      const overlaps =
        cached &&
        cached.messages.length > 0 &&
        (fresh.length === 0 || fresh[0].ts <= cached.messages[cached.messages.length - 1].ts);
      if (cached && overlaps) {
        const byId = new Map(cached.messages.map((m) => [m.id, m]));
        // Anything inside the fresh window that the server no longer has was
        // deleted while this room was out of sight. Only *inside* it: a message
        // newer than the page (one that arrived over the socket while this
        // request was out) is not the page's to judge.
        if (fresh.length > 0) {
          const windowStart = fresh[0].ts;
          const windowEnd = fresh[fresh.length - 1].ts;
          for (const [id, m] of byId) if (m.ts >= windowStart && m.ts <= windowEnd) byId.delete(id);
        }
        for (const m of fresh) byId.set(m.id, m);
        entry = {
          messages: [...byId.values()].sort((a, b) => a.ts - b.ts),
          authors: { ...cached.authors, ...result.authors },
          hasMore: cached.hasMore || fresh.length >= PAGE_SIZE,
          fetchedAt: Date.now(),
        };
      } else {
        entry = {
          messages: fresh,
          authors: result.authors,
          hasMore: fresh.length >= PAGE_SIZE,
          fetchedAt: Date.now(),
        };
      }
      putCachedChannel(channelId, entry);
      return channels.get(channelId) ?? entry;
    })
    .catch(() => null)
    .finally(() => {
      channelInFlight.delete(channelId);
    });
  channelInFlight.set(channelId, run);
  return run;
}

/** Warms a room before it is opened — on hover, say. Cheap when already fresh. */
export function prefetchChannel(groupId: string, channelId: string): void {
  const cached = channels.get(channelId);
  if (cached && Date.now() - cached.fetchedAt < CHANNEL_STALE_MS) return;
  void loadLatestMessages(groupId, channelId);
}

// ─── Members ─────────────────────────────────────────────────────────────

/** `key` is the revalidation key the list was read under — see useGroupMembers. */
const members = new Map<string, { list: GroupMember[]; fetchedAt: number; key: string }>();
const memberListeners = new Set<() => void>();
const membersInFlight = new Map<string, Promise<void>>();

function subscribeMembers(listener: () => void) {
  memberListeners.add(listener);
  return () => {
    memberListeners.delete(listener);
  };
}

export function refreshGroupMembers(groupId: string, key?: string): Promise<void> {
  const pending = membersInFlight.get(groupId);
  if (pending) return pending;
  const run = fetchMembers(groupId)
    .then((result) => {
      if (!result.ok) return;
      members.set(groupId, {
        list: result.members,
        fetchedAt: Date.now(),
        key: key ?? members.get(groupId)?.key ?? "",
      });
      memberListeners.forEach((l) => l());
    })
    .catch(() => {})
    .finally(() => {
      membersInFlight.delete(groupId);
    });
  membersInFlight.set(groupId, run);
  return run;
}

export function forgetGroupMembers(groupId: string): void {
  members.delete(groupId);
  memberListeners.forEach((l) => l());
}

/**
 * A group's members: whatever is held at once, re-read in the background when
 * it is stale or when `revalidateKey` changes (pass something that moves when
 * the group's membership does — its member count and admins). `pollMs` keeps
 * the online dots honest on a screen that stays open.
 */
export function useGroupMembers(
  groupId: string | null,
  revalidateKey: string,
  pollMs?: number
): GroupMember[] | null {
  const list = useSyncExternalStore(
    subscribeMembers,
    () => (groupId ? members.get(groupId)?.list ?? null : null),
    () => null
  );

  // Re-read only when there is nothing, when it is stale, or when the group
  // changed since it was read — not on every screen that mounts and asks.
  useEffect(() => {
    if (!groupId) return;
    const held = members.get(groupId);
    if (!held || Date.now() - held.fetchedAt > MEMBERS_STALE_MS || held.key !== revalidateKey) {
      void refreshGroupMembers(groupId, revalidateKey);
    }
  }, [groupId, revalidateKey]);

  useEffect(() => {
    if (!groupId || !pollMs) return;
    const timer = window.setInterval(() => void refreshGroupMembers(groupId), pollMs);
    return () => window.clearInterval(timer);
  }, [groupId, pollMs]);

  return list;
}
