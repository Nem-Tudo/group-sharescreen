"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/** A React mouse event or the browser's own — the document-level fallback passes the latter. */
type PointerLike = {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

// The right button, everywhere: one menu for the whole page, opened at the
// pointer with whatever the thing under it can do.
//
// Declared rather than drawn by each caller — a room, a category, a message,
// a conversation hands over a list of entries and components/ContextMenuHost
// draws it — so every menu on the site looks, closes and is keyboard-driven
// the same way, and nobody re-implements placing a panel at the pointer.
//
// Menus with state of their own (the group member menu, with its confirmations
// and its volume slider) keep their own host; the "custom" entry is for the
// small cases in between, like a row of quick reactions.

export type ContextMenuItem = {
  type?: "item";
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Red, for what removes or cannot be undone. */
  danger?: boolean;
  disabled?: boolean;
  /** A tick on the right: the entry is a setting that is on. */
  checked?: boolean;
  /** Small text on the right — a shortcut, usually. */
  hint?: string;
  /** Leaves the menu open after it runs (a toggle somebody may flip twice). */
  keepOpen?: boolean;
};

export type ContextMenuEntry =
  | ContextMenuItem
  | { type: "divider" }
  | { type: "label"; label: string }
  | { type: "custom"; render: (close: () => void) => ReactNode };

/** What callers pass: falsy entries are skipped, so conditions read inline. */
export type ContextMenuEntries = (ContextMenuEntry | false | null | undefined | "" | 0)[];

export interface ContextMenuState {
  x: number;
  y: number;
  title?: ReactNode;
  entries: ContextMenuEntry[];
  /** New for every opening, so a menu reopened in place starts fresh. */
  seq: number;
}

let state: ContextMenuState | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Dividers only where they divide: none first, none last, never two in a row
 * — which is what conditional entries would otherwise leave behind.
 */
export function tidyEntries(entries: ContextMenuEntries): ContextMenuEntry[] {
  const out: ContextMenuEntry[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.type === "divider" && (out.length === 0 || out[out.length - 1].type === "divider")) continue;
    out.push(entry);
  }
  while (out.length > 0 && out[out.length - 1].type === "divider") out.pop();
  return out;
}

/**
 * Whether the browser's own menu is the better one here: in a text field,
 * where it has cut and paste, or over a selection somebody made to copy.
 */
export function wantsNativeMenu(event: PointerLike): boolean {
  const target = event.target as Element | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return true;
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

/**
 * Opens the menu at the pointer. Does nothing — and lets the browser's own
 * menu open — when there is nothing to offer, or when the browser's is the
 * better one (see wantsNativeMenu).
 */
export function openContextMenu(
  event: PointerLike,
  menu: { title?: ReactNode; entries: ContextMenuEntries },
  /** Skips the wantsNativeMenu check — for the menu that stands in for the browser's (see ContextMenuHost). */
  force = false
): void {
  if (!force && wantsNativeMenu(event)) return;
  const entries = tidyEntries(menu.entries);
  if (!entries.some((e) => e.type !== "divider" && e.type !== "label")) return;
  event.preventDefault();
  event.stopPropagation();
  seq += 1;
  state = { x: event.clientX, y: event.clientY, title: menu.title, entries, seq };
  notify();
}

export function closeContextMenu(): void {
  if (!state) return;
  state = null;
  notify();
}

export function useContextMenu(): ContextMenuState | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => state,
    () => null
  );
}
