"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { AD_FILL_TIMEOUT_MS } from "@/lib/adsterra";

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
 * merely that a script loaded — see fillProbeScript in adsterra.ts, and note
 * that a blocker answering with an empty stub produces a perfectly successful
 * load with nothing behind it.
 *
 * The last verdict wins rather than latching: one unlucky empty response
 * should not be final, and a slot that fills after another was refused is
 * the more recent truth.
 */
export function reportAdsterraFill(filled: boolean): void {
  if (blocked === !filled) return;
  blocked = !filled;
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
 * How long the page waits for a frame to say anything at all.
 *
 * The probe inside the document answers within AD_FILL_TIMEOUT_MS of running;
 * this is that plus room for the document itself to be fetched and parsed.
 */
const AD_FRAME_TIMEOUT_MS = AD_FILL_TIMEOUT_MS + 2000;

/**
 * Catches the failure the in-document probe cannot report: the document never
 * loading.
 *
 * A blocked script still runs our probe, which is what says "nothing filled".
 * A blocked *frame* runs nothing — the slot would sit there empty forever, and
 * in the room it would keep taking its turn from the partner every other
 * minute. So the page keeps its own clock: no word by the deadline is the
 * same answer as an empty one.
 *
 * Returns the callback a slot calls when a real verdict arrives, which is
 * what stops this from overruling it.
 */
export function useAdFrameWatchdog(active: boolean): () => void {
  const settledRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    settledRef.current = false;
    const timer = setTimeout(() => {
      if (!settledRef.current) reportAdsterraFill(false);
    }, AD_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [active]);

  return useCallback(() => {
    settledRef.current = true;
  }, []);
}
