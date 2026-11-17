"use client";

import { useEffect } from "react";
import type { FeatureTier } from "@/lib/entitlements";
import { trackFeatureEvent } from "@/lib/features";

// The unlock guide (experiment "plan-unlock-guide"): right after a plan lands
// — bought by Pix or card, or a present redeemed — a list of what it opened
// and where each thing lives, plus what the rungs above still add. See
// components/PlanUnlockGuide.
//
// Two ways it reaches somebody, and this file is what keeps them from both
// firing for the same plan:
//
//   - inline, inside the confirmation screen that is already on screen (the
//     Pix/card "pagamento confirmado", the present's "resgatado");
//   - as a popup of its own, from a watcher at the layout root, for every way
//     a plan arrives with no confirmation screen at all: the hosted checkout
//     in another tab, a present given by name, a trial started at Stripe.
//
// The watcher works off the last rung it saw this account on, kept per
// account in this browser. A rung above that one is news. While a
// confirmation screen is open it stands back — that screen will show the
// guide itself and move the record forward — so the account refreshing under
// an open Pix dialog does not stack a second guide on top of the first.

/** The feature's key in the admin panel. Target: user. */
export const PLAN_UNLOCK_FEATURE = "plan-unlock-guide";

export const PLAN_UNLOCK_EVENTS = {
  /** The guide was drawn inside a confirmation screen. */
  inline: "unlock_guide_inline",
  /** The guide was opened as a popup by the watcher. */
  popup: "unlock_guide_popup",
  /** "Ver tudo" on a list longer than its first rows. */
  expand: "unlock_guide_expand",
  /** A higher plan was clicked from "ainda dá para ir além". */
  upsell: "unlock_guide_upsell",
} as const;

export const PLAN_UNLOCK_CLIENT_EVENTS = Object.values(PLAN_UNLOCK_EVENTS);

export function trackUnlockGuide(name: (typeof PLAN_UNLOCK_EVENTS)[keyof typeof PLAN_UNLOCK_EVENTS]) {
  trackFeatureEvent(name, { feature: PLAN_UNLOCK_FEATURE });
}

const TIER_KEY_PREFIX = "golive:seenPlanTier:";
const TIERS: readonly FeatureTier[] = ["free", "account", "premium", "premium_max", "pro_ultra"];

/** The last rung this browser saw `accountId` on, or null when it never has (or storage is refused). */
export function readSeenTier(accountId: string): FeatureTier | null {
  try {
    const value = window.localStorage.getItem(TIER_KEY_PREFIX + accountId);
    return value && (TIERS as readonly string[]).includes(value) ? (value as FeatureTier) : null;
  } catch {
    return null;
  }
}

export function writeSeenTier(accountId: string, tier: FeatureTier) {
  try {
    window.localStorage.setItem(TIER_KEY_PREFIX + accountId, tier);
  } catch {
    // Refused storage: the watcher simply never has a "before" to compare to,
    // and stays quiet. The inline guide still works.
  }
}

// How many confirmation screens are open right now. A counter rather than a
// flag: the /pro page can hold the Pix dialog and the card form at once.
let hosts = 0;
const listeners = new Set<() => void>();

export function guideHostOpen(): boolean {
  return hosts > 0;
}

export function subscribeGuideHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Marks a confirmation screen as open while `active`, so the watcher leaves
 * the announcement to it. Mount it in the dialog that *leads to* the
 * confirmation (the Pix code, the card form, the present) — the account can
 * refresh before the "paid" screen has rendered.
 */
export function useUnlockGuideHost(active: boolean) {
  useEffect(() => {
    if (!active) return;
    hosts += 1;
    return () => {
      hosts -= 1;
      for (const listener of listeners) listener();
    };
  }, [active]);
}
