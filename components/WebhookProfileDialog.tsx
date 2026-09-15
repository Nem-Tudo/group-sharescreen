"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdLink } from "react-icons/md";
import { UserAvatar } from "./UserAvatar";
import { WebhookTag } from "./WebhookTag";
import { useT } from "@/lib/useI18n";

// What clicking a webhook's name opens, instead of a profile: a webhook is not
// an account — it has a name and a picture and nothing else (see the API's
// webhookStore.ts) — so this says what it is rather than pretending to be a
// person's page with everything missing.

const subscribeNothing = () => () => {};

export function WebhookProfileDialog({
  name,
  avatarUrl,
  onClose,
}: {
  name: string;
  avatarUrl: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const onClient = useSyncExternalStore(subscribeNothing, () => true, () => false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!onClient) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xs rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 cursor-pointer rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <MdClose className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-3">
          <UserAvatar src={avatarUrl} name={name} size={80} userId={null} />
          <div className="flex max-w-full items-center justify-center gap-1.5">
            <span className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">{name}</span>
            <WebhookTag />
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-left text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <MdLink className="mt-0.5 h-4 w-4 shrink-0" />
            {t("webhook.profileExplanation")}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
