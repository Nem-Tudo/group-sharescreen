"use client";

import { ROOM_CATEGORIES, roomCategory } from "@/lib/roomCategories";

// A product's interests (the room categories it is for), as the admin picks
// them. The personalised pick (experiment affiliate-personalized) matches
// these against the categories of the rooms each person spends time in.

export const AFFILIATE_INTEREST_IDS = ROOM_CATEGORIES.map((c) => c.id).filter((id) => id !== "outros");

export function interestLabel(id: string): string {
  return roomCategory(id)?.label ?? id;
}

export function AffiliateInterestChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {AFFILIATE_INTEREST_IDS.map((id) => {
        const on = value.includes(id);
        const category = roomCategory(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== id) : [...value, id])}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
              on
                ? category?.className ?? "bg-zinc-200 text-zinc-800"
                : "bg-zinc-100 text-zinc-400 hover:text-zinc-600 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:text-zinc-300"
            } ${on ? "ring-1 ring-current" : ""}`}
          >
            {interestLabel(id)}
          </button>
        );
      })}
    </div>
  );
}
