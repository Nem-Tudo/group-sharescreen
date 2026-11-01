"use client";

import { useEffect, useState } from "react";
import { MdCheck } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { getUserBadges, useBadgesCatalog, type BadgeDefinition } from "@/lib/badges";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import {
  isPlanBadge,
  PRO_BADGE_FEATURE,
  PRO_BADGE_MONTHS,
  proBadgeLevel,
  proBadgeLevelLabel,
  withProBadgeLevel,
} from "@/lib/proBadge";
import { useT } from "@/lib/useI18n";

// What every badge is and how somebody ends up with one.
//
// Read from the live catalogue (GET /badges) rather than from a list written
// here: badges are rows somebody adds in the database, and a page that
// explains them from a copy would start lying the first time one is added.
// Each row carries its own colours too, so a new badge arrives on this page
// looking like itself without a deploy.

/** Every level of a plan badge, with the one this person is on picked out. */
function ProBadgeLadder({ badge, current }: { badge: BadgeDefinition; current: number | null }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {t("badges.badgesPanel.proBadgeEvolves")}
      </p>
      <ul className="grid grid-cols-4 gap-1.5">
        {PRO_BADGE_MONTHS.map((_, level) => (
          <li
            key={level}
            className={`flex flex-col items-center gap-1 rounded-lg p-1.5 text-center ${
              level === current ? `border ${badge.borderClass ?? ""} ${badge.bgClass ?? ""}` : "border border-transparent"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withProBadgeLevel(badge, level).iconUrl} alt="" className="h-5 w-5" />
            <span className="text-[10px] leading-tight text-zinc-600 dark:text-zinc-400">{proBadgeLevelLabel(level)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BadgeCard({
  badge,
  owned,
  ladder,
  level,
}: {
  badge: BadgeDefinition;
  owned: boolean;
  ladder: boolean;
  level: number;
}) {
  const t = useT();
  return (
    <li
      className={`group relative flex flex-col gap-3 rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-zinc-950 ${
        badge.borderClass ?? "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {owned && (
        <span className="absolute top-4 right-4 flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <MdCheck className="h-3 w-3" />
          {t("badges.badgesPanel.youHave")}
        </span>
      )}

      <span
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border transition group-hover:scale-105 ${
          badge.bgClass ?? "bg-zinc-100 dark:bg-zinc-900"
        } ${badge.borderClass ?? "border-zinc-200 dark:border-zinc-800"}`}
      >
        {/* A data: URL from the catalogue row — the icons are inline SVG, so
            there is nothing for an image optimiser to fetch or resize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badge.iconUrl} alt="" className="h-7 w-7" />
      </span>

      <div className="flex flex-col gap-1">
        <h2 className={`text-lg font-semibold ${badge.textClass ?? "text-zinc-950 dark:text-zinc-50"}`}>
          {badge.name}
        </h2>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {badge.description}
        </p>
      </div>

      {ladder && isPlanBadge(badge.id) && <ProBadgeLadder badge={badge} current={owned ? level : null} />}
    </li>
  );
}

export function BadgesPanel() {
  const t = useT();
  const badges = useBadgesCatalog();
  const { account } = useAuth();
  // The same function the profile uses, so this page and a profile can never
  // disagree about who has what.
  const owned = account ? getUserBadges(account, true, badges) : [];
  const ownedIds = new Set(owned.map((badge) => badge.id));
  const { enabled: ladder } = useFeature(PRO_BADGE_FEATURE);
  const [now] = useState(() => Date.now());
  const level = proBadgeLevel(account?.premium?.streakStartedAt, now);

  useEffect(() => {
    if (ladder) trackFeatureEvent("pro_badge_ladder_view", { feature: PRO_BADGE_FEATURE });
  }, [ladder]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl dark:text-zinc-50">
          {t("common.badges")}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t("badges.badgesPanel.marksThatAppearOnTheProfile")} <b>{t("badges.badgesPanel.theyAreSpecial")}</b> {t("badges.badgesPanel.someAreEasyToGetOthers")}
        </p>
        {account && badges.length > 0 && (
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("badges.badgesPanel.youHave")}{" "}
            <span className="text-zinc-950 dark:text-zinc-50">
              {ownedIds.size} {t("common.ofWord")} {badges.length}
            </span>
            .
          </p>
        )}
      </header>

      {badges.length === 0 ? (
        // The catalogue is fetched, so an empty list means it has not arrived
        // yet — never "there are no badges", which would be a claim this page
        // has no way to make.
        <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">{t("badges.badgesPanel.loadingTheBadges")}</p>
      ) : (
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((badge) => (
            <BadgeCard key={badge.id} badge={badge} owned={ownedIds.has(badge.id)} ladder={ladder} level={level} />
          ))}
        </ul>
      )}
    </main>
  );
}
