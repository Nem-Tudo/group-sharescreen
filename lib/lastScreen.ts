"use client";

import { useSyncExternalStore } from "react";
import { isAppShell } from "@/lib/desktop";
import {
  LAST_SCREEN_SESSION_KEY,
  LAST_SCREEN_STORAGE_KEY,
  NEVER_RESTORE,
  REOPEN_LAST_SCREEN_KEY,
} from "@/lib/lastScreenInit";

// Reopening the app where it was closed — desktop and Android alike.
//
// Done here, on the site, rather than in electron/main.ts and the Capacitor
// shell: both load the same deployed site, so one rule in one place covers
// both and needs no new build of either app.
//
// The one thing it must never do is put somebody in a call. Several addresses
// *are* a call — opening them joins (a room under /watch, the streamer's
// dashboard under /stream, a group's voice room) — so those are never written
// down. A group voice room is remembered as its group's page instead (see
// rememberVoiceRoute), because the address alone does not say whether a room
// is a text or a voice one.

const STORAGE_KEY = LAST_SCREEN_STORAGE_KEY;
const SESSION_KEY = LAST_SCREEN_SESSION_KEY;
// This device's choice, set on /me. On unless turned off.
const ENABLED_KEY = REOPEN_LAST_SCREEN_KEY;

const enabledListeners = new Set<() => void>();

export function isReopenLastScreenEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setReopenLastScreenEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Storage refused: the choice lasts only for this page.
  }
  enabledListeners.forEach((listener) => listener());
}

function subscribeEnabled(listener: () => void): () => void {
  enabledListeners.add(listener);
  return () => enabledListeners.delete(listener);
}

export function useReopenLastScreen(): boolean {
  return useSyncExternalStore(subscribeEnabled, isReopenLastScreenEnabled, () => true);
}

/** Voice room address → the group page remembered in its place. */
const voiceFallbacks = new Map<string, string>();

function isRestorable(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  const pathname = path.split(/[?#]/)[0];
  if (voiceFallbacks.has(pathname)) return false;
  return !NEVER_RESTORE.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix));
}

function write(path: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Storage refused: the app simply opens on the home page, as it used to.
  }
}

/** Records the screen on show. Anything that would join a call is skipped. */
export function rememberScreen(path: string): void {
  if (!isAppShell()) return;
  const pathname = path.split(/[?#]/)[0];
  const fallback = voiceFallbacks.get(pathname);
  if (fallback) {
    write(fallback);
    return;
  }
  if (isRestorable(path)) write(path);
}

/**
 * Called by the group shell when the address on screen is a voice room: that
 * address is remembered as the group's page, so relaunching shows the group
 * without connecting to the room.
 */
export function rememberVoiceRoute(voicePath: string, groupPath: string): void {
  voiceFallbacks.set(voicePath, groupPath);
  if (isAppShell() && window.location.pathname === voicePath) write(groupPath);
}

/**
 * The screen to open on this launch, if any. Normally already taken by
 * LAST_SCREEN_INIT_SCRIPT before the home page painted, which marks the
 * session; this is the fallback for a shell whose bridge was not there yet
 * when that script ran. Only on the first page load of
 * the app's session and only when it opened on the home page — a deep link,
 * a notification or the post-update resume (electron/main.ts) opens a
 * specific address and wins; a reload of the home page stays there.
 */
export function takeScreenToRestore(): string | null {
  if (!isAppShell()) return null;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return null;
    sessionStorage.setItem(SESSION_KEY, "1");
    if (!isReopenLastScreenEnabled()) return null;
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) return null;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved || saved === "/" || !isRestorable(saved)) return null;
    return saved;
  } catch {
    return null;
  }
}
