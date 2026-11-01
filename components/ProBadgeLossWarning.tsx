"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getUserBadges, useBadgesCatalog, type BadgeDefinition } from "@/lib/badges";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import {
  isPlanBadge,
  PRO_BADGE_FEATURE,
  proBadgeLevel,
  proBadgeLevelLabel,
  withProBadgeLevel,
} from "@/lib/proBadge";
import { useT } from "@/lib/useI18n";

export interface ProBadgeAtRisk {
  badge: BadgeDefinition;
  level: number;
}

/**
 * The badge level this account would lose, or null when there is none.
 *
 * Null on the first level, which has nothing to lose, and outside the
 * experiment, where the person has never seen a level to be warned about.
 */
export function useProBadgeAtRisk(): ProBadgeAtRisk | null {
  const { account } = useAuth();
  const catalog = useBadgesCatalog();
  const { enabled } = useFeature(PRO_BADGE_FEATURE, { track: false });
  const [now] = useState(() => Date.now());
  if (!enabled || !account) return null;
  const badge = getUserBadges(account, true, catalog).find((entry) => isPlanBadge(entry.id));
  const level = proBadgeLevel(account.premium?.streakStartedAt, now);
  return badge && level > 0 ? { badge, level } : null;
}

/**
 * The warning, shown when a flow opens and again at its confirm button. Only
 * the last one takes `onConfirmedChange`, which draws the checkbox that button
 * waits on; the first one is what counts as the warning having been seen.
 *
 * The wording differs because the two lose the level at different moments: a
 * downgrade restarts the count when it is bought, and a cancellation only once
 * the access already paid for has run out.
 */
export function ProBadgeLossWarning({
  risk,
  body,
  confirmed,
  onConfirmedChange,
}: {
  risk: ProBadgeAtRisk;
  body: string;
  confirmed?: boolean;
  onConfirmedChange?: (confirmed: boolean) => void;
}) {
  const t = useT();
  const opening = !onConfirmedChange;
  const shown = useRef(false);
  useEffect(() => {
    if (!opening || shown.current) return;
    shown.current = true;
    trackFeatureEvent("pro_badge_loss_warning", { value: risk.level + 1, feature: PRO_BADGE_FEATURE });
  }, [opening, risk.level]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <div className="flex items-start gap-2.5">
        {/* A data: URL built in lib/proBadge, so there is nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withProBadgeLevel(risk.badge, risk.level).iconUrl} alt="" className="mt-0.5 h-6 w-6 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">
            {t("badges.proBadgeLoss.title", { value: proBadgeLevelLabel(risk.level) })}
          </p>
          <p className="leading-relaxed">{body}</p>
        </div>
      </div>
      {onConfirmedChange && (
        <label className="flex cursor-pointer items-start gap-2 font-medium">
          <input
            type="checkbox"
            checked={Boolean(confirmed)}
            onChange={(event) => {
              onConfirmedChange(event.target.checked);
              if (event.target.checked) {
                trackFeatureEvent("pro_badge_loss_confirm", { value: risk.level + 1, feature: PRO_BADGE_FEATURE });
              }
            }}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-amber-600"
          />
          <span>{t("badges.proBadgeLoss.confirm")}</span>
        </label>
      )}
    </div>
  );
}
