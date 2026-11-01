"use client";

import { useSyncExternalStore } from "react";
import { trackFeatureEvent } from "@/lib/features";

// The "Configurações" dialog (components/settings/SettingsDialog), in one
// place: its experiment, what opens it and on which section, and the two facts
// the rest of the site needs from it.
//
// Behind a feature because it moves switches people already know where to find
// — see CLAUDE.md. Outside the experiment every menu stays exactly as it was.

/** The feature's key in the admin panel. Target: user, guests included. */
export const SETTINGS_HUB_FEATURE = "settings-hub";

/** The id the blue "NOVO" badge is tracked by — the feature's key. */
export const SETTINGS_HUB_BADGE = SETTINGS_HUB_FEATURE;

export type SettingsSection =
  | "account"
  | "appearance"
  | "notifications"
  | "general"
  | "call"
  | "shortcuts"
  | "extras"
  | "about";

/** Where it was opened from — the part after the dot in the event's name. */
export type SettingsSource = "card" | "menu" | "room" | "group" | "me" | "mic";

/**
 * Every event it reports. Each has to be registered as a "site event" on the
 * feature in the admin panel or it will not be counted.
 */
export const SETTINGS_HUB_EVENTS = {
  open: (source: SettingsSource) => `settings_open.${source}`,
  section: (section: SettingsSection) => `settings_section.${section}`,
} as const;

export function trackSettingsEvent(name: string) {
  trackFeatureEvent(name, { feature: SETTINGS_HUB_FEATURE });
}

// ---------------------------------------------------------------------------
// The window: open or not, and on what

// A null section is "wherever it starts": the first one in a dialog with its
// sections down the side, and the list of them on a phone.
type WindowState = { open: boolean; section: SettingsSection | null };

let windowState: WindowState = { open: false, section: null };
const windowListeners = new Set<() => void>();

function setWindowState(next: WindowState) {
  windowState = next;
  windowListeners.forEach((listener) => listener());
}

function subscribeWindow(listener: () => void) {
  windowListeners.add(listener);
  return () => {
    windowListeners.delete(listener);
  };
}

const CLOSED_ON_SERVER: WindowState = { open: false, section: null };

export function useSettingsWindow(): WindowState {
  return useSyncExternalStore(subscribeWindow, () => windowState, () => CLOSED_ON_SERVER);
}

export function openSettings(source: SettingsSource, section: SettingsSection | null = null) {
  trackSettingsEvent(SETTINGS_HUB_EVENTS.open(source));
  setWindowState({ open: true, section });
}

export function closeSettings() {
  setWindowState({ ...windowState, open: false });
}

export function setSettingsSection(section: SettingsSection | null) {
  setWindowState({ ...windowState, section });
}

// ---------------------------------------------------------------------------
// The "Chamada" section's switches
//
// They live in the room (see useRoomMedia): each one changes a call that is
// running, so only the room can draw them. The dialog offers a spot, and the
// room portals into it for as long as it is there.

let callSlot: HTMLElement | null = null;
const callSlotListeners = new Set<() => void>();

export function setSettingsCallSlot(node: HTMLElement | null) {
  callSlot = node;
  callSlotListeners.forEach((listener) => listener());
}

function subscribeCallSlot(listener: () => void) {
  callSlotListeners.add(listener);
  return () => {
    callSlotListeners.delete(listener);
  };
}

export function useSettingsCallSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribeCallSlot, () => callSlot, () => null);
}

// ---------------------------------------------------------------------------
// Whether an account card is on screen
//
// So the group's bar can leave out its account menu while the card already says
// who you are (see RoomAccountCard). Reported by the card itself, because only
// the card can tell: it may be mounted and still out of sight, in a folded chat
// column or in a call drawn nowhere.

let cardsOnScreen = 0;
const cardListeners = new Set<() => void>();

export function reportAccountCardOnScreen(delta: 1 | -1) {
  cardsOnScreen += delta;
  cardListeners.forEach((listener) => listener());
}

function subscribeCards(listener: () => void) {
  cardListeners.add(listener);
  return () => {
    cardListeners.delete(listener);
  };
}

export function useAccountCardOnScreen(): boolean {
  return useSyncExternalStore(subscribeCards, () => cardsOnScreen > 0, () => false);
}
