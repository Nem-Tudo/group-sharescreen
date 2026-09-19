"use client";

import { useState, type ReactNode } from "react";
import {
  EmojiPicker as Frimousse,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from "frimousse";
import { Popover } from "@/components/Tooltip";
import { Twemoji } from "@/components/Twemoji";
import { EMOJI_VERSION, EMOJIBASE_URL } from "@/lib/emoji";
import { getLocale } from "@/lib/i18n";
import { useT } from "@/lib/useI18n";
import { CustomEmojiPanel } from "@/components/CustomEmojiPanel";
import { NewBadge } from "@/components/NewBadge";
import { CUSTOM_EMOJI_BADGE, type CustomEmoji, type CustomEmojiSet } from "@/lib/customEmoji";

// Every standard emoji, by category and searchable in the site's language,
// drawn as Twemoji. Built on frimousse (headless), which fetches emojibase's
// data the first time a picker opens and keeps it in the browser after that.
//
// Pinned to the Emoji version the Twemoji font covers (see lib/emoji) rather
// than left to frimousse's default — the newest version the *system's* emoji
// font can draw — because the system font no longer decides anything: what
// is picked here is drawn by Twemoji, in the grid and in the text box alike.

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
      // Without this, clicking an emoji defaults to type="submit" — and
      // since the picker sits inside the composer's <form>, that would send
      // the message (attachments included) instead of just inserting it.
      type="button"
      title={emoji.label}
      className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg ${
        emoji.isActive ? "bg-zinc-100 dark:bg-zinc-800" : ""
      }`}
    >
      <Twemoji emoji={emoji.emoji} size={22} />
    </button>
  );
}

/**
 * The picker itself: search, then the grid. `header` sits above the search —
 * the reaction picker's quick row goes there.
 */
export function EmojiPickerPanel({
  onSelect,
  header,
  autoFocus = true,
  customEnabled = false,
  custom = null,
  onSelectCustom,
}: {
  onSelect: (emoji: string) => void;
  header?: ReactNode;
  autoFocus?: boolean;
  /** Shows the "Personalizados" tab (see CustomEmojiPanel) — only inside the experiment. */
  customEnabled?: boolean;
  /** What that tab offers — null while it loads. */
  custom?: CustomEmojiSet | null;
  onSelectCustom?: (emoji: CustomEmoji) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"standard" | "custom">("standard");
  const showCustom = customEnabled && Boolean(onSelectCustom);
  const tabClass = (active: boolean) =>
    `flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-b-2 px-2 py-1.5 text-xs font-medium transition ${
      active
        ? "border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
        : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    }`;
  return (
    <div className="flex w-[18.5rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      {header}
      {showCustom && (
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          <button type="button" onClick={() => setTab("standard")} className={tabClass(tab === "standard")}>
            <Twemoji emoji="😀" size={14} />
            {t("customEmoji.standardTab")}
          </button>
          <button type="button" onClick={() => setTab("custom")} className={tabClass(tab === "custom")}>
            <span className="text-violet-500">✦</span>
            {t("customEmoji.customTab")}
            <NewBadge id={CUSTOM_EMOJI_BADGE} />
          </button>
        </div>
      )}
      {showCustom && tab === "custom" && onSelectCustom ? (
        <CustomEmojiPanel set={custom} onSelect={onSelectCustom} autoFocus={autoFocus} />
      ) : (
      <Frimousse.Root
        locale={getLocale()}
        emojiVersion={EMOJI_VERSION}
        emojibaseUrl={EMOJIBASE_URL}
        columns={8}
        onEmojiSelect={({ emoji }) => onSelect(emoji)}
        className="flex h-80 flex-col"
      >
        <Frimousse.Search
          placeholder={t("groups.reactionPicker.searchEmoji")}
          autoFocus={autoFocus}
          className="mx-2 mt-2 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <Frimousse.Viewport className="relative mt-1 flex-1 outline-none">
          <Frimousse.Loading className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.reactionPicker.loadingEmojis")}
          </Frimousse.Loading>
          <Frimousse.Empty className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.reactionPicker.noEmojiFound")}
          </Frimousse.Empty>
          <Frimousse.List
            className="select-none pb-1.5"
            components={{ CategoryHeader, Row, Emoji: EmojiButton }}
          />
        </Frimousse.Viewport>
      </Frimousse.Root>
      )}
    </div>
  );
}

function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);
}

/**
 * The composer's emoji button, beside "send", and the picker it opens.
 *
 * The face is drawn grey and takes its colour on hover, the way Discord's
 * does: a full-colour emoji sitting permanently in the toolbar would be the
 * loudest thing in the box.
 */
export function EmojiPickerButton({
  onPick,
  disabled,
  className = "",
  iconSize = 20,
  customEnabled = false,
  custom = null,
  onPickCustom,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  /** See EmojiPickerPanel. */
  customEnabled?: boolean;
  custom?: CustomEmojiSet | null;
  onPickCustom?: (emoji: CustomEmoji) => void;
  /** The composer's own icon-button classes, so it matches its neighbours. */
  className?: string;
  iconSize?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-end"
      tooltip={t("emoji.emoji")}
      wrapperClassName="inline-flex shrink-0"
      content={
        <EmojiPickerPanel
          // Not on a touch screen, where focusing the search is a keyboard
          // sliding up over the grid somebody opened to tap in.
          autoFocus={!isCoarsePointer()}
          onSelect={(emoji) => {
            setOpen(false);
            onPick(emoji);
          }}
          customEnabled={customEnabled}
          custom={custom}
          onSelectCustom={
            onPickCustom
              ? (emoji) => {
                  setOpen(false);
                  onPickCustom(emoji);
                }
              : undefined
          }
        />
      }
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label={t("emoji.emoji")}
        aria-expanded={open}
        className={`group ${className}`}
      >
        <Twemoji
          emoji="😀"
          size={iconSize}
          className={`transition ${
            open ? "" : "opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0"
          }`}
        />
      </button>
    </Popover>
  );
}
