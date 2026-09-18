"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/Tooltip";

/**
 * One on/off setting in an options menu — the room's "Mais opções" and the
 * group bar's copy of it (see components/groups/GroupHeaderMenu).
 */
export function MenuToggleRow({
  label,
  active,
  onToggle,
  activeIcon,
  inactiveIcon,
  disabled = false,
  hint,
  badge,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  activeIcon: ReactNode;
  inactiveIcon: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
  // Beside the label — the "NOVO" of a just-launched setting (see NewBadge).
  badge?: ReactNode;
}) {
  return (
    // The wrapper is what a disabled row's hint hangs off of: a disabled
    // button emits no pointer events of its own, and "why is this off?" is
    // exactly the row that most needs explaining.
    <Tooltip content={hint} wrapperClassName="flex w-full">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <span className="flex items-center gap-1.5">
          {label}
          {badge}
        </span>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${active ? "bg-emerald-600" : "bg-zinc-500"
            }`}
        >
          {active ? activeIcon : inactiveIcon}
        </span>
      </button>
    </Tooltip>
  );
}
