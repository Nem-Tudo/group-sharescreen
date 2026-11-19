"use client";

import { useMemo } from "react";
import { AURAS_PER_PLAN, GROUP_AURA_FEATURE } from "@/lib/groupAura";
import { CAMERA_CUSTOM_FEATURE } from "@/lib/cameraCustomEffects";
import { CAMERA_OTHERS_FEATURE } from "@/lib/cameraEffectGift";
import { CAMERA_WORKSHOP_FEATURE, PUBLISHED_EFFECT_LIMITS } from "@/lib/cameraEffectWorkshop";
import { ACCOUNT_EMOJI_LIMITS, CUSTOM_EMOJI_FEATURE } from "@/lib/customEmoji";
import { planTierOf, tierAbove, tierAtLeast, type Feature, type FeatureTier } from "@/lib/entitlements";
import { useFeature } from "@/lib/features";
import { translate } from "@/lib/i18n";
import { MULTI_SCREEN_LIMITS } from "@/lib/multiScreen";
import type { PremiumPlan } from "@/lib/premiumApi";
import { PUBLISHED_THEME_LIMITS } from "@/lib/roomThemes";
import { CALL_TRANSCRIPT_FREE_FEATURE } from "@/lib/useCallTranscript";
import { useAvatarFree } from "@/lib/avatarFree";
import { LIVE_TRANSLATION_FREE_FEATURE } from "@/lib/useLiveTranslation";

// What each plan gives, in words — shared by the /pro page (which sells it)
// and the unlock guide (which explains it right after it was bought; see
// components/PlanUnlockGuide).
//
// The two used to be one table inside ProPanel. The guide needs the very same
// sentences: a perk sold as "Transmita em até 4K" and then announced as
// something else reads as two different things.

