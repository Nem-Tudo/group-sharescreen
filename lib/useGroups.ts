"use client";

import { useEffect, useSyncExternalStore } from "react";
import { signalingClient, type GroupSocketEvent } from "./signalingClient";
import { appendCachedMessage, forgetGroupMembers, removeCachedMessage } from "./groupCache";
import {
  fetchGroup,
  fetchMyGroups,
  markChannelRead,
  type GroupDetail,
  type GroupMessage,
  type GroupSummary,
  type GroupUser,
  type GroupVoiceMap,
} from "./groupsApi";

// Every group this person is in, and the details of the ones they have opened.
//
// One store for the whole page rather than state inside each screen, because
// the rail, the room list, the voice dock and the text room all show parts of
// the same answer and a nudge from the socket has to reach all of them at once.
// Same shape as the DM client: HTTP is the truth, the socket says "re-read" —
// with two exceptions applied in place because re-reading for them would be
// wasteful: who is in the voice rooms (the nudge *carries* the answer) and the
// unread dots (a new message says exactly which dot to light).

interface GroupsState {
  /** Null until the first read has answered. */
  groups: GroupSummary[] | null;
  groupsError: string | null;
  details: Record<string, GroupDetail>;
  /** Group ids whose detail read failed, with why — a 404 means "not yours". */
  detailErrors: Record<string, { status: number; error: string }>;
}

let state: GroupsState = { groups: null, groupsError: null, details: {}, detailErrors: {} };
const listeners = new Set<() => void>();

