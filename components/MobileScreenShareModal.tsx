"use client";

import { useEffect } from "react";
import { MdClose } from "react-icons/md";
import { FaDiscord } from "react-icons/fa";
import { ScreenIcon } from "@/components/icons";
import { BetaMark } from "@/components/BetaMark";
import { useT } from "@/lib/useI18n";

const DISCORD_INVITE_URL = "https://discord.gg/nemtudo";

export function MobileScreenShareModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();

  // Close on escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ScreenIcon className="h-5 w-5" />
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                  {t("mobileScreenShareModal.title")}
                </h2>
                <BetaMark />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="-mr-1 shrink-0 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <MdClose className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-5 pb-5">
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {t("mobileScreenShareModal.appOnly")} {t("mobileScreenShareModal.browserLimitation")}
          </p>

          <div className="mt-4 rounded-xl border border-indigo-200/80 bg-indigo-50/70 p-3.5 dark:border-indigo-900/50 dark:bg-indigo-950/30">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
              <span>{t("mobileScreenShareModal.betaNotice")}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {t("mobileScreenShareModal.discordInstructions")}
            </p>
          </div>

          {/* Action buttons */}
          <div className="mt-5 flex flex-col gap-2.5">
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#4752C4] active:scale-[0.98]"
            >
              <FaDiscord className="h-5 w-5" />
              <span>{t("mobileScreenShareModal.openTicketOnDiscord")}</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              {t("mobileScreenShareModal.understood")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

