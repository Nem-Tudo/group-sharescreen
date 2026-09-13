"use client";

import { MdDownload } from "react-icons/md";
import { AttachmentKindIcon } from "@/components/AttachmentTray";
import { fileExtension, formatBytes, type ChatAttachment } from "@/lib/chatAttachments";
import { useT } from "@/lib/useI18n";

// The files a message carries, as they are drawn in a conversation: a player
// for a video or a song, a card with a download button for anything else.
// Shared by the room chat, DMs and group rooms.
//
// Every URL here was put on our CDN by the API (see its uploadRoutes.ts) and
// signed for the message that carries it, so none of them is a link somebody
// typed — but they still open in a new tab with no opener, like any link.

export function MessageAttachments({
  attachments,
  className = "",
  compact = false,
}: {
  attachments: ChatAttachment[] | undefined;
  className?: string;
  /** Narrower players, for the room chat's sidebar. */
  compact?: boolean;
}) {
  const t = useT();
  if (!attachments || attachments.length === 0) return null;
  const width = compact ? "max-w-full" : "max-w-sm";
  return (
    <div className={`mt-1 flex flex-col gap-1.5 ${className}`}>
      {attachments.map((attachment) => {
        const meta = (
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.name}
            className="inline-flex min-w-0 items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            <MdDownload className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{attachment.name}</span>
            {attachment.size > 0 && <span className="shrink-0">· {formatBytes(attachment.size)}</span>}
          </a>
        );
        if (attachment.kind === "video") {
          return (
            <div key={attachment.url} className={`flex w-full flex-col gap-0.5 ${width}`}>
              <video
                src={attachment.url}
                controls
                playsInline
                preload="metadata"
                className="max-h-72 w-full rounded-lg bg-black"
              />
              {meta}
            </div>
          );
        }
        if (attachment.kind === "audio") {
          return (
            <div key={attachment.url} className={`flex w-full flex-col gap-0.5 ${width}`}>
              <audio src={attachment.url} controls preload="metadata" className="w-full" />
              {meta}
            </div>
          );
        }
        const extension = fileExtension(attachment.name);
        return (
          <a
            key={attachment.url}
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.name}
            title={t("attachments.downloadName", { name: attachment.name })}
            className={`group flex w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 transition hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 ${width}`}
          >
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              <AttachmentKindIcon kind="file" className="h-5 w-5" />
              {extension && (
                <span className="absolute -bottom-1 rounded bg-blue-600 px-1 text-[8px] font-bold leading-3 text-white">
                  {extension}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{attachment.name}</span>
              {attachment.size > 0 && (
                <span className="block text-[11px] text-zinc-500">{formatBytes(attachment.size)}</span>
              )}
            </span>
            <MdDownload
              className="h-5 w-5 shrink-0 text-zinc-400 transition group-hover:text-zinc-700 dark:group-hover:text-zinc-200"
              aria-hidden
            />
          </a>
        );
      })}
    </div>
  );
}
