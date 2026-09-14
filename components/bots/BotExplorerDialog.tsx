"use client";

import { MdClose, MdSmartToy } from "react-icons/md";
import { BotBrowser } from "@/components/bots/BotBrowser";
import { useT } from "@/lib/useI18n";

// "Explorar bots", from a group's name menu: the public bots, a card each,
// and — for whoever may change the group's settings — a button that adds one
// straight to it. The same shape as the theme dialog (see RoomThemePicker):
// wide, searchable, scrolling a page at a time. The list itself is BotBrowser,
// which is also the /bots page.

export type BotExplorerPopupData = {
  groupId: string;
  groupName: string;
  /** Whether this person may add bots to the group — "Gerenciar grupo". */
  canAdd: boolean;
};

export function BotExplorerDialog({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: BotExplorerPopupData;
}) {
  const t = useT();
  const group = data ? { id: data.groupId, name: data.groupName, canAdd: data.canAdd } : null;

  return (
    <div className="flex h-[min(52rem,calc(100dvh-2.5rem))] w-[min(62rem,calc(100vw-2rem))] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3.5 sm:px-5 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <MdSmartToy className="h-5 w-5 shrink-0 text-indigo-500" />
            {t("botDirectory.title")}
          </h2>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {group ? t("botDirectory.subtitleGroup", { group: group.name }) : t("botDirectory.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label={t("common.close")}
          className="-mr-1 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </div>
      <BotBrowser variant="dialog" group={group} onNavigate={() => closePopup(false)} />
    </div>
  );
}
