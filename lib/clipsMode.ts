"use client";

import { useEffect, useSyncExternalStore } from "react";
import { trackFeatureEvent, useFeature } from "./features";

// The tile experiments switched on from the room's "Mais opções":
//   - "Modo clipes": the clip-the-last-30s button (see lib/clipBuffer);
//   - "Gravação": the start/stop record button (see TileRecorder).
// Each has two gates:
//   - its feature (user target, created in the admin panel's "Features" tab —
//     no API change), which decides who gets to see the switch at all;
//   - the person's own switch in "Mais opções", off by default.

export type TileExperiment = "clips" | "recording";

const CONFIG: Record<TileExperiment, { feature: string; modeKey: string; tipKey: string }> = {
  clips: { feature: "room-clips", modeKey: "sharescreen:clipsMode", tipKey: "sharescreen:clipsTipSeen" },
  recording: {
    feature: "room-recording",
    modeKey: "sharescreen:recordingMode",
    tipKey: "sharescreen:recordingTipSeen",
  },
};

// Usage stats, compared between the sides of each experiment. Every name has
// to be listed in its feature's "site events" in the admin panel to count.
export const TILE_EXPERIMENT_EVENTS = {
  clips: {
    modeOn: "clips_mode_on",
    modeOff: "clips_mode_off",
    create: "clip_create", // value: seconds in the clip
    download: "clip_download", // value: seconds downloaded
    trim: "clip_trim", // downloaded after cutting
  },
  recording: {
    modeOn: "recording_mode_on",
    modeOff: "recording_mode_off",
    start: "recording_start",
    stop: "recording_stop", // value: seconds recorded
    download: "recording_download", // value: seconds downloaded
    trim: "recording_trim", // downloaded after cutting
  },
} as const;

// One event for every "recurso novo" tip, whatever the feature: the person
// clicked what the tip points at while it was on screen. Being a site event,
// it counts for each experiment they are in — register it in each one's
// "site events" in the admin panel.
export const TIP_CLICK_EVENT = "new_feature_tip_click";

export function trackTileExperiment(name: string, value?: number) {
  trackFeatureEvent(name, value ? { value: Math.max(1, Math.round(value)) } : {});
}

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
    if (event.key?.startsWith("sharescreen:")) listener();
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

export function setTileExperimentMode(experiment: TileExperiment, on: boolean) {
  write(CONFIG[experiment].modeKey, on ? "1" : "0");
  const events = TILE_EXPERIMENT_EVENTS[experiment];
  trackTileExperiment(on ? events.modeOn : events.modeOff);
}

/** The experiment and the person's switch together — what tiles check. */
export function useTileExperiment(experiment: TileExperiment, options: { track?: boolean } = {}) {
  const { feature, modeKey } = CONFIG[experiment];
  const { enabled: available } = useFeature(feature, { track: options.track ?? false });
  const on = useSyncExternalStore(subscribe, () => read(modeKey) === "1", () => false);
  return { available, on, active: available && on };
}

/**
 * The blue "novo" tip on the "Mais opções" button: once per experiment, for
 * people who already used GoLive before getting it. Somebody new has nothing
 * "new" to be told about, so their first sight of it marks it as seen.
 */
export function useTileExperimentTip(experiment: TileExperiment, available: boolean) {
  const { tipKey } = CONFIG[experiment];
  const seen = useSyncExternalStore(subscribe, () => read(tipKey) === "1", () => true);
  useEffect(() => {
    if (available && !seen && !wasReturning) write(tipKey, "1");
  }, [available, seen, tipKey]);
  return {
    show: available && !seen && wasReturning,
    dismiss: () => write(tipKey, "1"),
    /** The tip's target was clicked while it showed: counted, then gone. */
    clicked: () => {
      trackFeatureEvent(TIP_CLICK_EVENT);
      write(tipKey, "1");
    },
  };
}
