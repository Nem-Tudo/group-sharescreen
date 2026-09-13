"use client";

import { EmojiPickerPanel } from "@/components/EmojiPicker";
import { Twemoji } from "@/components/Twemoji";
import { useT } from "@/lib/useI18n";

// The emoji a reaction is picked from — every standard emoji, by category and
// searchable (see EmojiPickerPanel) — with Discord's quick row on top: the
// handful that answer most messages, one click away. Drawn as Twemoji, like
// the reactions themselves.

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export function ReactionPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const t = useT();
  return (
    <EmojiPickerPanel
      onSelect={onSelect}
      header={
        <div className="flex justify-between gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSelect(emoji)}
              aria-label={t("groups.reactionPicker.reactWithEmoji", { emoji })}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Twemoji emoji={emoji} size={24} />
            </button>
          ))}
        </div>
      }
    />
  );
}
