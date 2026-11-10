"use client";

import { useState } from "react";
import Link from "next/link";
import { MdLock, MdOpenInNew, MdOutlineShowChart, MdPublish } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { updateCustomCameraEffect, type CustomCameraEffect } from "@/lib/cameraCustomEffects";
import {
  CAMERA_WORKSHOP_EVENTS,
  CAMERA_WORKSHOP_FEATURE,
  publishWorkshopEffect,
  trackWorkshop,
  unpublishWorkshopEffect,
} from "@/lib/cameraEffectWorkshop";
import { accountTierOf, THEME_BAN_MESSAGE, TIER_NAMES, tierAtLeast } from "@/lib/entitlements";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { openProModal } from "@/lib/proModal";
import { useT } from "@/lib/useI18n";

// "Publicar no workshop", in the editor of an effect (see
// lib/cameraEffectWorkshop). Pro Max and up; below that it is shown locked and
// opens the plans, unless the account is in "camera-effects-free-publish", which
// lets anyone publish a few (the API decides how many). One taken from the
// workshop is somebody else's work, and cannot be handed out again under another name.

const PUBLISH_TIER = "premium_max" as const;

export const FREE_PUBLISH_FEATURE = "camera-effects-free-publish";
export const FREE_PUBLISH_EVENTS = {
  publish: "camfx_free_publish", // publicou (ou atualizou) sem ter Pro Max
  limit: "camfx_free_limit", // bateu no limite de publicados sem ter Pro Max
  upgrade: "camfx_free_upgrade", // abriu os planos pelo aviso do limite
};
function trackFreePublish(name: string) {
  trackFeatureEvent(name, { feature: FREE_PUBLISH_FEATURE });
}

const CHIP = "rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-50";
const CHIP_OFF =
  "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700";

export function CameraEffectPublish({ effect }: { effect: CustomCameraEffect }) {
  const t = useT();
  const { account } = useAuth();
  const enabled = useFeature(CAMERA_WORKSHOP_FEATURE, { track: false }).enabled;
  const hasPlan = Boolean(account && tierAtLeast(accountTierOf(account.flags), PUBLISH_TIER));
  // Exposure: this section shown to an account that would otherwise see it locked.
  const freePublish =
    useFeature(FREE_PUBLISH_FEATURE, { track: enabled && Boolean(account) && !hasPlan && !effect.sourceId }).enabled &&
    Boolean(account);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string; upgrade?: boolean } | null>(null);
  if (!enabled) return null;

  const title = <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{t("cameraWorkshop.publishTitle")}</h3>;

  if (effect.sourceId) {
    return (
      <section className="flex flex-col gap-1.5">
        {title}
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("cameraWorkshop.publishNotYours")}</p>
      </section>
    );
  }

  const viaExperiment = !hasPlan && freePublish;
  if (!hasPlan && !freePublish) {
    return (
      <section className="flex flex-col gap-1.5">
        {title}
        <button
          type="button"
          onClick={() => {
            trackWorkshop(CAMERA_WORKSHOP_EVENTS.locked);
            openProModal("camfx_publish", PUBLISH_TIER);
          }}
          className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1 self-start`}
        >
          <MdLock className="h-3 w-3 text-amber-500" />
          {t("cameraWorkshop.publish")}
          <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{TIER_NAMES[PUBLISH_TIER]}</span>
        </button>
      </section>
    );
  }

  const publish = async () => {
    setBusy(true);
    setMessage(null);
    const result = await publishWorkshopEffect(effect);
    setBusy(false);
    if (result.ok) {
      if (viaExperiment) trackFreePublish(FREE_PUBLISH_EVENTS.publish);
      setMessage({ error: false, text: t(result.updated ? "cameraWorkshop.updated" : "cameraWorkshop.published") });
    } else if (result.reason === "limit") {
      if (viaExperiment) trackFreePublish(FREE_PUBLISH_EVENTS.limit);
      setMessage({
        error: true,
        text: t(viaExperiment ? "cameraWorkshop.freeLimitReached" : "cameraWorkshop.limitReached", { limit: result.limit ?? 0 }),
        upgrade: viaExperiment,
      });
    } else if (result.reason === "plan") {
      // The site thought it could (a local override, or the experiment just ended).
      setMessage({ error: true, text: t("cameraWorkshop.publishError"), upgrade: true });
    } else if (result.reason === "banned") {
      setMessage({ error: true, text: THEME_BAN_MESSAGE });
    } else if (result.reason === "invalid") {
      // Said by the API, which knows which part it refused.
      setMessage({ error: true, text: result.message ?? t("cameraWorkshop.publishError") });
    } else {
      setMessage({ error: true, text: t("cameraWorkshop.publishError") });
    }
  };

  const unpublish = async () => {
    if (!effect.publishedId) return;
    setBusy(true);
    setMessage(null);
    const done = await unpublishWorkshopEffect(effect.publishedId);
    setBusy(false);
    setMessage(done ? null : { error: true, text: t("cameraWorkshop.publishError") });
  };

  return (
    <section className="flex flex-col gap-1.5">
      {title}
      <textarea
        value={effect.description ?? ""}
        maxLength={200}
        rows={2}
        placeholder={t("cameraWorkshop.descriptionPlaceholder")}
        aria-label={t("cameraWorkshop.descriptionPlaceholder")}
        onChange={(e) => {
          const description = e.target.value;
          updateCustomCameraEffect(effect.id, (current) => ({ ...current, description }));
        }}
        className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={busy} onClick={() => void publish()} className={`${CHIP} bg-emerald-600 text-white inline-flex items-center gap-1`}>
          <MdPublish className="h-3.5 w-3.5" />
          {busy
            ? t("cameraWorkshop.publishing")
            : t(effect.publishedId ? "cameraWorkshop.publishUpdate" : "cameraWorkshop.publish")}
        </button>
        {effect.publishedId && (
          <button type="button" disabled={busy} onClick={() => void unpublish()} className={`${CHIP} ${CHIP_OFF}`}>
            {t("cameraWorkshop.unpublish")}
          </button>
        )}
      </div>
      {effect.publishedId && (
        // In a new tab: the editor is open over the call.
        <div className="flex flex-wrap gap-1">
          <Link href={`/effect/${encodeURIComponent(effect.publishedId)}`} target="_blank" className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1`}>
            <MdOpenInNew className="h-3.5 w-3.5" />
            {t("cameraWorkshop.viewPage")}
          </Link>
          <Link href={`/effect/${encodeURIComponent(effect.publishedId)}/panel`} target="_blank" className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1`}>
            <MdOutlineShowChart className="h-3.5 w-3.5" />
            {t("cameraWorkshop.panel")}
          </Link>
        </div>
      )}
      {effect.publishedId && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{t("cameraWorkshop.publishedHint")}</p>}
      {message && (
        <p className={`text-[11px] ${message.error ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {message.text}
        </p>
      )}
      {message?.upgrade && (
        <button
          type="button"
          onClick={() => {
            if (viaExperiment) trackFreePublish(FREE_PUBLISH_EVENTS.upgrade);
            openProModal("camfx_publish", PUBLISH_TIER);
          }}
          className={`${CHIP} ${CHIP_OFF} inline-flex items-center gap-1 self-start`}
        >
          {t("cameraWorkshop.freeLimitUpgrade", { plan: TIER_NAMES[PUBLISH_TIER] })}
        </button>
      )}
    </section>
  );
}
