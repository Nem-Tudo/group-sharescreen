"use client";

import { useEffect, useState } from "react";
import {
  MdBolt,
  MdCheck,
  MdClose,
  MdFace,
  MdGroups,
  MdHd,
  MdPalette,
  MdSchedule,
  MdScreenShare,
  MdSpeed,
  MdTune,
  MdVerified,
  MdVisibility,
} from "react-icons/md";
import { PLAN_TONE_BUTTON, type PlanTone } from "@/components/PlanBand";
import { PLAN_ICONS, type PlanIconId } from "@/components/planIcons";
import { trackFeatureEvent } from "@/lib/features";
import { formatLocale } from "@/lib/i18n";
import { fetchPremiumPlans } from "@/lib/premiumApi";
import { openProModal } from "@/lib/proModal";
import { noteProSourceCta } from "@/lib/proSourceAttribution";
import { useT } from "@/lib/useI18n";
import { formatDuration } from "@/lib/userProfile";
import {
  STREAM_SUMMARY_EVENTS,
  STREAM_SUMMARY_FEATURE,
  hideStreamSummary,
  type StreamSummaryPopupData,
} from "@/lib/useStreamEndSummary";

// The two plans on offer, each in its own colour and with the badge it gives.
const OFFERED_PLANS: { id: string; titleKey: string; tone: PlanTone; iconId: PlanIconId }[] = [
  { id: "premium", titleKey: "streamSummary.seePro", tone: "blue", iconId: "blue_verified" },
  { id: "premium_max", titleKey: "streamSummary.seeProMax", tone: "gold", iconId: "gold_verified" },
];

/** The head of the popup: a screen sending its signal out, drawn in CSS. */
function SummaryArt() {
  return (
    <div
      aria-hidden
      className="relative flex h-32 items-center justify-center overflow-hidden"
      style={{ background: "radial-gradient(circle at 50% 120%, #10b981 0%, #065f46 45%, #022c22 100%)" }}
    >
      {[260, 190, 120].map((size) => (
        <span
          key={size}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15"
          style={{ width: size, height: size }}
        />
      ))}
      <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur">
        <MdScreenShare className="h-8 w-8" />
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-emerald-700">
          <MdCheck className="h-3.5 w-3.5" />
        </span>
      </span>
    </div>
  );
}

/** The ntpopups popup type "stream_summary", registered in NtPopups.tsx. */
export function StreamEndSummaryModal({
  closePopup,
  data: { durationSeconds, people, watchSeconds },
}: {
  closePopup: (hasAction?: boolean) => void;
  data: StreamSummaryPopupData;
}) {
  const t = useT();
  // The prices the API quotes today, by plan. Without an answer a button just
  // has no price.
  const [priceLabels, setPriceLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    // Personal: this is their own purchase, so the price their account would pay.
    void fetchPremiumPlans(controller.signal, { personal: true }).then((plans) => {
      if (controller.signal.aborted) return;
      setPriceLabels(Object.fromEntries(plans.map((entry) => [entry.id, entry.priceLabel])));
    });
    return () => controller.abort();
  }, []);

  function close() {
    trackFeatureEvent(STREAM_SUMMARY_EVENTS.close, { feature: STREAM_SUMMARY_FEATURE });
    closePopup(true);
  }

  const stats = [
    { Icon: MdSchedule, value: formatDuration(durationSeconds), label: t("streamSummary.timeLive") },
    { Icon: MdGroups, value: String(people), label: t("streamSummary.people") },
    {
      Icon: MdVisibility,
      value: t("streamSummary.watchHoursValue", {
        hours: (watchSeconds / 3600).toLocaleString(formatLocale(), { maximumFractionDigits: 1 }),
      }),
      label: t("streamSummary.watchTime"),
    },
  ];
  // Only what both plans on offer include, since either button can buy them.
  const perks = [
    { Icon: MdHd, text: t("streamSummary.perkQuality") },
    { Icon: MdBolt, text: t("streamSummary.perkBitrate") },
    { Icon: MdSpeed, text: t("streamSummary.perkConnection") },
    { Icon: MdVerified, text: t("streamSummary.perkVerified") },
    { Icon: MdTune, text: t("streamSummary.perkAds") },
    { Icon: MdPalette, text: t("streamSummary.perkThemes") },
    { Icon: MdFace, text: t("streamSummary.perkAvatars") },
  ];

  return (
    <div className="relative flex max-h-[94dvh] flex-col overflow-y-auto bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <SummaryArt />
      <button
        type="button"
        onClick={close}
        aria-label={t("common.close")}
        className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/50"
      >
        <MdClose className="h-5 w-5" />
      </button>

      <div className="flex flex-col gap-4 p-5">
        <div className="text-center">
          <h2 className="text-lg font-bold">{t("streamSummary.title")}</h2>
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t("streamSummary.finished")}</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {stats.map(({ Icon, value, label }) => (
            <div key={label} className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <Icon className="mb-1 h-4 w-4 text-zinc-400" />
              <p className="text-xl font-bold tabular-nums">{value}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="text-sm font-semibold">{t("streamSummary.offerTitle")}</p>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            {perks.map(({ Icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {OFFERED_PLANS.map(({ id, titleKey, tone, iconId }) => {
            const { Icon, className } = PLAN_ICONS[iconId];
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  trackFeatureEvent(STREAM_SUMMARY_EVENTS.cta, { feature: STREAM_SUMMARY_FEATURE });
                  trackFeatureEvent(`${STREAM_SUMMARY_EVENTS.cta}.${id}`, { feature: STREAM_SUMMARY_FEATURE });
                  noteProSourceCta("streamSummary");
                  closePopup(true);
                  openProModal(id);
                }}
                className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-3 text-left font-semibold text-white transition ${PLAN_TONE_BUTTON[tone]}`}
              >
                {/* On white: each badge is the same colour as its own button. */}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">
                  <Icon className={`h-5 w-5 ${className}`} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm leading-tight">{t(titleKey)}</span>
                  {priceLabels[id] && (
                    <span className="block text-xs font-medium opacity-90">
                      {t("streamSummary.perMonth", { price: priceLabels[id] })}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            trackFeatureEvent(STREAM_SUMMARY_EVENTS.never, { feature: STREAM_SUMMARY_FEATURE });
            hideStreamSummary();
            closePopup(true);
          }}
          className="-mt-1 cursor-pointer self-center text-xs text-zinc-500 underline-offset-2 transition hover:underline dark:text-zinc-400"
        >
          {t("streamSummary.neverShow")}
        </button>
      </div>
    </div>
  );
}
