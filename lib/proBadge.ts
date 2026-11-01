import type { BadgeDefinition } from "./badges";
import { translate } from "@/lib/i18n";

// What the three plan badges look like: the colour of the plan, and (behind the
// pro-badge-tenure experiment) a mark that evolves with the months subscribed.
//
// Decided here rather than read from the catalogue row. Production's rows were
// seeded before any of this and the boot never rewrites a row that exists, so
// the colours on them are stale; and an evolving mark cannot be one stored image
// anyway. The name and the description still come from the row.

export const PRO_BADGE_FEATURE = "pro-badge-tenure";

const PLAN_BADGE_IDS = ["pro", "pro_max", "pro_ultra"] as const;
type PlanBadgeId = (typeof PLAN_BADGE_IDS)[number];

export function isPlanBadge(id: string): id is PlanBadgeId {
  return (PLAN_BADGE_IDS as readonly string[]).includes(id);
}

interface PlanTone {
  /** The mark's colour, and a lighter one for the top level's gradient. */
  hex: string;
  light: string;
  /** Chip classes by emphasis: the first levels, the filled ones, the top two. */
  chips: readonly [string, string, string];
  bgClass: string;
  textClass: string;
  borderClass: string;
}

// The same colours as the plan's verified mark and its card on /pro (see
// app/pro/ProCardsLayout's TIER_TONES). Whole class names, for Tailwind to find.
const PLAN_TONES: Record<PlanBadgeId, PlanTone> = {
  pro: {
    hex: "#3b82f6",
    light: "#93c5fd",
    chips: [
      "border-blue-500/30 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-400",
      "border-blue-500/60 bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 dark:border-blue-400/70 dark:bg-blue-500/25 dark:text-blue-400",
      "border-blue-500 bg-blue-500/20 text-blue-600 shadow-[0_0_7px_rgba(59,130,246,0.7)] hover:bg-blue-500/30 dark:border-blue-400 dark:bg-blue-500/30 dark:text-blue-400",
    ],
    bgClass: "bg-blue-500/15",
    textClass: "text-blue-500",
    borderClass: "border-blue-500/30",
  },
  pro_max: {
    hex: "#f59e0b",
    light: "#fcd34d",
    chips: [
      "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-400",
      "border-amber-500/60 bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:border-amber-400/70 dark:bg-amber-500/25 dark:text-amber-400",
      "border-amber-500 bg-amber-500/20 text-amber-600 shadow-[0_0_7px_rgba(245,158,11,0.7)] hover:bg-amber-500/30 dark:border-amber-400 dark:bg-amber-500/30 dark:text-amber-400",
    ],
    bgClass: "bg-amber-500/15",
    textClass: "text-amber-500",
    borderClass: "border-amber-500/30",
  },
  pro_ultra: {
    hex: "#f43f5e",
    light: "#fda4af",
    chips: [
      "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-400",
      "border-rose-500/60 bg-rose-500/15 text-rose-600 hover:bg-rose-500/25 dark:border-rose-400/70 dark:bg-rose-500/25 dark:text-rose-400",
      "border-rose-500 bg-rose-500/20 text-rose-600 shadow-[0_0_7px_rgba(244,63,94,0.7)] hover:bg-rose-500/30 dark:border-rose-400 dark:bg-rose-500/30 dark:text-rose-400",
    ],
    bgClass: "bg-rose-500/15",
    textClass: "text-rose-500",
    borderClass: "border-rose-500/30",
  },
};

/** The months that reach each level, lowest first. Level 0 is everyone. */
export const PRO_BADGE_MONTHS = [1, 2, 3, 4, 5, 6, 12, 24] as const;

