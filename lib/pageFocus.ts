"use client";

import { useSyncExternalStore } from "react";

// Whether somebody is actually looking at this page: the tab visible *and* its
// window the one in front. Visible alone is not it — a window left open behind
// another app, or beside it on a second screen, is "visible" the whole time
// nobody is reading it — and that is precisely when a message arriving in an
// open chat has to notify, and must not be marked read.

export function isPageInFront(): boolean {
  if (typeof document === "undefined") return false;
  const visible = document.visibilityState === "visible";
  const focused = typeof document.hasFocus === "function" ? document.hasFocus() : visible;
  return visible && focused;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

/** isPageInFront, kept current — for effects that should wait until somebody is back. */
export function usePageInFront(): boolean {
  return useSyncExternalStore(subscribe, isPageInFront, () => false);
}
