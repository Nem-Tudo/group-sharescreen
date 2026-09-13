"use client";

import { MdAudiotrack, MdClose, MdErrorOutline, MdInsertDriveFile, MdMovie } from "react-icons/md";
import { formatBytes } from "@/lib/chatAttachments";
import type { PendingAttachment } from "@/lib/useAttachmentUploads";
import { useT } from "@/lib/useI18n";

// The files waiting in a composer, each with how far its upload has got.
// Pictures have their own tray of thumbnails in each composer; these are the
// videos and documents, drawn as small cards because a thumbnail of a PDF
// says nothing.

export function AttachmentKindIcon({ kind, className }: { kind: PendingAttachment["kind"]; className?: string }) {
  if (kind === "video") return <MdMovie className={className} aria-hidden />;
  if (kind === "audio") return <MdAudiotrack className={className} aria-hidden />;
  return <MdInsertDriveFile className={className} aria-hidden />;
}

export function AttachmentTray({
  items,
  onRemove,
  disabled = false,
  className = "",
}: {
  items: PendingAttachment[];
  onRemove: (id: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((item) => {
        const failed = item.status === "error";
        const busy = item.status === "queued" || item.status === "uploading";
        return (
          <div
            key={item.id}
            title={failed ? item.error : item.name}
            className={`relative flex w-48 max-w-full items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5 ${
              failed
                ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            {failed ? (
              <MdErrorOutline className="h-5 w-5 shrink-0 text-red-500" aria-hidden />
            ) : (
              <AttachmentKindIcon kind={item.kind} className="h-5 w-5 shrink-0 text-zinc-500" />
            )}
            <div className="min-w-0 flex-1 pr-4">
              <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{item.name}</p>
              <p className={`truncate text-[11px] ${failed ? "text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                {failed
                  ? item.error
                  : busy
                    ? `${Math.round(item.progress * 100)}% · ${formatBytes(item.size)}`
                    : formatBytes(item.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              disabled={disabled}
              aria-label={t("attachments.removeFile", { name: item.name })}
              className="absolute right-1 top-1 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
