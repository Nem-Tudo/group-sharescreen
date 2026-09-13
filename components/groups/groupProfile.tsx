"use client";

import { useSyncExternalStore, type MouseEvent } from "react";
import { mentionInComposer } from "@/lib/groupMentionBridge";

// One profile dialog and one right-click menu for the whole group screen.
// Anything that shows a person — a message's author, somebody in a voice room,
// a row in the members column — calls openGroupProfile or openGroupMemberMenu,
// and the single host of each in the shell draws it (see GroupMemberActions).
// One host rather than one per list, so opening someone from one place never
// leaves a second copy behind in another.
//
// And the same three gestures on a person everywhere, through the handlers at
// the bottom: a click opens their member profile, Shift+click mentions them in
// the message being written, and the right button opens the menu.

export interface GroupProfileTarget {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Guests have no profile to fetch; the dialog draws one from name and picture. */
  guest: boolean;
}

export interface GroupMemberMenuState {
  target: GroupProfileTarget;
  /** Where the pointer was, in viewport coordinates — the menu opens there. */
  x: number;
  y: number;
}

let current: GroupProfileTarget | null = null;
let menu: GroupMemberMenuState | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openGroupProfile(target: GroupProfileTarget): void {
  current = target;
  notify();
}

export function closeGroupProfile(): void {
  current = null;
  notify();
}

export function useGroupProfileTarget(): GroupProfileTarget | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export function openGroupMemberMenu(target: GroupProfileTarget, x: number, y: number): void {
  menu = { target, x, y };
  notify();
}

export function closeGroupMemberMenu(): void {
  if (!menu) return;
  menu = null;
  notify();
}

export function useGroupMemberMenu(): GroupMemberMenuState | null {
  return useSyncExternalStore(subscribe, () => menu, () => null);
}

/**
 * A click on a person: Shift mentions them in the message being written (when
 * there is one on screen), anything else opens their member profile.
 */
export function clickPerson(event: MouseEvent, target: GroupProfileTarget): void {
  if (event.shiftKey && mentionInComposer(target)) {
    event.preventDefault();
    return;
  }
  openGroupProfile(target);
}

/** The right button on a person: the menu, where the pointer is. */
export function contextPerson(event: MouseEvent, target: GroupProfileTarget): void {
  event.preventDefault();
  event.stopPropagation();
  openGroupMemberMenu(target, event.clientX, event.clientY);
}
