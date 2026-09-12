"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { Tooltip } from "@/components/Tooltip";
import { useT } from "@/lib/useI18n";

// Kept separate from PartnerCard's PartnerCardData on purpose — every field
// here is a plain required string so each input can stay a normal
// controlled input without fighting that type's optional fields.
export type AdForm = {
  title: string;
  description: string;
  imageUrl: string;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor: string;
  textColor: string;
  buttonBackgroundColor: string;
  buttonTextColor: string;
};

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const colorInputClass =
  "h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";

// A self-serve preview tool, not a real submission flow — there's no
// "publish" here on purpose. It exists purely to let a would-be advertiser
// see their own ad mocked up in the real card layout, then hands off to a
// human (Discord) to actually set it up server-side via /partner.
export function PartnerAdCustomizer({
  initial,
  onClose,
}: {
  initial: AdForm;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState<AdForm>(initial);

  function update<K extends keyof AdForm>(key: K, value: AdForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950"
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
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            {t("partnerAdCustomizer.preview")}
          </p>
          <div
            className="mb-5 w-72 max-w-full overflow-hidden rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            style={{ backgroundColor: form.backgroundColor, color: form.textColor }}
          >
            <div className="mb-2 flex items-center">
              <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-70 dark:bg-white/10">
                {t("common.sponsored")}
              </span>
            </div>
            {form.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.imageUrl} alt="" className="mb-2 max-h-32 w-full rounded-lg object-cover" />
            )}
            <p className="text-sm font-semibold">{form.title || t("common.adTitle")}</p>
            <p className="mt-1 whitespace-pre-line text-xs opacity-80">
              {form.description || t("common.adDescription")}
            </p>
            <div
              className="mt-3 rounded-lg px-3 py-2 text-center text-sm font-semibold"
              style={{ backgroundColor: form.buttonBackgroundColor, color: form.buttonTextColor }}
            >
              {form.buttonLabel || t("common.button")}
            </div>
          </div>

          <div className="flex flex-col gap-3">
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
            <div>
              <label className={labelClass}>{t("partnerAdCustomizer.imageUrlOptional")}</label>
              <input
                className={inputClass}
                value={form.imageUrl}
                onChange={(e) => update("imageUrl", e.target.value)}
                placeholder="https://..."
              />
            </div>
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
