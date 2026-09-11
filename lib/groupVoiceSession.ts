"use client";

import { useSyncExternalStore } from "react";

// Which group voice room this tab is connected to, if any.
//
// Kept outside React on purpose, as a tiny store: three unrelated parts of the
// page need the same answer and none of them is the parent of the others —
//
//   - the group shell (components/groups/GroupAppShell), which is what keeps
//     the room mounted while somebody reads a text room, and so has to know
//     which one to keep;
//   - the voice dock at the bottom of the room list, which shows it and hangs
//     it up;
//   - ManageRoomModal, which is opened as a popup from inside the room and has
//     to know whether the room it is managing belongs to a group (a group
//     room's admins are the group's, so that screen is hidden there).
//
// The room itself also publishes its microphone here (see setGroupVoiceControls)
// so the dock can offer the mute button without reaching into the room.

export interface GroupVoiceSession {
  groupId: string;
  channelId: string;
  /** The room handle the call runs under — see groupVoiceHandle. */
  handle: string;
  channelName: string;
  groupName: string;
}

export interface GroupVoiceControls {
  isMicOn: boolean;
  toggleMic: () => void;
}

let session: GroupVoiceSession | null = null;
let controls: GroupVoiceControls | null = null;
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

export function getGroupVoiceSession(): GroupVoiceSession | null {
  return session;
}

export function setGroupVoiceSession(next: GroupVoiceSession | null): void {
  const same =
    session === next ||
    (session !== null &&
      next !== null &&
      session.handle === next.handle &&
      session.channelName === next.channelName &&
      session.groupName === next.groupName);
  if (same) return;
  session = next;
  if (!next) controls = null;
  notify();
}

export function useGroupVoiceSession(): GroupVoiceSession | null {
  return useSyncExternalStore(subscribe, getGroupVoiceSession, () => null);
}

/** Published by the room while it is in group mode; cleared by it on the way out. */
export function setGroupVoiceControls(next: GroupVoiceControls | null): void {
  if (controls?.isMicOn === next?.isMicOn && controls?.toggleMic === next?.toggleMic) return;
  controls = next;
  notify();
}

function getControls(): GroupVoiceControls | null {
  return controls;
}

export function useGroupVoiceControls(): GroupVoiceControls | null {
  return useSyncExternalStore(subscribe, getControls, () => null);
}

/** Whether the room this tab is in right now is the active group voice room. */
export function isActiveGroupVoiceRoom(room: string | null | undefined): boolean {
  return Boolean(room && session && session.handle === room);
}
