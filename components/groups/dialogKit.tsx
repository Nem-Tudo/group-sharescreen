"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { MdArrowBack, MdClose } from "react-icons/md";
import { useT } from "@/lib/useI18n";

// The frame and the buttons every group popup is drawn with — GroupDialogs and
// ChannelSettingsDialog — so the two files look like one set.

export type PopupProps<T> = { closePopup: (hasAction?: boolean) => void; data?: T };

// On a phone (below sm) the fields and buttons grow to a fingertip's 44px, and
// the fields' text to 16px — under that, iOS zooms the page in on focus.
export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none focus:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-400/40 max-sm:min-h-11 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
export const primaryButton =
  "cursor-pointer rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
export const secondaryButton =
  "cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
export const dangerButton =
  "cursor-pointer rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-11";

/** A round icon button for a frame's top bar — 44px on a phone, 32px on a desktop. */
const barIconButton =
  "flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-600 transition hover:bg-black/10 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-zinc-500 active:bg-black/10 sm:h-8 sm:w-8 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-50 dark:active:bg-white/10";

export function DialogFrame({
  title,
  onClose,
  onBack,
  children,
  tabs,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  /** A way back to where this came from (a section's list, on a phone) — an arrow before the title. */
  onBack?: () => void;
  children: ReactNode;
  /** A DialogTabs row, kept in view with the title while the content under it scrolls. */
  tabs?: ReactNode;
  /**
   * The size of a settings popup — and, on a phone, the whole screen: a card
   * with a margin around it leaves a strip of page nobody can use, and its
   * tabs and fields want every pixel of width. See `[data-phone-fullscreen]`
   * in globals.css, which stretches the library's own box to fit.
   */
  wide?: boolean;
}) {
  const t = useT();
  return (
    // Only the content scrolls: the title and the tabs stay put, so the way to
    // another tab is never scrolled away — nor pushed off a short screen.
    <div
      data-phone-fullscreen={wide ? "" : undefined}
      className={`flex max-w-full flex-col overflow-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 ${
        wide
          ? "w-full max-sm:h-[var(--app-h,100dvh)] max-sm:pt-[env(safe-area-inset-top)] sm:max-h-[min(90dvh,calc(100dvh-2rem))]"
          : "max-h-[min(90dvh,calc(100dvh-2rem))] w-96"
      }`}
    >
      <div className={`flex shrink-0 flex-col gap-3 pt-5 ${wide ? "px-4 max-sm:gap-2 max-sm:pt-2 sm:px-5" : "px-5"}`}>
        <div className={`flex justify-between gap-2 ${wide ? "items-center sm:items-start" : "items-start"}`}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("common.back")}
              className={`${barIconButton} -ml-2 sm:-ml-1 sm:-mt-1`}
            >
              <MdArrowBack className="h-6 w-6 sm:h-5 sm:w-5" />
            </button>
          )}
          <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className={`${barIconButton} -mr-2 sm:-mr-1 sm:-mt-1`}
          >
            <MdClose className="h-6 w-6 sm:h-5 sm:w-5" />
          </button>
        </div>
        {tabs}
      </div>
      {/* A block that scrolls around a column, not a scrolling column: flex
          items with an overflow of their own (the map's box) would shrink.
          On a phone it clears the home indicator at the bottom. */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pt-4 ${
          wide ? "px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-5" : "px-5 pb-5"
        }`}
      >
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** The underlined tab row the settings popups share — pass it as DialogFrame's `tabs`. */
export function DialogTabs<T extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: { id: T; label: string; danger?: boolean; badge?: ReactNode }[];
  current: T;
  onChange: (id: T) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // The tab on screen kept in view: on a phone the row scrolls sideways, and
  // a tab opened from elsewhere (a link straight to one) may start off its edge.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  // The arrow keys move between tabs, as a tab list's do (WAI-ARIA tabs).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === current);
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    // Edge to edge on a phone, so a tab cut off by the screen's edge says
    // there are more to scroll to; no scrollbar under it, which is a desktop thing.
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 dark:border-zinc-800 [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => {
        const selected = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`flex shrink-0 cursor-pointer items-center border-b-2 px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-500 max-sm:min-h-11 ${
              selected
                ? `border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50 ${t.danger ? "!border-red-600 !text-red-600" : ""}`
                : `border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 ${t.danger ? "hover:!text-red-600" : ""}`
            }`}
          >
            {t.badge ? (
              <span className="flex items-center gap-1.5">
                {t.label}
                {t.badge}
              </span>
            ) : (
              t.label
            )}
          </button>
        );
      })}
    </div>
  );
}

/** An on/off pill — the look the room's own permission switches have (see ManageRoomModal). */
export function TogglePill({ on }: { on: boolean }) {
  const t = useT();
  return (
    <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[1.125rem]" : "left-0.5"}`} />
    </span>
  );
}

/** The size the wide group popups open at. */
export const WIDE_POPUP_SIZE = {
  maxWidth: "min(46rem, calc(100vw - 2rem))",
  width: "min(46rem, calc(100vw - 2rem))",
  maxHeight: "90dvh",
};
