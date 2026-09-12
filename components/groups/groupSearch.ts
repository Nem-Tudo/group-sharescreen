"use client";

import { useSyncExternalStore } from "react";

// What is being searched for on /groups, and how a group's name is matched
// against it. Shared rather than kept in the page, because the dock on the
// left can hand its own search over to the page ("search public groups too")
// — including while the page is already the one on screen.

let query = "";
const listeners = new Set<() => void>();

export function setGroupsHomeQuery(next: string): void {
  if (next === query) return;
  query = next;
  listeners.forEach((l) => l());
}

export function useGroupsHomeQuery(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => query,
    () => ""
  );
}

/** Lower case and without accents, so "fisica" finds "Física" — the API folds the same way. */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** The words of a query, folded. Empty for a blank one. */
export function searchWords(text: string): string[] {
  return foldForSearch(text).split(/\s+/).filter(Boolean);
}

/** Whether a name holds every word, in any order. */
export function nameMatches(name: string, words: readonly string[]): boolean {
  const folded = foldForSearch(name);
  return words.every((w) => folded.includes(w));
}
