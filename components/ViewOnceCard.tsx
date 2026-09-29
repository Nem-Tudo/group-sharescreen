"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MdLockOutline, MdOutlineVisibility, MdOutlineVisibilityOff } from "react-icons/md";
import { ViewOnceViewer } from "@/components/ViewOnceViewer";
import type { ChatAttachment } from "@/lib/chatAttachments";
import { useAuth } from "@/lib/AuthContext";
import { captureProtectionLevel, type CaptureProtectionLevel } from "@/lib/captureProtection";
import { getViewOnceStatus, type ViewOnceStatus } from "@/lib/viewOnceApi";
import { useT } from "@/lib/useI18n";

// A view-once file as a message shows it: what kind of thing it is, never the
// thing itself, and a button that opens it once (see ViewOnceViewer).
//
// Where it cannot be opened — a browser, a Linux desktop, a shell from before
// capture protection — the card says where it can be instead. Nothing here
// ever holds the file.

export function ViewOnceCard({
  attachment,
  className = "",
}: {
  attachment: ChatAttachment & { viewOnce: string };
  className?: string;
}) {
  const t = useT();
  const { account } = useAuth();
  const [status, setStatus] = useState<ViewOnceStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmPartial, setConfirmPartial] = useState(false);
  // Null in the server render, which has no window to ask. Fixed for the
  // page's life, so there is nothing to subscribe to.
  const level = useSyncExternalStore<CaptureProtectionLevel | null>(noSubscribe, captureProtectionLevel, () => null);

  useEffect(() => {
    let alive = true;
    void getViewOnceStatus(attachment.viewOnce).then((value) => {
      if (alive) setStatus(value);
    });
    return () => {
      alive = false;
    };
  }, [attachment.viewOnce]);

  const markOpened = useCallback(() => {
    setStatus((current) => (current ? { ...current, viewedByMe: true, views: current.views + 1 } : current));
  }, []);

  const what =
    attachment.type.startsWith("image/")
      ? attachment.type === "image/gif"
        ? t("viewOnce.gif")
        : t("viewOnce.photo")
      : attachment.kind === "video"
        ? t("viewOnce.video")
        : t("viewOnce.audio");

  const canOpen = level === "full" || level === "partial";
  const spent = status?.viewedByMe || status?.available === false;

  let detail: string;
  if (!account) detail = t("viewOnce.signInToView");
  else if (!status) detail = t("viewOnce.title");
  else if (status.mine) detail = t("viewOnce.sentByYou", { views: status.views });
  else if (status.viewedByMe) detail = t("viewOnce.opened");
  else if (!status.available) detail = t("viewOnce.expired");
  else if (!canOpen) detail = level === "unsupported" ? t("viewOnce.updateOrOtherSystem") : t("viewOnce.openInApp");
  else detail = t("viewOnce.tapToOpen");

  const clickable = Boolean(status && !status.mine && !spent && canOpen);

  function start() {
    if (!clickable) return;
    if (level === "partial" && !confirmPartial) {
      setConfirmPartial(true);
      return;
    }
    setConfirmPartial(false);
    setOpen(true);
  }

  return (
    <>
      <div className={`flex w-full max-w-xs flex-col gap-1 ${className}`}>
        <button
          type="button"
          onClick={start}
          disabled={!clickable}
          className="flex w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-left transition enabled:cursor-pointer enabled:hover:border-zinc-300 enabled:hover:bg-zinc-100 disabled:cursor-default dark:border-zinc-800 dark:bg-zinc-900 dark:enabled:hover:border-zinc-700 dark:enabled:hover:bg-zinc-800"
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              spent || status?.mine
                ? "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                : "bg-blue-600 text-white"
            }`}
          >
            {spent ? (
              <MdOutlineVisibilityOff className="h-5 w-5" aria-hidden />
            ) : canOpen || status?.mine ? (
              <MdOutlineVisibility className="h-5 w-5" aria-hidden />
            ) : (
              <MdLockOutline className="h-5 w-5" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{what}</span>
            <span className="block text-[11px] text-zinc-500">{detail}</span>
          </span>
        </button>
        {confirmPartial && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <p>{t("viewOnce.macPartialWarning")}</p>
            <div className="mt-1.5 flex gap-2">
              <button
                type="button"
                onClick={start}
                className="cursor-pointer rounded-md bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700"
              >
                {t("viewOnce.openAnyway")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmPartial(false)}
                className="cursor-pointer rounded-md px-2 py-1 font-medium hover:underline"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
      {open && <ViewOnceViewer attachment={attachment} onClose={() => setOpen(false)} onOpened={markOpened} />}
    </>
  );
}

function noSubscribe() {
  return () => {};
}
