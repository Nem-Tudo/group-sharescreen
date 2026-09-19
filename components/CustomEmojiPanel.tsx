"use client";

import { useEffect, useMemo, useState } from "react";
import useNtPopups from "ntpopups";
import { MdAutoAwesome, MdPerson } from "react-icons/md";
import { CustomEmoji } from "@/components/CustomEmoji";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { WIDE_POPUP_SIZE } from "@/components/groups/dialogKit";
import { trackFeatureEvent } from "@/lib/features";
import {
  CUSTOM_EMOJI_EVENTS,
  CUSTOM_EMOJI_FEATURE,
  type CustomEmoji as CustomEmojiInfo,
  type CustomEmojiSet,
} from "@/lib/customEmoji";
import { normalizeEmojiQuery } from "@/lib/emoji";
import { useT } from "@/lib/useI18n";

// The picker's "Personalizados" tab (see EmojiPickerPanel): every custom emoji
// this person has, by where it comes from — the group being written in first,
// then their own, then their other groups'. One that may not go in here (the
// room refuses outside emoji, or its owner is over the limit) is shown greyed
// out with why, the way Discord shows one, rather than hidden: knowing it
// exists is how somebody finds out what the room allows.

export function CustomEmojiPanel({
  set,
  onSelect,
  autoFocus,
}: {
  set: CustomEmojiSet | null;
  onSelect: (emoji: CustomEmojiInfo) => void;
  autoFocus: boolean;
}) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const [query, setQuery] = useState("");

  useEffect(() => {
    trackFeatureEvent(CUSTOM_EMOJI_EVENTS.pickerOpen, { feature: CUSTOM_EMOJI_FEATURE });
  }, []);

  const sources = useMemo(() => {
    if (!set) return [];
    const q = normalizeEmojiQuery(query.trim().replace(/^:|:$/g, ""));
    return set.sources
      .map((source) => ({
        ...source,
        emojis: q ? source.emojis.filter((e) => normalizeEmojiQuery(e.name).includes(q)) : source.emojis,
      }))
      .filter((source) => source.emojis.length > 0);
  }, [set, query]);

  function why(here: boolean): string {
    if (set && !set.can.custom) return t("customEmoji.disabledHere");
    if (set && !here && !set.can.external) return t("customEmoji.externalDisabledHere");
    return t("customEmoji.overLimit");
  }

  return (
    <div className="flex h-80 flex-col">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("groups.reactionPicker.searchEmoji")}
        autoFocus={autoFocus}
        className="mx-2 mt-2 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      {set && !set.can.custom && (
        <p className="mx-2 mt-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
          {t("customEmoji.disabledHere")}
        </p>
      )}
      <div className="relative mt-1 min-h-0 flex-1 overflow-y-auto pb-1.5">
        {!set && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.reactionPicker.loadingEmojis")}
          </p>
        )}
        {set && sources.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            <MdAutoAwesome className="h-6 w-6 text-violet-500" />
            {query ? t("groups.reactionPicker.noEmojiFound") : t("customEmoji.noneYet")}
          </div>
        )}
        {sources.map((source) => (
          <section key={source.key}>
            <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-white px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              {source.kind === "mine" ? (
                <MdPerson className="h-3.5 w-3.5" />
              ) : (
                <GroupIcon name={source.name} iconUrl={source.iconUrl} seed={source.key} size={14} />
              )}
              <span className="truncate">{source.name}</span>
            </div>
            <div className="grid grid-cols-8 px-1.5">
              {source.emojis.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  disabled={!emoji.usable}
                  onClick={() => onSelect(emoji)}
                  title={emoji.usable ? `:${emoji.name}:` : `:${emoji.name}: — ${why(source.here)}`}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-35 disabled:grayscale disabled:hover:bg-transparent dark:hover:bg-zinc-800"
                >
                  <CustomEmoji id={emoji.id} name={emoji.name} src={emoji.url} size={24} />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void openPopup("my_emojis", { ...WIDE_POPUP_SIZE, data: {} })}
          className="cursor-pointer text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
        >
          {t("customEmoji.manageYours")}
        </button>
      </div>
    </div>
  );
}
