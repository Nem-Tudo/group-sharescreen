"use client";

import { DEFAULT_PLAN_ICON_ID, PLAN_ICONS, type PlanIconId } from "@/components/planIcons";
import { translate } from "@/lib/i18n";

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
  | "profile_group"
  | "profile_links"
  | "avatar_shape"
  | "room_theme"
  | "room_theme_publish"
  | "room_theme_set"
  | "room_theme_gradient"
  | "force_relay"
  | "uncapped_relay"
  | "clip_no_watermark"
  | "call_transcript";

export type FeatureTier = "free" | "account" | "premium" | "premium_max" | "pro_ultra";

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
  profile_group: "pro_ultra",
  profile_links: "pro_ultra",
  avatar_shape: "pro_ultra",
  room_theme: "premium",
  room_theme_publish: "premium_max",
  room_theme_set: "premium_max",
  room_theme_gradient: "premium_max",
  force_relay: "pro_ultra",
  uncapped_relay: "pro_ultra",
  clip_no_watermark: "premium_max",
  call_transcript: "premium_max",
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
 * Checked from the top down, because every rung carries the flags of the ones
 * below it — a Pro Ultra subscriber has PRO_ULTRA, PRO_MAX and PRO, so that
 * every rule written against a lower flag keeps matching them (see the API's
 * entitlements.ts). Testing a lower flag first would make the higher mark
 * unreachable.
 *
 * A Pro Max/Pro Ultra subscriber may choose to wear a plainer mark than their
 * plan affords (see the account settings' verified-badge picker) — the API
 * publishes that choice as BADGE_TONE_BLUE/BADGE_TONE_GOLD alongside
 * PRO_MAX/PRO_ULTRA (see its entitlements.ts and accountStore's
 * publishedFlags), and this is the one place that reads them, so every
 * caller below sees the chosen mark without carrying the preference itself.
 */
export type VerifiedTone = "blue" | "gold" | "ruby" | null;

export function verifiedBadge(flags: readonly string[] | undefined | null): VerifiedTone {
  if (!flags) return null;
  if (flags.includes("PRO_ULTRA")) {
    if (flags.includes("BADGE_TONE_BLUE")) return "blue";
    if (flags.includes("BADGE_TONE_GOLD")) return "gold";
    return "ruby";
  }
  if (flags.includes("PRO_MAX")) {
    if (flags.includes("BADGE_TONE_BLUE")) return "blue";
    return "gold";
  }
  if (flags.includes("VERIFIED") || flags.includes("PRO")) return "blue";
  return null;
}

/**
 * The highest mark this account's *plan* affords, ignoring any BADGE_TONE_*
 * downgrade it is currently wearing — mirrors the API's
 * entitlements.ts#maxVerifiedTone.
 *
 * verifiedBadge above is deliberately not this: it reads the override too, so
 * once somebody picks "blue" it starts answering "blue" — which is correct
 * for drawing their name, but wrong for the settings picker deciding which
 * options to offer. Asking verifiedBadge there shrank the choice down to just
 * the one already picked, with no way back to ruby/gold: the ceiling has to
 * come from the plan alone.
 */
export function maxVerifiedTone(flags: readonly string[] | undefined | null): VerifiedTone {
  if (!flags) return null;
  if (flags.includes("PRO_ULTRA")) return "ruby";
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
  get account() { return translate("entitlements.accountRequired"); },
  get premium() { return translate("common.pro"); },
  get premium_max() { return translate("common.proMax"); },
  get pro_ultra() { return translate("common.proUltra"); },
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
  const paid = tierAtLeast(tier, "premium");
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
  if (planId === "pro_ultra") return "pro_ultra";
  return planId === "premium_max" ? "premium_max" : "premium";
}

/**
 * The plan mark that belongs to a rung — ruby, gold or blue — for anywhere a
 * *tier* rather than a person is being labelled (a locked option, a plan
 * card). Mirrors verifiedBadge's colours, so the mark on "available on Pro
 * Ultra" is the same one Pro Ultra subscribers wear.
 */
export function tierIconId(tier: FeatureTier | null | undefined): PlanIconId {
  if (tier === "pro_ultra") return "ruby_verified";
  if (tier === "premium_max") return "gold_verified";
  return "blue_verified";
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
  translate("entitlements.yourAccountIsBlockedFromCreating");

/**
 * Which rung an account stands on, read from the flags every name already
 * carries. PRO_MAX first, because a Pro Max subscriber carries PRO as well —
 * see verifiedBadge above, which is the same trap.
 */
export function accountTierOf(flags: readonly string[] | undefined | null): FeatureTier {
  if (!flags) return "free";
  if (flags.includes("PRO_ULTRA")) return "pro_ultra";
  if (flags.includes("PRO_MAX")) return "premium_max";
  if (flags.includes("PRO")) return "premium";
  return "account";
}

const TIER_RANK: Record<FeatureTier, number> = {
  free: 0,
  account: 1,
  premium: 2,
  premium_max: 3,
  pro_ultra: 4,
};

/** Whether `tier` is strictly above `other` — "I already have more than this". */
export function tierAbove(tier: FeatureTier, other: FeatureTier): boolean {
  return TIER_RANK[tier] > TIER_RANK[other];
}

/**
 * Whether `tier` is at least `floor` — "has Pro Max or better". Ask this
 * instead of `=== "premium_max"`: an equality check quietly takes a perk away
 * from everybody on a rung above it.
 */
export function tierAtLeast(tier: FeatureTier, floor: FeatureTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[floor];
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
