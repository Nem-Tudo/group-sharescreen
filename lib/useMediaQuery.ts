"use client";

import { useCallback, useSyncExternalStore } from "react";

type MediaStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
};

// One MediaQueryList per query, shared by every component asking for it —
// the alternative (a list per hook call) means N native listeners for what is
// always the same answer.
const stores = new Map<string, MediaStore>();

function getStore(query: string): MediaStore {
  const existing = stores.get(query);
  if (existing) return existing;
  const list = window.matchMedia(query);
  const store: MediaStore = {
    subscribe(onChange) {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    getSnapshot: () => list.matches,
  };
  stores.set(query, store);
  return store;
}

// Reads a CSS media query from JS, for the handful of places where a
// breakpoint changes *which component renders* rather than just how it looks
// — see WatchRoom's "Mais opções", a Tippy popover on desktop and a bottom
// sheet on a phone. Anything expressible as a `sm:` class should stay a
// `sm:` class instead of coming through here.
//
// Reports false during SSR and the first client paint (no matchMedia on the
// server), so callers should treat the mobile branch as the safe default.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => getStore(query).subscribe(onChange),
    [query]
  );
  const getSnapshot = useCallback(() => getStore(query).getSnapshot(), [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// Tailwind's `sm` breakpoint — the width every "phone layout vs. desktop
// layout" split in this app is already keyed to.
export const SM_BREAKPOINT_QUERY = "(min-width: 40rem)";

// Tailwind's `lg` breakpoint — the wider split WatchRoom's participants/chat
// columns use (see the `lg:` classes there). Needed as a JS boolean, not
// just `lg:` classes, wherever a breakpoint changes *which* JSX mounts
// rather than just how it looks — e.g. the same interactive control row
// living in the header on a phone vs. a bottom bar on desktop. Rendering
// both and hiding one with CSS would still mount the hidden copy's hooks
// (device pickers, ChatPanel's own state) twice for nothing.
export const LG_BREAKPOINT_QUERY = "(min-width: 64rem)";

// "This machine has a mouse." Not a width: a desktop browser at half the
// screen is still a desktop, and a tablet held in landscape is still touch.
// Used to decide between a native <select> and a custom listbox — the native
// one opens the OS picker on a phone, which is genuinely better there and is
// the reason the custom one is not simply used everywhere.
export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
