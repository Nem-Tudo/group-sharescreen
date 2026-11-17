"use client";

import { MdClose, MdTouchApp } from "react-icons/md";
import { markMessageGesturesLearned, useMessageGesturesTip } from "@/lib/messageGestures";
import { useT } from "@/lib/useI18n";

// A line above the composer, once, on a touch screen: the row of icons that
// used to sit over every message is gone there (see the chats' row actions),
// and this says where it went. It leaves for good the first time a message is
// held or dragged (lib/messageGestures marks it), or when closed.

export function MessageGesturesTip() {
  const t = useT();
  const show = useMessageGesturesTip();
  if (!show) return null;
  return (
    <div
      role="note"
      className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-blue-50 py-1 pl-3 pr-1 text-sm text-blue-900 dark:bg-blue-500/15 dark:text-blue-100"
    >
      <MdTouchApp className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-300" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">{t("chatGestures.tip")}</p>
      <button
        type="button"
        onClick={markMessageGesturesLearned}
        aria-label={t("common.close")}
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-blue-700 transition active:bg-blue-100 dark:text-blue-200 dark:active:bg-blue-500/20"
      >
        <MdClose className="h-5 w-5" />
      </button>
    </div>
  );
}
