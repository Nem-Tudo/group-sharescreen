"use client";

import { useSyncExternalStore } from "react";
import { signalingClient, type DmSocketEvent } from "./signalingClient";
import {
  fetchDmSettings,
  saveDmSettings,
  type DirectMessage,
  type DmAllowFrom,
  type DmCallInfo,
  type DmReaction,
} from "./dmApi";
import type { DmChange } from "./dmThread";
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
/** Edits and deletions heard live, the same. */
const MAX_CHANGES = 400;
/** Calls whose line changed while it was on screen. A conversation has few. */
const MAX_CALL_UPDATES = 100;

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
  /** Messages edited or deleted since they were read, by id — see dmThread's withChanges. */
  changes: Readonly<Record<string, DmChange>>;
  /**
   * How each call line stands now, by message id.
   *
   * A call's line changes while it is on screen — ringing, answered, over —
   * and the page it was read in says whatever it said when it was read (see
   * the API's callMessages). This is what the thread draws over it.
   */
  calls: Readonly<Record<string, DmCallInfo>>;
  /**
   * How many deletions have been heard. The conversation list re-reads on it:
   * a row whose newest line went needs the server to say what is newest now.
   */
  deletions: number;
  /** This account's "visto" switch; null until read. Tagged with whose it is. */
  readReceipts: { accountId: string; value: boolean } | null;
  /** Who may start a conversation with this account; null until read. */
  allowFrom: { accountId: string; value: DmAllowFrom } | null;
};

let state: DmLiveState = {
  typing: {},
  seen: {},
  reactions: {},
  changes: {},
  calls: {},
  deletions: 0,
  readReceipts: null,
  allowFrom: null,
};
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

/**
 * Records what became of one message — or, with null, forgets it (a change
 * this tab made at once and the server then refused). Oldest records go past
 * the cap.
 */
export function noteDmChange(messageId: string, change: DmChange | null): void {
  const next: Record<string, DmChange> = { ...state.changes };
  delete next[messageId];
  if (change) next[messageId] = change;
  const ids = Object.keys(next);
  for (let i = 0; i < ids.length - MAX_CHANGES; i += 1) delete next[ids[i]];
  set({ changes: next, ...(change?.deleted ? { deletions: state.deletions + 1 } : {}) });
}

/** How a call stands now — the server's word, for a line already on screen. */
export function noteDmCall(messageId: string, call: DmCallInfo): void {
  const next: Record<string, DmCallInfo> = { ...state.calls };
  delete next[messageId];
  next[messageId] = call;
  const ids = Object.keys(next);
  for (let i = 0; i < ids.length - MAX_CALL_UPDATES; i += 1) delete next[ids[i]];
  set({ calls: next });
}

/** An edit this tab made, drawn before the server answers — stamped now, or when the server said. */
export function noteDmEdit(messageId: string, text: string, editedAt?: number): void {
  noteDmChange(messageId, { text, editedAt: editedAt ?? Date.now() });
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
    case "dm-edited": {
      const message = event.message as Partial<DirectMessage> | undefined;
      if (typeof message?.id !== "string" || typeof message.text !== "string") return;
      if (typeof message.editedAt !== "number") return;
      // An older edit arriving late never undoes a newer one already heard.
      const held = state.changes[message.id];
      if (held && (held.deleted || held.editedAt > message.editedAt)) return;
      noteDmChange(message.id, { text: message.text, editedAt: message.editedAt });
      return;
    }
    case "dm-call": {
      const message = event.message as Partial<DirectMessage> | undefined;
      if (typeof message?.id !== "string" || !message.call) return;
      noteDmCall(message.id, message.call);
      return;
    }
    case "dm-deleted": {
      if (typeof event.messageId !== "string") return;
      noteDmChange(event.messageId, { deleted: true });
      return;
    }
    case "dm-settings": {
      // Either switch may be the one that moved, and the event carries both.
      if (typeof event.readReceipts === "boolean" && state.readReceipts) {
        set({ readReceipts: { ...state.readReceipts, value: event.readReceipts } });
      }
      if ((event.allowFrom === "everyone" || event.allowFrom === "friends") && state.allowFrom) {
        set({ allowFrom: { ...state.allowFrom, value: event.allowFrom } });
      }
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

const SERVER_STATE: DmLiveState = {
  typing: {},
  seen: {},
  reactions: {},
  changes: {},
  calls: {},
  deletions: 0,
  readReceipts: null,
  allowFrom: null,
};

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
    if (settings) {
      set({
        readReceipts: { accountId, value: settings.readReceipts },
        allowFrom: { accountId, value: settings.allowFrom },
      });
    }
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

/**
 * Sets who may start a conversation with this account, the same way: at once
 * on screen, and back if the server refuses.
 *
 * The switch is saved alongside "visto" because the API has one route for the
 * pair — so whatever "visto" is right now goes with it, and a request that
 * crossed with another device's change loses nothing it was not told about.
 */
export async function setDmAllowFrom(accountId: string, value: DmAllowFrom): Promise<boolean> {
  const before = state.allowFrom;
  set({ allowFrom: { accountId, value } });
  const saved = await saveDmSettings({
    readReceipts: state.readReceipts?.value ?? true,
    allowFrom: value,
  });
  if (saved) {
    set({ allowFrom: { accountId, value: saved.allowFrom } });
    return true;
  }
  set({ allowFrom: before });
  return false;
}
