"use client";

import { useSyncExternalStore } from "react";
import { trackFeatureEvent } from "./features";

// "Girar/inverter" — turning a tile's picture a quarter turn at a time, or
// flipping it, without touching the transmission itself.
//
// Two orientations meet on every tile, and they are deliberately different
// things:
//
//   - the *broadcaster's*, announced to the room (see the API's
//     "tile-orientation"), for the person whose camera is upside down at the
//     source and who wants everyone to see it the right way up;
//   - the *viewer's*, which lives only in this tab and overrides the
//     broadcaster's for whoever set it. Somebody who already tilted a tile to
//     suit themselves must not have it yanked around when the broadcaster
//     tries to fix it, so the local one always wins until it is cleared.
//
// The transform itself is applied by lib/usePinchZoom.ts, which owns the
// video element's `transform` — a second one written from here would be
// overwritten by the next pinch frame.

export type Orientation = {
  /** Quarter turns clockwise. */
  rotation: 0 | 90 | 180 | 270;
  /** Mirrored left-to-right / top-to-bottom, applied to the turned picture. */
  flipX: boolean;
  flipY: boolean;
};

export const NO_ORIENTATION: Orientation = { rotation: 0, flipX: false, flipY: false };

export function isDefaultOrientation(o: Orientation | null | undefined): boolean {
  return !o || (o.rotation === 0 && !o.flipX && !o.flipY);
}

export function sameOrientation(a: Orientation | null, b: Orientation | null): boolean {
  if (!a || !b) return isDefaultOrientation(a) && isDefaultOrientation(b);
  return a.rotation === b.rotation && a.flipX === b.flipX && a.flipY === b.flipY;
}

/** Anything off the wire, back into a value the transform can trust. */
export function parseOrientation(value: unknown): Orientation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { rotation?: unknown; flipX?: unknown; flipY?: unknown };
  const rotation = Number(raw.rotation);
  if (![0, 90, 180, 270].includes(rotation)) return null;
  return {
    rotation: rotation as Orientation["rotation"],
    flipX: Boolean(raw.flipX),
    flipY: Boolean(raw.flipY),
  };
}

export function rotateOrientation(o: Orientation, quarterTurns: 1 | -1): Orientation {
  return { ...o, rotation: (((o.rotation / 90 + quarterTurns + 4) % 4) * 90) as Orientation["rotation"] };
}

export function flipOrientation(o: Orientation, axis: "x" | "y"): Orientation {
  return axis === "x" ? { ...o, flipX: !o.flipX } : { ...o, flipY: !o.flipY };
}

// The viewer's own overrides, one per tile id (see WatchRoom's tileId). Kept
// in memory rather than in localStorage on purpose: half of a tile id is a
// peer connection id, reissued on every reconnect, so a stored value would
// either be orphaned or — worse — land on somebody else's tile later.
const localOverrides = new Map<string, Orientation>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLocalOrientation(tileId: string, orientation: Orientation) {
  if (isDefaultOrientation(orientation)) localOverrides.delete(tileId);
  else localOverrides.set(tileId, orientation);
  emit();
}

export function clearLocalOrientation(tileId: string) {
  if (!localOverrides.delete(tileId)) return;
  emit();
}

/** The viewer's override for this tile, or null when they set none. */
export function useLocalOrientation(tileId: string | undefined): Orientation | null {
  return useSyncExternalStore(
    subscribe,
    () => (tileId ? localOverrides.get(tileId) ?? null : null),
    () => null
  );
}

// What the video element's transform needs: the quarter turn a rotated
// picture has to be scaled by to still fit its box. An object-contain video
// is letterboxed inside its element, and turning that drawn rectangle on its
// side makes it as tall as it was wide — without this it would simply be
// cropped by the tile's `overflow-hidden`.
export function orientationFitScale(
  rotation: Orientation["rotation"],
  boxW: number,
  boxH: number,
  intrinsicW: number,
  intrinsicH: number
): number {
  if (rotation % 180 === 0) return 1;
  if (!boxW || !boxH || !intrinsicW || !intrinsicH) return 1;
  const fit = Math.min(boxW / intrinsicW, boxH / intrinsicH);
  const drawnW = intrinsicW * fit;
  const drawnH = intrinsicH * fit;
  // The turned picture occupies drawnH x drawnW.
  return Math.min(boxW / drawnH, boxH / drawnW);
}

/** The CSS for an orientation, innermost part of the video's transform. */
export function orientationTransform(o: Orientation, fitScale: number): string {
  const parts: string[] = [];
  if (fitScale !== 1) parts.push(`scale(${fitScale})`);
  if (o.rotation) parts.push(`rotate(${o.rotation}deg)`);
  if (o.flipX) parts.push("scaleX(-1)");
  if (o.flipY) parts.push("scaleY(-1)");
  return parts.join(" ");
}

// Usage stats for the experiment — every name here is listed in the
// "tile-orientation" feature's site events in the admin panel.
export const ORIENTATION_EVENTS = {
  open: "orientation_open", // the panel was opened on a tile
  rotate: "orientation_rotate", // value: the resulting rotation in degrees
  flip: "orientation_flip",
  reset: "orientation_reset",
  broadcast: "orientation_broadcast", // a broadcaster set it for the room
  broadcastReset: "orientation_broadcast_reset",
  // The zoom bar a mouse gets on a tile that has the room to be zoomed
  // — on the stage, in hyperfocus or in fullscreen. value: the level it
  // was left at, in per cent (200 = 2x).
  zoom: "orientation_zoom",
} as const;

export function trackOrientation(name: string, value?: number) {
  trackFeatureEvent(name, value === undefined ? {} : { value: Math.max(0, Math.round(value)) });
}
