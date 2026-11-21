"use client";

import { useSyncExternalStore } from "react";

// Which folders of the list of groups are open, on this browser (experiment
// group-organize). Per browser, like the rail's "keep open": a folder open on
// the desktop and closed on the phone is two screens of different sizes making
// their own choice, not something to sync.

const KEY = "golive:groups:openFolders";
const listeners = new Set<() => void>();
let cache: ReadonlySet<string> | null = null;
const EMPTY: ReadonlySet<string> = new Set();

function read(): ReadonlySet<string> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    cache = new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function write(next: ReadonlySet<string>) {
  cache = next;
  try {
    // Bounded: a folder deleted elsewhere leaves its id behind here.
    window.localStorage.setItem(KEY, JSON.stringify([...next].slice(-100)));
  } catch {
    // Storage refused: it still holds for this page.
  }
  listeners.forEach((l) => l());
}

export function setFolderOpen(folderId: string, open: boolean): void {
  const current = read();
  if (current.has(folderId) === open) return;
  const next = new Set(current);
  if (open) next.add(folderId);
  else next.delete(folderId);
  write(next);
}

export function useOpenFolders(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read,
    () => EMPTY
  );
}
