"use client";

import { useSyncExternalStore } from "react";

// "Shift+clique em alguém menciona" — from anywhere on the group's pages into
// the message being written.
//
// The box lives inside the text room (components/groups/GroupMessageComposer)
// and the people live everywhere else: the members column, a name in the chat,
// a reply, the right-click menu. Rather than thread a callback through each of
// those, the composer on screen registers how to insert a mention, and they
// ask for one here. With no composer on screen — a voice room, the group's
// home — there is nobody to ask, and the caller does what a plain click does.

export interface MentionTarget {
  id: string;
  name: string;
  avatarUrl: string | null;
}

type Handler = (target: MentionTarget) => void;

let handler: Handler | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Called by the composer on screen. Returns the unregister, which only undoes its own. */
export function registerMentionHandler(next: Handler): () => void {
  handler = next;
  notify();
  return () => {
    if (handler !== next) return;
    handler = null;
    notify();
  };
}

/** Puts `@name` into the message being written. False when there is no box to put it in. */
export function mentionInComposer(target: MentionTarget): boolean {
  if (!handler) return false;
  handler(target);
  return true;
}

/** Whether a mention has somewhere to go right now — for offering "Mencionar" at all. */
export function useCanMention(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => handler !== null,
    () => false
  );
}
