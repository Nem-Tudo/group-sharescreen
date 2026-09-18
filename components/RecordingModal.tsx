"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { DownloadIcon } from "@/components/icons";
import { downloadClip } from "@/lib/clipBuffer";
import { useT } from "@/lib/useI18n";

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// What a finished "gravar" becomes: the recording to watch back, how long and
// how big it is, and the button to save it. Nothing is uploaded — closing
// without downloading throws it away.
export function RecordingModal({
  blob,
  durationMs,
  name,
  onClose,
}: {
  blob: Blob;
  durationMs: number;
  name: string;
  onClose: () => void;
}) {
  const t = useT();
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      // Portalled, but React still bubbles events up the tile that opened it —
      // whose double click means "focar".
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("recording.title")}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t("recording.title")} — {name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("recording.close")}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            ✕
          </button>
        </div>
        <video src={url} controls autoPlay className="max-h-[60vh] w-full rounded-lg bg-black" />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {t("recording.duration")}:{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">{formatDuration(durationMs)}</strong>
            {" · "}
            {formatSize(blob.size)}
          </span>
          <button
            type="button"
            onClick={() => downloadClip(blob, name)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
          >
            <DownloadIcon className="h-4 w-4" />
            {t("recording.download")}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t("recording.notSaved")}</p>
      </div>
    </div>,
    document.body,
  );
}
