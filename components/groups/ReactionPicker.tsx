"use client";

import type { ReactNode } from "react";
import { MdAdd } from "react-icons/md";
import { EmojiPickerPanel } from "@/components/EmojiPicker";
import { openContextMenu } from "@/lib/contextMenu";
import { useCoarsePointer } from "@/lib/messageGestures";
import { Twemoji } from "@/components/Twemoji";
import { useT } from "@/lib/useI18n";
import { trackFeatureEvent } from "@/lib/features";
import {
  CUSTOM_EMOJI_EVENTS,
  CUSTOM_EMOJI_FEATURE,
  emojiToken,
  useCustomEmojiEnabled,
  useCustomEmojiSet,
  type EmojiPlace,
} from "@/lib/customEmoji";

// The emoji a reaction is picked from — every standard emoji, by category and
// searchable (see EmojiPickerPanel), and the custom ones this person may use
// on the message (its "Personalizados" tab) — with Discord's quick row on top: the
// handful that answer most messages, one click away. Drawn as Twemoji, like
// the reactions themselves.

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export function ReactionPicker({
  onSelect,
  place = null,
  fill = false,
}: {
  /** A standard emoji, or a custom one's token (see lib/customEmoji). */
  onSelect: (emoji: string) => void;
  /** Where the message is — which custom emoji may go on it. Null for a DM. */
  place?: EmojiPlace;
  /**
   * In a phone's sheet (see openReactionSheet): full width, and the search not
   * focused on open — that would throw the keyboard over the emoji.
   */
  fill?: boolean;
}) {
  const t = useT();
  const customEnabled = useCustomEmojiEnabled(place, false);
  const custom = useCustomEmojiSet(place, customEnabled);
  return (
    <EmojiPickerPanel
      onSelect={onSelect}
      fill={fill}
      autoFocus={!fill}
      customEnabled={customEnabled}
      custom={custom}
      onSelectCustom={(emoji) => {
        trackFeatureEvent(CUSTOM_EMOJI_EVENTS.react, { feature: CUSTOM_EMOJI_FEATURE });
        onSelect(emojiToken(emoji));
      }}
      header={
        <div className="flex justify-between gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSelect(emoji)}
              aria-label={t("groups.reactionPicker.reactWithEmoji", { emoji })}
              className={`flex cursor-pointer items-center justify-center rounded-lg transition hover:bg-zinc-100 active:bg-zinc-100 dark:hover:bg-zinc-800 dark:active:bg-zinc-800 ${
                fill ? "h-12 w-12" : "h-9 w-9"
              }`}
            >
              <Twemoji emoji={emoji} size={fill ? 28 : 24} />
            </button>
          ))}
        </div>
      }
    />
  );
}

/**
 * The whole picker as a sheet from the bottom — a phone's way to "Adicionar
 * reação", where the desktop opens a popover on the message's hover button (a
 * button a phone does not show). Drawn by the page's one menu host (see
 * components/ContextMenuHost), which is a sheet on a touch screen, so it
 * replaces the message's menu in place when opened from it.
 */
export function openReactionSheet({
  title,
  place = null,
  onSelect,
}: {
  title?: ReactNode;
  place?: EmojiPlace;
  onSelect: (emoji: string) => void;
}): void {
  openContextMenu(
    { target: null, clientX: 0, clientY: 0, preventDefault: () => {}, stopPropagation: () => {} },
    {
      title,
      entries: [
        {
          type: "custom",
          render: (close) => (
            <div className="-mx-3">
              <ReactionPicker
                fill
                place={place}
                onSelect={(emoji) => {
                  close();
                  onSelect(emoji);
                }}
              />
            </div>
          ),
        },
      ],
    },
    true
  );
}

/**
 * The quick reactions atop a message's menu (see TextChannelView's and the
 * messages window's). On a touch screen each is a 48px target, and a "+"
 * after them opens every other emoji — WhatsApp's and Discord's row — in
 * place of a separate "Adicionar reação" entry further down.
 */
export function QuickReactionsRow({
  isMine,
  onReact,
  onMore,
  close,
}: {
  isMine: (emoji: string) => boolean;
  onReact: (emoji: string) => void;
  /** The full picker. Shown as the row's "+" on a touch screen only. */
  onMore?: () => void;
  close: () => void;
}) {
  const t = useT();
  const touch = useCoarsePointer();
  const button = touch
    ? "h-12 min-w-0 flex-1 max-w-12 rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
    : "h-8 w-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800";
  return (
    <div className={`flex justify-between ${touch ? "gap-1 px-0.5 pb-2" : "gap-0.5 px-1 pb-1"}`}>
      {QUICK_REACTIONS.map((emoji) => {
        const mine = isMine(emoji);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              close();
              onReact(emoji);
            }}
            aria-label={t("groups.reactionPicker.reactWithEmoji", { emoji })}
            aria-pressed={mine}
            className={`flex cursor-pointer items-center justify-center transition ${button} ${
              mine ? "bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-500/15" : touch ? "bg-zinc-100 dark:bg-zinc-900" : ""
            }`}
          >
            <Twemoji emoji={emoji} size={touch ? 26 : 20} />
          </button>
        );
      })}
      {touch && onMore && (
        <button
          type="button"
          // No close() first: the picker replaces this menu in the same sheet.
          onClick={onMore}
          aria-label={t("groups.textChannelView.addReaction")}
          className={`flex cursor-pointer items-center justify-center bg-zinc-100 text-zinc-600 transition dark:bg-zinc-900 dark:text-zinc-300 ${button}`}
        >
          <MdAdd className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
