"use client";

import { useSyncExternalStore } from "react";

// "Hand this room over to the desktop app."
//
// A one-bit channel between two components that cannot reach each other any
// other way: the offer is a banner *inside* the room, and the screen that
// replaces the room is the gate *outside* it (see components/RoomAppGate.tsx,
// which renders the room as its children). Passing a callback down would mean
// threading it through every layer of WatchRoom for one button.
//
// The point of the gate owning it, rather than the banner just navigating to
// the protocol itself: switching the gate away from its children unmounts
// WatchRoom, and WatchRoom's unmount is what calls signalingClient.leaveRoom()
// — so the person actually leaves the room instead of lingering in it as a
// ghost while their app opens the same room a second time.

// A counter rather than a boolean, and that is what makes the gate need no
// state of its own for this: "asked again" has to be distinguishable from
// "still asking", because pressing "abrir no app de novo" must re-run the
// protocol navigation. An external store the gate merely *reads* also keeps
// the whole handoff out of setState-inside-an-effect territory.
let count = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Asked for — from the banner inside the room, or from the gate's own buttons. */
export function requestAppHandoff(): void {
  count += 1;
  emit();
}

/**
 * Put back once the handoff screen is left, so a later room in the same tab
 * does not open straight into a screen about a decision already made.
 */
export function clearAppHandoff(): void {
  if (count === 0) return;
  count = 0;
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** How many times a handoff has been asked for. Zero means "not asking". */
export function useAppHandoffCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => count,
    () => 0
  );
}
