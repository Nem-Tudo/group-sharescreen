"use client";

import { useSyncExternalStore } from "react";
import {
  CAMERA_STREAM_BG_EVENTS,
  setCameraBackgroundTrack,
  setCameraEffect,
  trackStreamBackground,
} from "./cameraEffects";

// Which transmission is the camera's background ("camera-stream-bg", see
// setCameraBackgroundTrack in lib/cameraEffects.ts). The room publishes what
// can be picked — every screen, camera and file with a picture, except one's
// own camera, which would end up drawn into itself — and the effects panel
// picks one. Kept for this page only: on a reload, or in another room, the
// transmission it named is not there anymore.

export interface StreamBackgroundSource {
  // `${key}:${ownerId}`, as the room's call sources name them: stable while
  // the transmission lasts.
  id: string;
  kind: "screen" | "camera" | "file";
  name: string;
  self: boolean;
  track: MediaStreamTrack;
}

let sources: StreamBackgroundSource[] = [];
let selectedId: string | null = null;
let selected: StreamBackgroundSource | null = null;
const listeners = new Set<() => void>();

function sameSource(a: StreamBackgroundSource, b: StreamBackgroundSource): boolean {
  return a.id === b.id && a.kind === b.kind && a.name === b.name && a.self === b.self && a.track === b.track;
}

// Only tells anyone when something did change. The room republishes on every
// render its call sources are rebuilt in — fresh objects for the same
// transmissions — and handing those on as news made the room re-render,
// rebuild, republish... (React's "maximum update depth", the page gone).
function update() {
  const found = (selectedId && sources.find((source) => source.id === selectedId)) || null;
  const next = found && selected && sameSource(found, selected) ? selected : found;
  if (next !== selected) {
    selected = next;
    setCameraBackgroundTrack(next ? next.track : null);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What the room has to offer right now (WatchRoom calls this whenever it changes). */
export function publishStreamBackgroundSources(next: StreamBackgroundSource[]) {
  if (next.length === sources.length && next.every((source, i) => sameSource(source, sources[i]))) return;
  sources = next;
  update();
}

/** Puts `id` behind the person (and the background on "stream"). */
export function pickStreamBackground(id: string) {
  selectedId = id;
  setCameraEffect("background", "stream");
  trackStreamBackground(CAMERA_STREAM_BG_EVENTS.pick);
  update();
}

const NO_SOURCES: StreamBackgroundSource[] = [];

export function useStreamBackgroundSources(): StreamBackgroundSource[] {
  return useSyncExternalStore(subscribe, () => sources, () => NO_SOURCES);
}

/** The picked transmission while it is still in the room, else null. */
export function useStreamBackgroundSelected(): StreamBackgroundSource | null {
  return useSyncExternalStore(subscribe, () => selected, () => null);
}
