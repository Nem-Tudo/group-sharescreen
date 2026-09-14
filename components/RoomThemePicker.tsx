"use client";

import { MdClose, MdPalette } from "react-icons/md";
import { ThemeBrowser } from "@/components/ThemeBrowser";
import { useT } from "@/lib/useI18n";

// "Trocar o tema da sala" — the Pro Max control that repaints a room for
// everybody in it — and "Tema do grupo", the same for every room of a group.
//
// It used to offer two short lists and no search: the themes you made and the
// workshop's twelve most used, on the reasoning that somebody reaching for this
// mid-call wants a look they already have in mind. Somebody with a look in
// mind is exactly who needs a search box, though, and a twelve-theme list is
// how that look was never in it. It is the whole workshop now (see
// ThemeBrowser), with a preview on the room itself before anybody else sees
// anything, and paid themes bought from here rather than offered and then
// refused by the server.
//
// Nothing here checks whether this person may actually do it. The plan and the
// room's own switch are both enforced by the server (see the "room-theme-set"
// handler), and the room answers a refusal the same way it answers every other
// one. What this file decides is only what to *offer*.

export type RoomThemePopupData = {
  /** The theme the room is wearing now, so the list can mark it. */
  currentThemeId?: string | null;
  /**
   * Set when this picks a *group's* theme rather than a room's (see
   * components/groups) — the whole group, every room in it, over HTTP. Absent
   * for an ordinary room, which is exactly what this popup always did.
   */
  groupId?: string | null;
  /** Reopened from a preview: back to the same search and scroll. */
  resume?: boolean;
};

export function RoomThemePicker({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: RoomThemePopupData;
}) {
  const t = useT();
  const groupId = data?.groupId ?? null;

  return (
    <div className="flex h-[min(52rem,calc(100dvh-2.5rem))] w-[min(62rem,calc(100vw-2rem))] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3.5 sm:px-5 dark:border-zinc-800">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <MdPalette className="h-5 w-5 shrink-0 text-indigo-500" />
            {groupId ? t("common.groupTheme") : t("common.roomTheme")}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {groupId
              ? t("roomThemePicker.everyoneInTheGroupWillSee")
              : t("roomThemePicker.everyoneInTheRoomWillSee")}
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

      <ThemeBrowser
        target={{ kind: "room", currentThemeId: data?.currentThemeId ?? null, groupId }}
        onClose={closePopup}
        resume={data?.resume}
      />
    </div>
  );
}
