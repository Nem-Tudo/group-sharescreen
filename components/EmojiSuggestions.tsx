"use client";

import { useEffect, useRef } from "react";
import { Twemoji } from "@/components/Twemoji";
import type { EmojiMatch } from "@/lib/emoji";
import { useT } from "@/lib/useI18n";

/**
 * The list ":" opens above a composer — see useEmojiAutocomplete.
 *
 * Positioned by the caller (every composer already has a relative box its
 * @-mention list sits on top of). Rows are picked on mousedown rather than
 * click, so the textarea never loses focus and the cursor stays where it was.
 */
export function EmojiSuggestions({
  matches,
  highlight,
  onHighlight,
  onPick,
  className = "",
}: {
  matches: EmojiMatch[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (match: EmojiMatch) => void;
  className?: string;
}) {
  const t = useT();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  return (
    <div
      role="listbox"
      aria-label={t("emoji.suggestions")}
      className={`z-30 flex max-h-72 flex-col overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {t("emoji.emojiMatching")}
      </div>
      {matches.map((match, index) => {
        const active = index === highlight;
        return (
          <button
            key={match.entry.unicode}
            ref={active ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(match);
            }}
            onMouseEnter={() => onHighlight(index)}
            className={`flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
              active
                ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            <Twemoji emoji={match.entry.unicode} size={22} />
            <span className="min-w-0 flex-1 truncate">
              {match.shortcode ? `:${match.shortcode}:` : match.entry.label}
            </span>
            {match.shortcode && (
              <span className="hidden max-w-[45%] truncate text-xs text-zinc-400 sm:block dark:text-zinc-500">
                {match.entry.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
