"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";


// Whether Adsterra is reaching this browser at all.
//
// One answer for the whole page, not one per slot: an ad blocker is a
// property of the browser, so a banner that was refused is telling you what
// the native unit is about to find out too. Sharing the verdict is what lets
// the room put its own ad back the moment the first slot comes up empty,
// instead of every slot rediscovering it separately — and what keeps a page
// with several slots from holding several holes open.
//
// Deliberately *not* persisted, and that is the interesting decision here.
// Remembering it in sessionStorage would save a few milliseconds of empty box
// per page load, and would cost something much worse: a single failed request
// — a network blip, a slow DNS — would turn advertising off for the rest of
// the session with no way back, because a slot that has removed itself can
// never report that it would have filled after all. Re-asking on every page
// load is cheap, and it is the only version of this that recovers on its own.

let blocked = false;
const listeners = new Set<() => void>();

/**
 * What a slot found out. `filled` means a box with real size was drawn, never
 * merely that a script loaded — see fillProbeScript in adsterra.ts.
 *
 * An ad blocker is a property of the browser and marks blocked = true.
 * An empty unit (no ad inventory) is specific to that unit and does NOT
 * poison the global blocked state for the whole page.
 */
export function reportAdsterraFill(filled: boolean, reason?: "blocked" | "empty" | null): void {
  // If not filled, only mark globally blocked if reason is explicitly "blocked" (e.g. adblocker script refusal)
  if (!filled && reason !== "blocked") {
    return;
  }
  const nextBlocked = !filled;
  if (blocked === nextBlocked) return;
  blocked = nextBlocked;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  return blocked;
}

/**
 * Whether Adsterra has been found unreachable.
 *
 * False on the server and on the first client paint, which is the safe way
 * round: a slot renders, tries, and removes itself if it was refused. The
 * reverse — assuming blocked until proven otherwise — would mean never
 * loading the first ad that could have proven it.
 */
export function useAdsterraBlocked(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * Catches the failure the in-document probe cannot report: the document never
 * loading.
 *
 * Calls onTimeout when the frame fails to settle in time so the slot can
 * handle fallback locally without poisoning other slots.
 */
export function useAdFrameWatchdog(
  active: boolean,
  timeoutMs: number,
  onTimeout?: () => void
): () => void {
  const settledRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    settledRef.current = false;
    const timer = setTimeout(() => {
      if (!settledRef.current) {
        onTimeout?.();
      }
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [active, timeoutMs, onTimeout]);

  return useCallback(() => {
    settledRef.current = true;
  }, []);
}