function setState(patch: Partial<GroupsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureSocketListener();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const serverSnapshot: GroupsState = { groups: null, groupsError: null, details: {}, detailErrors: {} };

// ─── Reads ───────────────────────────────────────────────────────────────

let groupsInFlight: Promise<void> | null = null;

export function refreshGroups(): Promise<void> {
  if (groupsInFlight) return groupsInFlight;
  groupsInFlight = (async () => {
    const result = await fetchMyGroups();
    if (result.ok) setState({ groups: result.groups, groupsError: null });
    else if (result.status === 401) setState({ groups: [], groupsError: null });
    else setState({ groupsError: result.error, groups: state.groups ?? [] });
  })().finally(() => {
    groupsInFlight = null;
  });
  return groupsInFlight;
}

const detailInFlight = new Map<string, Promise<void>>();
/** When each group's detail was last read — see useGroupDetail's background refresh. */
const detailFetchedAt = new Map<string, number>();
/** A group opened again after this long is re-read behind what is shown. */
const DETAIL_STALE_MS = 30_000;

export function refreshGroup(groupId: string): Promise<void> {
  const pending = detailInFlight.get(groupId);
  if (pending) return pending;
  const run = (async () => {
    const result = await fetchGroup(groupId);
    if (result.ok) {
      const { ok: _ok, ...detail } = result;
      void _ok;
      detailFetchedAt.set(groupId, Date.now());
      // A room being looked at right now has, by definition, nothing unread.
      const viewing = viewingChannel?.groupId === groupId ? viewingChannel.channelId : null;
      const channels = detail.channels.map((c) =>
        c.id === viewing ? { ...c, unread: false, mentions: 0 } : c
      );
      const errors = { ...state.detailErrors };
      delete errors[groupId];
      setState({ details: { ...state.details, [groupId]: { ...detail, channels } }, detailErrors: errors });
      syncSummaryFromDetail(groupId);
    } else if (result.status !== 0) {
      setState({
        detailErrors: { ...state.detailErrors, [groupId]: { status: result.status, error: result.error } },
      });
    }
  })().finally(() => {
    detailInFlight.delete(groupId);
  });
  detailInFlight.set(groupId, run);
  return run;
}

/** Drops everything — used when the identity changes (logging in or out). */
export function resetGroups(): void {
  setState({ groups: null, groupsError: null, details: {}, detailErrors: {} });
}

/** Whose groups the store holds. Undefined until somebody says. */
let groupsIdentity: string | null | undefined = undefined;

/**
 * Tells the store who is asking, and drops what it holds when that changed —
 * a guest who signs in on the home page must not go on seeing the guest's
 * groups. Call from an effect: it can notify subscribers.
 */
export function syncGroupsIdentity(identity: string | null): void {
  if (groupsIdentity !== undefined && groupsIdentity !== identity) resetGroups();
  groupsIdentity = identity;
}

// ─── Unread bookkeeping ──────────────────────────────────────────────────

/** The text room on screen right now, if any — see setViewingChannel. */
let viewingChannel: { groupId: string; channelId: string } | null = null;

/**
 * Tells the store which text room is on screen. A message arriving there is
 * read the moment it lands, so it must not light a dot — and opening a room
 * clears its dot, here and (through the read call) on every other device.
 */
export function setViewingChannel(next: { groupId: string; channelId: string } | null): void {
  viewingChannel = next;
  if (next) clearUnread(next.groupId, next.channelId, true);
}

function clearUnread(groupId: string, channelId: string, tellServer: boolean) {
  const detail = state.details[groupId];
  if (detail) {
    const channel = detail.channels.find((c) => c.id === channelId);
    if (channel && (channel.unread || channel.mentions > 0)) {
      patchDetail(groupId, {
        channels: detail.channels.map((c) =>
          c.id === channelId ? { ...c, unread: false, mentions: 0 } : c
        ),
      });
    }
  }
  if (tellServer) markChannelRead(groupId, channelId);
  syncSummaryFromDetail(groupId);
}

function patchDetail(groupId: string, patch: Partial<GroupDetail>) {
  const detail = state.details[groupId];
  if (!detail) return;
  setState({ details: { ...state.details, [groupId]: { ...detail, ...patch } } });
}

/** Keeps the rail's dot for a group in step with its rooms' dots, when the rooms are known. */
function syncSummaryFromDetail(groupId: string) {
  const detail = state.details[groupId];
  if (!detail || !state.groups) return;
  const unread = detail.channels.some((c) => c.unread);
  const mentions = detail.channels.reduce((n, c) => n + c.mentions, 0);
  const summary = state.groups.find((g) => g.id === groupId);
  if (!summary) return;
  if (
    summary.unread === unread &&
    summary.mentions === mentions &&
    summary.name === detail.group.name &&
    summary.iconUrl === detail.group.iconUrl &&
    summary.role === detail.me.role
  ) {
    return;
  }
  setState({
    groups: state.groups.map((g) =>
      g.id === groupId
        ? { ...g, unread, mentions, name: detail.group.name, iconUrl: detail.group.iconUrl, role: detail.me.role }
        : g
    ),
  });
}

function noteIncomingMessage(message: GroupMessage) {
  const { groupId, channelId } = message;
  const detail = state.details[groupId];
  const selfId = detail?.me.id ?? null;
  if (selfId && message.from === selfId) return;
  const onScreen =
    viewingChannel?.groupId === groupId &&
    viewingChannel.channelId === channelId &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible";
  if (onScreen) {
    // Read as it lands — move the bookmark so other devices agree.
    markChannelRead(groupId, channelId);
    return;
  }
  const mentionsMe =
    Boolean(selfId) &&
    (Boolean(message.mentions?.includes(selfId!)) || message.replyTo?.userId === selfId);
  if (detail) {
    patchDetail(groupId, {
      channels: detail.channels.map((c) =>
        c.id === channelId ? { ...c, unread: true, mentions: c.mentions + (mentionsMe ? 1 : 0) } : c
      ),
    });
    syncSummaryFromDetail(groupId);
  } else if (state.groups) {
    // A group whose rooms were never opened: only its dot on the rail.
    setState({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, unread: true, mentions: g.mentions + (mentionsMe ? 1 : 0) } : g
      ),
    });
  }
}

// ─── Socket ──────────────────────────────────────────────────────────────

type MessageListener = (message: GroupMessage, author: GroupUser | null) => void;
type DeleteListener = (event: { groupId: string; channelId: string; messageId: string }) => void;
type RemovedListener = (event: { groupId: string; reason: string }) => void;

const messageListeners = new Set<MessageListener>();
const deleteListeners = new Set<DeleteListener>();
const removedListeners = new Set<RemovedListener>();

/** Every live group message, for the text room on screen to append. */
export function onGroupMessage(listener: MessageListener): () => void {
  ensureSocketListener();
  messageListeners.add(listener);
  return () => {
    messageListeners.delete(listener);
  };
}

