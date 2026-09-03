"use client";

import { DEFAULT_PLAN_ICON_ID, PLAN_ICONS } from "@/components/planIcons";

// The client's half of the entitlement table — the mirror of the API's
// server/entitlements.ts.
//
// The division of labour between the two is the important part, and it is not
// symmetric:
//
//   - the *server* decides what is true. Every account carries a resolved
//     `features` list (see the API's toPublicAccount), computed from the
//     subscription's real state, and that list is the only thing anything
//     gates on.
//   - this file decides what to *say*. It knows which tier each feature
//     belongs to, so a locked option can explain itself — "(conta
//     necessária)" versus "(Premium)" — without the client ever deciding
//     whether the lock applies.
//
// So a feature the server added and this file has never heard of still works:
// it arrives in `features` and is simply allowed. One this file knows about
// and the server does not is never granted. Both directions fail safe, which
// is what lets the two lists drift for a deploy without anything breaking.

export type Feature =
  | "quality_1440p"
  | "quality_2160p"
  | "fps_120"
  | "bitrate_maximo"
  | "verified_badge"
  | "no_ads";

export type FeatureTier = "free" | "account" | "premium";

/** Which tier each gated option belongs to. Display only — see the header. */
export const FEATURE_TIERS: Record<Feature, FeatureTier> = {
  quality_1440p: "premium",
  bitrate_maximo: "premium",
  quality_2160p: "premium",
  fps_120: "premium",
  verified_badge: "premium",
  no_ads: "premium",
};

/**
 * Whether a name should carry the blue badge.
 *
 * Two things earn it and they are deliberately different values:
 *
 *   - "VERIFIED" is a permanent grant, written into the account's flags by an
 *     admin. It stays until somebody removes it.
 *   - "PRO" is derived by the API from a subscription that is currently
 *     paying (see its entitlements.ts) and is never stored, so it disappears
 *     on its own when the plan lapses.
 *
 * Every badge in the app asks this rather than testing a flag itself. A dozen
 * call sites each doing `flags.includes("VERIFIED")` is a dozen places to
 * forget the second value — which is exactly what happened to the first one
 * before this existed.
 */
export function hasVerifiedBadge(flags: readonly string[] | undefined | null): boolean {
  if (!flags) return false;
  return flags.includes("VERIFIED") || flags.includes("PRO");
}

/**
 * Which tier an option needs and this account has not got, or null when it is
 * not locked at all.
 *
 * The one place that decides "is this gated, and by what" — the three
 * renderings below (and QualitySelect's markup) all ask this rather than
 * re-testing `FEATURE_TIERS` themselves, so a picker cannot end up disagreeing
 * with the label beside it.
 */
export function lockTier(
  feature: Feature | undefined,
  features: readonly string[]
): FeatureTier | null {
  if (!feature) return null;
  if (features.includes(feature)) return null;
  return FEATURE_TIERS[feature];
}

/** What the missing tier is called, in words. Null when nothing is missing. */
export function lockName(
  feature: Feature | undefined,
  features: readonly string[]
): string | null {
  const tier = lockTier(feature, features);
  if (!tier) return null;
  return tier === "premium" ? "Pro" : "conta necessária";
}

/**
 * The same thing written for a native `<option>`, which may hold text and
 * nothing else — so the badge has to be the registry's glyph rather than the
 * component (see components/planIcons.tsx).
 *
 * Ordered to match the custom listbox beside it: the label, then the tier,
 * then the mark. Two pickers for one setting that put the same three things
 * in two different orders is how somebody ends up thinking they are two
 * different settings.
 */
export function lockLabel(
  feature: Feature | undefined,
  features: readonly string[]
): string | null {
  const tier = lockTier(feature, features);
  if (!tier) return null;
  const name = tier === "premium" ? "Pro" : "conta necessária";
  const mark = tier === "premium" ? ` ${PLAN_ICONS[DEFAULT_PLAN_ICON_ID].glyph}` : "";
  return ` ${name}${mark}`;
}

export function hasFeature(feature: Feature | undefined, features: readonly string[]): boolean {
  if (!feature) return true;
  return features.includes(feature);
}

/**
 * The feature list for somebody who is not logged in.
 *
 * A guest gets the free tier and nothing else. Kept as a named empty list
 * rather than an inline `[]` so the reason is written down somewhere: the
 * absence of an account is not a loading state, and rendering the pickers as
 * though everything were unlocked while auth resolves would flash options
 * that are about to disappear.
 */
export const GUEST_FEATURES: readonly string[] = [];
