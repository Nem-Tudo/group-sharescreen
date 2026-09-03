"use client";

import { useSyncExternalStore } from "react";

// The bell's contents: things that happened while you were not looking.
//
// Kept per browser in localStorage rather than on the server, and that is a
// deliberate limit worth stating: this is a *read receipt*, not an inbox. The
// facts themselves already live server-side — a friend request is a row in the
// friendships collection — so nothing is lost when this is cleared, and two
// devices tracking "seen" separately is the honest behaviour for something
// whose only job is to stop nagging you about what you already read.
//
// Dedup is by `id`, and every producer builds one that names the *thing*
// rather than the moment ("friend-request:<userId>"). Adding the same
// notification twice is therefore free, which is what lets the producer be a
// dumb "here is everything pending" sweep instead of a diff — see
// components/SocialNotifier.tsx.

const STORAGE_KEY = "sharescreen:notifications";
/** Beyond this the oldest are dropped. A bell is not an archive. */
const MAX_ITEMS = 50;

export type NotificationKind = "friend-request" | "friend-accepted";

export interface InboxNotification {
  /** Names the thing, not the moment — see the header on dedup. */
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Where clicking it goes. */
  href?: string;
  ts: number;
  read: boolean;
}

let items: InboxNotification[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) items = parsed as InboxNotification[];
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignored - localStorage may be unavailable (private mode, quota, etc.)
  }
}

/**
 * Adds one, or does nothing if it is already there.
 *
 * Returns whether it was new, which is the signal the caller needs: the sound
 * and the system notification belong to an *arrival*, and firing them on every
 * sweep would mean a chime every time the page re-read the friend list.
 */
export function pushNotification(
  notification: Omit<InboxNotification, "read" | "ts"> & { ts?: number }
): boolean {
  hydrate();
  if (items.some((item) => item.id === notification.id)) return false;
  items = [
    { ...notification, ts: notification.ts ?? Date.now(), read: false },
    ...items,
  ].slice(0, MAX_ITEMS);
  persist();
  emit();
  return true;
}

/** Drops one by id — for something that stopped being true. */
export function dismissNotification(id: string): void {
  hydrate();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return;
  items = next;
  persist();
  emit();
}

export function markAllRead(): void {
  hydrate();
  if (!items.some((item) => !item.read)) return;
  items = items.map((item) => ({ ...item, read: true }));
  persist();
  emit();
}

export function clearNotifications(): void {
  hydrate();
  if (items.length === 0) return;
  items = [];
  persist();
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): InboxNotification[] {
  hydrate();
  return items;
}

// A stable empty array for the server snapshot: returning a fresh `[]` would
// be a new reference on every render, which useSyncExternalStore treats as a
// changed store and turns into an infinite loop.
const SERVER_SNAPSHOT: InboxNotification[] = [];

export function useNotificationInbox(): InboxNotification[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
