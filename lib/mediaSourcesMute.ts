"use client";

import { useSyncExternalStore } from "react";
import { trackFeatureEvent } from "@/lib/features";

// "Silenciar fontes": the room's media — YouTube videos and music, and the
// files other people play for the room — silenced for this listener only,
// apart from the voices. The other half of the headphones button, which
// silences the voices (micsMuted in WatchRoom) and nothing else.
//
// A module store rather than WatchRoom state, because the players live far
// from the dock: a group room's MusicBar is drawn under the group's header and
// keeps playing between its rooms. Each player reads `useMediaSourcesMuted()`
// and folds it into its own mute, so the person's own volume dial on each one
// is left exactly where they put it and comes back untouched.
//
// Behind the experiment below. `available` is set by the room from the
// feature, and while it is off this store answers "not muted" whatever is
// saved, so somebody taken out of the experiment cannot be left with silent
// videos and no button to bring them back.

export const MEDIA_MUTE_FEATURE = "room-mute-sources";
export const MEDIA_MUTE_EVENTS = {
  /** Turned on. value: 1 = the dock's own button, 2 = the menu under the headphones' arrow. */
  on: "mute_sources_on",
  /** Turned off, same values. */
  off: "mute_sources_off",
} as const;

const KEY = "golive.mediaSourcesMuted";

let stored = false;
let loaded = false;
let available = false;
const listeners = new Set<() => void>();

function readStored(): boolean {
  if (loaded) return stored;
  loaded = true;
  try {
    stored = window.localStorage.getItem(KEY) === "1";
  } catch {
    stored = false;
  }
  return stored;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): boolean {
  return available && readStored();
}

function serverSnapshot(): boolean {
  return false;
}

/** Whether the room's media is silenced for this listener right now. */
export function useMediaSourcesMuted(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** The same answer outside React (player callbacks created once). */
export function getMediaSourcesMuted(): boolean {
  return typeof window !== "undefined" && snapshot();
}

/** Set by the room from the feature flag; see the header. */
export function setMediaSourcesMuteAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  emit();
}

export function setMediaSourcesMuted(next: boolean, from: "button" | "menu"): void {
  if (readStored() === next) return;
  stored = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Blocked storage: still applies for this page.
  }
  trackFeatureEvent(next ? MEDIA_MUTE_EVENTS.on : MEDIA_MUTE_EVENTS.off, {
    feature: MEDIA_MUTE_FEATURE,
    value: from === "button" ? 1 : 2,
  });
  emit();
}
