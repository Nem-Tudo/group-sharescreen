"use client";

// "Modo clipes" turns itself off after a week without a clip.
//
// The clip buffer is several MediaRecorders per tile on screen, re-encoding
// the stream for as long as the switch is on (see lib/clipBuffer and
// VideoTile's clipBuffering). That is most of a core and a hardware encoder
// session or more per tile, all the time, and the switch lives in
// localStorage: whoever tried clips once and forgot pays it in every room from
// then on. In production (2026-11-16) ~2.9k people ever switched it on and
// ~1.2k switched it off again, and all of them together make ~18 clips a day.
//
// The clock starts when the switch goes on (or, for whoever already had it on
// when this shipped, the first time a room sees it on) and restarts on every
// clip. Calendar time, not time in rooms: the question is "do they still want
// this", and a week without one clip says no either way.
//
// Behind CLIPS_IDLE_OFF_FEATURE. Both sides keep the clock, so the control
// side reports the moment it *would* have turned off (`idleWould`), once per
// idle stretch, which is what the "on" side's `idleOff` is compared against.
// The switch's own clips_mode_on/off are not sent for an automatic change:
// those count what people do.

import { useEffect, useSyncExternalStore } from "react";
import { useFeature } from "./features";
import { setTileExperimentMode, trackTileExperiment } from "./clipsMode";

export const CLIPS_IDLE_OFF_FEATURE = "clips-idle-off";

export const CLIPS_IDLE_OFF_EVENTS = {
  /** Turned off by this. value: days since the last clip / switching on. */
  idleOff: "clips_idle_off",
  /** Control side: would have been turned off now. value: as above. */
  idleWould: "clips_idle_would",
  /** Switched back on by hand after being turned off by this. */
  reOn: "clips_idle_reon",
} as const;

export const CLIPS_IDLE_MS = 7 * 24 * 60 * 60_000;

const LAST_USE_KEY = "sharescreen:clipsLastUse";
// "1" from an automatic switch-off until the person touches the switch again;
// it is what makes the menu say why the switch is off.
const AUTO_OFF_KEY = "sharescreen:clipsAutoOff";
// Control side: the idle stretch already reported, so it is sent once.
const WOULD_KEY = "sharescreen:clipsIdleWould";

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage refused: the clock simply starts again next visit.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTO_OFF_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function lastUse(): number | null {
  const value = Number(read(LAST_USE_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** A clip was made: the week starts over. */
export function noteClipMade() {
  write(LAST_USE_KEY, String(Date.now()));
  write(WOULD_KEY, null);
}

/**
 * The person flipped the switch in "⋯" — the one place that should call this,
 * so an automatic change is never mistaken for theirs.
 */
export function noteClipsSwitched(on: boolean, room?: string | null) {
  if (!on) {
    write(AUTO_OFF_KEY, null);
    return;
  }
  if (read(AUTO_OFF_KEY) === "1") trackTileExperiment(CLIPS_IDLE_OFF_EVENTS.reOn, undefined, room);
  write(AUTO_OFF_KEY, null);
  noteClipMade();
}

/**
 * Run where the clips switch is shown (WatchRoom). `on` is the switch as the
 * person left it, `available` whether they have clips at all. Exposure is
 * counted only for people with the switch on, the only ones this can touch.
 */
export function useClipsIdleOff(available: boolean, on: boolean, room?: string | null) {
  const watching = available && on;
  const { enabled, ready } = useFeature(CLIPS_IDLE_OFF_FEATURE, { track: watching });
  const autoOff = useSyncExternalStore(subscribe, () => read(AUTO_OFF_KEY) === "1", () => false);

  useEffect(() => {
    if (!watching || !ready) return;
    const check = () => {
      const since = lastUse();
      const now = Date.now();
      // Already on before this existed: the week starts today, not at some
      // unknown moment in the past.
      if (since === null) {
        write(LAST_USE_KEY, String(now));
        return;
      }
      const idle = now - since;
      if (idle < CLIPS_IDLE_MS) return;
      const days = idle / (24 * 60 * 60_000);
      if (!enabled) {
        if (read(WOULD_KEY) === String(since)) return;
        write(WOULD_KEY, String(since));
        trackTileExperiment(CLIPS_IDLE_OFF_EVENTS.idleWould, days, room);
        return;
      }
      trackTileExperiment(CLIPS_IDLE_OFF_EVENTS.idleOff, days, room);
      write(AUTO_OFF_KEY, "1");
      setTileExperimentMode("clips", false, room, { track: false });
    };
    check();
    // A room left open across the deadline.
    const timer = setInterval(check, 60 * 60_000);
    return () => clearInterval(timer);
  }, [watching, ready, enabled, room]);

  /** The switch is off because of this, and the person has not touched it since. */
  return { autoOff: autoOff && !on };
}
