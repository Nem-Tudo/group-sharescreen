"use client";

import { useAuth } from "@/lib/AuthContext";
import { useFeature } from "@/lib/features";
import { hasClaimedPartnerReward, type PartnerCardData } from "@/lib/partner";

// Which partner ads a Pro subscriber is shown, in one place.
//
// Pro already takes the ad networks and the broadcast ad gate away (the
// `no_ads` entitlement, see lib/useAdsAllowed and BroadcastAdGateModal); the
// partner ads stayed, because they are also where points come from. This
// lets the subscriber decide: every ad (the default, and what everybody else
// has), only the ones that still pay them points, or none at all.
//
// Saved on the account (PATCH /account/profile), so it follows them to every
// device and into the apps. The setting lives on /me ("Gerenciar conta") and
// goes out behind a feature flag created in the admin panel — see CLAUDE.md.

/** The feature's key in the admin panel. Target: user. */
export const PARTNER_ADS_MODE_FEATURE = "hide-partner-ads";

/** The id the blue "NOVO" badge is tracked by — the feature's key. */
export const PARTNER_ADS_MODE_BADGE = PARTNER_ADS_MODE_FEATURE;

export type PartnerAdsMode = "always" | "rewards" | "never";

/** In the order the setting lists them. */
export const PARTNER_ADS_MODES: readonly PartnerAdsMode[] = ["never", "rewards", "always"];

/**
 * One event per choice, sent when it is picked. Each has to be registered as a
 * "site event" on the feature in the admin panel or it will not be counted.
 */
export const PARTNER_ADS_MODE_EVENTS: Record<PartnerAdsMode, string> = {
  always: "partner_ads_always",
  rewards: "partner_ads_rewards",
  never: "partner_ads_never",
};

/**
 * The choice in force for whoever is here, or null while it cannot be known
 * yet (the account still loading, or a Pro subscriber's experiment still being
 * read) — a slot shows its placeholder until then rather than flashing an ad
 * at somebody who turned them off.
 *
 * Only a Pro subscriber inside the experiment ever gets anything but
 * "always": the setting is theirs, and somebody taken out of the experiment
 * loses the switch along with what it did.
 */
export function usePartnerAdsMode(): PartnerAdsMode | null {
  const { account, loading } = useAuth();
  const feature = useFeature(PARTNER_ADS_MODE_FEATURE, { track: false });
  if (loading) return null;
  if (!account?.features?.includes("no_ads")) return "always";
  const chosen = account.partnerAdsMode ?? "always";
  // Nothing to wait for when the answer is the default either way.
  if (chosen === "always") return "always";
  if (!feature.ready) return null;
  return feature.enabled ? chosen : "always";
}

/** Whether this ad still has points in it for whoever is here. */
export function hasUnclaimedPartnerReward(partner: PartnerCardData | null | undefined): boolean {
  const id = partner?.id;
  if (!id) return false;
  const video = Boolean(partner.rewardPoints && partner.rewardVideoUrl) && !hasClaimedPartnerReward(id, "video");
  const click = Boolean(partner.clickRewardPoints) && !hasClaimedPartnerReward(id, "click");
  return video || click;
}
