"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_NOTIFY_PREFS,
  fetchNotifyPrefs,
  saveNotifyPrefs as putNotifyPrefs,
  setNotifyMute,
  type NotifyKind,
  type NotifyPrefs,
} from "./pushApi";

// What this account has silenced, as one copy shared by everything that asks.
//
// A module-level store rather than a hook's own state, because two very
// different screens read the same answer: the settings page, and the little
// mute button inside a conversation. Two copies would mean silencing a
// conversation from the header and having the settings page still list it as
// loud until a reload.
//
// Server-side, unlike the global mute next door in lib/notifications.ts, and
// the split is deliberate: "não me avise sobre esta conversa" is a fact about
// a person and should follow them to a new phone, while "fique quieto neste
// navegador" is a fact about a browser and has no business following anybody
// anywhere.

let prefs: NotifyPrefs = DEFAULT_NOTIFY_PREFS;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function set(next: NotifyPrefs | null) {
  if (!next) return;
  prefs = next;
  loaded = true;
  emit();
}

/** Reads them once per page. Safe to call from every mount. */
export function ensureNotifyPrefs(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = fetchNotifyPrefs()
    .then((next) => {
      // A failed read leaves the defaults *and* marks them loaded: a settings
      // screen that spins forever because the API had a bad second is worse
      // than one showing everything on, which is what a fresh account sees
      // anyway.
      set(next ?? DEFAULT_NOTIFY_PREFS);
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Forgets what was read — for signing out, so the next account starts clean. */
export function resetNotifyPrefs(): void {
  prefs = DEFAULT_NOTIFY_PREFS;
  loaded = false;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface UseNotifyPrefs {
  prefs: NotifyPrefs;
  /** False until the first read comes back. */
  ready: boolean;
  /** Turns one kind of notification off, or back on. */
  setKindMuted: (kind: NotifyKind, muted: boolean) => Promise<void>;
  /** Silences one conversation, by the other person's id. */
  setDmMuted: (userId: string, muted: boolean) => Promise<void>;
  /** Silences one group whole. */
  setGroupMuted: (groupId: string, muted: boolean) => Promise<void>;
  /** The quiet window, in minutes from local midnight. Null for "off". */
  setQuietHours: (from: number | null, to: number | null) => Promise<void>;
  setQuietAllowCalls: (allow: boolean) => Promise<void>;
}

export function useNotifyPrefs(): UseNotifyPrefs {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => prefs,
    () => DEFAULT_NOTIFY_PREFS
  );
  const ready = useSyncExternalStore(
    subscribe,
    () => loaded,
    () => false
  );

  useEffect(() => {
    void ensureNotifyPrefs();
  }, []);

  const setKindMuted = useCallback(async (kind: NotifyKind, muted: boolean) => {
    set(await setNotifyMute("kind", kind, muted));
  }, []);
  const setDmMuted = useCallback(async (userId: string, muted: boolean) => {
    set(await setNotifyMute("dm", userId, muted));
  }, []);
  const setGroupMuted = useCallback(async (groupId: string, muted: boolean) => {
    set(await setNotifyMute("group", groupId, muted));
  }, []);

  const setQuietHours = useCallback(async (from: number | null, to: number | null) => {
    // The offset rides along with the window every time it is written, and it
    // is the browser's *current* one: the server cannot know what time it is
    // where somebody is, and a person who moves country (or whose clock goes
    // forward) should have their quiet hours follow them rather than drift.
    const quietOffset = from === null ? null : -new Date().getTimezoneOffset();
    set(await putNotifyPrefs({ quietFrom: from, quietTo: to, quietOffset }));
  }, []);

  const setQuietAllowCalls = useCallback(async (allow: boolean) => {
    set(await putNotifyPrefs({ quietAllowCalls: allow }));
  }, []);

  return {
    prefs: snapshot,
    ready,
    setKindMuted,
    setDmMuted,
    setGroupMuted,
    setQuietHours,
    setQuietAllowCalls,
  };
}

/** Whether one conversation is silenced, without subscribing to everything. */
export function isDmMuted(userId: string): boolean {
  return prefs.mutedDms.includes(userId);
}

// ─── Reading and writing a quiet window as "HH:MM" ────────────────────────

/** "23:00" → 1380. Null for anything that is not a time. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 1380 → "23:00", which is also what an `<input type="time">` wants. */
export function formatTimeOfDay(minutes: number | null): string {
  if (minutes === null) return "";
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
