"use client";

import { useCallback } from "react";
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

/**
 * The group's aura level, beside its name (see GroupName, which puts it right
 * after the globe or the lock). Nothing at all for a group with no level, or
 * for a viewer outside the experiment.
 */
export function AuraLevelBadge({
  groupId,
  level,
  className = "",
}: {
  groupId: string;
  level: number | null | undefined;
  className?: string;
}) {
  const { enabled } = useFeature(GROUP_AURA_FEATURE, { group: groupId, track: false });
  const label = translate("groups.aura.levelBadge", { level: level ?? 0 });
  if (!enabled || !level || level <= 0) return null;
  return (
    <Tooltip content={label} wrapperClassName="inline-flex shrink-0">
      <span
        aria-label={label}
        className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 px-1 py-[1px] text-[10px] font-bold leading-none text-white shadow-sm ${className}`}
      >
        <MdAutoAwesome className="h-2.5 w-2.5" />
        {level}
      </span>
    </Tooltip>
  );
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

