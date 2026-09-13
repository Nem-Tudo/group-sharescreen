"use client";

import { useSyncExternalStore } from "react";
import { signalingClient, type DmSocketEvent } from "./signalingClient";
import { fetchDmSettings, saveDmSettings, type DmReaction } from "./dmApi";
import { TYPING_REFRESH_MS } from "./typing";

// What a conversation knows *now* and the database does not hold as a page:
// who is writing to this account, how far each person has read, the newest
// reactions on messages already on screen, and this account's own "visto"
// switch.
//
// One store for the page rather than state inside the dialog, because more
// than the dialog draws it — the group header's recent conversations show
// "digitando" too (see components/DmRecentStrip) — and because the socket
// events behind it arrive whether or not anything is open to receive them.
// A "digitando" that started while the window was closed has to still be
// there when it opens.

/**
 * How long somebody stays "digitando" with nothing more heard from them. A
 * writer re-announces every TYPING_REFRESH_MS, so this only runs out when the
 * "stopped" was lost: a closed tab, a dropped connection. The group rooms' rule.
 */
export const DM_TYPING_EXPIRE_MS = TYPING_REFRESH_MS + 3000;

/** Reactions heard live, kept for this many messages at most. */
const MAX_REACTION_UPDATES = 400;

export type DmReactionUpdate = {
  reactions: DmReaction[];
  /** When this tab heard it — compared with when a page was read (see dmThread's reactionsFor). */
  at: number;
};

export type DmLiveState = {
  /** Account ids writing to this account right now. */
  typing: Readonly<Record<string, true>>;
  /** How far each account has read its conversation with this one, heard live. */
  seen: Readonly<Record<string, number>>;
  /** The newest reactions per message id, heard live or set by this tab. */
  reactions: Readonly<Record<string, DmReactionUpdate>>;
  /** This account's "visto" switch; null until read. Tagged with whose it is. */
  readReceipts: { accountId: string; value: boolean } | null;
};

let state: DmLiveState = { typing: {}, seen: {}, reactions: {}, readReceipts: null };
const listeners = new Set<() => void>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let wired = false;
let settingsInFlight: string | null = null;

function set(next: Partial<DmLiveState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function stopTyping(userId: string) {
  const timer = typingTimers.get(userId);
  if (timer) clearTimeout(timer);
  typingTimers.delete(userId);
  if (!(userId in state.typing)) return;
  const typing = { ...state.typing };
  delete typing[userId];
  set({ typing });
}

function startTyping(userId: string) {
  const existing = typingTimers.get(userId);
  if (existing) clearTimeout(existing);
  typingTimers.set(
    userId,
    setTimeout(() => stopTyping(userId), DM_TYPING_EXPIRE_MS)
  );
  if (state.typing[userId]) return;
  set({ typing: { ...state.typing, [userId]: true } });
}

/** Records reactions for one message, dropping the oldest records past the cap. */
export function noteDmReactions(messageId: string, reactions: DmReaction[]): void {
  const next: Record<string, DmReactionUpdate> = { ...state.reactions };
  delete next[messageId];
  next[messageId] = { reactions, at: Date.now() };
  const ids = Object.keys(next);
  for (let i = 0; i < ids.length - MAX_REACTION_UPDATES; i += 1) delete next[ids[i]];
  set({ reactions: next });
}

function handle(event: DmSocketEvent) {
  switch (event.type) {
    case "dm": {
      // What they were writing just arrived: the line goes with it.
      const message = event.message as { from?: unknown } | undefined;
      if (typeof message?.from === "string") stopTyping(message.from);
      return;
    }
    case "dm-typing": {
      if (typeof event.from !== "string") return;
      if (event.typing === false) stopTyping(event.from);
      else startTyping(event.from);
      return;
    }
    case "dm-seen": {
      if (typeof event.by !== "string" || typeof event.ts !== "number") return;
      if ((state.seen[event.by] ?? 0) >= event.ts) return;
      set({ seen: { ...state.seen, [event.by]: event.ts } });
      return;
    }
    case "dm-reactions": {
      if (typeof event.messageId !== "string" || !Array.isArray(event.reactions)) return;
      noteDmReactions(event.messageId, event.reactions as DmReaction[]);
      return;
    }
    case "dm-settings": {
      if (typeof event.readReceipts !== "boolean" || !state.readReceipts) return;
      set({ readReceipts: { ...state.readReceipts, value: event.readReceipts } });
      return;
    }
  }
}

function subscribe(onChange: () => void) {
  if (!wired) {
    // For the life of the page: the events are cheap, and a subscription torn
    // down with the last screen would miss a "digitando" that starts before
    // the next one opens.
    wired = true;
    signalingClient.onDmEvent(handle);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const SERVER_STATE: DmLiveState = { typing: {}, seen: {}, reactions: {}, readReceipts: null };

export function useDmLive(): DmLiveState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

/** Whether `userId` is writing to this account right now. */
export function useDmTyping(userId: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? Boolean(state.typing[userId]) : false),
    () => false
  );
}

/** Reads this account's switch once per account; later changes arrive as "dm-settings". */
export function loadDmSettings(accountId: string): void {
  if (state.readReceipts?.accountId === accountId || settingsInFlight === accountId) return;
  settingsInFlight = accountId;
  void fetchDmSettings().then((settings) => {
    if (settingsInFlight === accountId) settingsInFlight = null;
    // Unknown stays unknown on a failure, so the next open asks again.
    if (settings) set({ readReceipts: { accountId, value: settings.readReceipts } });
  });
}

/** Flips the switch at once, and back if the server refuses. Resolves whether it held. */
export async function setDmReadReceipts(accountId: string, value: boolean): Promise<boolean> {
  const before = state.readReceipts;
  set({ readReceipts: { accountId, value } });
  const saved = await saveDmSettings({ readReceipts: value });
  if (saved) {
    set({ readReceipts: { accountId, value: saved.readReceipts } });
    return true;
  }
  set({ readReceipts: before });
  return false;
}
