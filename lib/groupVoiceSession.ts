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
// so the dock can offer the mute button without reaching into the room — and
// everybody in it as the call sees them (see setGroupVoiceLive), so the rooms
// list can draw the room you are in from the call rather than from the server
// — and whether it has the group's side columns folded away (see
// setGroupVoiceColumns), so the shell knows to stop drawing them.

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
  /**
   * Silences somebody in the call for this listener alone — every device they
   * are on at once — or lets them be heard again. See GroupVoiceLivePerson.audio.
   */
  togglePersonMute: (userId: string) => void;
  /** How loud somebody is for this listener alone, 0 to MAX_GAIN. */
  setPersonVolume: (userId: string, volume: number) => void;
}

/**
 * Somebody in the connected room, as the call sees them — one entry per
 * person, however many devices, folded the way the server folds them (see the
 * API's groupVoiceParticipants).
 */
export interface GroupVoiceLivePerson {
  userId: string;
  /** Unique per row — one account on two devices is two rows. Absent: userId. */
  key?: string;
  /** The connection this row is, when it is somebody else in your room — what its mute toggles. */
  peerId?: string;
  name: string;
  avatarUrl: string | null;
  mic: boolean;
  /** A room manager turned their mic off — the mic-off icon goes red. */
  silenced?: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
  /** Their microphone's audio, for telling when they speak. Null while it is off. */
  micStream: MediaStream | null;
  /**
   * How this listener hears them: muted for this listener, and at what volume.
   * Present only for somebody else in the room you are connected to — nobody
   * else's audio reaches this tab, and your own is not yours to turn down —
   * which is also what says whether the rooms list offers the controls.
   */
  audio?: { muted: boolean; volume: number };
}

/**
 * The connected room, live. What the rooms list shows for the room you are in
 * instead of the server's group-wide update: the call hears about a mute or a
 * camera the moment it happens (it is the same message that updates the tiles),
 * and it has everybody's audio, which is the only way to know who is speaking.
 */
export interface GroupVoiceLive {
  /** The room handle this describes — matched against the session's. */
  handle: string;
  people: GroupVoiceLivePerson[];
  music: { playing: boolean } | null;
}

/**
 * The group's own columns beside its voice room — the rail of groups and the
 * rooms column, with the group's ad under it — which the room may fold away to
 * give the call their width, the way an ordinary room folds its participant
 * list (see WatchRoom's leftSidebarCollapsed, which this is). Published by the
 * room, which knows whether anything is on screen worth the space and draws the
 * ad in the grid once the column that held it is gone; read by the shell, which
 * draws the columns.
 */
export interface GroupVoiceColumns {
  collapsed: boolean;
  /** Whether folding them is on offer: from lg up, while something is being shown. */
  canCollapse: boolean;
  toggle: () => void;
}

let session: GroupVoiceSession | null = null;
let controls: GroupVoiceControls | null = null;
let live: GroupVoiceLive | null = null;
let columns: GroupVoiceColumns | null = null;
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

/**
 * Every change here, for lib/callSession — which mirrors this store into the
 * one the call host runs on, so that hanging up from the group's own dock (or
 * leaving the group, or logging out) still ends the call now that no component
 * owns the room. Fires for the controls and the participant list too; the
 * reader compares before acting.
 */
export function subscribeGroupVoiceSession(listener: () => void): () => void {
  return subscribe(listener);
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
  if (!next) {
    controls = null;
    live = null;
    columns = null;
  }
  notify();
}

export function useGroupVoiceSession(): GroupVoiceSession | null {
  return useSyncExternalStore(subscribe, getGroupVoiceSession, () => null);
}

/** Published by the room while it is in group mode; cleared by it on the way out. */
export function setGroupVoiceControls(next: GroupVoiceControls | null): void {
  if (
    controls?.isMicOn === next?.isMicOn &&
    controls?.toggleMic === next?.toggleMic &&
    controls?.togglePersonMute === next?.togglePersonMute &&
    controls?.setPersonVolume === next?.setPersonVolume
  ) {
    return;
  }
  controls = next;
  notify();
}

function getControls(): GroupVoiceControls | null {
  return controls;
}

export function useGroupVoiceControls(): GroupVoiceControls | null {
  return useSyncExternalStore(subscribe, getControls, () => null);
}

/** Published by the room while it is in group mode and joined; cleared by it on the way out. */
export function setGroupVoiceLive(next: GroupVoiceLive | null): void {
  if (live === next) return;
  live = next;
  notify();
}

function getLive(): GroupVoiceLive | null {
  return live;
}

export function useGroupVoiceLive(): GroupVoiceLive | null {
  return useSyncExternalStore(subscribe, getLive, () => null);
}

/** Published by the room while it is in group mode; cleared by it on the way out. */
export function setGroupVoiceColumns(next: GroupVoiceColumns | null): void {
  if (
    columns?.collapsed === next?.collapsed &&
    columns?.canCollapse === next?.canCollapse &&
    columns?.toggle === next?.toggle
  ) {
    return;
  }
  columns = next;
  notify();
}

function getColumns(): GroupVoiceColumns | null {
  return columns;
}

export function useGroupVoiceColumns(): GroupVoiceColumns | null {
  return useSyncExternalStore(subscribe, getColumns, () => null);
}

/**
 * "Show me what this person is transmitting": the "ao vivo" badge next to
 * somebody in the rooms list opens their voice room with their transmission
 * focused. The list and the room are not parent and child, and the room may
 * not even be mounted yet (it mounts when the navigation lands), so the
 * request waits here and the room picks it up once that person's tile exists
 * (see WatchRoom's focusRequest). `id` tells one click from the next, even
 * for the same person.
 */
export interface GroupVoiceFocusRequest {
  id: number;
  /** The room handle it is meant for — see groupVoiceHandle. */
  handle: string;
  userId: string;
}

// Long enough for joining a room and the transmission connecting; short
// enough that a request nobody could honour does not fire, out of nowhere,
// the next time that room is opened.
const FOCUS_REQUEST_TTL_MS = 30_000;

let focusRequest: GroupVoiceFocusRequest | null = null;
let focusRequestCount = 0;
let focusRequestTimer: ReturnType<typeof setTimeout> | null = null;

export function requestGroupVoiceFocus(handle: string, userId: string): void {
  focusRequestCount += 1;
  const request = { id: focusRequestCount, handle, userId };
  focusRequest = request;
  if (focusRequestTimer) clearTimeout(focusRequestTimer);
  focusRequestTimer = setTimeout(() => {
    if (focusRequest !== request) return;
    focusRequest = null;
    notify();
  }, FOCUS_REQUEST_TTL_MS);
  notify();
}

function getFocusRequest(): GroupVoiceFocusRequest | null {
  return focusRequest;
}

export function useGroupVoiceFocusRequest(): GroupVoiceFocusRequest | null {
  return useSyncExternalStore(subscribe, getFocusRequest, () => null);
}

/** Whether the room this tab is in right now is the active group voice room. */
export function isActiveGroupVoiceRoom(room: string | null | undefined): boolean {
  return Boolean(room && session && session.handle === room);
}
