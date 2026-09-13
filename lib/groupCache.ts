"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  fetchMembers,
  fetchMessages,
  type GroupMember,
  type GroupMessage,
  type GroupUser,
  fetchOnlineMembers,
  fetchOfflineMembers,
  fetchMemberCounts,
  type MemberCounts,
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
export function appendCachedMessage(
  message: GroupMessage,
  author: GroupUser | null,
  mentioned: Record<string, GroupUser> = {}
): void {
  const entry = channels.get(message.channelId);
  if (!entry || entry.messages.some((m) => m.id === message.id)) return;
  // The people it mentions go in with its author: "authors" is everybody this
  // room needs a name for, and a mention is drawn from it (see TextChannelView).
  const hasMentioned = Object.keys(mentioned).length > 0;
  channels.set(message.channelId, {
    ...entry,
    messages: [...entry.messages, message].sort((a, b) => a.ts - b.ts),
    authors:
      author || hasMentioned
        ? { ...mentioned, ...entry.authors, ...(author ? { [author.id]: author } : {}) }
        : entry.authors,
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


/**
 * The counts an API response carried, or null when it carried none.
 *
 * An API from before the member slices ignores the query and answers with the
 * whole list and no counts — which is what the web app meets if it is deployed
 * before the API is. Reading `undefined` as a number would put "NaN" in the
 * column's headings; reading it as null keeps the old behaviour.
 */
function countsOf(result: { total?: unknown; online?: unknown }): MemberCounts | null {
  return typeof result.total === "number" && typeof result.online === "number"
    ? { total: result.total, online: result.online }
    : null;
}

// ─── Who is online ───────────────────────────────────────────────────────
//
// The part of the member list a screen needs whole. Bounded by how many people
// are connected rather than by how many belong, which is what makes it safe to
// hold and to poll at ten thousand members — the whole list was neither. The
// members column and the text room share it, the same way they shared the
// whole list before.

type OnlineEntry = { list: GroupMember[]; counts: MemberCounts; fetchedAt: number; key: string };
const onlineMembers = new Map<string, OnlineEntry>();
const onlineListeners = new Set<() => void>();
const onlineInFlight = new Map<string, Promise<void>>();

function subscribeOnline(listener: () => void) {
  onlineListeners.add(listener);
  return () => {
    onlineListeners.delete(listener);
  };
}

export function refreshOnlineMembers(groupId: string, key?: string): Promise<void> {
  const pending = onlineInFlight.get(groupId);
  if (pending) return pending;
  const run = fetchOnlineMembers(groupId)
    .then((result) => {
      if (!result.ok) return;
      onlineMembers.set(groupId, {
        // Filtered even though the API already did: an older API answers
        // this request with the whole membership, and without this every
        // offline member would be listed as online.
        list: result.members.filter((m) => m.online),
        counts: countsOf(result) ?? { total: result.members.length, online: result.members.length },
        fetchedAt: Date.now(),
        key: key ?? onlineMembers.get(groupId)?.key ?? "",
      });
      onlineListeners.forEach((l) => l());
    })
    .catch(() => {})
    .finally(() => {
      onlineInFlight.delete(groupId);
    });
  onlineInFlight.set(groupId, run);
  return run;
}

/**
 * Who in the group is connected right now, with the group's totals. The same
 * refresh rules as useGroupMembers: re-read when missing, stale, or when
 * `revalidateKey` moves, and on `pollMs` for a screen that stays open.
 *
 * Returns the held entry itself, not a fresh object, so useSyncExternalStore
 * sees a stable snapshot between refreshes.
 */
export function useOnlineGroupMembers(
  groupId: string | null,
  revalidateKey: string,
  pollMs?: number
): OnlineEntry | null {
  const entry = useSyncExternalStore(
    subscribeOnline,
    () => (groupId ? onlineMembers.get(groupId) ?? null : null),
    () => null
  );

  useEffect(() => {
    if (!groupId) return;
    const held = onlineMembers.get(groupId);
    if (!held || Date.now() - held.fetchedAt > MEMBERS_STALE_MS || held.key !== revalidateKey) {
      void refreshOnlineMembers(groupId, revalidateKey);
    }
  }, [groupId, revalidateKey]);

  useEffect(() => {
    if (!groupId || !pollMs) return;
    const timer = window.setInterval(() => void refreshOnlineMembers(groupId), pollMs);
    return () => window.clearInterval(timer);
  }, [groupId, pollMs]);

  return entry;
}

// ─── Just the counts ─────────────────────────────────────────────────────

/**
 * How many members the group has and how many are online — with `channelId`,
 * how many can see that room. Asked for as soon as the column opens, rather
 * than read off the first offline page: that page is only requested once the
 * list scrolls near its end, so with many people online the column's total
 * used to read the same as the online count until somebody scrolled.
 *
 * Re-read when the group, the room or `revalidateKey` changes (a membership
 * change moves the key). The last counts for the same group and room stay up
 * while that re-read is in flight, so the numbers never blink back to nothing.
 */
export function useMemberCounts(
  groupId: string | null,
  channelId: string | null,
  revalidateKey: string
): MemberCounts | null {
  const room = `${groupId ?? ""}|${channelId ?? ""}`;
  const [held, setHeld] = useState<{ room: string; counts: MemberCounts } | null>(null);

  useEffect(() => {
    if (!groupId) return;
    const controller = new AbortController();
    void fetchMemberCounts(groupId, channelId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !result.ok) return;
        const counts = countsOf(result);
        if (counts) setHeld({ room, counts });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [groupId, channelId, room, revalidateKey]);

  return held?.room === room ? held.counts : null;
}

// ─── Everybody else, a page at a time ────────────────────────────────────

/**
 * The members who are not connected, loaded as the column scrolls down to
 * them rather than all at once. Local to the column — nothing else lists
 * offline members, so there is nothing to share.
 *
 * Starts over whenever the group or `revalidateKey` changes: a membership or
 * role change can reorder the list, and pages stitched from two different
 * orders would repeat some people and drop others.
 */
export function useOfflineGroupMembers(
  groupId: string | null,
  revalidateKey: string,
  channelId: string | null = null
) {
  // Which listing this is. The state below is tagged with it and simply read
  // as empty when the tag no longer matches, which is how a change of group or
  // key starts the list over without an effect calling setState to reset it —
  // the rule this codebase enforces (react-hooks/set-state-in-effect).
  // The room is part of the listing: a different room is a different list.
  const listing = `${groupId ?? ""}|${channelId ?? ""}|${revalidateKey}`;
  const [state, setState] = useState<OfflinePages>(() => emptyPages(listing));
  const view = state.key === listing ? state : emptyPages(listing);

  // Where the next page starts, for the listing it belongs to. A ref, read and
  // written only inside loadMore and its response — never during render.
  const cursor = useRef<{ key: string; next: string | null; done: boolean; busy: boolean }>({
    key: listing,
    next: null,
    done: false,
    busy: false,
  });

  const loadMore = useCallback(() => {
    if (!groupId) return;
    if (cursor.current.key !== listing) {
      cursor.current = { key: listing, next: null, done: false, busy: false };
    }
    const at = cursor.current;
    if (at.busy || at.done) return;
    at.busy = true;
    setState((prev) => ({ ...(prev.key === listing ? prev : emptyPages(listing)), loading: true }));

    void fetchOfflineMembers(groupId, at.next, channelId)
      .then((result) => {
        // A response for a listing that has since been replaced is dropped
        // rather than appended to the new one.
        if (cursor.current !== at) return;
        if (!result.ok) {
          // Stop rather than retry in a loop: the column shows what it has,
          // and the next change of key starts it again.
          at.done = true;
          setState((prev) => (prev.key === listing ? { ...prev, done: true } : prev));
          return;
        }
        // Anything but a string ends the listing. An older API sends no `next`
        // at all, and treating that `undefined` as "there is more" would ask
        // again forever, receiving the same whole list every time.
        const next = typeof result.next === "string" ? result.next : null;
        at.next = next;
        at.done = next === null;
        setState((prev) => {
          const base = prev.key === listing ? prev : emptyPages(listing);
          // Merged by id: a page can repeat when its cursor's member left in
          // between (see the API's memberPaging), and nobody is listed twice.
          const seen = new Set(base.list.map((m) => m.id));
          const fresh = result.members.filter((m) => !seen.has(m.id));
          return {
            ...base,
            // Offline only, for the same older-API reason as the online list.
            list: [...base.list, ...fresh.filter((m) => !m.online)],
            done: next === null,
            counts: countsOf(result) ?? base.counts,
          };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (cursor.current !== at) return;
        at.busy = false;
        setState((prev) => (prev.key === listing ? { ...prev, loading: false } : prev));
      });
  }, [groupId, channelId, listing]);

  return {
    list: view.list,
    hasMore: !view.done,
    loading: view.loading,
    // Null until the first page answers. With a room, these are that room's
    // numbers — the API filters its counts the same way it filters the list.
    counts: view.counts,
    loadMore,
  };
}

type OfflinePages = {
  key: string;
  list: GroupMember[];
  done: boolean;
  loading: boolean;
  counts: MemberCounts | null;
};

// One shared empty list, so a listing that has not loaded yet hands out the
// same reference every render and nothing memoized on it recomputes.
const NO_MEMBERS: GroupMember[] = [];

function emptyPages(key: string): OfflinePages {
  return { key, list: NO_MEMBERS, done: false, loading: false, counts: null };
}
