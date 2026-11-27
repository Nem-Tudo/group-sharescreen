"use client";

import { useSyncExternalStore } from "react";
import type { PlanSale, PremiumPlan } from "@/lib/premiumApi";

// The sale on the Pro plans, for the page and its popups.
//
// The prices themselves always come from the API (see its planSale.ts) — this
// only decides how the page *looks* while one runs, and counts down to its end.
// The API sends the end time with the plans, so the two cannot disagree about
// when it is over.

/** The sale on any of these plans, or null. */
export function saleOf(plans: readonly PremiumPlan[]): PlanSale | null {
  return plans.find((plan) => plan.sale && plan.sale.endsAt > 0)?.sale ?? null;
}

// One clock for every countdown on screen, ticking once a second while any is
// mounted.
function subscribeSecond(onTick: () => void): () => void {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}
const nowSecond = () => Math.floor(Date.now() / 1000);
const noSecond = () => null;

/**
 * Milliseconds left until `endsAt`, ticking once a second; null on the server
 * and during hydration (so both render the same markup) and 0 once it is over.
 */
export function useCountdown(endsAt: number | null): number | null {
  const second = useSyncExternalStore(subscribeSecond, nowSecond, noSecond);
  if (endsAt === null || second === null) return null;
  return Math.max(0, endsAt - second * 1000);
}

/** "07:42:05" — hours can pass 24 and are not wrapped. */
export function formatCountdown(ms: number): { h: string; m: string; s: string } {
  const total = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    h: pad(Math.floor(total / 3600)),
    m: pad(Math.floor((total % 3600) / 60)),
    s: pad(total % 60),
  };
}
