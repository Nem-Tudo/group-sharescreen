"use client";

import { useState } from "react";
import { MdClose } from "react-icons/md";
import { BsCoin } from "react-icons/bs";
import { trackEvent } from "@/lib/analytics";
import { usePeopleOnline } from "@/lib/peopleOnline";
import { formatLocale } from "@/lib/i18n";
import { useT } from "@/lib/useI18n";
import { FALLBACK_PARTNER } from "@/lib/partner";
import { CUSTOMIZER_STARTING_POINT, PartnerAdCustomizer } from "@/components/PartnerAdCustomizer";

// "Anuncie aqui também!" — the slot selling itself. An ntpopups popup type,
// registered as "partner_pitch" in NtPopups.tsx, opened from the button over a
// real ad (PartnerCard) and from the folded strip (PartnerCardMinimized).
//
// It used to swap the card in place for the house ad, which meant the pitch
// had to fit in the space of an ad and could say one sentence. A would-be
// advertiser deciding whether to spend money wants the rest: how many people,
// what an ad can do, and how to start — so it gets a page of its own, with the
// video that says it better than copy does.
//
// Named "partner", never "ad", like everything else around these cards:
// ad-blocker filter lists key off that word.

const PITCH_VIDEO_URL =
  "https://cdn.nemtudo.me/f/nemtudo/2026/08/31/VIDEO/GoLive%20Ad_Final.mp4";

export type PartnerPitchSource = "real_ad" | "minimized";

export type PartnerPitchPopupData = {
  /** Which button opened it — kept on every event below. */
  source: PartnerPitchSource;
};

/** The popup's size, for whoever opens it. */
export const PARTNER_PITCH_POPUP_SIZE = {
  width: "min(920px, calc(100vw - 30px))",
  maxWidth: "920px",
  maxHeight: "94dvh",
};

export function PartnerPitchModal({
  closePopup,
  data: { source },
}: {
  closePopup: (hasAction?: boolean) => void;
  data: PartnerPitchPopupData;
}) {
  const t = useT();
  const peopleOnline = usePeopleOnline();
  const [customizerOpen, setCustomizerOpen] = useState(false);

  const features = [
    t("partnerPitch.featureCreative"),
    t("partnerPitch.featureReward"),
    t("partnerPitch.featureSchedule"),
    t("partnerPitch.featureReport"),
  ];

  return (
    <div className="relative flex max-h-[94dvh] flex-col overflow-y-auto bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <button
        type="button"
        onClick={() => closePopup(true)}
        aria-label={t("common.close")}
        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70"
      >
        <MdClose className="h-5 w-5" />
      </button>

      {/* The video first: it is the pitch, and it says in thirty seconds
          what the copy below needs a paragraph for. Muted so it can start on
          its own — a popup that opens shouting is the fastest way to be
          closed — with the controls there to turn the sound on. */}
      <div className="bg-black">
        <video
          src={PITCH_VIDEO_URL}
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="auto"
          onPlay={() => trackEvent("partner_pitch_video_play", { source })}
          className="aspect-video w-full bg-black object-contain"
        />
      </div>

      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:p-6">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {t("partnerPitch.eyebrow")}
          </p>
          <h2 className="mt-1 text-xl font-bold leading-tight sm:text-2xl">
            {t("partnerPitch.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("partnerPitch.subtitle")}
          </p>

          <ul className="mt-4 flex flex-col gap-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          {/* The two numbers an advertiser asks first, as numbers. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
            <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <p className="text-2xl font-bold tabular-nums">
                {t("partnerPitch.dailyVisitorsValue")}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("partnerPitch.dailyVisitorsLabel")}
              </p>
            </div>
            <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
              <p className="flex items-center gap-1.5 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                {peopleOnline !== null ? peopleOnline.toLocaleString(formatLocale()) : "—"}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("partnerPitch.onlineNowLabel")}
              </p>
            </div>
          </div>

          <a
            href={FALLBACK_PARTNER.buttonUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("partner_pitch_cta", { source })}
            className="flex items-center justify-center rounded-xl bg-[#5865f2] px-4 py-3 text-center text-sm font-semibold text-white transition hover:opacity-90"
          >
            {t("partnerPitch.cta")}
          </a>
          <button
            type="button"
            onClick={() => {
              trackEvent("partner_customizer_opened", { source: `pitch_${source}` });
              setCustomizerOpen(true);
            }}
            className="rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("partnerPitch.buildMine")}
          </button>
          <p className="flex items-center justify-center gap-1 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
            <BsCoin className="h-3 w-3 shrink-0" />
            {t("partnerPitch.footnote")}
          </p>
        </div>
      </div>

      {customizerOpen && (
        <PartnerAdCustomizer
          initial={CUSTOMIZER_STARTING_POINT}
          onClose={() => setCustomizerOpen(false)}
          // Over this popup, which sits at ntpopups' own z-index (60).
          overlayClassName="z-[70]"
        />
      )}
    </div>
  );
}
