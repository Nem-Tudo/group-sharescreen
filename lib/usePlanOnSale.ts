"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchPremiumPlans } from "./premiumApi";

// Whether a plan can actually be bought right now — for the offers that point
// somebody at one (see components/ProOffer and RoomProOffer).
//
// It matters because a plan can exist and be off sale: Pro Ultra was seeded
// with `active: false` (see the API's premiumPlan.ts), and /premium/plans lists
// only what is on sale. An offer that links to a plan the page cannot show
// lands the person on the cheapest plan instead — which, for somebody on Pro
// Max being offered Pro Ultra, is Pro: a plan they already have.
//
// One fetch per tab, shared by every caller, and only started by a caller that
// asks — so the header does not load the plan list for everybody on every page
// just in case.

type State = { ids: ReadonlySet<string> | null; started: boolean };

let state: State = { ids: null, started: false };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load() {
  if (state.started) return;
  state = { ...state, started: true };
  void fetchPremiumPlans().then((plans) => {
    state = { ...state, ids: new Set(plans.map((plan) => plan.id)) };
    for (const listener of listeners) listener();
  });
}

const getIds = () => state.ids;
const getServerIds = () => null;

/**
 * True once `planId` is known to be on sale; false while unknown or when it is
 * not. Unknown reads as "no" on purpose: an offer that appears a moment late
 * is harmless, one that links to a page without the plan is not.
 *
 * `enabled` is what keeps the fetch from happening for somebody the answer
 * does not matter to.
 */
export function usePlanOnSale(planId: string, enabled: boolean): boolean {
  const ids = useSyncExternalStore(subscribe, getIds, getServerIds);
  useEffect(() => {
    if (enabled) load();
  }, [enabled]);
  return enabled && Boolean(ids?.has(planId));
}
