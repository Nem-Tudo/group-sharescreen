"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useFeature } from "./features";

// "Modo clipes" — the experiment behind the clip button on every tile (see
// lib/clipBuffer). Two gates:
//   - the `room-clips` feature (user target, created in the admin panel's
//     "Features" tab — no API change), which decides who gets to see the
//     switch at all;
//   - the person's own switch in the room's "Mais opções", off by default,
//     since keeping a buffer costs CPU and memory for every tile.

export const CLIPS_FEATURE = "room-clips";
const MODE_KEY = "sharescreen:clipsMode";
const TIP_SEEN_KEY = "sharescreen:clipsTipSeen";

// Whether this browser had used GoLive before this page load. Read at module
// evaluation, before anything on the page mints a device id or caches the
// feature list, so a first visit cannot count itself as a returning one.
const wasReturning = (() => {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem("sharescreen:deviceId") !== null ||
      window.localStorage.getItem("sharescreen:features") !== null
    );
  } catch {
    return false;
  }
})();

const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MODE_KEY || event.key === TIP_SEEN_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused — the switch just won't survive a reload.
  }
  emit();
}

const getMode = () => read(MODE_KEY) === "1";
const getTipSeen = () => read(TIP_SEEN_KEY) === "1";

export function setClipsMode(on: boolean) {
  write(MODE_KEY, on ? "1" : "0");
}

/** The experiment and the person's switch together — what tiles check. */
export function useClipsMode(options: { track?: boolean } = {}) {
  const { enabled: available } = useFeature(CLIPS_FEATURE, { track: options.track ?? false });
  const on = useSyncExternalStore(subscribe, getMode, () => false);
  return { available, on, active: available && on };
}

/**
 * The blue "novo" tip on the "Mais opções" button: once, for people who
 * already used GoLive before getting the experiment. Somebody new has nothing
 * "new" to be told about, so their first sight of it marks it as seen.
 */
export function useClipsTip(available: boolean) {
  const seen = useSyncExternalStore(subscribe, getTipSeen, () => true);
  useEffect(() => {
    if (available && !seen && !wasReturning) write(TIP_SEEN_KEY, "1");
  }, [available, seen]);
  return {
    show: available && !seen && wasReturning,
    dismiss: () => write(TIP_SEEN_KEY, "1"),
  };
}
