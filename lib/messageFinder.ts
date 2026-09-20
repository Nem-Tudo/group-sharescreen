"use client";

import { useSyncExternalStore } from "react";
import { trackFeatureEvent, useFeature } from "./features";

// Keeping a message, and finding one again — the shared half.
//
// Three things ship together here, because they are one idea in three
// gestures: pinning a message so it stops going past, searching a room or a
// conversation for one that already did, and copying a link straight to it.
// They are behind one experiment for the same reason: somebody who can pin
// but cannot search has half a feature.
//
// What is *not* here is the drawing. A group room and a private conversation
// hold their messages in completely different shapes (see TextChannelView and
// DirectMessagesModal), so each renders its own panel; this module owns the
// key, the events, the link, and the one thing the two surfaces could not do
// on their own — a phone's menu, which lives in a different component from
// the panel it has to open.

export const MESSAGE_FINDER_FEATURE = "message-pins-search";

/**
 * The names the admin panel has to know about, as the feature's "site
 * events". Listed here so the set is one thing rather than a dozen string
 * literals spread over two thousand lines of chat component.
 */
export const MESSAGE_FINDER_EVENTS = {
  pin: "message_pin",
  unpin: "message_unpin",
  pinsOpen: "message_pins_open",
  pinJump: "message_pin_jump",
  searchOpen: "message_search_open",
  searchRun: "message_search_run",
  searchJump: "message_search_jump",
  linkCopy: "message_link_copy",
} as const;

/** Whether this person has the pins, the search and the message links. */
export function useMessageFinder(): { enabled: boolean; ready: boolean } {
  // Tracked here and nowhere else: this is the check that decides whether the
  // buttons exist at all, and the per-message menu entries would otherwise
  // count one exposure per message drawn.
  const { enabled, ready } = useFeature(MESSAGE_FINDER_FEATURE, { track: true });
  return { enabled, ready };
}

/** The same answer without counting an exposure — for the menus and the rows. */
export function useMessageFinderQuiet(): boolean {
  return useFeature(MESSAGE_FINDER_FEATURE, { track: false }).enabled;
}

export function trackFinderEvent(name: string, group?: string | null) {
  trackFeatureEvent(name, { feature: MESSAGE_FINDER_FEATURE, ...(group ? { group } : {}) });
}

// ─── Opening a panel from somewhere else ──────────────────────────────────
//
// On a desktop the two buttons sit in the room's own header, next to the
// panel they open. A phone has no such header: the room's title bar belongs
// to the group shell (see GroupMobile), several components away from the room
// itself. Rather than thread a callback down through the shell, the request
// is a value anybody may set and the room watches for — the same shape as the
// right-click menu's store (see lib/contextMenu).

export type FinderPanel = "pins" | "search";

export interface FinderRequest {
  /** Which room or conversation asked, so a stale request never opens another. */
  scopeId: string;
  panel: FinderPanel;
  /** New on every request, so asking twice for the same panel reopens it. */
  seq: number;
}

let request: FinderRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function openMessageFinder(scopeId: string, panel: FinderPanel): void {
  seq += 1;
  request = { scopeId, panel, seq };
  for (const listener of listeners) listener();
}

/** Called by whoever handled a request, so it is not handled twice. */
export function clearMessageFinder(): void {
  if (!request) return;
  request = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMessageFinderRequest(): FinderRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null
  );
}

// ─── Links to a message ───────────────────────────────────────────────────

/** The query parameter a link to one message carries. See groupMessageLink. */
export const MESSAGE_LINK_PARAM = "m";

/**
 * A link that opens a group's room scrolled to one message.
 *
 * The room's own address plus `?m=<id>`: the path is the one that already
 * works everywhere — shared, reloaded, opened in a new tab — and the message
 * rides as a parameter rather than a fourth segment, so nothing that reads
 * these paths (see groupLinks' parseGroupsPath, which stops at the query) has
 * to learn a new shape.
 */
export function groupMessageLink(groupId: string, channelId: string, messageId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/groups/${encodeURIComponent(groupId)}/${encodeURIComponent(channelId)}?${MESSAGE_LINK_PARAM}=${encodeURIComponent(messageId)}`;
}

/**
 * The message a link asked for, read off the address bar, and taken off it in
 * the same breath.
 *
 * Removed once read because it has been spent: it is an instruction to scroll
 * somewhere, not a description of where the page is, and leaving it behind
 * would make a reload jump again long after somebody had scrolled elsewhere.
 */
export function takeLinkedMessageId(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get(MESSAGE_LINK_PARAM);
  if (!id) return null;
  params.delete(MESSAGE_LINK_PARAM);
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  );
  return id;
}
