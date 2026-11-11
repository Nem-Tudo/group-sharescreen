"use client";

import { useEffect } from "react";
import { MdLockOpen } from "react-icons/md";
import { trackFeatureEvent } from "@/lib/features";
import { BILLING_RESCUE_EVENTS, DOOR_CONTEXT_FEATURE } from "@/lib/billingRescue";
import { useT } from "@/lib/useI18n";

// "What you just tried is in this plan" — the card at the top of the plans when
// they were opened by a lock (experiment pro-door-context).
//
// The doors where somebody tried a specific thing (a room theme, a second
// screen, a tool) were opened thousands of times a week and sold almost
// nothing: the plans opened on a generic pitch, and the thing they clicked was
// nowhere on it. This names it first.

/** The lock doors this card has words for (texts: proDoor.<door>.title/body). */
export const DOOR_CONTEXT_DOORS: ReadonlySet<string> = new Set([
  "multi_screen",
  "multi_camera",
  "room_theme",
  "group_theme",
  "aura",
  "emoji",
  "translation",
  "transcript",
  "room_tools",
  "camfx_others",
  "camfx_publish",
  "camfx_custom_bg",
  "camfx_stream_bg",
  "theme_hub",
  "theme_editor",
  "quality_select",
]);

export function ProDoorContext({ door, planTitle }: { door: string; planTitle: string }) {
  const t = useT();
  useEffect(() => {
    trackFeatureEvent(BILLING_RESCUE_EVENTS.doorSeen, { feature: DOOR_CONTEXT_FEATURE });
  }, []);
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-sky-300 bg-sky-50 p-3 dark:border-sky-500/40 dark:bg-sky-500/10">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
        <MdLockOpen className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300">
          {t("proDoor.youTried")}
        </p>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t(`proDoor.${door}.title`)}</p>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{t(`proDoor.${door}.body`)}</p>
        <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">
          {t("proDoor.includedIn", { plan: planTitle })}
        </p>
      </div>
    </div>
  );
}
