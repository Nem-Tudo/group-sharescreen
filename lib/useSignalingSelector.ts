"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { signalingClient, type SignalingState } from "./signalingClient";

/**
 * Subscribe to a slice of the signaling state instead of all sixty-odd
 * fields.
 *
 * useSignaling hands every subscriber the whole snapshot, so a chat message
 * wakes the incoming-call host, the gift notifier, the presence map and the
 * watch room alike — each of which reads one or two fields and had no reason
 * to hear about it. This narrows that to the components whose own slice
 * actually moved.
 *
 * The trap this has to avoid: useSyncExternalStore calls getSnapshot during
 * render and again when it checks for consistency, so a selector returning a
 * fresh object every call would look like a store that never stops changing,
 * and React would loop. The cache below is keyed on the identity of the
 * store's state object, which is a sound key precisely because setState
 * replaces that object on every change and never mutates it in place.
 *
 * `selector` must be referentially stable — a module-level const (see
 * lib/signalingSelectors) or a useCallback. An inline arrow rebuilds the
 * cache every render and re-subscribes, which is worse than not using this
 * at all.
 *
 * `isEqual` is what lets a selector return a fresh array or object without
 * forcing a render: when it says nothing changed we hand back the *previous*
 * reference, and React's own bail-out does the rest.
 */
export function useSignalingSelector<T>(
  selector: (state: SignalingState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  // The cache lives in a ref rather than in variables closed over by a
  // useMemo: the closure has to *write* what it last returned, and locals
  // captured that way are exactly what React's rules forbid mutating once a
  // render is over. A ref is the container sanctioned for it, and the reads
  // and writes all happen inside getSnapshot, never in the render body.
  const cache = useRef<{ state: SignalingState | null; value: T; primed: boolean }>({
    state: null,
    value: undefined as T,
    primed: false,
  });

  const getSnapshot = useCallback(() => {
    const held = cache.current;
    const state = signalingClient.getSnapshot();
    // Several reads in one render pass all see the same store state.
    if (held.primed && held.state === state) return held.value;
    const next = selector(state);
    held.state = state;
    if (held.primed && isEqual(held.value, next)) return held.value;
    held.primed = true;
    held.value = next;
    return next;
  }, [selector, isEqual]);

  // The same function for the server snapshot, which is what useSignaling
  // already does — so hydration behaves exactly as it did.
  return useSyncExternalStore(signalingClient.subscribe, getSnapshot, getSnapshot);
}

/**
 * Field-by-field comparison, for selectors that gather a few values into a
 * fresh object. Pair it with any selector that does not return a single
 * field straight out of the state.
 */
export function shallow<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}
