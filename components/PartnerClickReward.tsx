"use client";

import { BsCoin } from "react-icons/bs";
import { useT } from "@/lib/useI18n";
import { formatLocale } from "@/lib/i18n";

// How the partner-ctr experiment (see lib/partnerExperiment) shows click
// points. The old look — a coin and a bare number in front of the button's
// label, in the button's own colours — read like a price tag: "50 🪙 Saiba
// mais" looks like it costs 50 to click. These say the opposite: a "+", in
// gold whatever the advertiser's colours are, and in words above the button.

/** "+50 🪙" in gold — goes at the end of the button it pays for. */
export function PartnerClickRewardPill({
  points,
  size = "md",
}: {
  points: number;
  size?: "sm" | "md";
}) {
  const t = useT();
  const label = t("partnerCard.clickToEarnPoints", { points: points.toLocaleString(formatLocale()) });
  return (
    <span
      title={label}
      aria-label={label}
      className={`partner-reward-glow flex shrink-0 items-center gap-0.5 rounded-full bg-amber-400 font-bold tabular-nums text-amber-950 ring-1 ring-black/10 ${
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"
      }`}
      style={{ ["--partner-reward-glow-color" as string]: "#f59e0b" }}
    >
      +{points.toLocaleString(formatLocale())}
      <BsCoin className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
    </span>
  );
}

/** "🪙 Clique e ganhe 50 pontos" — the line over the button, where there is room for words. */
export function PartnerClickRewardHint({ points, className = "" }: { points: number; className?: string }) {
  const t = useT();
  return (
    <p className={`flex items-center justify-center gap-1 text-[11px] font-semibold ${className}`}>
      <BsCoin className="h-3 w-3 shrink-0 text-amber-400" />
      {t("partnerCard.clickToEarnPoints", { points: points.toLocaleString(formatLocale()) })}
    </p>
  );
}
