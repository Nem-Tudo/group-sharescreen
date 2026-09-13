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
}

export function closeDirectMessages(): void {
  if (!state.open) return;
  set({ ...state, open: false, withUserId: null });
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
