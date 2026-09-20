"use client";

import { useCallback, type ReactNode } from "react";
import { MdAutoAwesome } from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { useFeature } from "@/lib/features";
import { GROUP_AURA_FEATURE } from "@/lib/groupAura";
import type { GroupDetail } from "@/lib/groupsApi";
import { translate, translateCount } from "@/lib/i18n";

// The mark after the name of somebody "farmando aura" in a group — giving it
// auras that count (Discord's boost icon). Drawn by DisplayUserName when it
// is handed an `aura` count; the counts come from the group detail's
// auraGivers.

export function AuraMark({ count, className = "" }: { count: number; className?: string }) {
  const label = translateCount("groups.aura.farmingMark", count);
  return (
    <Tooltip content={label}>
      <span
        aria-label={label}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 p-[3px] text-white shadow-sm ${className}`}
      >
        <MdAutoAwesome className="h-2.5 w-2.5" />
      </span>
    </Tooltip>
  );
}

/** The id of the gradient a level 3 group's mark is filled with. */
const AURA_GRADIENT_ID = "golive-aura-gradient";

/**
 * The gradient itself, in an SVG of no size — a mark filled with
 * `url(#AURA_GRADIENT_ID)` needs it somewhere on the page. Rendered beside
 * every lit mark rather than once at the root: several copies of the same id
 * are harmless (the first one answers), and this way nothing has to be
 * remembered to put anywhere.
 */
function AuraGradientDef() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <linearGradient id={AURA_GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d946ef" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * How a group's globe or lock is lit by its aura level (see GroupName, which
 * draws the mark itself): white at level 1, blue at level 2, and the aura's
 * own gradient at level 3 — each with the glow around it.
 *
 * Level 1's white needs the thin grey halo under its glow, or the mark
 * vanishes into a white page.
 */
const AURA_LIT: Record<number, { className: string; fill?: string; textShadow: string }> = {
  1: {
    className: "text-white",
    textShadow: "drop-shadow(0 0 1px rgba(113,113,122,0.9)) drop-shadow(0 0 4px rgba(255,255,255,0.95))",
  },
  2: {
    className: "text-sky-400",
    textShadow: "drop-shadow(0 0 4px rgba(56,189,248,0.9))",
  },
  3: {
    className: "text-violet-500",
    fill: `url(#${AURA_GRADIENT_ID})`,
    textShadow: "drop-shadow(0 0 5px rgba(168,85,247,0.85))",
  },
};

/**
 * The group's aura level as the mark beside its name should draw it — 0 for a
 * group with none, and for a viewer outside the experiment.
 */
export function useAuraLevel(groupId: string | null | undefined, level: number | null | undefined): number {
  const { enabled } = useFeature(GROUP_AURA_FEATURE, { group: groupId ?? null, track: false });
  if (!enabled || !groupId || !level || level < 1) return 0;
  return Math.min(3, Math.floor(level));
}

/** What to hand the visibility icon to light it at `level`, and its label. */
export function auraLitMark(level: number): {
  props: { className: string; fill?: string; style: { filter: string } };
  label: string;
  def: ReactNode;
} | null {
  const lit = AURA_LIT[level];
  if (!lit) return null;
  return {
    props: {
      className: lit.className,
      ...(lit.fill ? { fill: lit.fill } : {}),
      style: { filter: lit.textShadow },
    },
    label: translate("groups.aura.levelBadge", { level }),
    def: lit.fill ? <AuraGradientDef /> : null,
  };
}

/**
 * How many auras someone has counting for this group — 0 for everybody while
 * the viewer is not in the experiment. Call once per list, not per row.
 */
export function useAuraOf(detail: GroupDetail | null | undefined): (userId: string) => number {
  const { enabled } = useFeature(GROUP_AURA_FEATURE, { group: detail?.group.id ?? null, track: false });
  const givers = detail?.auraGivers;
  return useCallback((userId: string) => (enabled ? givers?.[userId] ?? 0 : 0), [enabled, givers]);
}

