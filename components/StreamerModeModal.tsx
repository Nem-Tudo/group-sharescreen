"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import { ObsSourceIcon } from "./icons";
import { useT } from "@/lib/useI18n";

/**
 * Opens every time "Modo Streamer" is switched on. The name sells it short —
 * people turn it on to hide the room code and never find out that it is also
 * what puts the "link de transmissão" button on every tile (see
 * ObsBrowserSourceModal) — so this says both, and how to use the second.
 */
export function StreamerModeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const perks = [
    { title: t("streamerModeModal.perkHideTitle"), text: t("streamerModeModal.perkHideText") },
    { title: t("streamerModeModal.perkObsTitle"), text: t("streamerModeModal.perkObsText") },
    { title: t("streamerModeModal.perkCleanTitle"), text: t("streamerModeModal.perkCleanText") },
    { title: t("streamerModeModal.perkSafeTitle"), text: t("streamerModeModal.perkSafeText") },
  ];
  const steps = [
    t("streamerModeModal.step1"),
    t("streamerModeModal.step2"),
    t("streamerModeModal.step3"),
    t("streamerModeModal.step4"),
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("streamerModeModal.title")}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
              <ObsSourceIcon className="h-5 w-5" />
            </span>
            {t("streamerModeModal.title")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-sm text-zinc-700 dark:text-zinc-300">
          <p className="mb-4">{t("streamerModeModal.intro")}</p>

          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            {t("streamerModeModal.perksHeading")}
          </h3>
          <ul className="mb-5 flex flex-col gap-2">
            {perks.map((perk) => (
              <li
                key={perk.title}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60"
              >
                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{perk.title}</p>
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{perk.text}</p>
              </li>
            ))}
          </ul>

          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            {t("streamerModeModal.stepsHeading")}
          </h3>
          <ol className="flex flex-col gap-2.5">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>

          <p className="mt-5 rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
            {t("streamerModeModal.keepTabOpen")}
          </p>
        </div>

        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-700"
          >
            {t("streamerModeModal.gotIt")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
