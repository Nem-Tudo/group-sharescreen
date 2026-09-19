"use client";

import { accountTierOf, type FeatureTier } from "./entitlements";

// "Várias telas": sharing more than one monitor or window at the same time.
//
// The first one is the ordinary "screen" channel. Every other one is a
// channel of its own ("screen2".."screen10") — a full sibling, the same way
// the local-file slots are (see useRoomMedia): its own peer connections, its
// own tiles, its own start/stop. The server needs to know nothing about them;
// the signalling relay forwards a channel's payloads opaquely.
export const EXTRA_SCREEN_SLOTS = [
  "screen2",
  "screen3",
  "screen4",
  "screen5",
  "screen6",
  "screen7",
  "screen8",
  "screen9",
  "screen10",
] as const;
export type ExtraScreenSlot = (typeof EXTRA_SCREEN_SLOTS)[number];

export function isExtraScreenSlot(value: string): value is ExtraScreenSlot {
  return (EXTRA_SCREEN_SLOTS as readonly string[]).includes(value);
}

// How many screens/windows (the first one included) each rung may share at
// once. Enforced here, on the sharing side — a viewer receives whatever
// arrives.
export const MULTI_SCREEN_LIMITS: Record<FeatureTier, number> = {
  free: 2,
  account: 2,
  // Same as free on purpose: more screens is a Pro Max perk.
  premium: 2,
  premium_max: 5,
  pro_ultra: 10,
};

export function multiScreenLimit(flags: readonly string[] | undefined | null): number {
  return MULTI_SCREEN_LIMITS[accountTierOf(flags)];
}

// Usage stats. Every name has to be listed in the feature's "site events" in
// the admin panel to count. The switch's own on/off events live with the other
// tile experiments' (TILE_EXPERIMENT_EVENTS in lib/clipsMode).
export const MULTI_SCREEN_EVENTS = {
  add: "multi_screen_add", // value: how many screens are going out after it
  limit: "multi_screen_limit_hit", // value: the limit that was hit
  upgradeClick: "multi_screen_upgrade_click", // opened the plans from the "+"
  dualCamera: "dual_camera_start", // front and rear cameras at once
} as const;

// The next rung that raises the limit, for the upsell beside the counter —
// null on the top one. Pro gives nothing more than free, so it points at Pro
// Max like free does.
export function nextScreenUpgrade(
  flags: readonly string[] | undefined | null
): { tier: "premium_max" | "pro_ultra"; planId: string; limit: number } | null {
  const tier = accountTierOf(flags);
  if (tier === "pro_ultra") return null;
  if (tier === "premium_max") {
    return { tier: "pro_ultra", planId: "pro_ultra", limit: MULTI_SCREEN_LIMITS.pro_ultra };
  }
  return { tier: "premium_max", planId: "premium_max", limit: MULTI_SCREEN_LIMITS.premium_max };
}
