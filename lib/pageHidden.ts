"use client";

import { useSyncExternalStore } from "react";
import { getDesktopBridge } from "./desktop";

// Whether nobody can see this page at all — the tab in the background, the
// phone browser backgrounded, or the desktop app's window minimised or closed
// to the tray.
//
// The last one is why this exists. The desktop shell runs with
// backgroundThrottling off (see electron/main.ts), and Electron ties the Page
// Visibility API to that same switch, so its `document.visibilityState` stays
// "visible" through a minimise. Everything that paused itself on
// `document.hidden` to save a minimised window's CPU — the speaking pump, the
// video tiles, the polls — therefore never paused there, which is exactly the
// case it was written for. The shell says so over IPC instead (see
// DesktopBridge.onWindowBackground); this puts the two answers together.
//
// For work that is only worth doing while somebody is looking. Not for
// anything the app has to keep doing in the background — audio, the global
// shortcuts, the connection itself — and not for "is this the window in use",
// which is lib/pageFocus.

let shellBackground = false;
let hidden = false;
let wired = false;
const listeners = new Set<() => void>();

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function recompute() {
  const next = shellBackground || documentHidden();
  if (next === hidden) return;
  hidden = next;
  listeners.forEach((l) => l());
}

function wire() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  hidden = documentHidden();
  document.addEventListener("visibilitychange", recompute);
  // For the life of the page, like the document's own event: the shell pushes
  // every change, and one missed while nothing was subscribed would leave the
  // answer wrong for whoever subscribes next.
  getDesktopBridge()?.onWindowBackground?.((background) => {
    shellBackground = background;
    recompute();
  });
}

/** Whether the page is out of sight right now. */
export function isPageHidden(): boolean {
  wire();
  return hidden;
}

/** Calls `listener` whenever isPageHidden changes. Returns the unsubscribe. */
export function onPageHiddenChange(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** isPageHidden as React state, for a component that should rest while unseen. */
export function usePageHidden(): boolean {
  return useSyncExternalStore(onPageHiddenChange, isPageHidden, () => false);
}
