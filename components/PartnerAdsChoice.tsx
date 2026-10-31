"use client";

import { useState } from "react";
import { MdClose, MdTune } from "react-icons/md";
import useNtPopups from "ntpopups";
import { useAuth } from "@/lib/AuthContext";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { useT } from "@/lib/useI18n";
import { markFeatureUsed } from "@/components/NewBadge";
import {
  PARTNER_ADS_CARD_EVENTS,
  PARTNER_ADS_CARD_FEATURE,
  PARTNER_ADS_MODE_BADGE,
  PARTNER_ADS_MODE_EVENTS,
  PARTNER_ADS_MODE_FEATURE,
  PARTNER_ADS_MODES,
  type PartnerAdsMode,
} from "@/lib/partnerAdsMode";

/**
 * The three options of lib/partnerAdsMode. Saved on the account at once, so
 * there is no save button. Shared by /me and the popup the ad card opens.
 */
export function PartnerAdsChoice({ locked = false, onSaved }: { locked?: boolean; onSaved?: () => void }) {
  const t = useT();
  const { account, updateProfile } = useAuth();
  // The choice just made, until the account comes back with it.
  const [pending, setPending] = useState<PartnerAdsMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = pending ?? account?.partnerAdsMode ?? "always";

  async function choose(mode: PartnerAdsMode) {
    if (locked || mode === current) return;
    setPending(mode);
    setError(null);
    markFeatureUsed(PARTNER_ADS_MODE_BADGE);
    trackFeatureEvent(PARTNER_ADS_MODE_EVENTS[mode], { feature: PARTNER_ADS_MODE_FEATURE });
    try {
      await updateProfile({ partnerAdsMode: mode });
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("partnerAds.couldNotSave"));
    } finally {
      setPending(null);
    }
  }

  const labels: Record<PartnerAdsMode, { title: string; hint: string }> = {
    never: { title: t("partnerAds.never"), hint: t("partnerAds.neverHint") },
    rewards: { title: t("partnerAds.rewards"), hint: t("partnerAds.rewardsHint") },
    always: { title: t("partnerAds.always"), hint: t("partnerAds.alwaysHint") },
  };

  return (
    <>
      <div role="radiogroup" aria-label={t("partnerAds.title")} className="flex flex-col gap-1.5">
        {PARTNER_ADS_MODES.map((mode) => {
          const selected = current === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked || pending !== null}
              onClick={() => void choose(mode)}
              className={`flex w-full cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${
                selected
                  ? "border-sky-500 bg-sky-50 dark:border-sky-500/70 dark:bg-sky-500/10"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              } ${locked ? "opacity-50" : ""}`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-sky-500" : "border-zinc-300 dark:border-zinc-600"
                }`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-sky-500" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{labels[mode].title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                  {labels[mode].hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </>
  );
}

/** The ntpopups popup type "partner_ads_settings", registered in NtPopups.tsx. */
export function PartnerAdsSettingsModal({ closePopup }: { closePopup: (hasAction?: boolean) => void }) {
  const t = useT();
  return (
    <div className="relative flex flex-col gap-3 bg-white p-5 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <button
        type="button"
        onClick={() => closePopup(true)}
        aria-label={t("common.close")}
        className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <MdClose className="h-5 w-5" />
      </button>
      <div className="pr-8">
        <h2 className="text-base font-semibold">{t("partnerAds.title")}</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{t("partnerAds.hint")}</p>
      </div>
      <PartnerAdsChoice
        onSaved={() => {
          trackFeatureEvent(PARTNER_ADS_CARD_EVENTS.change, { feature: PARTNER_ADS_CARD_FEATURE });
          closePopup(true);
        }}
      />
      {/* Choosing "never" takes this very card away, so say where the way back is. */}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("partnerAds.changeLater")}</p>
    </div>
  );
}

/**
 * Whether the card offers the indicator below: a Pro subscriber inside both
 * experiments. Exposure counts only for them, the ones it can appear for.
 */
export function usePartnerAdsSettingsAvailable(): boolean {
  const { account } = useAuth();
  const pro = Boolean(account && !account.bot && account.features?.includes("no_ads"));
  const setting = useFeature(PARTNER_ADS_MODE_FEATURE, { track: false }).enabled;
  const { enabled } = useFeature(PARTNER_ADS_CARD_FEATURE, { track: pro && setting });
  return pro && setting && enabled;
}

/**
 * The indicator on an ad card. Drawn in the ad's own text colour, since the
 * advertiser picks the background.
 */
export function PartnerAdsSettingsButton() {
  const t = useT();
  const { openPopup } = useNtPopups();
  return (
    <button
      type="button"
      onClick={() => {
        trackFeatureEvent(PARTNER_ADS_CARD_EVENTS.open, { feature: PARTNER_ADS_CARD_FEATURE });
        openPopup("partner_ads_settings", { width: "min(420px, calc(100vw - 30px))", maxWidth: "420px" });
      }}
      aria-label={t("partnerAds.cardSettings")}
      title={t("partnerAds.cardSettings")}
      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
    >
      <MdTune className="h-3.5 w-3.5" />
    </button>
  );
}
