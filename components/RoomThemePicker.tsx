"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MdClose, MdPalette } from "react-icons/md";
import { signalingClient } from "@/lib/signalingClient";
import { setGroupTheme } from "@/lib/groupsApi";
import { refreshGroup } from "@/lib/useGroups";
import {
  fetchMyThemes,
  fetchWorkshop,
  isDarkTheme,
  type RoomTheme,
} from "@/lib/roomThemes";
import { useT } from "@/lib/useI18n";

// "Trocar o tema da sala" — the Pro Max control that repaints a room for
// everybody in it.
//
// It offers two lists and no search: the themes you made, and the workshop's
// most-used. That is deliberate — somebody reaching for this in the middle of
// a call wants a look they already have in mind, not a browsing session, and
// the workshop itself is one link away for the rest.
//
// Nothing here checks whether this person may actually do it. The plan and the
// room's own switch are both enforced by the server (see the "room-theme-set"
// handler), and the room answers a refusal the same way it answers every other
// one. What this file decides is only what to *offer*.

/** One row: the palette, the name, and what it is. */
function ThemeRow({
  theme,
  current,
  onPick,
}: {
  theme: RoomTheme;
  current: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const { palette, accent } = theme.spec;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={current}
        className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
          current
            ? "border-zinc-900 dark:border-zinc-100"
            : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        }`}
      >
        {/* The palette as its own swatch — five colours in the order they sit
            on each other, which says more about a theme at this size than any
            name could. */}
        <span
          className="flex h-9 w-9 shrink-0 overflow-hidden rounded-md border"
          style={{ borderColor: palette.border }}
        >
          {[palette.page, palette.surface, palette.raised, accent].map((colour, index) => (
            <span key={index} className="h-full flex-1" style={{ background: colour }} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {theme.name}
          </span>
          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {isDarkTheme(theme.spec) ? t("common.dark") : t("common.light")}
            {theme.author ? ` · ${theme.author.displayName}` : ""}
          </span>
        </span>
        {current && (
          <span className="shrink-0 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {t("common.current")}
          </span>
        )}
      </button>
    </li>
  );
}

export type RoomThemePopupData = {
  /** The theme the room is wearing now, so the list can mark it. */
  currentThemeId?: string | null;
  /**
   * Set when this picks a *group's* theme rather than a room's (see
   * components/groups) — the whole group, every room in it, over HTTP. Absent
   * for an ordinary room, which is exactly what this popup always did.
   */
  groupId?: string | null;
};

export function RoomThemePicker({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: RoomThemePopupData;
}) {
  const t = useT();
  const current = data?.currentThemeId ?? null;
  const groupId = data?.groupId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<RoomTheme[]>([]);
  const [popular, setPopular] = useState<RoomTheme[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMyThemes(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setMine(loaded);
    });
    void fetchWorkshop("popular", controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setPopular(loaded.slice(0, 12));
    });
    return () => controller.abort();
  }, []);

  async function pick(themeId: string | null) {
    if (!groupId) {
      signalingClient.setRoomTheme(themeId);
      closePopup(true);
      return;
    }
    // A group's theme is set over HTTP and can be refused (the plan, the
    // theme itself) — said here rather than closing on a choice that did not
    // take.
    if (busy) return;
    setBusy(true);
    const result = await setGroupTheme(groupId, themeId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void refreshGroup(groupId);
    closePopup(true);
  }

  // The workshop list minus anything already shown above it, so a theme
  // somebody made *and* published does not appear twice.
  const others = popular.filter((theme) => !mine.some((own) => own.id === theme.id));

  return (
    <div className="flex w-96 max-w-[calc(100vw-1rem)] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
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

      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => pick(null)}
          className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
            current === null
              ? "border-zinc-900 dark:border-zinc-100"
              : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          }`}
        >
          <span className="block font-medium text-zinc-900 dark:text-zinc-100">{t("roomThemePicker.noTheme")}</span>
          <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
            {t("roomThemePicker.eachPersonSeesTheThemeThey")}
          </span>
        </button>

        {mine.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t("common.yourThemes")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {mine.map((theme) => (
                <ThemeRow
                  key={theme.id}
                  theme={theme}
                  current={current === theme.id}
                  onPick={() => pick(theme.id)}
                />
              ))}
            </ul>
          </div>
        )}

        {others.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t("roomThemePicker.mostUsedOnDiscover")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {others.map((theme) => (
                <ThemeRow
                  key={theme.id}
                  theme={theme}
                  current={current === theme.id}
                  onPick={() => pick(theme.id)}
                />
              ))}
            </ul>
          </div>
        )}

        <Link
          href="/workshop"
          target="_blank"
          className="self-start text-xs font-medium text-zinc-500 underline underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {t("roomThemePicker.seeTheWholeOfDiscover")}
        </Link>
      </div>
    </div>
  );
}
