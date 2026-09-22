"use client";

import { useState } from "react";
import { BsCoin } from "react-icons/bs";
import { trackEvent } from "@/lib/analytics";
import { Tooltip } from "@/components/Tooltip";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { partnerWideImage, type PartnerCardData, type PartnerSchedule } from "@/lib/partner";
import { formatMinuteOfDay, parseMinuteOfDay, resolvePartnerCreative } from "@/lib/partnerSchedule";

// Kept separate from PartnerCard's PartnerCardData on purpose — every field
// here is a plain required string so each input can stay a normal
// controlled input without fighting that type's optional fields.
export type AdForm = {
  title: string;
  description: string;
  imageUrl: string;
  iconUrl: string;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor: string;
  textColor: string;
  buttonBackgroundColor: string;
  buttonTextColor: string;
  // The two rewards, as typed. Empty = the ad has none. Only ever drawn here —
  // this tool publishes nothing (see below) — so the video's length is asked
  // for rather than measured off a video the visitor does not have.
  rewardPoints: string;
  rewardSeconds: string;
  clickPoints: string;
};

// Where the tool starts — generic placeholders, not a copy of any real ad, so
// it reads as "your ad here" rather than nudging everyone toward one look.
// Shared by every place that opens it (the card's "ver exemplo", the pitch
// popup's "Montar meu anúncio").
export const CUSTOMIZER_STARTING_POINT: AdForm = {
  get title() { return translate("partnerCard.yourBrandHere"); },
  get description() { return translate("partnerCard.writeAShortCatchyDescriptionOf"); },
  imageUrl: "",
  iconUrl: "",
  get buttonLabel() { return translate("partnerCard.learnMore"); },
  buttonUrl: "https://",
  backgroundColor: "#111827",
  textColor: "#f4f4f5",
  buttonBackgroundColor: "#10b981",
  buttonTextColor: "#ffffff",
  rewardPoints: "",
  rewardSeconds: "30",
  clickPoints: "",
};

// The second daypart's fields. Blank = same as the ad (the real rule, see
// lib/partnerSchedule), so a visitor can try "only the banner changes at
// night" exactly the way it would really work.
type AltForm = {
  start: string;
  end: string;
  title: string;
  description: string;
  imageUrl: string;
  iconUrl: string;
  buttonLabel: string;
  backgroundColor: string;
  buttonBackgroundColor: string;
};

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const colorInputClass =
  "h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";
const sectionClass =
  "rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40";
const timeInputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const segmentClass = (active: boolean) =>
  `flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${
    active
      ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
      : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
  }`;

