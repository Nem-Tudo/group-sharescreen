"use client";

import Link from "next/link";
import { Tooltip } from "./Tooltip";
import { getUserBadges, useBadgesCatalog, type BadgeDefinition } from "@/lib/badges";
import type { ProfileThemeStyle } from "@/lib/profileTheme";
import type { Account } from "@/lib/accountApi";
import { useT } from "@/lib/useI18n";

interface UserBadgesProps {
  account: Pick<Account, "id" | "username" | "flags" | "createdAt" | "premium" | "features">;
  isOwner?: boolean;
  className?: string;
  /**
   * The profile's own palette, when it has one (see lib/profileTheme).
   *
   * Only the help mark reads it. The badges themselves keep their own colours
   * on purpose — a badge's colour is what identifies it, and re-tinting them
   * per profile would make the same badge look like a different one on every
   * card.
   */
  theme?: ProfileThemeStyle;
}

export function UserBadges({ account, isOwner, className, theme }: UserBadgesProps) {
  const catalog = useBadgesCatalog();
  const badges = getUserBadges(account, isOwner, catalog);
  if (badges.length === 0) return null;

  return (
    <div className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {badges.map((badge) => (
        <BadgeItem key={badge.id} badge={badge} />
      ))}
      <BadgesHelp theme={theme} />
    </div>
  );
}

/**
 * The "what are these?" mark, next to the badges it is about.
 *
 * Only ever drawn beside real badges — the component above returns nothing
 * when there are none, and a lone question mark on a profile with nothing to
 * explain would be a control pointing at empty space.
 *
 * Opens in a new tab, and that is not a preference: this same card is shown
 * inside a room (see components/UserProfileDialog), where an ordinary
 * navigation would tear down the call to answer a question about an icon. The
 * dialog's own "abrir em nova aba" control settles it the same way.
 *
 * Smaller than the badges and in the muted colour, so it reads as an aside
 * rather than as one more badge somebody earned.
 *
 * On a profile with a custom background it takes that palette's own quiet tier
 * instead of the fixed zinc, which is the same reason every other secondary
 * line on the card does: a grey chosen against white sits somewhere between
 * invisible and illegible once there is a gradient behind it.
 */
function BadgesHelp({ theme }: { theme?: ProfileThemeStyle }) {
  const t = useT();
  return (
    <Tooltip content={t("userBadges.whatAreTheseBadges")} placement="top">
      <Link
        href="/badges"
        target="_blank"
        aria-label={t("userBadges.learnMoreAboutTheBadges")}
        style={
          theme
            ? { color: theme.faint, borderColor: theme.border, textShadow: theme.textShadow }
            : undefined
        }
        // The hover cue is the scale, not the colour, because an inline style
        // beats a `hover:` class and a themed mark would otherwise sit there
        // not reacting at all. It is also what the badges beside it already do.
        className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-300 text-[10px] font-bold leading-none text-zinc-400 transition-all duration-150 hover:scale-110 hover:border-zinc-400 hover:text-zinc-600 active:scale-95 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
      >
        ?
      </Link>
    </Tooltip>
  );
}

function BadgeItem({ badge }: { badge: BadgeDefinition }) {
  const t = useT();
  const tooltipContent = (
    <div className="flex flex-col gap-1 p-1 max-w-[220px] text-left">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center p-1 rounded-md border ${badge.bgClass ?? "bg-zinc-800/40"} ${badge.borderClass ?? "border-zinc-700/50"}`}
        >
          <img
            src={badge.iconUrl}
            alt={badge.name}
            className="h-full w-full object-contain pointer-events-none select-none"
            loading="lazy"
          />
        </span>
        <div className="min-w-0">
          <span className="text-xs font-semibold text-zinc-100 truncate block">{badge.name}</span>
        </div>
      </div>
      <p className="text-[11px] leading-snug text-zinc-300">
        {badge.description}
      </p>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} placement="top" delay={[150, 0]}>
      <button
        type="button"
        aria-label={`${badge.name}: ${badge.description}`}
        className={`inline-flex h-5 w-5 items-center justify-center p-0.5 rounded-md border transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer overflow-hidden ${badge.chipClass ?? "border-zinc-700/40 bg-zinc-800/20"}`}
      >
        <img
          src={badge.iconUrl}
          alt={badge.name}
          className="h-3.5 w-3.5 object-contain pointer-events-none select-none"
          loading="lazy"
        />
      </button>
    </Tooltip>
  );
}
