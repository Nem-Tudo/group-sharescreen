"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DownloadIcon } from "@/components/icons";
import { downloadClip, trimRecording } from "@/lib/clipBuffer";
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

// The shortest cut the handles allow, so they can never cross.
const MIN_CUT_S = 1;

// What a finished "gravar" — or a clip — becomes: the recording to watch
// back, a timeline whose two handles pick where it starts and ends, and the
// button to save it (cut first, when the handles moved — see trimRecording).
// Nothing is uploaded — closing without downloading throws it away.
export function RecordingModal({
  blob,
  durationMs,
  kind = "recording",
  name,
  onClose,
}: {
  blob: Blob;
  durationMs: number;
  kind?: "clip" | "recording";
  name: string;
  onClose: () => void;
}) {
  const t = useT();
  const title = kind === "clip" ? t("recording.clipTitle") : t("recording.title");
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // MediaRecorder files often carry no duration (the element says Infinity),
  // so the recorder's own clock is the starting point and a real one, when the
  // element does know it, replaces it.
  const [total, setTotal] = useState(Math.max(MIN_CUT_S, durationMs / 1000));
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(total);
  const [playhead, setPlayhead] = useState(0);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [cutting, setCutting] = useState<number | null>(null);
  const [cutFailed, setCutFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const trimmed = start > 0.05 || end < total - 0.05;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The preview plays only the chosen stretch, looping back to its start.
  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setPlayhead(video.currentTime);
    if (video.currentTime >= end || video.currentTime < start - 0.25) video.currentTime = start;
  };
  const onLoadedMetadata = () => {
    const d = videoRef.current?.duration;
    if (d && Number.isFinite(d) && d > 0) {
      setTotal(d);
      setEnd((e) => (e >= total - 0.05 ? d : Math.min(e, d)));
    }
  };

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total;
  };
  const seek = (time: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = time;
    setPlayhead(time);
  };
  const onHandleDown = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    videoRef.current?.pause();
    setDragging(which);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const time = timeAt(e.clientX);
    if (dragging === "start") {
      const next = Math.min(time, end - MIN_CUT_S);
      setStart(Math.max(0, next));
      seek(Math.max(0, next));
    } else {
      const next = Math.max(time, start + MIN_CUT_S);
      setEnd(Math.min(total, next));
      seek(Math.min(total, next));
    }
  };
  const onHandleUp = () => {
    if (!dragging) return;
    setDragging(null);
    seek(start);
  };
  const onTrackClick = (e: React.MouseEvent) => {
    seek(Math.min(end, Math.max(start, timeAt(e.clientX))));
  };
  const nudge = (which: "start" | "end") => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 0.5;
    const delta = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    if (!delta) return;
    e.preventDefault();
    if (which === "start") setStart((s) => Math.min(end - MIN_CUT_S, Math.max(0, s + delta)));
    else setEnd((v) => Math.max(start + MIN_CUT_S, Math.min(total, v + delta)));
  };

  const download = async () => {
    if (!trimmed) {
      downloadClip(blob, name);
      return;
    }
    videoRef.current?.pause();
    const controller = new AbortController();
    abortRef.current = controller;
    setCutFailed(false);
    setCutting(0);
    const result = await trimRecording(blob, start, end, setCutting, controller.signal);
    abortRef.current = null;
    setCutting(null);
    if (controller.signal.aborted) return;
    if (result) downloadClip(result, name);
    else setCutFailed(true);
  };
  const cancelCut = () => abortRef.current?.abort();

  const pct = (time: number) => `${(time / total) * 100}%`;

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
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title} — {name}
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
        <video
          ref={videoRef}
          src={url}
          controls
          autoPlay
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          className="max-h-[55vh] w-full rounded-lg bg-black"
        />

        {/* The cut: drag either handle; the stretch between them is what gets
            previewed and downloaded. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{t("recording.trimHint")}</span>
            {trimmed && (
              <button
                type="button"
                onClick={() => {
                  setStart(0);
                  setEnd(total);
                }}
                className="font-medium text-zinc-700 hover:underline dark:text-zinc-300"
              >
                {t("recording.trimReset")}
              </button>
            )}
          </div>
          <div
            ref={trackRef}
            onClick={onTrackClick}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            className="relative h-10 cursor-pointer touch-none select-none rounded-lg bg-zinc-200 dark:bg-zinc-800"
          >
            <div
              className="absolute inset-y-0 rounded-lg border-2 border-emerald-500 bg-emerald-500/20"
              style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-zinc-900 dark:bg-white"
              style={{ left: pct(playhead) }}
            />
            {(["start", "end"] as const).map((which) => (
              <div
                key={which}
                role="slider"
                tabIndex={0}
                aria-label={which === "start" ? t("recording.trimStart") : t("recording.trimEnd")}
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                aria-valuenow={Math.round(which === "start" ? start : end)}
                aria-valuetext={formatDuration((which === "start" ? start : end) * 1000)}
                onPointerDown={onHandleDown(which)}
                onKeyDown={nudge(which)}
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-md bg-emerald-600 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                style={{ left: pct(which === "start" ? start : end) }}
              >
                <span className="h-4 w-0.5 rounded bg-white/80" />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs tabular-nums text-zinc-500">
            <span>{formatDuration(start * 1000)}</span>
            <span>{formatDuration(end * 1000)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            {t("recording.duration")}:{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">{formatDuration((end - start) * 1000)}</strong>
            {!trimmed && (
              <>
                {" · "}
                {formatSize(blob.size)}
              </>
            )}
          </span>
          {cutting !== null ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs">{t("recording.cutting")}</span>
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${cutting * 100}%` }} />
                </div>
              </div>
              <button
                type="button"
                onClick={cancelCut}
                className="rounded-lg px-3 py-2 font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                {t("recording.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={download}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
            >
              <DownloadIcon className="h-4 w-4" />
              {t("recording.download")}
            </button>
          )}
        </div>
        {cutFailed && <p className="text-xs text-red-600">{t("recording.cutFailed")}</p>}
        <p className="text-xs text-zinc-500">{t("recording.notSaved")}</p>
      </div>
    </div>,
    document.body,
  );
}
