"use client";

import type { ReactNode } from "react";
import { MobileSheet } from "@/components/MobileSheet";
import { useT } from "@/lib/useI18n";

// What holding a message opens on a phone (see lib/messageGestures): the
// message itself at the top, so it is clear which one the actions are about —
// a finger was covering it a moment ago — and the actions as full-width rows
// a thumb can hit, instead of the 14px icons a mouse gets.

export type MessageAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  danger?: boolean;
};

export function MessageActionSheet({
  open,
  onClose,
  author,
  preview,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  author: string;
  preview: string;
  actions: MessageAction[];
}) {
  const t = useT();
  return (
    <MobileSheet open={open} onClose={onClose} title={t("chatPanel.mobileMessageActions")}>
      <div className="mb-2 rounded-2xl bg-zinc-100 px-3.5 py-2.5 dark:bg-zinc-900">
        <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-200">{author}</p>
        {preview && (
          <p className="line-clamp-3 break-words text-[15px] text-zinc-600 dark:text-zinc-400">{preview}</p>
        )}
      </div>
      <ul className="flex flex-col pb-1">
        {actions.map((action) => (
          <li key={action.key}>
            <button
              type="button"
              onClick={() => {
                onClose();
                action.onSelect();
              }}
              className={`flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium transition active:bg-zinc-100 dark:active:bg-zinc-900 ${
                action.danger ? "text-red-600 dark:text-red-400" : "text-zinc-800 dark:text-zinc-100"
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xl" aria-hidden>
                {action.icon}
              </span>
              {action.label}
            </button>
          </li>
        ))}
      </ul>
    </MobileSheet>
  );
}