/** Whole calendar months between two instants, in UTC. */
export function completedMonths(start: number, now: number): number {
  if (now <= start) return 0;
  const a = new Date(start);
  const b = new Date(now);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  // Not there yet if this month has not reached the day and time it started on.
  // A start on the 31st reaches a shorter month on that month's last day.
  const anchor = new Date(start);
  anchor.setUTCDate(1);
  anchor.setUTCMonth(a.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  anchor.setUTCDate(Math.min(a.getUTCDate(), lastDay));
  return now >= anchor.getTime() ? months : months - 1;
}

/** Which level a streak has reached. No start on file reads as the first. */
export function proBadgeLevel(streakStartedAt: number | null | undefined, now: number): number {
  if (!streakStartedAt) return 0;
  const months = completedMonths(streakStartedAt, now);
  let level = 0;
  PRO_BADGE_MONTHS.forEach((needed, index) => {
    if (months >= needed) level = index;
  });
  return level;
}

/** "2 meses", "1 ano": how long one level takes to reach. */
export function proBadgeLevelLabel(level: number): string {
  const months = PRO_BADGE_MONTHS[level] ?? 1;
  if (months === 1) return translate("badges.proBadge.oneMonth");
  if (months === 12) return translate("badges.proBadge.oneYear");
  if (months % 12 === 0) return translate("badges.proBadge.years", { value: months / 12 });
  return translate("badges.proBadge.months", { value: months });
}

const BOLT = "M13 2 3 14h9l-1 8 10-12h-9l1-8z";
const SHIELD = "M12 1.5 21 5v7c0 5.5-3.8 8.9-9 10.5C6.8 20.9 3 17.5 3 12V5z";
const HEXAGON = "M12 1 21.5 6.5v11L12 23l-9.5-5.5v-11z";
const STAR =
  "m12 .5 2.8 3.7 4.5-1 .4 4.6 4 2.2-2.2 4 1.3 4.4-4.5 1-1.8 4.3-4.5-1.7-4.5 1.7-1.8-4.3-4.5-1 1.3-4.4-2.2-4 4-2.2.4-4.6 4.5 1z";
const CROWN = "M1.5 6.5 7 11l5-8.5L17 11l5.5-4.5L20 21H4z";

function smallBolt(fill: string, scale = 0.62): string {
  return `<path fill="${fill}" transform="translate(12 12) scale(${scale}) translate(-12 -12)" d="${BOLT}"/>`;
}

function outlined(shape: string, hex: string): string {
  return `<path fill="none" stroke="${hex}" stroke-width="2" stroke-linejoin="round" d="${shape}"/>${smallBolt(hex, 0.55)}`;
}

function filled(shape: string, hex: string): string {
  return `<path fill="${hex}" d="${shape}"/>${smallBolt("#fff")}`;
}

/**
 * The mark for one level. Each one has to read as different at 16px, which is
 * why they change shape rather than detail: the plain bolt, then outlined, then
 * solid, then the two top levels.
 */
function levelSvg(level: number, tone: PlanTone): string {
  const { hex, light } = tone;
  switch (level) {
    case 1:
      return `<circle cx="12" cy="12" r="10" fill="none" stroke="${hex}" stroke-width="2"/>${smallBolt(hex, 0.55)}`;
    case 2:
      return outlined(SHIELD, hex);
    case 3:
      return `<circle cx="12" cy="12" r="11" fill="${hex}"/>${smallBolt("#fff")}`;
    case 4:
      return filled(SHIELD, hex);
    case 5:
      return filled(HEXAGON, hex);
    case 6:
      return filled(STAR, hex);
    case 7:
      return (
        `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${hex}"/></linearGradient></defs>` +
        `<path fill="url(#g)" d="${CROWN}"/><path fill="#fff" transform="translate(12 14) scale(0.42) translate(-12 -12)" d="${BOLT}"/>`
      );
    default:
      return `<path fill="${hex}" d="${BOLT}"/>`;
  }
}

function levelIcon(level: number, tone: PlanTone): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${levelSvg(level, tone)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A plan badge in its plan's colour. Anything else comes back as it was. */
export function withPlanTheme<T extends BadgeDefinition>(badge: T): T {
  if (!isPlanBadge(badge.id)) return badge;
  const tone = PLAN_TONES[badge.id];
  return {
    ...badge,
    iconUrl: levelIcon(0, tone),
    chipClass: tone.chips[0],
    bgClass: tone.bgClass,
    textClass: tone.textClass,
    borderClass: tone.borderClass,
  };
}

/** A plan badge at one level of the evolution. */
export function withProBadgeLevel(badge: BadgeDefinition, level: number): BadgeDefinition {
  if (!isPlanBadge(badge.id)) return badge;
  const tone = PLAN_TONES[badge.id];
  return {
    ...badge,
    iconUrl: levelIcon(level, tone),
    chipClass: tone.chips[level >= 6 ? 2 : level >= 3 ? 1 : 0],
  };
}
