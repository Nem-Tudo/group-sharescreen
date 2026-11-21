"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "./AuthContext";
import { useAccountToken } from "./accountApi";
import { useDirectMessagesWindow } from "./dmWindow";
import { trackFeatureEvent, useFeature } from "./features";
import { GROUP_VOICE_PREFIX, parseGroupsPath } from "./groupLinks";
import { isCallRoomHandle, isThemeRoomHandle } from "./roomsApi";
import { refreshGroups, useGroupsSlice } from "./useGroups";
import { useMediaQuery } from "./useMediaQuery";

// Experiment "room-shell": an ordinary room's page drawn inside the group
// shell (components/groups/GroupAppShell) — the rail of groups down the left,
// the conversations in the top bar, and the room in the middle with its own
// columns (participants, chat), the way a group's voice room already is.
//
// Only where the frame has something to offer and room to offer it:
//   - from xl up (1280px). Below lg the shell has no rail at all, and a
//     phone's room is a screen of its own with its own bars; between lg and xl
//     the rail would come out of the screen being shared — next to the room's
//     participant column and chat, it left the stage under 300px at 1024. A
//     group's voice room pays that already; an ordinary room keeps its width;
//   - for an account with at least one group — a rail with nothing on it is
//     noise, and somebody arriving by a link with no account is the room's
//     most important visitor, who gets the room exactly as it always was;
//   - for an ordinary room — not a group's voice room (its group draws it),
//     a direct call's room (its conversation does) or a theme preview room.
//
// Both sides of the experiment run the same test (`eligible`), so the events
// below compare like with like. The side that gets the frame can switch it off
// in the room's "⋯" (`switchedOff`, per browser), which puts the room back as
// it was and is itself counted.

export const ROOM_SHELL_FEATURE = "room-shell";

/** The width the frame needs — see the list above. */
export const ROOM_SHELL_QUERY = "(min-width: 80rem)";

export const ROOM_SHELL_EVENTS = {
  /** From a room's page straight to a group's page (both sides). */
  toGroup: "room_shell_to_group",
  /** The private messages opened while a room's page is on screen (both sides). */
  dmOpen: "room_shell_dm_open",
  /** Five more minutes in an ordinary room's call, on any page (both sides). value = 5. */
  callMinutes: "room_shell_call_5min",
  /** The rail and the participants folded away (1) or brought back (2). */
  fold: "room_shell_fold",
  /** The frame switched off (1) or back on (2) in the room's "⋯". */
  switched: "room_shell_switch",
  /** One of the site's other pages opened inside the frame (phase 2). Tag `page`: which one. */
  page: "room_shell_page",
} as const;

/** The room a /watch address names, or null for any other address. */
export function parseWatchPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const parts = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  if (parts[0] !== "watch" || parts.length !== 2) return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return parts[1];
  }
}

/** A room with a page of its own — see the list at the top of this file. */
export function isOrdinaryRoomHandle(handle: string): boolean {
  return !handle.startsWith(GROUP_VOICE_PREFIX) && !isCallRoomHandle(handle) && !isThemeRoomHandle(handle);
}

// ─── The site's other pages (phase 2) ─────────────────────────────────────
//
// Once somebody is in the groups layout, nothing they open from it should
// take them out of it: the public rooms, the map, their friends, a profile,
// their own screen, the themes, Pro. These pages live under app/(shell) too,
// and the shell frames them on the same terms as a room's page — xl up, an
// account with groups, in the experiment. Everywhere else they are drawn
// exactly as they always were (see GroupAppShell's `plainPage`).
//
// The home is the one page left out on purpose: it is the site's front door,
// the landing page and the search result, and the groups layout has a home of
// its own (experiment groups-hub).

/** The first segment of every page the shell may frame, and the name it is counted under. */
const SHELL_PAGES = ["rooms", "worldmap", "friends", "me", "user", "badges", "workshop", "theme", "pro"] as const;
export type ShellPage = (typeof SHELL_PAGES)[number];

