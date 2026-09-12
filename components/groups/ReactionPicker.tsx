"use client";

import { EmojiPicker, type EmojiPickerListCategoryHeaderProps, type EmojiPickerListEmojiProps, type EmojiPickerListRowProps } from "frimousse";
import { useT } from "@/lib/useI18n";

// The emoji a reaction is picked from — every standard emoji, by category and
// searchable in Portuguese — with Discord's quick row on top: the handful that
// answer most messages, one click away. Built on frimousse (headless), which
// fetches the emoji data from its CDN the first time a picker opens and keeps
// it in the browser after that; emoji the browser cannot draw are left out.

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

// Defined once, outside the picker: the list re-renders as it scrolls, and
// components created inside a render would be new types every time.
function CategoryHeader({ category, ...props }: EmojiPickerListCategoryHeaderProps) {
  return (
    <div
      {...props}
      className="bg-white px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
    >
      {category.label}
    </div>
  );
}

function Row({ children, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className="scroll-my-1.5 px-1.5">
      {children}
    </div>
  );
}

function EmojiButton({ emoji, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      {...props}
      title={emoji.label}
      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-xl ${
        emoji.isActive ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      {emoji.emoji}
    </button>
  );
}

export function ReactionPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const t = useT();
  return (
    <div className="flex w-[18.5rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex justify-between gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            aria-label={t("groups.reactionPicker.reactWithEmoji", { emoji })}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-xl transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {emoji}
          </button>
        ))}
      </div>
      <EmojiPicker.Root
        locale="pt"
        columns={8}
        onEmojiSelect={({ emoji }) => onSelect(emoji)}
        className="flex h-80 flex-col"
      >
        <EmojiPicker.Search
          placeholder={t("groups.reactionPicker.searchEmoji")}
          autoFocus
          className="mx-2 mt-2 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <EmojiPicker.Viewport className="relative mt-1 flex-1 outline-none">
          <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.reactionPicker.loadingEmojis")}
          </EmojiPicker.Loading>
          <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.reactionPicker.noEmojiFound")}
          </EmojiPicker.Empty>
          <EmojiPicker.List
            className="select-none pb-1.5"
            components={{ CategoryHeader, Row, Emoji: EmojiButton }}
          />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
}
