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
  | "no_ads"
  | "avatar_gallery"
  | "avatar_upload"
  | "banner_upload"
  | "profile_gradient"
  | "profile_song"
  | "room_theme"
  | "room_theme_publish"
  | "room_theme_set"
  | "room_theme_gradient";

export type FeatureTier = "free" | "account" | "premium" | "premium_max";

/** Which tier each gated option belongs to. Display only — see the header. */
export const FEATURE_TIERS: Record<Feature, FeatureTier> = {
  quality_1440p: "premium",
  bitrate_maximo: "premium",
  quality_2160p: "premium",
  fps_120: "premium",
  verified_badge: "premium",
  no_ads: "premium",
  avatar_gallery: "premium",
  avatar_upload: "premium_max",
  banner_upload: "premium_max",
  profile_gradient: "premium_max",
  profile_song: "premium_max",
  room_theme: "premium",
  room_theme_publish: "premium_max",
  room_theme_set: "premium_max",
  room_theme_gradient: "premium_max",
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
  return verifiedBadge(flags) !== null;
}

/**
 * Which mark to draw, or null for none.
 *
 * Gold is the top plan's, blue is everybody else's who has one. Returning the
 * *tone* rather than a boolean is what keeps the two from drifting: a caller
 * cannot render a badge without having been told which one, so a new rung
 * added here reaches every name in the app at once.
 *
 * PRO_MAX is checked first because a Pro Max subscriber carries PRO as well —
 * the API publishes both, so that every rule written against PRO keeps
 * matching them (see its entitlements.ts). Testing PRO first would make gold
 * unreachable.
 */
export type VerifiedTone = "blue" | "gold" | null;

export function verifiedBadge(flags: readonly string[] | undefined | null): VerifiedTone {
  if (!flags) return null;
  if (flags.includes("PRO_MAX")) return "gold";
  if (flags.includes("VERIFIED") || flags.includes("PRO")) return "blue";
  return null;
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

/**
 * What each rung is called in front of a person.
 *
 * "premium_max" had no entry here and fell through to "conta necessária",
 * which is the one answer that is not merely imprecise but wrong: it tells
 * somebody who already has an account that an account is what they are
 * missing. Every rung the ladder can return now names itself.
 */
export const TIER_NAMES: Record<FeatureTier, string> = {
  free: "",
  account: "conta necessária",
  premium: "Pro",
  premium_max: "Pro Max",
};

/** What the missing tier is called, in words. Null when nothing is missing. */
export function lockName(
  feature: Feature | undefined,
  features: readonly string[]
): string | null {
  const tier = lockTier(feature, features);
  if (!tier) return null;
  return TIER_NAMES[tier];
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
  const name = TIER_NAMES[tier];
  // The mark belongs to a paid rung. "conta necessária" is not a product and
  // wearing a plan's badge would be claiming it is one.
  const paid = tier === "premium" || tier === "premium_max";
  const mark = paid ? ` ${PLAN_ICONS[DEFAULT_PLAN_ICON_ID].glyph}` : "";
  return ` ${name}${mark}`;
}

/**
 * Which rung a plan sells, by id — the mirror of the API's planTier.
 *
 * Display only, like everything else in this file: it is what lets a screen
 * say "you already have more than this" *before* somebody presses a button
 * that would have been refused (see GiftClaimDialog). The refusal itself is
 * still the server's, which is the only side that knows what is true.
 */
export function planTierOf(planId: string): FeatureTier {
  return planId === "premium_max" ? "premium_max" : "premium";
}

/**
 * Whether this account has been stopped from making themes.
 *
 * A moderation state, not a plan: it sits alongside the entitlement checks
 * rather than inside them because it answers a different question. `hasFeature`
 * asks what somebody paid for; this asks whether they are still allowed to use
 * it. Both have to be true, and they fail with different messages — being sold
 * a plan you already have is the worst possible answer to "why can't I create
 * a theme".
 *
 * Mirrors the API's isThemeBanned (roomTheme.ts), which is where it is
 * actually enforced. This copy exists so somebody finds out before spending
 * twenty minutes on a palette, not to be the check.
 */
export function isThemeBanned(flags: readonly string[] | undefined | null): boolean {
  return Boolean(flags?.includes("THEME_BANNED"));
}

/** What a banned author is told. Matches the API's wording. */
export const THEME_BAN_MESSAGE =
  "Sua conta está impedida de criar ou publicar temas. Fale com a moderação se achar que é engano.";

/**
 * Which rung an account stands on, read from the flags every name already
 * carries. PRO_MAX first, because a Pro Max subscriber carries PRO as well —
 * see verifiedBadge above, which is the same trap.
 */
export function accountTierOf(flags: readonly string[] | undefined | null): FeatureTier {
  if (!flags) return "free";
  if (flags.includes("PRO_MAX")) return "premium_max";
  if (flags.includes("PRO")) return "premium";
  return "account";
}

const TIER_RANK: Record<FeatureTier, number> = {
  free: 0,
  account: 1,
  premium: 2,
  premium_max: 3,
};

/** Whether `tier` is strictly above `other` — "I already have more than this". */
export function tierAbove(tier: FeatureTier, other: FeatureTier): boolean {
  return TIER_RANK[tier] > TIER_RANK[other];
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
