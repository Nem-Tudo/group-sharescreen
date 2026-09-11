"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which categories of each group's rooms list this browser has collapsed —
// kept in localStorage, one key for every group, so a category folded away
// stays folded across reloads (and in every tab, which hears about it through
// the "storage" event). Nothing of this is sent anywhere: how somebody tidies
// their own sidebar is theirs.

const STORAGE_KEY = "golive:group-collapsed-categories";
const EMPTY: string[] = [];

let cache: Record<string, string[]> | null = null;
const listeners = new Set<() => void>();

function read(): Record<string, string[]> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    cache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function write(next: Record<string, string[]>) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: collapsing still works for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The collapsed category ids of one group, and a way to flip one. */
export function useCollapsedCategories(groupId: string): {
  collapsed: string[];
  toggle: (categoryId: string) => void;
} {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => read()[groupId] ?? EMPTY,
    () => EMPTY
  );
  const toggle = useCallback(
    (categoryId: string) => {
      const all = read();
      const current = all[groupId] ?? [];
      const next = current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId];
      const copy = { ...all };
      if (next.length > 0) copy[groupId] = next;
      else delete copy[groupId];
      write(copy);
    },
    [groupId]
  );
  return { collapsed, toggle };
}
