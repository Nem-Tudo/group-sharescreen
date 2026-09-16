"use client";

import { isAppShell } from "@/lib/desktop";

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

const STORAGE_KEY = "golive:lastScreen";
const SESSION_KEY = "golive:lastScreenRestored";

// Addresses that join something, or only exist to hand a result over and move
// on (a login callback, a claim link), and so must not be the first thing a
// launch opens.
const NEVER_RESTORE = [
  "/watch/",
  "/stream/",
  "/obs/",
  "/oauth",
  "/oauth2",
  "/desktop/",
  "/invite/",
  "/gift/",
  "/ads",
  "/ad/",
  "/download",
];

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
 * The screen to open on this launch, if any. Only on the first page load of
 * the app's session and only when it opened on the home page — a deep link,
 * a notification or the post-update resume (electron/main.ts) opens a
 * specific address and wins; a reload of the home page stays there.
 */
export function takeScreenToRestore(): string | null {
  if (!isAppShell()) return null;
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return null;
    sessionStorage.setItem(SESSION_KEY, "1");
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) return null;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved || saved === "/" || !isRestorable(saved)) return null;
    return saved;
  } catch {
    return null;
  }
}
