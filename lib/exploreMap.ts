"use client";

import { trackFeatureEvent, useFeature } from "./features";

// Experiment "explore-map": the rooms-and-groups map (the one /worldmap shows)
// at the top of "Explorar grupos" (/groups/explore, experiment groups-hub), so
// finding a group can start from "near me" and not only from a list. A card
// the width of the page, with the same filter as /worldmap (everything, live
// rooms, groups) and a way out to the full map. The wheel scrolls the page
// until the map is clicked: a map in a scrolling page that zooms on every
// wheel turn traps whoever is just scrolling past it.

export const EXPLORE_MAP_FEATURE = "explore-map";

export const EXPLORE_MAP_EVENTS = {
  /** A pin's link followed from the map. Tag `kind`: room or group. */
  pin: "explore_map_pin",
  /** The filter changed. value: 1 everything, 2 live rooms, 3 groups. */
  filter: "explore_map_filter",
  /** "Mapa inteiro": out to /worldmap. */
  full: "explore_map_full",
  /** A public group opened from Explorar (list or map) and joined — both sides. */
  join: "explore_map_join",
} as const;

export function trackExploreMap(
  event: (typeof EXPLORE_MAP_EVENTS)[keyof typeof EXPLORE_MAP_EVENTS],
  extra?: { value?: number; tags?: Record<string, string> }
): void {
  trackFeatureEvent(event, { feature: EXPLORE_MAP_FEATURE, ...extra });
}

export function useExploreMap({ track }: { track: boolean }): boolean {
  return useFeature(EXPLORE_MAP_FEATURE, { track }).enabled;
}
