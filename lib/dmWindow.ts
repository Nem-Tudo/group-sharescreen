"use client";

import { useSyncExternalStore } from "react";

// Which conversation window is open, if any — and how it is drawn.
//
// A store rather than state in whichever component holds the dialog, because
// the openers are scattered — the bell, the account menu, a profile — and the
// dialog must exist exactly once. Two copies mounted in two headers would be
// two conversations of the same thread, each with its own scroll position and
// its own idea of what has been read.
//
// `expanded` is the one thing here that outlives the window: somebody who
// prefers conversations across the whole screen, like a group's text room,
// should not have to ask for it again every time. Remembered per browser.

type WindowState = { open: boolean; withUserId: string | null; expanded: boolean };

const EXPANDED_STORAGE_KEY = "golive:dm-expanded";

let state: WindowState = { open: false, withUserId: null, expanded: false };
// Where the expanded window draws itself instead of over the whole screen —
// see setDirectMessagesOutlet.
let outlet: HTMLElement | null = null;
// The remembered choice, apart from `state.expanded`: a window opened expanded
// on purpose (see openDirectMessages' `expanded`) must not become the choice.
let preferExpanded = false;
let expandedRead = false;
const listeners = new Set<() => void>();

function set(next: WindowState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Read on the first open rather than at import, which also runs on the server. */
function storedExpanded(): boolean {
  if (expandedRead) return preferExpanded;
  expandedRead = true;
  try {
    preferExpanded = window.localStorage.getItem(EXPANDED_STORAGE_KEY) === "1";
  } catch {
    preferExpanded = false;
  }
  return preferExpanded;
}

/**
 * Opens the window, optionally straight into one person's thread.
 *
 * `expanded` forces how it is drawn for this opening only — "Todas as
 * mensagens" always opens full screen — without touching the remembered
 * choice. Without it, a window already open keeps however it is drawn (moving
 * between threads inside it comes through here too), and a closed one opens
 * the way it was last chosen.
 */
export function openDirectMessages(withUserId?: string | null, options: { expanded?: boolean } = {}): void {
  const expanded = options.expanded ?? (state.open ? state.expanded : storedExpanded());
  set({ open: true, withUserId: withUserId ?? null, expanded });
  if (expanded && dmNavigator?.wide()) dmNavigator.show(withUserId ?? null);
}

export function closeDirectMessages(): void {
  if (!state.open) return;
  const routed = Boolean(dmNavigator?.onDmPage());
  set({ ...state, open: false, withUserId: null });
  if (routed) dmNavigator?.leave();
}

// ─── The expanded window as a page ────────────────────────────────────────
//
// Expanded on a wide screen, the messages are an address of their own
// (/groups/messages, see groupLinks' dmPath) rather than a layer over whatever
// page was open — so no group loads behind them, and back/forward, a reload or
// a shared link all mean what they say. The store stays the one answer to
// "which thread is open"; the address follows it, and it follows the address
// (see DirectMessagesHost, which lends the router).

export type DirectMessagesNavigator = {
  /** Wide enough for the expanded window to be a page. */
  wide: () => boolean;
  /** Whether the address on screen is the messages' page. */
  onDmPage: () => boolean;
  /** Puts the messages' page — the list, or one thread — on screen. */
  show: (withUserId: string | null) => void;
  /** Back to wherever the messages were opened from. */
  leave: () => void;
};

let dmNavigator: DirectMessagesNavigator | null = null;
// Whether the address last seen was the messages' page — so leaving it (a
// click on a group, the back button) closes the window, but a first look at
// some other page does not.
let pathOnDmPage = false;

export function registerDirectMessagesNavigator(next: DirectMessagesNavigator): () => void {
  dmNavigator = next;
  return () => {
    if (dmNavigator === next) dmNavigator = null;
  };
}

/**
 * The address changed: `withUserId` is the thread it names on the messages'
 * page (null for the list), or undefined for any other page.
 */
export function syncDirectMessagesWithPath(withUserId: string | null | undefined): void {
  if (withUserId !== undefined) {
    pathOnDmPage = true;
    if (state.open && state.expanded && state.withUserId === withUserId) return;
    set({ open: true, withUserId, expanded: true });
    return;
  }
  const wasOnDmPage = pathOnDmPage;
  pathOnDmPage = false;
  if (wasOnDmPage && state.open && state.expanded) set({ ...state, open: false, withUserId: null });
}

/** Full screen (true) or the dialog (false), remembered for next time. */
export function setDirectMessagesExpanded(expanded: boolean): void {
  expandedRead = true;
  preferExpanded = expanded;
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? "1" : "0");
  } catch {
    // Private mode or blocked storage: it still applies for this visit.
  }
  set({ ...state, expanded });
  if (!state.open || !dmNavigator) return;
  if (expanded && dmNavigator.wide()) dmNavigator.show(state.withUserId);
  else if (!expanded && dmNavigator.onDmPage()) dmNavigator.leave();
}

const SERVER_STATE: WindowState = { open: false, withUserId: null, expanded: false };

export function useDirectMessagesWindow(): WindowState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => state,
    () => SERVER_STATE
  );
}

/**
 * A place on the page that hosts the expanded window, or null to take it back.
 *
 * The group pages lend the space beside their list of groups (see
 * GroupAppShell): somebody reading their messages full screen there should
 * still have their groups down the left, one click away, the way a text room
 * keeps them. Anywhere else there is no outlet and the window covers the
 * screen as before. Taking it back only clears the outlet that was lent, so a
 * page unmounting late cannot unset the one that replaced it.
 */
export function setDirectMessagesOutlet(element: HTMLElement | null, previous?: HTMLElement | null): void {
  if (element === null && previous !== undefined && outlet !== previous) return;
  if (outlet === element) return;
  outlet = element;
  for (const listener of listeners) listener();
}

export function useDirectMessagesOutlet(): HTMLElement | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => outlet,
    () => null
  );
}
