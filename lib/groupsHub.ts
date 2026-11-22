"use client";

import { trackFeatureEvent, useFeature } from "./features";

// Experiment "groups-hub": the groups layout as a place to stay.
//
//   - /groups is a home of its own on a desktop — start a room, join one, see
//     what is live — instead of a second copy of the rail's list;
//   - "Explorar grupos" (/groups/explore) is where new groups are found, and
//     only that: the groups somebody is in are the rail's (and, on a phone,
//     the Grupos tab's list);
//   - the bar's house goes to that home, not out of the layout to the site's.
//
// The public rooms tile ("Salas ao vivo") keeps its own experiment
// (groups-rooms); here it only changes icon, since the globe goes to Explorar.

export const GROUPS_HUB_FEATURE = "groups-hub";

export const GROUPS_HUB_EVENTS = {
  /** A room started or joined from the home inside the layout. value: 1 public, 2 private created, 3 private joined. */
  roomStart: "hub_room_start",
  /** "Explorar grupos" opened. */
  exploreOpen: "explore_open",
  /** A public group joined from Explorar. */
  exploreJoin: "explore_join",
} as const;

export function trackGroupsHub(
  event: (typeof GROUPS_HUB_EVENTS)[keyof typeof GROUPS_HUB_EVENTS],
  value?: number
): void {
  trackFeatureEvent(event, { feature: GROUPS_HUB_FEATURE, ...(value !== undefined ? { value } : {}) });
}

// The public group last opened from Explorar, so joining it from its page
// (GroupPages' GroupGate) can be counted as Explorar's. One at a time and
// this tab only: a join is a few clicks after the card, not days.
let exploredGroupId: string | null = null;

export function noteExploreVisit(groupId: string): void {
  exploredGroupId = groupId;
}

/** Whether this group was opened from Explorar — and forgets it, so one visit counts once. */
export function takeExploreVisit(groupId: string): boolean {
  if (exploredGroupId !== groupId) return false;
  exploredGroupId = null;
  return true;
}

export function useGroupsHub({ track }: { track: boolean }): boolean {
  return useFeature(GROUPS_HUB_FEATURE, { track }).enabled;
}

/**
 * Where "home" is for this person: the groups layout's own home (/groups)
 * inside the experiment, the site's (/) outside it. Every "back to the start"
 * — hanging up on the call's page, a room that failed, a list's "Início" —
 * goes through here, so nobody in the experiment lands on the old home.
 */
export function useHomePath(): "/groups" | "/" {
  return useGroupsHub({ track: false }) ? "/groups" : "/";
}