/** Which framed-able page an address is, or null. */
export function shellPageOf(pathname: string | null | undefined): ShellPage | null {
  if (!pathname) return null;
  const first = pathname.split(/[?#]/)[0].split("/").filter(Boolean)[0];
  return first && (SHELL_PAGES as readonly string[]).includes(first) ? (first as ShellPage) : null;
}

// ─── The switch ───────────────────────────────────────────────────────────

const SWITCHED_OFF_KEY = "golive:roomShellOff";
const switchListeners = new Set<() => void>();
let switchedOffCache: boolean | null = null;

function readSwitchedOff(): boolean {
  if (switchedOffCache !== null) return switchedOffCache;
  try {
    switchedOffCache = window.localStorage.getItem(SWITCHED_OFF_KEY) === "1";
  } catch {
    switchedOffCache = false;
  }
  return switchedOffCache;
}

function subscribeSwitch(listener: () => void) {
  switchListeners.add(listener);
  return () => {
    switchListeners.delete(listener);
  };
}

export function setRoomShellSwitchedOff(off: boolean): void {
  switchedOffCache = off;
  try {
    if (off) window.localStorage.setItem(SWITCHED_OFF_KEY, "1");
    else window.localStorage.removeItem(SWITCHED_OFF_KEY);
  } catch {
    // Storage refused: it still holds for this page.
  }
  trackFeatureEvent(ROOM_SHELL_EVENTS.switched, { feature: ROOM_SHELL_FEATURE, value: off ? 1 : 2 });
  for (const listener of switchListeners) listener();
}

function useSwitchedOff(): boolean {
  return useSyncExternalStore(subscribeSwitch, readSwitchedOff, () => false);
}

// ─── Remembered answer ────────────────────────────────────────────────────
//
// Whether a room's page last opened inside the frame on this browser. The
// account, the experiment and the list of groups each take a request to
// learn, and until all three are in, this is the answer: a returning person
// sees the page they saw last time from the first frame, instead of the plain
// room and then, a beat later, the whole layout moving.

const REMEMBERED_KEY = "golive:roomShellLast";

function readRemembered(): boolean {
  try {
    return window.localStorage.getItem(REMEMBERED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRemembered(on: boolean) {
  try {
    if (on) window.localStorage.setItem(REMEMBERED_KEY, "1");
    else window.localStorage.removeItem(REMEMBERED_KEY);
  } catch {
    // Nothing to remember it in: the next visit decides afresh.
  }
}

// ─── The decision ─────────────────────────────────────────────────────────

export interface RoomShellState {
  /** The frame is drawn around this room's page. */
  on: boolean;
  /**
   * Every fact known, and this visit is one either side of the experiment
   * would count: an ordinary room, xl up, an account with groups, in the
   * experiment. What the events below are counted against.
   */
  eligible: boolean;
  /** The frame's side of the experiment, eligible — whoever gets the switch. */
  available: boolean;
  /** Switched off in the room's "⋯" on this browser. */
  switchedOff: boolean;
}

const OFF: RoomShellState = { on: false, eligible: false, available: false, switchedOff: false };

/**
 * `handle` is the room whose page is being drawn, or null when the page is no
 * room's. `track` counts the exposure — true only where the frame is drawn
 * (the shell); everywhere else reads the same answer without counting it.
 */
export function useRoomShell(
  handle: string | null,
  { track, page = false }: { track: boolean; /** One of the site's other pages (see shellPageOf). */ page?: boolean }
): RoomShellState {
  const wide = useMediaQuery(ROOM_SHELL_QUERY);
  const accountToken = useAccountToken();
  const { account, loading } = useAuth();
  // Whether there are any, not the list: the list moves on every unread and
  // every voice event of every group, and this runs in the group shell itself,
  // which must not be redrawn for each of them.
  const hasGroups = useGroupsSlice((s) => (s.groups === null ? null : s.groups.length > 0), null);
  const switchedOff = useSwitchedOff();
  // A page the frame is for: an ordinary room's, or one of the site's other pages.
  const ordinary = (handle !== null && isOrdinaryRoomHandle(handle)) || page;
  const facts = ordinary && wide && Boolean(account) && hasGroups === true;
  const feature = useFeature(ROOM_SHELL_FEATURE, { track: track && facts });
  const inExperiment = feature.group !== null;
  // Read once per page: the remembered answer stands in only until the real
  // one is known, and is rewritten below as soon as it is.
  const [remembered] = useState(() => (typeof window === "undefined" ? false : readRemembered()));

  // The groups are only asked for when they decide something: an account, on
  // a room's page, wide enough, in the experiment. Anybody else costs no request.
  const needsGroups = ordinary && wide && Boolean(account) && inExperiment && hasGroups === null;
  useEffect(() => {
    if (needsGroups) void refreshGroups();
  }, [needsGroups]);

  let on: boolean;
  let settled: boolean;
  if (!ordinary || !wide || switchedOff) {
    on = false;
    settled = false;
  } else if (account) {
    if (!feature.enabled) {
      on = feature.ready ? false : remembered;
      settled = feature.ready;
    } else if (hasGroups === null) {
      on = remembered;
      settled = false;
    } else {
      on = hasGroups;
      settled = true;
    }
  } else if (loading && accountToken) {
    on = remembered;
    settled = false;
  } else {
    on = false;
    settled = true;
  }

  useEffect(() => {
    if (settled) writeRemembered(on);
  }, [settled, on]);

  if (!ordinary) return OFF;
  return {
    on,
    eligible: facts && inExperiment,
    available: facts && feature.enabled,
    switchedOff,
  };
}

// ─── What the frame lends the page ────────────────────────────────────────

/**
 * True while the shell is drawing the frame around a room's page (xl up only):
 * the page's own top bar is the shell's, and the room's skeleton leaves its
 * own out (see components/RoomSkeleton).
 */
export const RoomShellHostContext = createContext(false);

export function useRoomShellHosted(): boolean {
  return useContext(RoomShellHostContext);
}

// ─── Events ───────────────────────────────────────────────────────────────

/**
 * The page-level events, run by the shell on both sides: leaving a room's page
 * for a group's, and opening the private messages over a room's page.
 * `eligibleRoom` is whether the page on screen is an eligible room's.
 */
export function useRoomShellPageEvents(pathname: string | null, eligibleRoom: boolean): void {
  // The room page last seen while eligible, until the address moves on.
  const lastRoomPath = useRef<string | null>(null);
  useEffect(() => {
    const from = lastRoomPath.current;
    lastRoomPath.current = eligibleRoom ? pathname : null;
    if (!from || from === pathname) return;
    const to = parseGroupsPath(pathname);
    // The messages are counted on their own, below.
    if (to && to.kind !== "dms") {
      trackFeatureEvent(ROOM_SHELL_EVENTS.toGroup, { feature: ROOM_SHELL_FEATURE });
    }
  }, [pathname, eligibleRoom]);

  const dm = useDirectMessagesWindow();
  const wasOpen = useRef(dm.open);
  useEffect(() => {
    const opened = dm.open && !wasOpen.current;
    wasOpen.current = dm.open;
    if (opened && eligibleRoom) {
      trackFeatureEvent(ROOM_SHELL_EVENTS.dmOpen, { feature: ROOM_SHELL_FEATURE });
    }
  }, [dm.open, eligibleRoom]);
}

const TICK_MS = 30_000;
const BLOCK_MS = 5 * 60_000;

/**
 * Time in an ordinary room's call, in five-minute blocks, on whatever page —
 * run by the room itself, which is mounted for exactly as long as the call is.
 * The frame lets somebody walk off the room's page without leaving the call,
 * so time on the page is not the question; time in the call is.
 */
export function useRoomShellCallMinutes(counting: boolean): void {
  useEffect(() => {
    if (!counting) return;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += TICK_MS;
      if (elapsed < BLOCK_MS) return;
      elapsed -= BLOCK_MS;
      trackFeatureEvent(ROOM_SHELL_EVENTS.callMinutes, { feature: ROOM_SHELL_FEATURE, value: 5 });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [counting]);
}

/** Folding the rail and the participants away (true) or back (false). */
export function trackRoomShellFold(folded: boolean): void {
  trackFeatureEvent(ROOM_SHELL_EVENTS.fold, { feature: ROOM_SHELL_FEATURE, value: folded ? 1 : 2 });
}
