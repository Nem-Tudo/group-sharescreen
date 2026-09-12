"use client";

import { useSyncExternalStore } from "react";
import { groupPath } from "./groupLinks";
import {
  getGroupVoiceSession,
  setGroupVoiceSession,
  subscribeGroupVoiceSession,
  type GroupVoiceSession,
} from "./groupVoiceSession";
import { recentRoomPresentation } from "./recentRooms";

// Which call this tab is in, and where on the page it is being drawn.
//
// The call outlives the page. components/RoomCallHost mounts the one WatchRoom
// there is, at the root of the app, and keeps it mounted for as long as there
// is a session here — which is the whole of what makes walking around the site
// mid-call possible: unmounting WatchRoom is what calls leaveRoom(), and the
// microphone, the screen share and every peer's video live in its own hooks
// (see lib/useRoomMedia), so a room that unmounts is a call that ends.
//
// Pages therefore do not render the room any more. They offer it somewhere to
// be drawn (components/CallOutlet) and the host *moves the room's DOM node*
// into it — moved, not re-parented through a portal, because changing a
// portal's container remounts everything under it and a remounted <video> is a
// black rectangle.
//
// A page with no outlet — anywhere else on the site — leaves the call docked:
// still connected, still audible, drawn a pixel wide off in the corner with a
// bar on screen to get back to it or hang up.

export interface CallSessionGroup {
  groupId: string;
  channelId: string;
  channelName: string;
  groupName: string;
}

export interface CallSession {
  /** The room handle the call runs under. */
  handle: string;
  /** A theme this tab was sent to look at — /watch only. See useRoomTheme. */
  viewThemeId: string | null;
  /** Set when the call is a group's voice room; null for an ordinary room. */
  group: CallSessionGroup | null;
}

/**
 * What a page lends the call while it draws it.
 *
 * Only the group pages have any: a group room has no header of its own, so its
 * controls are portalled into the group's bar, and the group answers for the
 * "you are in a call" bar itself (see GroupSidebar's VoiceControls) — which is
 * how the host knows not to draw a second one.
 */
export interface CallChrome {
  headerSlots: { center: HTMLElement | null; right: HTMLElement | null };
  /** Opens the group's rooms drawer on a phone. */
  onOpenNav: () => void;
}

/**
 * The floating call bar's size. Compact is what a call needs every minute —
 * mic, headset, screen, camera, hanging up — and expanded is the room's whole
 * row. "collapsing" is the moment in between, while the extra buttons play
 * their way out before they are dropped.
 */
export type CallDockPhase = "compact" | "expanded" | "collapsing";

let session: CallSession | null = null;
let outlet: HTMLElement | null = null;
let chrome: CallChrome | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameSession(a: CallSession | null, b: CallSession | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.handle === b.handle &&
    a.viewThemeId === b.viewThemeId &&
    a.group?.groupId === b.group?.groupId &&
    a.group?.channelId === b.group?.channelId &&
    a.group?.channelName === b.group?.channelName &&
    a.group?.groupName === b.group?.groupName
  );
}

// ─── The group half ───────────────────────────────────────────────────────
//
// lib/groupVoiceSession is still where everything group-shaped reads the call
// from — the rooms list, its dock, the room settings dialog — and is still
// written from outside this file: the shell puts a session there on the way
// into a voice room, and leaving a group, being thrown out of one or logging
// in as somebody else clears it. So the two are kept in step both ways, with a
// flag so neither side hears its own answer back as a new instruction.

let applying = false;

function toGroupVoiceSession(next: CallSession | null): GroupVoiceSession | null {
  if (!next?.group) return null;
  return { ...next.group, handle: next.handle };
}

export function getCallSession(): CallSession | null {
  return session;
}

export function setCallSession(next: CallSession | null): void {
  if (sameSession(session, next)) return;
  session = next;
  applying = true;
  try {
    setGroupVoiceSession(toGroupVoiceSession(next));
  } finally {
    applying = false;
  }
  notify();
}

/** Hanging up. The host unmounts the room, and the room's unmount leaves it. */
export function endCall(): void {
  setCallSession(null);
}

/** The call's own page — the way back to it from anywhere on the site. */
export function callPathFor(call: CallSession): string {
  return call.group ? groupPath(call.group.groupId, call.group.channelId) : `/watch/${call.handle}`;
}

/** What to call the call on a button: the voice room's name, or the room's. */
export function callNameFor(call: CallSession): string {
  return call.group ? call.group.channelName : recentRoomPresentation(call.handle).name;
}

subscribeGroupVoiceSession(() => {
  if (applying) return;
  const group = getGroupVoiceSession();
  if (group) {
    setCallSession({
      handle: group.handle,
      viewThemeId: null,
      group: {
        groupId: group.groupId,
        channelId: group.channelId,
        channelName: group.channelName,
        groupName: group.groupName,
      },
    });
    return;
  }
  // Cleared from outside. Only ever ends a call that was a group's: an
  // ordinary room's call has nothing to do with the group store, and must not
  // be hung up because somebody left a group in another tab of the same page.
  if (session?.group) setCallSession(null);
});

export function useCallSession(): CallSession | null {
  return useSyncExternalStore(subscribe, getCallSession, () => null);
}

// ─── Where it is drawn ────────────────────────────────────────────────────

/** Claimed by the outlet on screen. See components/CallOutlet. */
export function setCallOutlet(el: HTMLElement | null): void {
  if (outlet === el) return;
  outlet = el;
  notify();
}

/**
 * Given up on the way out. Guarded, because React mounts the next page's
 * outlet before unmounting the last one's: without the check, arriving
 * somewhere would be immediately undone by leaving where you were.
 */
export function clearCallOutlet(el: HTMLElement | null): void {
  if (outlet !== el) return;
  outlet = null;
  notify();
}

export function useCallOutlet(): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => outlet,
    () => null
  );
}

export function setCallChrome(next: CallChrome | null): void {
  const same =
    chrome === next ||
    (chrome !== null &&
      next !== null &&
      chrome.onOpenNav === next.onOpenNav &&
      chrome.headerSlots.center === next.headerSlots.center &&
      chrome.headerSlots.right === next.headerSlots.right);
  if (same) return;
  chrome = next;
  notify();
}

export function useCallChrome(): CallChrome | null {
  return useSyncExternalStore(
    subscribe,
    () => chrome,
    () => null
  );
}
