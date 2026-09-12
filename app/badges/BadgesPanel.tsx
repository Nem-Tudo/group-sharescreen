"use client";

import { MdCheck } from "react-icons/md";
import { useAuth } from "@/lib/AuthContext";
import { getUserBadges, useBadgesCatalog, type BadgeDefinition } from "@/lib/badges";
import { useT } from "@/lib/useI18n";

// What every badge is and how somebody ends up with one.
//
// Read from the live catalogue (GET /badges) rather than from a list written
// here: badges are rows somebody adds in the database, and a page that
// explains them from a copy would start lying the first time one is added.
// Each row carries its own colours too, so a new badge arrives on this page
// looking like itself without a deploy.

function BadgeCard({ badge, owned }: { badge: BadgeDefinition; owned: boolean }) {
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
            <BadgeCard key={badge.id} badge={badge} owned={ownedIds.has(badge.id)} />
          ))}
        </ul>
      )}
    </main>
  );
}
