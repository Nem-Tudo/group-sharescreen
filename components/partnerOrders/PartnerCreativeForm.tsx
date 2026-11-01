"use client";

import { useRef, type ReactNode } from "react";
import { PartnerImageUpload, PartnerMediaDrop } from "@/app/admin/PartnerMediaDrop";
import { PartnerScheduleEditor } from "@/app/admin/PartnerScheduleEditor";
import { useT } from "@/lib/useI18n";
import { BsCoin } from "react-icons/bs";
import {
  PARTNER_DISCORD_URL,
  SELF_SERVE_PARTNER_EVENTS,
  SELF_SERVE_VIDEO_REWARD_POINTS,
  trackPartnerOrderEvent,
  type PartnerCreative,
} from "@/lib/partnerOrders";

// The ad's fields, as the advertiser edits them — the same ones the admin form
// has (see app/admin/PartnerAdsPanel.tsx) minus the house's own (weight,
// expiry), split in two so the wizard can give each a step of its own:
//
//   "card"   — what the card says and looks like. Required.
//   "extras" — rewards, the long description and dayparts. All optional.

// Mirrors the API's limits (signaling.ts's PARTNER_*_MAX_LEN).
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 400;
const BUTTON_LABEL_MAX = 40;
const EXTENDED_DESCRIPTION_MAX = 20000;

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const colorInputClass =
  "mt-1 h-10 w-full cursor-pointer rounded-lg border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700 dark:text-zinc-300";
const hintClass = "mt-1 text-[11px] text-zinc-500 dark:text-zinc-400";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** What is missing before the card can be sent, or null when nothing is. */
export function creativeProblem(creative: PartnerCreative, t: (key: string) => string): string | null {
  if (!creative.title.trim()) return t("partnerOrders.form.needTitle");
  if (!creative.description.trim()) return t("partnerOrders.form.needDescription");
  if (!creative.buttonLabel.trim()) return t("partnerOrders.form.needButtonLabel");
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(creative.buttonUrl.trim())) return t("partnerOrders.form.needButtonUrl");
  if ((creative.schedules ?? []).some((s) => s.startMinute === s.endMinute)) return t("partnerOrders.form.badSchedule");
  return null;
}

