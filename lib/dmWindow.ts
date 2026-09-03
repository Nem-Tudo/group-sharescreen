"use client";

import { useSyncExternalStore } from "react";

// Which conversation window is open, if any.
//
// A store rather than state in whichever component holds the dialog, because
// the openers are scattered — the bell, the account menu, a profile — and the
// dialog must exist exactly once. Two copies mounted in two headers would be
// two conversations of the same thread, each with its own scroll position and
// its own idea of what has been read.

type WindowState = { open: boolean; withUserId: string | null };

let state: WindowState = { open: false, withUserId: null };
const listeners = new Set<() => void>();

function set(next: WindowState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Opens the window, optionally straight into one person's thread. */
export function openDirectMessages(withUserId?: string | null): void {
  set({ open: true, withUserId: withUserId ?? null });
}

export function closeDirectMessages(): void {
  if (!state.open) return;
  set({ open: false, withUserId: null });
}

const SERVER_STATE: WindowState = { open: false, withUserId: null };

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
