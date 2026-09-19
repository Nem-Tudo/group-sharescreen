"use client";

import { EmojiPickerPanel } from "@/components/EmojiPicker";
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
}: {
  /** A standard emoji, or a custom one's token (see lib/customEmoji). */
  onSelect: (emoji: string) => void;
  /** Where the message is — which custom emoji may go on it. Null for a DM. */
  place?: EmojiPlace;
}) {
  const t = useT();
  const customEnabled = useCustomEmojiEnabled(place, false);
  const custom = useCustomEmojiSet(place, customEnabled);
  return (
    <EmojiPickerPanel
      onSelect={onSelect}
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
