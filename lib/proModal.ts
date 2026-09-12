"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";

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
};

let state: ModalState = { open: false, planId: null };
const listeners = new Set<() => void>();

function set(next: ModalState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Opens the GoLive Pro modal, on `planId` when one is named. */
export function openProModal(planId?: string | null): void {
  set({ open: true, planId: planId ?? null });
}

/** Closes the GoLive Pro modal. */
export function closeProModal(): void {
  if (!state.open) return;
  set({ open: false, planId: null });
}

const SERVER_STATE: ModalState = { open: false, planId: null };

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
export function useOpenPro(): (planId?: string | null) => void {
  const pathname = usePathname();
  const router = useRouter();
  return (planId?: string | null) => {
    if (pathname?.startsWith("/watch/")) {
      openProModal(planId);
      return;
    }
    // The page reads the same thing off the query string (see ProPanel), so a
    // plan named here survives whichever of the two answers this gives.
    router.push(planId ? `/pro?plan=${encodeURIComponent(planId)}` : "/pro");
  };
}
