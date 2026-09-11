"use client";

import type { ReactNode } from "react";

// The frame and the buttons every group popup is drawn with — GroupDialogs and
// ChannelSettingsDialog — so the two files look like one set.

export type PopupProps<T> = { closePopup: (hasAction?: boolean) => void; data?: T };

export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
export const primaryButton =
  "cursor-pointer rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
export const secondaryButton =
  "cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
export const dangerButton =
  "cursor-pointer rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

export function DialogFrame({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`flex max-h-[90dvh] max-w-full flex-col gap-4 overflow-y-auto bg-white p-5 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50 ${
        wide ? "w-full" : "w-96"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-lg font-semibold tracking-tight">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-xl leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

/** The underlined tab row the settings popups share. */
export function DialogTabs<T extends string>({
  tabs,
  current,
  onChange,
}: {
  tabs: { id: T; label: string; danger?: boolean }[];
  current: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="-mt-1 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`shrink-0 cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition ${
            current === t.id
              ? `border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50 ${t.danger ? "!border-red-600 !text-red-600" : ""}`
              : `border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 ${t.danger ? "hover:!text-red-600" : ""}`
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off pill — the look the room's own permission switches have (see ManageRoomModal). */
export function TogglePill({ on }: { on: boolean }) {
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
