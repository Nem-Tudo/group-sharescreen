"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdArrowBack, MdClose, MdVisibility } from "react-icons/md";
import { BsCoin } from "react-icons/bs";
import { ThemeMiniPreview } from "@/components/ThemeMiniPreview";
import { formatLocale } from "@/lib/i18n";
import type { RoomTheme } from "@/lib/roomThemes";
import { endThemePreview, updateThemePreview, useThemeChoice, useThemePreviewSession, type ThemeTarget } from "@/lib/themeChoice";
import { useT } from "@/lib/useI18n";

// What a preview leaves on screen while the theme dialog is out of the way (see
// lib/themeChoice): which theme the room is wearing and that nobody else can
// see it, and the three ways out — take it (buying it first when it is paid),
// go back to the list exactly where it was left, or just stop looking.
//
// Mounted once, beside the popups (see NtPopups), because the dialog that
// started the preview has closed by the time this is needed.

export function ThemePreviewBar() {
  const session = useThemePreviewSession();
  const pathname = usePathname();
  const startedAt = useRef(pathname);

  // A preview belongs to the page it was started on. Walking off it ends it,
  // and clears the colours on the way, since the next page may paint nothing.
  useEffect(() => {
    if (!session) {
      startedAt.current = pathname;
      return;
    }
    if (startedAt.current !== pathname) endThemePreview({ leftPage: true });
  }, [session, pathname]);

  if (!session) return null;
  return <PreviewBar key={session.theme.id} theme={session.theme} target={session.target} />;
}

function PreviewBar({ theme, target }: { theme: RoomTheme; target: ThemeTarget }) {
  const t = useT();
  const { openPopup } = useNtPopups();
  const { account, points, current, choose, buy } = useThemeChoice(target);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGroup = target.kind === "room" && Boolean(target.groupId);
  const missing = account && !theme.owned ? Math.max(0, theme.price - points) : 0;
  const isCurrent = current === theme.id;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") endThemePreview();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(timer);
  }, [confirming]);

  function backToList() {
    endThemePreview();
    if (target.kind === "self") {
      void openPopup("theme_hub", { data: { resume: true } });
    } else {
      void openPopup("room_theme", {
        data: { currentThemeId: target.currentThemeId, groupId: target.groupId, resume: true },
      });
    }
  }

  async function take() {
    if (!account) {
      // Nothing to take it with. The dialog has the sign-up.
      backToList();
      return;
    }
    setError(null);
    if (!theme.owned) {
      if (!confirming) {
        setConfirming(true);
        return;
      }
      setConfirming(false);
      setBusy(true);
      const failure = await buy(theme);
      setBusy(false);
      if (failure) setError(failure);
      else updateThemePreview({ ...theme, owned: true });
      return;
    }
    setBusy(true);
    const failure = await choose(theme.id);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    // Chosen for real now: whatever paints the page takes over from the preview.
    endThemePreview();
  }

  const price = theme.price.toLocaleString(formatLocale());
  let label: string;
  if (!theme.owned) {
    label =
      missing > 0
        ? t("themeBrowser.missingPoints", { points: missing.toLocaleString(formatLocale()) })
        : confirming
          ? t("themeBrowser.confirmBuy", { price })
          : t("themeBrowser.buyFor", { price });
  } else if (target.kind === "self") {
    label = isCurrent ? t("themeBrowser.inUse") : t("common.useTheme");
  } else {
    label = isCurrent
      ? isGroup
        ? t("themeBrowser.onTheGroup")
        : t("themeBrowser.onTheRoom")
      : isGroup
        ? t("themeBrowser.applyToGroup")
        : t("themeBrowser.applyToRoom");
  }
  const disabled = busy || missing > 0 || (theme.owned && isCurrent);

  return (
    // At the top on a phone, where the room's own controls are not (they are
    // in the bar along the bottom); along the bottom from lg up, over the
    // video rather than the header's controls.
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex justify-center px-3 lg:top-auto lg:bottom-5">
      <div
        role="status"
        className="golive-dialog-card pointer-events-auto flex w-full max-w-2xl flex-col gap-2 rounded-2xl border border-zinc-200 bg-white/95 p-2.5 text-zinc-900 shadow-2xl backdrop-blur-md sm:flex-row sm:items-center dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <ThemeMiniPreview theme={theme} className="aspect-[16/10] w-14 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
              <MdVisibility className="h-3.5 w-3.5 shrink-0" />
              {t("themeBrowser.previewing")}
            </p>
            <p className="truncate text-sm font-semibold">{theme.name}</p>
            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {error ?? t("themeBrowser.previewOnlyYou")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={backToList}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 sm:flex-none dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <MdArrowBack className="h-4 w-4 shrink-0" />
            {t("themeBrowser.backToThemes")}
          </button>
          <button
            type="button"
            onClick={() => void take()}
            disabled={disabled}
            className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none ${
              !theme.owned
                ? confirming
                  ? "bg-amber-600 text-white ring-2 ring-amber-500/40 hover:bg-amber-700"
                  : "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            }`}
          >
            {!theme.owned && missing === 0 && <BsCoin className="h-3.5 w-3.5 shrink-0" />}
            {busy ? t("common.loading") : label}
          </button>
          <button
            type="button"
            onClick={() => endThemePreview()}
            aria-label={t("themeBrowser.endPreview")}
            title={t("themeBrowser.endPreview")}
            className="shrink-0 rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <MdClose className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
