"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { noteProSource, proHref, type ProSource } from "@/lib/proSourceAttribution";
import { sellsHere } from "@/lib/storePolicy";

// Whether the Pro subscription modal is open, managed as a single global store
// so any trigger in the app (room header, quality picker, user profile, etc.)
// can open the modal without prop drilling.

type ModalState = {
  open: boolean;
  /**
   * Which plan to open on, when the thing that opened it knows.
   *
   * A lock that says "Disponível no Pro Max" and then opens on the Pro card is
   * the same confusion the header's own Pro row was fixed for: the reader has
   * to find the picker to see the thing they just clicked about.
   */
  planId: string | null;
  /** The door it was opened from, for the panel's context card (pro-door-context). */
  source: ProSource | null;
};

let state: ModalState = { open: false, planId: null, source: null };
const listeners = new Set<() => void>();

function set(next: ModalState) {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Opens the GoLive Pro modal, on `planId` when one is named. `source` is the
 * door it was opened from, which the sale is credited to (see
 * lib/proSourceAttribution) — required, so no new door goes uncounted.
 */
export function openProModal(source: ProSource, planId?: string | null): void {
  noteProSource(source);
  set({ open: true, planId: planId ?? null, source });
}

/** Closes the GoLive Pro modal. */
export function closeProModal(): void {
  if (!state.open) return;
  set({ open: false, planId: null, source: null });
}

const SERVER_STATE: ModalState = { open: false, planId: null, source: null };

export function useProModal(): ModalState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    () => state,
    () => SERVER_STATE
  );
}

/**
 * Opens Pro the right way for where the caller is.
 *
 * The modal exists for one situation: inside a room, where following a link
 * would tear down the call to read a price. Everywhere else the page is the
 * better answer — it has a URL somebody can share or come back to, a back
 * button, and room to breathe — and a modal there was the site denying all
 * three for no reason.
 *
 * The room is the only place with that constraint, so the room is the only
 * place that gets the modal.
 */
export function useOpenPro(): (source: ProSource, planId?: string | null) => void {
  const pathname = usePathname();
  const router = useRouter();
  return (source: ProSource, planId?: string | null) => {
    // The iOS app has no /pro to go to (lib/storePolicy.ts): the modal there
    // is a plain "this is part of Pro", wherever it was asked for.
    if (pathname?.startsWith("/watch/") || !sellsHere()) {
      openProModal(source, planId);
      return;
    }
    // The page reads the same things off the query string (see ProPanel), so
    // the plan and the door survive whichever of the two answers this gives.
    router.push(proHref(source, planId));
  };
}
