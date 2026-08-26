"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

function getSnapshot() {
  return document.visibilityState === "visible";
}

function getServerSnapshot() {
  return true;
}

export function usePageVisibility(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
