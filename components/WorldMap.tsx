"use client";

import dynamic from "next/dynamic";

// A pin on the world map. `id` is only a React-side key; Leaflet itself is
// handed a fresh marker per render pass (see WorldMapImpl).
export type WorldMapMarker = {
  id: string;
  lat: number;
  lng: number;
  // Shown on the pin itself — a room's name, today.
  label: string;
  // How many people are in the room. Rendered two different ways from one
  // number, which is why it is a number here rather than pre-worded text: the
  // pin shows the bare digit (a pin is a few dozen pixels wide, and "pessoas"
  // repeated across forty of them is what turns a map into a wall of words),
  // and the popup — which has room for a sentence — spells it out.
  peopleCount?: number;
  // A short tag shown on the pin ahead of the label, and again in the popup —
  // a room's category, today. Kept to a word or two: the pin grows to fit it.
  tag?: string;
  // Longer text, popup only — there is no room for it on the pin itself.
  description?: string;
  // Clicking the pin goes here. Omitted for a pin that isn't a link.
  href?: string;
};

export type WorldMapProps = {
  markers?: WorldMapMarker[];
  // The single "you are placing it here" pin, drawn differently from the room
  // pins above — see WorldMapImpl's pickIcon.
  pick?: { lat: number; lng: number } | null;
  // Turns the map into a picker: every click on the basemap reports where.
  // Omitted for a read-only map, which then ignores clicks entirely.
  onPick?: (lat: number, lng: number) => void;
  // Initial view only. Panning afterwards is the user's, and neither of these
  // changing later will yank the map back.
  center?: [number, number];
  zoom?: number;
  // Shows the place-search box over the map (see lib/geocoding). Picking a
  // result frames it — and, when `onPick` is also given, drops the pin there
  // as a starting point.
  searchable?: boolean;
  className?: string;
};

// Leaflet reaches for `window` at import time, so the real implementation can
// never be part of a server render — not even the throwaway one Next does for
// a "use client" component. This is the one place that knows that; everything
// else just imports WorldMap and renders it.
export const WorldMap = dynamic(() => import("./WorldMapImpl"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-600 dark:border-zinc-700 dark:border-t-zinc-300" />
    </div>
  ),
});
