"use client";

import {
  MdAudiotrack,
  MdBrandingWatermark,
  MdClose,
  MdErrorOutline,
  MdInsertDriveFile,
  MdMovie,
  MdOutlineBrandingWatermark,
  MdOutlineVisibility,
  MdVisibility,
} from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { formatBytes } from "@/lib/chatAttachments";
import type { AttachmentUploads, PendingAttachment } from "@/lib/useAttachmentUploads";
import { isViewOnceFile } from "@/lib/viewOnceApi";
import { useT } from "@/lib/useI18n";

// The files waiting in a composer, each with how far its upload has got.
// Pictures have their own tray of thumbnails in each composer; these are the
// videos and documents, drawn as small cards because a thumbnail of a PDF
// says nothing — plus any picture switched to view-once, which has to travel
// as an upload (see lib/viewOnceApi) and so lives here, with its thumbnail.
//
// Each card that can be view-once carries the switch for it (the eye), and a
// view-once card the switch for the viewer's-name watermark beside it. Both
// are the sender's call, file by file.

export function AttachmentKindIcon({ kind, className }: { kind: PendingAttachment["kind"]; className?: string }) {
  if (kind === "video") return <MdMovie className={className} aria-hidden />;
  if (kind === "audio") return <MdAudiotrack className={className} aria-hidden />;
  return <MdInsertDriveFile className={className} aria-hidden />;
}

export function AttachmentTray({
  items,
  onRemove,
  uploads,
  onRestoreImage,
  disabled = false,
  className = "",
}: {
  items: PendingAttachment[];
  onRemove: (id: number) => void;
  /** The tray's owner — given, the view-once and watermark switches show. */
  uploads?: AttachmentUploads;
  /**
   * Where a picture goes when view-once is switched back off: the composer's
   * own picture tray, so it is sent inline like any other picture.
   */
  onRestoreImage?: (file: File) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  if (items.length === 0) return null;

  function toggleViewOnce(item: PendingAttachment) {
    if (!uploads) return;
    if (item.viewOnce && item.type?.startsWith("image/") && onRestoreImage) {
      const file = uploads.take(item.id);
      if (file) onRestoreImage(file);
      return;
    }
    uploads.setViewOnce(item.id, !item.viewOnce);
  }

  const switchClass = (on: boolean) =>
    `inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-50 ${
      on
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    }`;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((item) => {
        const failed = item.status === "error";
        const busy = item.status === "queued" || item.status === "uploading";
        const canViewOnce =
          Boolean(uploads) && isViewOnceFile({ type: item.type ?? "" }) && Boolean(uploads?.canReupload(item.id));
        return (
          <div
            key={item.id}
            title={failed ? item.error : item.name}
            className={`relative flex w-56 max-w-full items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5 ${
              failed
                ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                : item.viewOnce
                  ? "border-blue-400 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
                  : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            {failed ? (
              <MdErrorOutline className="h-5 w-5 shrink-0 text-red-500" aria-hidden />
            ) : item.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local object URL
              <img src={item.previewUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
            ) : (
              <AttachmentKindIcon kind={item.kind} className="h-5 w-5 shrink-0 text-zinc-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{item.name}</p>
              <p className={`truncate text-[11px] ${failed ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                {failed
                  ? item.error
                  : busy
                    ? `${Math.round(item.progress * 100)}% · ${formatBytes(item.size)}`
                    : item.viewOnce
                      ? t("viewOnce.title")
                      : formatBytes(item.size)}
              </p>
            </div>
            {canViewOnce && (
              <div className="flex shrink-0 items-center gap-0.5">
                <Tooltip content={item.viewOnce ? t("viewOnce.turnOff") : t("viewOnce.turnOn")}>
                  <button
                    type="button"
                    onClick={() => toggleViewOnce(item)}
                    disabled={disabled}
                    aria-pressed={Boolean(item.viewOnce)}
                    aria-label={item.viewOnce ? t("viewOnce.turnOff") : t("viewOnce.turnOn")}
                    className={switchClass(Boolean(item.viewOnce))}
                  >
                    {item.viewOnce ? (
                      <MdVisibility className="h-4 w-4" aria-hidden />
                    ) : (
                      <MdOutlineVisibility className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </Tooltip>
                {item.viewOnce && (
                  <Tooltip
                    content={item.watermark !== false ? t("viewOnce.watermarkOn") : t("viewOnce.watermarkOff")}
                  >
                    <button
                      type="button"
                      onClick={() => uploads?.setWatermark(item.id, item.watermark === false)}
                      disabled={disabled}
                      aria-pressed={item.watermark !== false}
                      aria-label={t("viewOnce.watermark")}
                      className={switchClass(item.watermark !== false)}
                    >
                      {item.watermark !== false ? (
                        <MdBrandingWatermark className="h-4 w-4" aria-hidden />
                      ) : (
                        <MdOutlineBrandingWatermark className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </Tooltip>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              disabled={disabled}
              aria-label={t("attachments.removeFile", { name: item.name })}
              className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <MdClose className="h-3.5 w-3.5" aria-hidden />
            </button>
            {busy && (
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-0.5 bg-blue-500 transition-[width]"
                style={{ width: `${Math.max(item.progress * 100, 3)}%` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The eye on a picture in a composer's own picture tray: turning it on moves
 * the picture into the upload tray as view-once (a view-once picture cannot
 * travel inline — see lib/viewOnceApi).
 */
export function ImageViewOnceButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Tooltip content={t("viewOnce.turnOn")} wrapperClassName="absolute bottom-0.5 left-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={t("viewOnce.turnOn")}
        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-zinc-950/70 text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MdOutlineVisibility className="h-3.5 w-3.5" aria-hidden />
      </button>
    </Tooltip>
  );
}

/** A composer picture (a data URL) as a File again, for the upload tray. */
export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const base = name.replace(/\.[^.]+$/, "") || "imagem";
  return new File([blob], `${base}.${extension}`, { type: blob.type });
}
