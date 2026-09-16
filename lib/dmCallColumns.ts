"use client";

import { useSyncExternalStore } from "react";
import { getCallSession, subscribeCallSession } from "./callSession";

// Whether the columns beside a direct call are folded away.
//
// A direct call is drawn inside the conversation it belongs to (see
// lib/callSession's `dm`), which on a wide screen means it shares the row with
// two lists: the rail of groups down the far left, drawn by the group shell,
// and the conversations column, drawn by the messages window. Neither is a
// parent of the other and neither owns the call, so "are they folded away" is
// a fact about the page rather than state anybody can hold — the same shape,
// and for the same reason, as lib/groupVoiceSession's GroupVoiceColumns.
//
// Deliberately not remembered between calls. The fold is something you reach
// for while looking at somebody's screen, not a preference about the app, and
// the rule is that the lists come back on their own when the call is over —
// which is the subscription at the foot of this file and not something each
// reader has to remember to do.

let collapsed = false;
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

function get(): boolean {
  return collapsed;
}

export function setDmCallColumnsCollapsed(next: boolean): void {
  if (collapsed === next) return;
  collapsed = next;
  notify();
}

export function toggleDmCallColumns(): void {
  setDmCallColumnsCollapsed(!collapsed);
}

/**
 * Whether the lists are folded away right now. Always false with no direct
 * call on, so nothing has to pair this with a check of its own.
 */
export function useDmCallColumnsCollapsed(): boolean {
  return useSyncExternalStore(subscribe, get, () => false);
}

// The call ended — hung up, or the other end was the last one out. The lists
// come back, so nobody is left on a conversation page with the conversations
// hidden and only a call that is no longer there to explain why.
subscribeCallSession(() => {
  if (getCallSession()?.dm) return;
  setDmCallColumnsCollapsed(false);
});