export function PartnerCreativeForm({
  value,
  onChange,
  section,
}: {
  value: PartnerCreative;
  onChange: (next: PartnerCreative) => void;
  section: "card" | "extras";
}) {
  const t = useT();
  const extendedCaretRef = useRef<number | null>(null);

  function set<K extends keyof PartnerCreative>(key: K, next: PartnerCreative[K]) {
    onChange({ ...value, [key]: next });
  }
  const text = (raw: string) => (raw.trim() ? raw : null);
  // A reward video always pays the fixed amount; no video, no points.
  const setVideo = (url: string | null) =>
    onChange({ ...value, rewardVideoUrl: url, rewardPoints: url ? SELF_SERVE_VIDEO_REWARD_POINTS : null });

  if (section === "card") {
    return (
      <div className="flex flex-col gap-4">
        <Section title={t("partnerOrders.form.textTitle")} hint={t("partnerOrders.form.textHint")}>
          <div>
            <label className={labelClass} htmlFor="po-title">{t("common.title")}</label>
            <input
              id="po-title"
              className={inputClass}
              maxLength={TITLE_MAX}
              value={value.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={t("partnerCard.yourBrandHere")}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="po-description">{t("common.description")}</label>
            <textarea
              id="po-description"
              className={`${inputClass} resize-y`}
              rows={3}
              maxLength={DESCRIPTION_MAX}
              value={value.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={t("partnerCard.writeAShortCatchyDescriptionOf")}
            />
            <p className={`${hintClass} flex justify-between`}>
              <span>{t("admin.partnerAdsPanel.lineBreaksAreKept")}</span>
              <span className="tabular-nums">{value.description.length}/{DESCRIPTION_MAX}</span>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="po-button-label">{t("common.buttonText")}</label>
              <input
                id="po-button-label"
                className={inputClass}
                maxLength={BUTTON_LABEL_MAX}
                value={value.buttonLabel}
                onChange={(e) => set("buttonLabel", e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="po-button-url">{t("common.buttonLink")}</label>
              <input
                id="po-button-url"
                className={inputClass}
                value={value.buttonUrl}
                onChange={(e) => set("buttonUrl", e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
        </Section>

        <Section title={t("partnerOrders.form.imagesTitle")} hint={t("partnerOrders.form.imagesHint")}>
          <div>
            <p className={labelClass}>{t("partnerOrders.form.banner")}</p>
            <PartnerImageUpload value={value.imageUrl} onChange={(url) => set("imageUrl", url)} />
          </div>
          <div>
            <p className={labelClass}>{t("partnerOrders.form.icon")}</p>
            <p className={hintClass}>{t("partnerAdCustomizer.iconHint")}</p>
            <PartnerImageUpload square value={value.iconUrl} onChange={(url) => set("iconUrl", url)} />
          </div>
        </Section>

        <Section title={t("partnerOrders.form.colorsTitle")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["backgroundColor", t("common.background"), "#111827"],
                ["textColor", t("common.text"), "#f4f4f5"],
                ["buttonBackgroundColor", t("common.button"), "#10b981"],
                ["buttonTextColor", t("partnerAdCustomizer.buttonText"), "#ffffff"],
              ] as const
            ).map(([key, label, fallback]) => (
              <div key={key}>
                <label className={labelClass} htmlFor={`po-${key}`}>{label}</label>
                <input
                  id={`po-${key}`}
                  type="color"
                  className={colorInputClass}
                  value={value[key] ?? fallback}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  }

  // --- extras ---
  function insertExtendedImage(url: string) {
    const current = value.extendedDescription ?? "";
    const caret = extendedCaretRef.current;
    const at = caret === null ? current.length : Math.min(caret, current.length);
    const before = current.slice(0, at);
    const after = current.slice(at);
    const snippet = `${before && !before.endsWith("\n") ? "\n" : ""}![](${url})${after.startsWith("\n") ? "" : "\n"}`;
    set("extendedDescription", before + snippet + after);
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title={t("partnerOrders.form.videoTitle")} hint={t("partnerOrders.form.videoHint")}>
        <div>
          <label className={labelClass} htmlFor="po-video">{t("admin.partnerAdsPanel.videoLinkMp4")}</label>
          <input
            id="po-video"
            className={inputClass}
            value={value.rewardVideoUrl ?? ""}
            onChange={(e) => setVideo(text(e.target.value))}
            placeholder="https://cdn.../video.mp4"
          />
          <PartnerMediaDrop advertiser kind="video" onUploaded={setVideo} />
        </div>
        {/* The points are not the advertiser's to pick (see the API's
            SELF_SERVE_VIDEO_REWARD_POINTS); more is a conversation. */}
        <div className="flex flex-col gap-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-semibold">
            <BsCoin className="h-3.5 w-3.5 shrink-0" />
            {t("partnerOrders.form.videoPoints", { points: SELF_SERVE_VIDEO_REWARD_POINTS })}
          </p>
          <p>
            {t("partnerOrders.form.morePoints")}{" "}
            <a
              href={PARTNER_DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackPartnerOrderEvent(SELF_SERVE_PARTNER_EVENTS.discordClick)}
              className="font-semibold text-[#5865f2] underline underline-offset-2"
            >
              {t("partnerOrders.discord.cta")}
            </a>
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="po-extended">{t("admin.partnerAdsPanel.extendedDescriptionOptional")}</label>
          <textarea
            id="po-extended"
            onSelect={(e) => {
              extendedCaretRef.current = e.currentTarget.selectionStart;
            }}
            className={`${inputClass} font-mono text-xs`}
            rows={6}
            maxLength={EXTENDED_DESCRIPTION_MAX}
            value={value.extendedDescription ?? ""}
            onChange={(e) => set("extendedDescription", text(e.target.value))}
            placeholder={"## Título\n**negrito**, *itálico*, [link](https://...)\n![imagem](https://.../imagem.png)"}
          />
          <p className={`${hintClass} flex justify-between gap-2`}>
            <span>{t("admin.partnerAdsPanel.extendedDescriptionHint")}</span>
            <span className="tabular-nums">{(value.extendedDescription ?? "").length}/{EXTENDED_DESCRIPTION_MAX}</span>
          </p>
          <PartnerMediaDrop advertiser kind="image" compact onUploaded={insertExtendedImage} />
        </div>
      </Section>

      <Section title={t("partnerOrders.form.scheduleTitle")} hint={t("partnerAdCustomizer.scheduleHint")}>
        <PartnerScheduleEditor
          advertiser
          schedules={value.schedules ?? []}
          onChange={(schedules) => set("schedules", schedules)}
          base={{
            title: value.title,
            description: value.description,
            imageUrl: value.imageUrl ?? "",
            iconUrl: value.iconUrl ?? "",
            buttonLabel: value.buttonLabel,
            buttonUrl: value.buttonUrl,
            backgroundColor: value.backgroundColor ?? "#111827",
            textColor: value.textColor ?? "#f4f4f5",
            buttonBackgroundColor: value.buttonBackgroundColor ?? "#10b981",
            buttonTextColor: value.buttonTextColor ?? "#ffffff",
          }}
        />
      </Section>
    </div>
  );
}