function formatSeconds(raw: string): string | null {
  const total = Math.floor(Number(raw));
  if (!Number.isFinite(total) || total <= 0) return null;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function toSchedule(alt: AltForm): PartnerSchedule {
  const blank = (v: string) => (v.trim() ? v : null);
  return {
    id: "customizer",
    label: "B",
    startMinute: parseMinuteOfDay(alt.start) ?? 19 * 60,
    endMinute: parseMinuteOfDay(alt.end) ?? 23 * 60 + 59,
    title: blank(alt.title),
    description: blank(alt.description),
    imageUrl: blank(alt.imageUrl),
    iconUrl: blank(alt.iconUrl),
    buttonLabel: blank(alt.buttonLabel),
    buttonUrl: null,
    backgroundColor: blank(alt.backgroundColor),
    textColor: null,
    buttonBackgroundColor: blank(alt.buttonBackgroundColor),
    buttonTextColor: null,
  };
}

// A self-serve preview tool, not a real submission flow — there's no
// "publish" here on purpose. It exists purely to let a would-be advertiser
// see their own ad mocked up in the real card layout, then hands off to a
// human (Discord) to actually set it up server-side via /partner.
export function PartnerAdCustomizer({
  initial,
  onClose,
  overlayClassName = "z-50",
}: {
  initial: AdForm;
  onClose: () => void;
  /** Stacking for the overlay — raised when opened from inside a popup. */
  overlayClassName?: string;
}) {
  const t = useT();
  const [form, setForm] = useState<AdForm>(initial);
  const [layout, setLayout] = useState<"vertical" | "horizontal">("vertical");
  const [altEnabled, setAltEnabled] = useState(false);
  const [alt, setAlt] = useState<AltForm>({
    start: "19:00",
    end: "23:59",
    title: "",
    description: "",
    imageUrl: "",
    iconUrl: "",
    buttonLabel: "",
    backgroundColor: "",
    buttonBackgroundColor: "",
  });
  // Which of the two configurations the preview shows.
  const [previewAlt, setPreviewAlt] = useState(false);

  function update<K extends keyof AdForm>(key: K, value: AdForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  function updateAlt<K extends keyof AltForm>(key: K, value: AltForm[K]) {
    setAlt((prev) => ({ ...prev, [key]: value }));
  }

  // The card as the preview draws it: the form, with configuration B laid
  // over it by the same resolver visitors' browsers use.
  const base: PartnerCardData = {
    title: form.title,
    description: form.description,
    imageUrl: form.imageUrl,
    iconUrl: form.iconUrl,
    buttonLabel: form.buttonLabel,
    buttonUrl: form.buttonUrl,
    backgroundColor: form.backgroundColor,
    textColor: form.textColor,
    buttonBackgroundColor: form.buttonBackgroundColor,
    buttonTextColor: form.buttonTextColor,
  };
  const schedule = toSchedule(alt);
  const creative =
    altEnabled && previewAlt
      ? resolvePartnerCreative({ ...base, schedules: [schedule] }, schedule.startMinute)
      : base;

  return (
    <div
      className={`fixed inset-0 ${overlayClassName} flex items-center justify-center bg-black/60 p-4`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {t("partnerAdCustomizer.seeHowYourAdWillLook")}
            </h2>
            <p className="mt-1 text-xs text-emerald-500 dark:text-emerald-400">
              {t("partnerAdCustomizer.weAreHappyToMakeChanges")}
            </p>
          </div>
          <Tooltip content={t("common.close")}>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="shrink-0 text-2xl leading-none text-zinc-400 transition hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              ×
            </button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Preview controls: which shape of the card, and — with a second
              configuration on — which of the two is showing. */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              {t("partnerAdCustomizer.preview")}
            </p>
            <div className="flex flex-wrap gap-2">
              {altEnabled && (
                <div className="flex w-44 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
                  <button type="button" onClick={() => setPreviewAlt(false)} className={segmentClass(!previewAlt)}>
                    {t("partnerAdCustomizer.configA")}
                  </button>
                  <button type="button" onClick={() => setPreviewAlt(true)} className={segmentClass(previewAlt)}>
                    {t("partnerAdCustomizer.configB")}
                  </button>
                </div>
              )}
              <div className="flex w-44 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
                <button type="button" onClick={() => setLayout("vertical")} className={segmentClass(layout === "vertical")}>
                  {t("partnerAdCustomizer.layoutVertical")}
                </button>
                <button type="button" onClick={() => setLayout("horizontal")} className={segmentClass(layout === "horizontal")}>
                  {t("partnerAdCustomizer.layoutHorizontal")}
                </button>
              </div>
            </div>
          </div>

          <CustomizerPreview
            creative={creative}
            horizontal={layout === "horizontal"}
            rewardPoints={form.rewardPoints.trim()}
            rewardDuration={formatSeconds(form.rewardSeconds)}
            clickPoints={form.clickPoints.trim()}
          />

          <div className="mt-5 flex flex-col gap-3">
            <div>
              <label className={labelClass}>{t("common.title")}</label>
              <input
                className={inputClass}
                maxLength={60}
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>{t("common.description")}</label>
              <textarea
                className={`${inputClass} resize-none`}
                rows={3}
                maxLength={200}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>{t("partnerAdCustomizer.imageUrlOptional")}</label>
                <input
                  className={inputClass}
                  value={form.imageUrl}
                  onChange={(e) => update("imageUrl", e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className={labelClass}>{t("partnerAdCustomizer.iconUrlOptional")}</label>
                <input
                  className={inputClass}
                  value={form.iconUrl}
                  onChange={(e) => update("iconUrl", e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <p className="-mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {t("partnerAdCustomizer.iconHint")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t("common.buttonText")}</label>
                <input
                  className={inputClass}
                  maxLength={30}
                  value={form.buttonLabel}
                  onChange={(e) => update("buttonLabel", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>{t("common.buttonLink")}</label>
                <input
                  className={inputClass}
                  value={form.buttonUrl}
                  onChange={(e) => update("buttonUrl", e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className={labelClass}>{t("common.background")}</label>
                <input
                  type="color"
                  className={colorInputClass}
                  value={form.backgroundColor}
                  onChange={(e) => update("backgroundColor", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>{t("common.text")}</label>
                <input
                  type="color"
                  className={colorInputClass}
                  value={form.textColor}
                  onChange={(e) => update("textColor", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>{t("common.button")}</label>
                <input
                  type="color"
                  className={colorInputClass}
                  value={form.buttonBackgroundColor}
                  onChange={(e) => update("buttonBackgroundColor", e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>{t("partnerAdCustomizer.buttonText")}</label>
                <input
                  type="color"
                  className={colorInputClass}
                  value={form.buttonTextColor}
                  onChange={(e) => update("buttonTextColor", e.target.value)}
                />
              </div>
            </div>

            {/* Rewards: what the person seeing the ad gets for engaging. */}
            <div className={sectionClass}>
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {t("partnerAdCustomizer.rewardsTitle")}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {t("partnerAdCustomizer.rewardsHint")}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>{t("partnerAdCustomizer.videoPoints")}</label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.rewardPoints}
                    onChange={(e) => update("rewardPoints", e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div>
                  <label className={labelClass}>{t("partnerAdCustomizer.videoSeconds")}</label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.rewardSeconds}
                    onChange={(e) => update("rewardSeconds", e.target.value)}
                    disabled={!form.rewardPoints.trim()}
                  />
                </div>
                <div>
                  <label className={labelClass}>{t("partnerAdCustomizer.clickPoints")}</label>
                  <input
                    type="number"
                    min={1}
                    className={inputClass}
                    value={form.clickPoints}
                    onChange={(e) => update("clickPoints", e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>

            {/* A second configuration for part of the day — the dayparting
                advertisers can buy (see lib/partnerSchedule). */}
            <div className={sectionClass}>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={altEnabled}
                  onChange={(e) => {
                    setAltEnabled(e.target.checked);
                    setPreviewAlt(e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                />
                {t("partnerAdCustomizer.scheduleTitle")}
              </label>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                {t("partnerAdCustomizer.scheduleHint")}
              </p>
              {altEnabled && (
                <div className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {t("partnerAdCustomizer.scheduleFrom")}
                    <input
                      type="time"
                      value={alt.start}
                      onChange={(e) => updateAlt("start", e.target.value)}
                      className={timeInputClass}
                    />
                    {t("partnerAdCustomizer.scheduleTo")}
                    <input
                      type="time"
                      value={alt.end}
                      onChange={(e) => updateAlt("end", e.target.value)}
                      className={timeInputClass}
                    />
                    <span className="text-[11px] text-zinc-500">
                      {t("partnerAdCustomizer.scheduleRestOfDay", {
                        from: formatMinuteOfDay(schedule.endMinute + 1),
                        to: formatMinuteOfDay(schedule.startMinute - 1),
                      })}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>{t("common.title")}</label>
                      <input
                        className={inputClass}
                        maxLength={60}
                        value={alt.title}
                        placeholder={form.title}
                        onChange={(e) => updateAlt("title", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{t("common.buttonText")}</label>
                      <input
                        className={inputClass}
                        maxLength={30}
                        value={alt.buttonLabel}
                        placeholder={form.buttonLabel}
                        onChange={(e) => updateAlt("buttonLabel", e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>{t("common.description")}</label>
                    <textarea
                      className={`${inputClass} resize-none`}
                      rows={2}
                      maxLength={200}
                      value={alt.description}
                      placeholder={form.description}
                      onChange={(e) => updateAlt("description", e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>{t("partnerAdCustomizer.imageUrlOptional")}</label>
                      <input
                        className={inputClass}
                        value={alt.imageUrl}
                        placeholder={form.imageUrl || "https://..."}
                        onChange={(e) => updateAlt("imageUrl", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{t("partnerAdCustomizer.iconUrlOptional")}</label>
                      <input
                        className={inputClass}
                        value={alt.iconUrl}
                        placeholder={form.iconUrl || "https://..."}
                        onChange={(e) => updateAlt("iconUrl", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>{t("common.background")}</label>
                      <input
                        type="color"
                        className={colorInputClass}
                        value={alt.backgroundColor || form.backgroundColor}
                        onChange={(e) => updateAlt("backgroundColor", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>{t("common.button")}</label>
                      <input
                        type="color"
                        className={colorInputClass}
                        value={alt.buttonBackgroundColor || form.buttonBackgroundColor}
                        onChange={(e) => updateAlt("buttonBackgroundColor", e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {t("partnerAdCustomizer.scheduleBlankHint")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <a
            href="https://go.nemtudo.me/golive-partner-nemtudodiscord"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("partner_customizer_discord_clicked")}
            className="block rounded-lg bg-[#5865f2] px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:opacity-90"
          >
            {t("partnerAdCustomizer.iLikeItTalkOnDiscord")}
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * The card, drawn from the tool's form. Mirrors PartnerCard's real markup in
 * both shapes — when the two drift, that one is the original.
 */
function CustomizerPreview({
  creative,
  horizontal,
  rewardPoints,
  rewardDuration,
  clickPoints,
}: {
  creative: PartnerCardData;
  horizontal: boolean;
  rewardPoints: string;
  rewardDuration: string | null;
  clickPoints: string;
}) {
  const t = useT();
  // Banner first, the square mark standing in (as a square) when there is
  // none — the real card's rule, see partnerWideImage.
  const hero = partnerWideImage(creative);
  const heroIsIcon = Boolean(hero) && !creative.imageUrl;
  const sideBySide = horizontal && Boolean(hero);

  return (
    <div
      className={`overflow-hidden rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 ${
        horizontal ? "w-full" : "w-72 max-w-full"
      } ${sideBySide ? "sm:flex sm:items-center sm:gap-5" : ""}`}
      style={{
        backgroundColor: creative.backgroundColor ?? undefined,
        color: creative.textColor ?? undefined,
      }}
    >
      {hero && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hero}
          alt=""
          className={
            heroIsIcon
              ? `mx-auto mb-2 aspect-square rounded-xl object-cover ring-1 ring-black/10 dark:ring-white/10 ${
                  horizontal ? "w-24 sm:mx-0 sm:mb-0 sm:w-32 sm:shrink-0" : "w-16"
                }`
              : horizontal
                ? "mb-2 aspect-video w-full rounded-lg object-cover sm:mb-0 sm:w-[15rem] sm:shrink-0"
                : "mb-2 max-h-32 w-full rounded-lg object-cover"
          }
        />
      )}
      <div className="min-w-0 sm:flex-1">
        <div className="mb-2 flex items-center">
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
            {t("common.sponsored")}
          </span>
        </div>
        <p className={`font-semibold ${horizontal ? "text-sm sm:text-base" : "text-sm"}`}>
          {creative.title || t("common.adTitle")}
        </p>
        <p className="mt-1 whitespace-pre-line text-xs opacity-80">
          {creative.description || t("common.adDescription")}
        </p>
        <div
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-center text-sm font-semibold"
          style={{
            backgroundColor: creative.buttonBackgroundColor ?? undefined,
            color: creative.buttonTextColor ?? undefined,
          }}
        >
          {clickPoints && (
            <>
              <BsCoin className="h-4 w-4 shrink-0" />
              <span className="shrink-0 tabular-nums">{clickPoints}</span>
            </>
          )}
          <span className="truncate">{creative.buttonLabel || t("common.button")}</span>
        </div>
        {rewardPoints && (
          <div
            className="partner-reward-glow mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-current px-3 py-1.5 text-xs font-semibold opacity-90"
            style={{ ["--partner-reward-glow-color" as string]: creative.buttonBackgroundColor ?? "#18181b" }}
          >
            <span className="truncate">
              {rewardDuration
                ? t("partnerCard.watchAndRedeem", { duration: rewardDuration })
                : t("common.redeem")}
            </span>
            <BsCoin className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 tabular-nums">{rewardPoints}</span>
          </div>
        )}
      </div>
    </div>
  );
}
