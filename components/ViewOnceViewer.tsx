"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdLockOutline } from "react-icons/md";
import { ViewerWatermark } from "@/components/ViewerWatermark";
import type { ChatAttachment } from "@/lib/chatAttachments";
import { useCaptureProtection } from "@/lib/captureProtection";
import { useAuth } from "@/lib/AuthContext";
import { openViewOnce, type ViewOnceOpenResult } from "@/lib/viewOnceApi";
import { useT } from "@/lib/useI18n";

// A view-once file, open. Full screen, over everything, and in this order:
//
//   1. The window's capture protection goes on and is confirmed (see
//      lib/captureProtection.ts). Nothing is fetched before that.
//   2. The file is asked for, which spends this person's one look.
//   3. It is shown from memory — an object URL of a Blob that is revoked the
//      moment this closes — with the viewer's name over it, no controls that
//      save, and no right-click, drag or picture-in-picture.
//
// Closing is final: the file is gone from memory and the API will not hand it
// over again.

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; url: string; type: string; watermark: boolean }
  | { kind: "error"; reason: Exclude<ViewOnceOpenResult, { ok: true }>["reason"] | "protection" };

export function ViewOnceViewer({
  attachment,
  onClose,
  onOpened,
}: {
  attachment: ChatAttachment & { viewOnce: string };
  onClose: () => void;
  /** The look was spent — whether or not the file then showed. */
  onOpened: () => void;
}) {
  const t = useT();
  const { account } = useAuth();
  const protection = useCaptureProtection(true);
  const [loaded, setLoaded] = useState<Phase>({ kind: "loading" });
  // Protection that could not be turned on ends it before anything is asked.
  const phase: Phase = protection === "failed" ? { kind: "error", reason: "protection" } : loaded;
  const started = useRef(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (protection !== "on" || started.current) return;
    started.current = true;
    void openViewOnce(attachment.viewOnce).then((result) => {
      if (result.ok || result.reason === "viewed") onOpened();
      if (!result.ok) {
        setLoaded({ kind: "error", reason: result.reason });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setLoaded({ kind: "ready", url, type: result.blob.type, watermark: result.watermark });
    });
  }, [attachment.viewOnce, onOpened, protection]);

  // Gone from memory with the viewer. The Blob itself goes with its last
  // reference, which this was.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    []
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const errorText =
    phase.kind === "error"
      ? phase.reason === "viewed"
        ? t("viewOnce.alreadyViewed")
        : phase.reason === "expired"
          ? t("viewOnce.expired")
          : phase.reason === "own"
            ? t("viewOnce.ownFile")
            : phase.reason === "signed-out"
              ? t("viewOnce.signInToView")
              : phase.reason === "app-only" || phase.reason === "protection"
                ? t("viewOnce.appOnly")
                : t("viewOnce.couldNotOpen")
      : "";

  const block = (event: { preventDefault(): void }) => event.preventDefault();

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label={t("viewOnce.title")}
      onContextMenu={block}
      onDragStart={block}
      className="fixed inset-0 z-[1000] flex select-none items-center justify-center bg-black/95"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("common.close")}
        className="absolute right-4 top-4 z-30 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <MdClose className="h-6 w-6" aria-hidden />
      </button>
      <p className="absolute left-4 top-5 z-30 inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
        <MdLockOutline className="h-4 w-4" aria-hidden />
        {t("viewOnce.closingIsFinal")}
      </p>

      {phase.kind === "loading" && (
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-label={t("common.loading")} />
      )}

      {phase.kind === "error" && (
        <div className="max-w-sm px-6 text-center text-sm text-white/80">
          <p>{errorText}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 cursor-pointer rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
          >
            {t("common.close")}
          </button>
        </div>
      )}

      {phase.kind === "ready" && (
        <div className="relative flex max-h-[88vh] max-w-[92vw] items-center justify-center overflow-hidden">
          {phase.type.startsWith("video/") ? (
            <video
              src={phase.url}
              autoPlay
              controls
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              controlsList="nodownload noremoteplayback noplaybackrate"
              className="max-h-[88vh] max-w-[92vw]"
            />
          ) : phase.type.startsWith("audio/") ? (
            <div className="flex h-48 w-[min(28rem,90vw)] items-center justify-center rounded-2xl bg-zinc-900 px-6">
              <audio src={phase.url} autoPlay controls controlsList="nodownload noplaybackrate" className="w-full" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- an in-memory Blob; next/image cannot take one
            <img src={phase.url} alt="" draggable={false} className="max-h-[88vh] max-w-[92vw] object-contain" />
          )}
          {phase.watermark && <ViewerWatermark label={account ? `@${account.username}` : ""} />}
        </div>
      )}
    </div>,
    document.body
  );
}
