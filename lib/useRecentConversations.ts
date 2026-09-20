"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/AuthContext";
import { fetchConversations, markConversationRead, type Conversation } from "@/lib/dmApi";
import { liveConversationList, newestListChange } from "@/lib/dmThread";
import { useDirectMessagesWindow } from "@/lib/dmWindow";
import { selectDmReadSeq, selectRecentDms } from "@/lib/signalingSelectors";
import { useSignalingSelector } from "@/lib/useSignalingSelector";

// The conversation list as a shortcut somewhere else in the app shows it: the
// faces in a group's top bar and in the site header (DmRecentStrip) and the
// recent block on the home page (HomeRecentMessages) are the same list, read
// the same way, and the two had no business each keeping their own copy of
// when to re-read it.
//
// It is *not* the messages window's own list — that one lives inside
// DirectMessagesModal with everything a full list needs (search, context
// menus, the thread beside it). This is the short version: who is at the top,
// their unread count, and enough to draw a line under a name.
//
// One list for the whole page, not one per caller. The home page mounts two
// of these at once (the header's faces and the panel's rows), and a hook that
// fetched per instance would mean two identical requests on load and two more
// on every message that arrives. So the conversations live in a module store
// below, every mount reads the same array, and a load already in flight is
// the load a second caller gets.

/** How long after a nudge the list is re-read, so a burst is one request. */
const REFRESH_DEBOUNCE_MS = 800;

let cache: Conversation[] | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Conversation[] | null): void {
  cache = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The array itself, so React only re-renders when it is a new one. */
function snapshot(): Conversation[] | null {
  return cache;
}

/** Null on the server: there is no account there and nothing to draw. */
function serverSnapshot(): Conversation[] | null {
  return null;
}

function load(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = fetchConversations()
    .then((data) => {
      if (data) publish(data.conversations);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export interface RecentConversations {
  /** The top `limit` conversations, newest first, or empty until they land. */
  rows: Conversation[];
  /** Across every conversation, not just the ones returned above. */
  totalUnread: number;
  /** Marks one read on the server and here, without waiting for a re-read. */
  markRead: (userId: string) => void;
}

export function useRecentConversations(limit: number): RecentConversations {
  const { account } = useAuth();
  const recentDms = useSignalingSelector(selectRecentDms);
  const dmReadSeq = useSignalingSelector(selectDmReadSeq);
  const { open: windowOpen } = useDirectMessagesWindow();
  const conversations = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  // Not every delivery: this account's own sends move their row through the
  // live overlay below and need nothing from the server (see newestListChange).
  const listNudge = account ? newestListChange(recentDms, account.id, conversations) : null;

  // Re-read when a message arrives, when a conversation is read on another
  // device, and when the window closes — which is when this account most
  // likely just read something here.
  useEffect(() => {
    if (!account) return;
    const timer = window.setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [account, listNudge, dmReadSeq, windowOpen]);

  // Somebody else's list is not this account's: signing out, or into another
  // account, has to drop what the last one was shown.
  useEffect(() => {
    if (!account && cache !== null) publish(null);
  }, [account]);

  // What arrived since the read, laid over it, so the order moves the moment
  // a message lands rather than a beat later.
  const rows = useMemo(
    () =>
      conversations && account
        ? liveConversationList(conversations, recentDms, account.id).slice(0, limit)
        : [],
    [conversations, recentDms, account, limit]
  );

  const totalUnread = (conversations ?? []).reduce((total, c) => total + c.unread, 0);

  function markRead(userId: string) {
    markConversationRead(userId);
    publish(cache?.map((c) => (c.user.id === userId ? { ...c, unread: 0 } : c)) ?? cache);
  }

  return { rows, totalUnread, markRead };
}
