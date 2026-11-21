"use client";

// Experiment "room-declutter": the redesigned room on a computer
// (room-redesign's desktop half, WatchRoom's deskRedesign) with less on
// screen at once. People said the room looked "poluída", and next to other
// call apps it did: six red blocks in the call bar, ten icons over a tile,
// cards inside cards, the same actions in two places — and, worst of all,
// whoever shared their whole screen saw the room inside the room inside the
// room. Only a layer over the redesign: whoever is outside it sees nothing
// change, and so does anyone in it without the redesign.
//
//   - Whole screen: our own preview of a whole-screen share is a quiet card
//     ("you are showing your whole screen") instead of a mirror of the page,
//     with a button to see it anyway (that share only).
//   - One red: only leaving the call is a red block. Something off (mic,
//     sound) is a red icon on the bar's neutral; something going out
//     (screen, camera) a green tint. See [data-room-declutter] in globals.css.
//   - Fewer buttons: the screen's quality settings on an arrow of the screen
//     button, the video/music/tools buttons behind one "Atividades" button,
//     a tile's rarer buttons behind its "⋯", and the account card down to who
//     you are (its recording and transcript buttons live in the room's "⋯").
//   - Top bar: the room's name, a lock and its code as one quiet line, and
//     the gift button outlined rather than a second solid one.
//
// No switch in the "⋯": it is a layout, like the redesign itself, and a
// switch would hide the comparison it is here to make.
import { createContext, useEffect } from "react";
import { trackFeatureEvent } from "./features";

export const ROOM_DECLUTTER_FEATURE = "room-declutter";

/** Whether the room around a tile is in the experiment (see VideoTile's "⋯"). */
export const RoomDeclutterContext = createContext(false);

export const ROOM_DECLUTTER_EVENTS = {
  /** "Mostrar prévia" on the whole-screen card. */
  selfPreviewShow: "declutter_self_preview_show",
  /** The "Atividades" button opened its panel. */
  activitiesOpen: "declutter_activities_open",
  /** A tile's "⋯" opened. */
  tileMenuOpen: "declutter_tile_menu_open",
  /** Five more minutes in the call (both sides). value = 5. */
  callMinutes: "declutter_call_5min",
  /** A screen share started (both sides). */
  shareStart: "declutter_share_start",
} as const;

export type RoomDeclutterEvent = (typeof ROOM_DECLUTTER_EVENTS)[keyof typeof ROOM_DECLUTTER_EVENTS];

export function trackRoomDeclutterEvent(name: RoomDeclutterEvent, value?: number): void {
  trackFeatureEvent(name, { feature: ROOM_DECLUTTER_FEATURE, value });
}

const TICK_MS = 30_000;
const BLOCK_MS = 5 * 60_000;

/**
 * Time in the call, in five-minute blocks, on both sides — a calmer room
 * should keep people in it at least as long. Run by the room, which is
 * mounted for exactly as long as the call is.
 */
export function useRoomDeclutterCallMinutes(counting: boolean): void {
  useEffect(() => {
    if (!counting) return;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += TICK_MS;
      if (elapsed < BLOCK_MS) return;
      elapsed -= BLOCK_MS;
      trackRoomDeclutterEvent(ROOM_DECLUTTER_EVENTS.callMinutes, 5);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [counting]);
}

// ─── Whole-screen shares ──────────────────────────────────────────────────
//
// The GPU capture (lib/nativeVideoCapture) swaps the browser's track for a
// generated one with no displaySurface and no label, so what the picker
// returned is noted on the stream before that swap (see useRoomMedia's
// withNativeVideo) and read back from here.
const wholeScreenStreams = new WeakMap<MediaStream, boolean>();

function trackIsWholeScreen(track: MediaStreamTrack | undefined): boolean | null {
  if (!track) return null;
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
  if (surface === "monitor") return true;
  if (surface === "window" || surface === "browser") return false;
  // The desktop app's picker (Electron's desktopCapturer) names a screen
  // "screen:<id>:0" and a window "window:<id>:0".
  if (track.label.startsWith("screen:")) return true;
  if (track.label.startsWith("window:")) return false;
  return null;
}

/** Notes what a share's browser track captured, before anything replaces it. */
export function noteShareSurface(stream: MediaStream): void {
  if (wholeScreenStreams.has(stream)) return;
  const whole = trackIsWholeScreen(stream.getVideoTracks()[0]);
  if (whole !== null) wholeScreenStreams.set(stream, whole);
}

/** Whether a share of ours shows a whole screen (which has this page on it). */
export function isWholeScreenShare(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  const noted = wholeScreenStreams.get(stream);
  if (noted !== undefined) return noted;
  return trackIsWholeScreen(stream.getVideoTracks()[0]) === true;
}