export function onGroupMessageDeleted(listener: DeleteListener): () => void {
  ensureSocketListener();
  deleteListeners.add(listener);
  return () => {
    deleteListeners.delete(listener);
  };
}

/** A group this person was just taken out of (left, kicked, banned, deleted). */
export function onGroupRemoved(listener: RemovedListener): () => void {
  ensureSocketListener();
  removedListeners.add(listener);
  return () => {
    removedListeners.delete(listener);
  };
}

/** Called after a successful leave, so the page reacts before the socket echo arrives. */
export function forgetGroup(groupId: string): void {
  const details = { ...state.details };
  delete details[groupId];
  setState({ groups: state.groups?.filter((g) => g.id !== groupId) ?? null, details });
}

let socketListenerInstalled = false;

function ensureSocketListener() {
  if (socketListenerInstalled || typeof window === "undefined") return;
  socketListenerInstalled = true;
  signalingClient.onGroupEvent(handleEvent);
}

function handleEvent(event: GroupSocketEvent) {
  const groupId = typeof event.groupId === "string" ? event.groupId : null;
  switch (event.type) {
    case "group-resync": {
      if (state.groups !== null) void refreshGroups();
      for (const id of Object.keys(state.details)) void refreshGroup(id);
      return;
    }
    case "group-message": {
      const message = event.message as GroupMessage | undefined;
      if (!message) return;
      noteIncomingMessage(message);
      const author = (event.author as GroupUser | undefined) ?? null;
      // Kept current for a room that is not on screen, so reopening it is
      // instant and already has this (see lib/groupCache).
      appendCachedMessage(message, author);
      messageListeners.forEach((l) => l(message, author));
      return;
    }
    case "group-message-deleted": {
      if (!groupId || typeof event.channelId !== "string" || typeof event.messageId !== "string") return;
      const payload = { groupId, channelId: event.channelId, messageId: event.messageId };
      removeCachedMessage(event.channelId, event.messageId);
      deleteListeners.forEach((l) => l(payload));
      return;
    }
    case "group-read": {
      if (groupId && typeof event.channelId === "string") clearUnread(groupId, event.channelId, false);
      return;
    }
    case "group-voice": {
      if (!groupId) return;
      patchDetail(groupId, { voice: (event.voice as GroupVoiceMap | undefined) ?? {} });
      return;
    }
    case "group-updated": {
      if (!groupId) return;
      // Whether the list needs re-reading is not knowable from the nudge (a
      // group we just joined is not in it yet), and it is one cheap request.
      void refreshGroups();
      if (state.details[groupId]) void refreshGroup(groupId);
      return;
    }
    case "group-removed": {
      if (!groupId) return;
      forgetGroup(groupId);
      forgetGroupMembers(groupId);
      const reason = typeof event.reason === "string" ? event.reason : "removed";
      removedListeners.forEach((l) => l({ groupId, reason }));
      return;
    }
  }
}

// ─── Hooks ───────────────────────────────────────────────────────────────

export function useGroupsState(): GroupsState {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

/** The list of groups, read once on first use. */
export function useMyGroups(): { groups: GroupSummary[] | null; error: string | null } {
  const snapshot = useGroupsState();
  useEffect(() => {
    if (snapshot.groups === null) void refreshGroups();
  }, [snapshot.groups]);
  return { groups: snapshot.groups, error: snapshot.groupsError };
}

/** One group's details, read on first use and kept fresh by the socket. */
export function useGroupDetail(groupId: string | null): {
  detail: GroupDetail | null;
  error: { status: number; error: string } | null;
} {
  const snapshot = useGroupsState();
  const detail = groupId ? snapshot.details[groupId] ?? null : null;
  const error = groupId ? snapshot.detailErrors[groupId] ?? null : null;
  // Shown from memory at once when it was read before; re-read behind it when
  // that read is old — the socket keeps it current while connected, this covers
  // whatever a sleeping tab or a dropped connection missed.
  useEffect(() => {
    if (!groupId) return;
    const stale = Date.now() - (detailFetchedAt.get(groupId) ?? 0) > DETAIL_STALE_MS;
    if (!state.details[groupId] || stale) void refreshGroup(groupId);
  }, [groupId]);
  return { detail, error };
}
