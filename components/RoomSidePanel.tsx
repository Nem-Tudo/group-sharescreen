"use client";

import type { ReactNode } from "react";
import { LuPanelRightClose } from "react-icons/lu";
import { Tooltip } from "@/components/Tooltip";
import { useT } from "@/lib/useI18n";

// The room's chat column on a desktop, in the room redesign (see
// lib/roomRedesign): the conversation and the room's settings (map, theme,
// management) as two tabs of one panel. The settings used to be a row of
// buttons over the chat, taking its height for something that is about the
// room rather than the conversation.
//
// Both tabs stay mounted and only the hidden one is `display: none`, so the
// chat keeps its scroll position and its draft while somebody is in the
// settings.

export type RoomSideTab = "chat" | "settings";

export function RoomSidePanel({
  tab,
  onTab,
  chat,
  settings,
  chatBadge,
  chatExtra,
  onCollapse,
}: {
  tab: RoomSideTab;
  onTab: (tab: RoomSideTab) => void;
  chat: ReactNode;
  /** Null where there is nothing to set (a group's room, for a member). */
  settings: ReactNode | null;
  /** The unread count, drawn on the chat tab (see ChatUnreadBadge). */
  chatBadge?: ReactNode;
  /** Beside the tabs, whichever is open — the notification bell. */
  chatExtra?: ReactNode;
  /** Folds the panel away; absent while there is nothing on the stage to give the room to. */
  onCollapse?: () => void;
}) {
  const t = useT();
  const shown: RoomSideTab = settings === null ? "chat" : tab;
  const tabClass = (active: boolean) =>
    `relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${
      active
        ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
        : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
    }`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <div
          role="tablist"
          data-rr-tabs=""
          className="flex min-w-0 flex-1 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900"
        >
          <button
            type="button"
            role="tab"
            aria-selected={shown === "chat"}
            onClick={() => onTab("chat")}
            className={tabClass(shown === "chat")}
          >
            <span className="relative">
              {t("common.chat")}
              {chatBadge}
            </span>
          </button>
          {settings !== null && (
            <button
              type="button"
              role="tab"
              aria-selected={shown === "settings"}
              onClick={() => onTab("settings")}
              className={tabClass(shown === "settings")}
            >
              {t("watch.watchRoom.roomSettingsTab")}
            </button>
          )}
        </div>
        {chatExtra}
        {onCollapse && (
          <Tooltip content={t("chatPanel.hideChatAndProfile")}>
            <button
              type="button"
              onClick={onCollapse}
              aria-label={t("chatPanel.hideChatAndProfile")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              <LuPanelRightClose className="h-4 w-4" />
            </button>
          </Tooltip>
        )}
      </div>
      <div role="tabpanel" className={shown === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        {chat}
      </div>
      {settings !== null && (
        <div role="tabpanel" className={shown === "settings" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          {settings}
        </div>
      )}
    </div>
  );
}
