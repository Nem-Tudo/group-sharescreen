"use client";

import { trackFeatureEvent, useFeature } from "./features";

// Experiment "hub-central": the home inside the groups layout (groups-hub's
// GroupsHubHome, desktop only) as the app's central — besides starting a room
// and what is live in your groups, the three things somebody opens Go Live to
// check: who is around (friends, online first, with call and chat on each
// row), who wrote (the last conversations and their unread counts) and what
// happened (the bell's list, without opening the bell). Accounts only: a guest
// has none of the three and keeps the page as it was.
//
// A layout, not a switch: on for the person, it is the home.

export const HUB_CENTRAL_FEATURE = "hub-central";

export const HUB_CENTRAL_EVENTS = {
  /** A room started or joined from the home (both sides). value: 1 public, 2 private created, 3 private joined. */
  roomStart: "central_room_start",
  /** "Ligar" on a friend's row. */
  call: "central_call",
  /** The chat button on a friend's row. */
  chat: "central_chat",
  /** A conversation opened from the messages card. */
  dmOpen: "central_dm_open",
  /** "Todas as mensagens" from the messages card. */
  dmAll: "central_dm_all",
  /** A notification opened from the card. Tag `kind`: the notification's kind. */
  notifOpen: "central_notif_open",
  /** "Adicionar amigo" from the friends card. */
  friendAdd: "central_friend_add",
  /** The pending friend requests line opened. */
  requests: "central_requests_open",
} as const;

export function trackHubCentral(
  event: (typeof HUB_CENTRAL_EVENTS)[keyof typeof HUB_CENTRAL_EVENTS],
  extra?: { value?: number; tags?: Record<string, string> }
): void {
  trackFeatureEvent(event, { feature: HUB_CENTRAL_FEATURE, ...extra });
}

export function useHubCentral({ track }: { track: boolean }): boolean {
  return useFeature(HUB_CENTRAL_FEATURE, { track }).enabled;
}