/** An upload limit in MiB, as people say it: "100 MB", or "1 GB" from 1024 up. */
export function formatUploadLimit(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`;
  return `${mb} MB`;
}

// What each entitlement is called in front of a person. Keys come from
// lib/entitlements.ts; a feature with no entry here still counts and is
// simply not listed, which is the right behaviour for a client that predates
// a perk the server already grants.
// Every gated feature needs a line here, and the failure when one is missing
// is silent: the row below drops anything it cannot name, so a perk the plan
// really grants simply never appears on the page selling it. That is what
// happened to the two avatar features — added to the ladder, never given a
// sentence.
export const FEATURE_LABELS: Partial<Record<Feature, string>> = {
  get verified_badge() { return translate("pro.proPanel.beVerifiedAndGetAnAuthenticity"); },
  get quality_2160p() { return translate("pro.proPanel.broadcastInUpTo4k2160p"); },
  get quality_1440p() { return translate("pro.proPanel.broadcastIn2k1440p"); },
  get fps_120() { return translate("pro.proPanel.upTo240FramesPerSecond"); },
  get bitrate_maximo() { return translate("pro.proPanel.bitrateOfUpTo32Mbps"); },
  get no_ads() { return translate("pro.proPanel.browseWithNoAds"); },
  get avatar_gallery() { return translate("pro.proPanel.exclusiveAvatarsForYourProfilePicture"); },
  get avatar_upload() { return translate("pro.proPanel.useAnyImageOfYoursAs"); },
  get avatar_shape() { return translate("pro.proPanel.chooseYourAvatarShape"); },
  get banner_upload() { return translate("pro.proPanel.uploadYourOwnProfileBanner"); },
  get profile_gradient() { return translate("pro.proPanel.chooseYourProfileSBackgroundColours"); },
  get profile_song() { return translate("pro.proPanel.putASongOnYourProfile"); },
  get profile_group() { return translate("pro.proPanel.showAGroupOnYourProfile"); },
  get profile_links() { return translate("pro.proPanel.linkYourSocialNetworksOnYour"); },
  get room_theme() { return translate("pro.proPanel.createThemesAndGiveRoomsYour"); },
  get room_theme_publish() { return translate("pro.proPanel.publishYourThemesOnDiscoverFor"); },
  get camera_effect_publish() { return translate("pro.proPanel.publishCameraEffects"); },
  get camera_effect_others() { return translate("pro.proPanel.putEffectsOnOthers"); },
  get room_theme_set() { return translate("pro.proPanel.changeTheThemeOfAnyRoom"); },
  get uncapped_relay() { return translate("pro.proPanel.noQualityLimitOnRelayedConnections"); },
  get force_relay() { return translate("pro.proPanel.hideYourIpFromEveryoneInA"); },
  get dedicated_turn() { return translate("pro.proPanel.dedicatedTurn"); },
  get room_theme_gradient() { return translate("pro.proPanel.useAGradientInYourThemes"); },
  get clip_no_watermark() { return translate("pro.proPanel.clipWithoutWatermark"); },
  get call_transcript() { return translate("pro.proPanel.transcribeYourCalls"); },
  get live_translation() { return translate("pro.proPanel.liveTranslation"); },
  // The room's tools, one row per rung (see lib/roomTools.ts's TOOL_FEATURES).
  get room_tools_tasks() { return translate("pro.proPanel.roomToolsTasks"); },
  get room_tools_text() { return translate("pro.proPanel.roomToolsText"); },
  get room_tools_draw() { return translate("pro.proPanel.roomToolsDraw"); },
};

/**
 * Perks that sit behind experiments of their own, read for whoever is looking.
 *
 * The same filters the /pro page applies before listing a perk: telling
 * somebody they unlocked a thing their account cannot see — or one that is
 * already free for them — is worse than leaving it out.
 */
export type PerkGates = {
  aura: boolean;
  emoji: boolean;
  transcriptFree: boolean;
  translationFree: boolean;
  /** Avatars the avatar-free experiment already gives this person. */
  avatarGalleryFree: boolean;
  avatarUploadFree: boolean;
  effectsPublish: boolean;
  effectsOnOthers: boolean;
};

export function usePerkGates(): PerkGates {
  const aura = useFeature(GROUP_AURA_FEATURE, { track: false }).enabled;
  const emoji = useFeature(CUSTOM_EMOJI_FEATURE, { track: false }).enabled;
  const transcriptFree = useFeature(CALL_TRANSCRIPT_FREE_FEATURE, { track: false }).enabled;
  const translationFree = useFeature(LIVE_TRANSLATION_FREE_FEATURE, { track: false }).enabled;
  const workshop = useFeature(CAMERA_WORKSHOP_FEATURE, { track: false }).enabled;
  const custom = useFeature(CAMERA_CUSTOM_FEATURE, { track: false }).enabled;
  const effectsOnOthers = useFeature(CAMERA_OTHERS_FEATURE, { track: false }).enabled;
  const effectsPublish = workshop && custom;
  const avatarFree = useAvatarFree();
  const avatarGalleryFree = avatarFree.gallery;
  const avatarUploadFree = avatarFree.upload;
  return useMemo(
    () => ({
      aura,
      emoji,
      transcriptFree,
      translationFree,
      avatarGalleryFree,
      avatarUploadFree,
      effectsPublish,
      effectsOnOthers,
    }),
    [aura, emoji, transcriptFree, translationFree, avatarGalleryFree, avatarUploadFree, effectsPublish, effectsOnOthers]
  );
}

/** Where a perk belongs, for the guide's headings. Also the order they are listed in. */
export type PerkGroup = "broadcast" | "profile" | "room" | "extras";
export const PERK_GROUPS: readonly PerkGroup[] = ["broadcast", "profile", "room", "extras"];

export type Perk = {
  /** A feature key, or one of the numbered perks ("multi_screen", "upload"…). */
  key: string;
  group: PerkGroup;
  label: string;
  /** Where to find it, or what to do with it — one short line. */
  hint: string;
  /** For a perk that differs by a number between rungs: that number. */
  amount?: number;
};

const FEATURE_GROUP: Partial<Record<Feature, PerkGroup>> = {
  quality_2160p: "broadcast",
  quality_1440p: "broadcast",
  fps_120: "broadcast",
  bitrate_maximo: "broadcast",
  uncapped_relay: "broadcast",
  force_relay: "broadcast",
  dedicated_turn: "broadcast",
  verified_badge: "profile",
  avatar_gallery: "profile",
  avatar_upload: "profile",
  avatar_shape: "profile",
  banner_upload: "profile",
  profile_gradient: "profile",
  profile_song: "profile",
  profile_group: "profile",
  profile_links: "profile",
  no_ads: "extras",
};

/** Where to find each perk. Room-menu labels are quoted from the room itself, so the two never disagree. */
function perkHint(key: string): string {
  switch (key) {
    case "verified_badge":
      return translate("planUnlocks.hint.badge");
    case "badge_choice":
    case "avatar_gallery":
    case "avatar_upload":
    case "avatar_shape":
    case "banner_upload":
    case "profile_gradient":
    case "profile_song":
    case "profile_group":
    case "profile_links":
      return translate("planUnlocks.hint.profile", { label: translate("userProfileCard.editProfile") });
    case "quality_2160p":
    case "quality_1440p":
    case "fps_120":
    case "bitrate_maximo":
      return translate("planUnlocks.hint.quality");
    case "multi_screen":
      return translate("planUnlocks.hint.multiScreen");
    case "uncapped_relay":
    case "dedicated_turn":
      return translate("planUnlocks.hint.automatic");
    case "force_relay":
      return translate("planUnlocks.hint.relay", { label: translate("watch.watchRoom.preventDirectConnections") });
    case "room_theme":
    case "room_theme_gradient":
      return translate("planUnlocks.hint.roomMenu", { label: translate("roomTour.roomTheme.title") });
    case "room_theme_publish":
      return translate("planUnlocks.hint.themePublish");
    case "room_theme_set":
      return translate("planUnlocks.hint.themeAnyRoom", { label: translate("roomTour.roomTheme.title") });
    case "camera_effect_publish":
      return translate("planUnlocks.hint.effectPublish");
    case "camera_effect_others":
      return translate("planUnlocks.hint.effectOthers");
    case "clip_no_watermark":
      return translate("planUnlocks.hint.clips");
    case "call_transcript":
      return translate("planUnlocks.hint.roomMenu", { label: translate("roomTour.transcript.title") });
    case "live_translation":
      return translate("planUnlocks.hint.roomMenu", { label: translate("roomTour.translation.title") });
    case "room_tools_tasks":
    case "room_tools_text":
    case "room_tools_draw":
      return translate("planUnlocks.hint.tools", { label: translate("roomTour.tools.title") });
    case "no_ads":
      return translate("planUnlocks.hint.noAds");
    case "upload":
      return translate("planUnlocks.hint.upload");
    case "daily_points":
      return translate("planUnlocks.hint.dailyPoints");
    case "auras":
      return translate("planUnlocks.hint.auras");
    case "emojis":
      return translate("planUnlocks.hint.emojis");
    default:
      return "";
  }
}

/**
 * Everything one plan gives, by key, in the /pro page's order.
 *
 * `plan` null is "no plan at all" — an empty list, which is exactly right for
 * the rung somebody stood on before their first purchase: everything their new
 * plan has is new to them.
 */
export function perksOf(plan: PremiumPlan | null, gates: PerkGates): Map<string, Perk> {
  const perks = new Map<string, Perk>();
  if (!plan) return perks;
  const tier = planTierOf(plan.id);
  const add = (key: string, group: PerkGroup, label: string | undefined, amount?: number) => {
    if (!label) return;
    perks.set(key, { key, group, label, hint: perkHint(key), ...(amount !== undefined ? { amount } : {}) });
  };

  for (const feature of Object.keys(FEATURE_LABELS) as Feature[]) {
    if (!plan.features.includes(feature)) continue;
    if (feature === "call_transcript" && gates.transcriptFree) continue;
    if (feature === "live_translation" && gates.translationFree) continue;
    if (feature === "avatar_gallery" && gates.avatarGalleryFree) continue;
    if (feature === "avatar_upload" && gates.avatarUploadFree) continue;
    if (feature === "camera_effect_publish" && !gates.effectsPublish) continue;
    if (feature === "camera_effect_others" && !gates.effectsOnOthers) continue;
    // "Até 4K" already says 2K.
    if (feature === "quality_1440p" && plan.features.includes("quality_2160p")) continue;
    const group = FEATURE_GROUP[feature] ?? "room";
    if (feature === "room_theme_publish") {
      const limit = PUBLISHED_THEME_LIMITS[tier as keyof typeof PUBLISHED_THEME_LIMITS];
      add(feature, group, limit ? translate("pro.proPanel.publishThemesWithLimit", { limit }) : FEATURE_LABELS[feature], limit);
    } else if (feature === "camera_effect_publish") {
      const limit = PUBLISHED_EFFECT_LIMITS[tier as keyof typeof PUBLISHED_EFFECT_LIMITS];
      add(
        feature,
        group,
        limit ? translate("pro.proPanel.publishCameraEffectsWithLimit", { limit }) : FEATURE_LABELS[feature],
        limit
      );
    } else {
      add(feature, group, FEATURE_LABELS[feature]);
    }
    // Right under the badge, which it qualifies.
    if (feature === "verified_badge" && tierAtLeast(tier, "premium_max")) {
      add("badge_choice", "profile", translate("pro.proPanel.chooseVerifiedBadge"));
    }
  }

  const screens = MULTI_SCREEN_LIMITS[tier];
  if (screens > MULTI_SCREEN_LIMITS.account) {
    add(
      "multi_screen",
      "broadcast",
      translate("pro.proPanel.shareUpToScreens", { count: screens, free: MULTI_SCREEN_LIMITS.account }),
      screens
    );
  }
  if (typeof plan.uploadLimitMb === "number" && plan.uploadLimitMb > 0) {
    add(
      "upload",
      "extras",
      translate("pro.proPanel.sendFilesOfUpToValue", { value: formatUploadLimit(plan.uploadLimitMb) }),
      plan.uploadLimitMb
    );
  }
  if (plan.dailyPoints > 0) {
    add("daily_points", "extras", translate("planUnlocks.dailyPoints", { count: plan.dailyPoints }), plan.dailyPoints);
  }
  const auras = AURAS_PER_PLAN[tier] ?? 0;
  if (gates.aura && auras > 0) {
    add(
      "auras",
      "extras",
      tier === "pro_ultra"
        ? translate("pro.proPanel.aurasToGiveUltra", { count: auras })
        : translate("pro.proPanel.aurasToGive", { count: auras }),
      auras
    );
  }
  const emojis = ACCOUNT_EMOJI_LIMITS[tier] ?? 0;
  if (gates.emoji && emojis > 0) {
    add("emojis", "extras", translate("pro.proPanel.customEmojis", { count: emojis }), emojis);
  }
  return perks;
}

/** What `next` has that `before` has not — a new perk, or a bigger number on one already held. */
function gained(next: Map<string, Perk>, before: Map<string, Perk>): Perk[] {
  const out: Perk[] = [];
  for (const perk of next.values()) {
    const held = before.get(perk.key);
    if (!held) out.push(perk);
    else if (perk.amount !== undefined && (held.amount === undefined || perk.amount > held.amount)) out.push(perk);
  }
  // Grouped, keeping the /pro page's order inside each group.
  return out.sort((a, b) => PERK_GROUPS.indexOf(a.group) - PERK_GROUPS.indexOf(b.group));
}

export type PlanUnlocks = {
  plan: PremiumPlan;
  /** What the new plan added over the rung they stood on before. */
  unlocked: Perk[];
  /** The plans above it, each with only what it adds over the one below it. */
  beyond: { plan: PremiumPlan; perks: Perk[] }[];
};

/**
 * What changed hands, for the guide: the perks the new rung opened, and what
 * every rung above it would still add.
 *
 * Worked out from the plans' own feature lists rather than the account's:
 * a card payment is confirmed on screen before the webhook has granted
 * anything, and the account would still be answering with the old plan.
 */
export function planUnlocks(
  plans: readonly PremiumPlan[],
  tier: FeatureTier,
  previousTier: FeatureTier,
  gates: PerkGates
): PlanUnlocks | null {
  const plan = plans.find((entry) => planTierOf(entry.id) === tier);
  if (!plan) return null;
  const previous = tierAtLeast(previousTier, "premium")
    ? plans.find((entry) => planTierOf(entry.id) === previousTier) ?? null
    : null;
  const mine = perksOf(plan, gates);
  const unlocked = tierAbove(tier, previousTier) ? gained(mine, perksOf(previous, gates)) : [];

  const above = plans
    .filter((entry) => tierAbove(planTierOf(entry.id), tier))
    .sort((a, b) => (tierAbove(planTierOf(a.id), planTierOf(b.id)) ? 1 : -1));
  const beyond: PlanUnlocks["beyond"] = [];
  let below = mine;
  for (const entry of above) {
    const theirs = perksOf(entry, gates);
    const perks = gained(theirs, below);
    if (perks.length > 0) beyond.push({ plan: entry, perks });
    below = theirs;
  }
  return { plan, unlocked, beyond };
}
