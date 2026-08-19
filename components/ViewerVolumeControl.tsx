"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SpeakerIcon, SpeakerMuteIcon } from "@/components/icons";
import { MAX_VIEWER_VOLUME, useViewerAudio } from "@/lib/useViewerAudio";

export function ViewerVolumeControl({
  stream,
  label,
  showLabel = false,
}: {
  stream: MediaStream;
  label: string;
  showLabel?: boolean;
}) {
  const [hasAudio, setHasAudio] = useState(() =>
    stream.getAudioTracks().some((track) => track.readyState === "live")
  );
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 16, width: 288 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sliderId = useId();
  const viewerAudio = useViewerAudio(stream, hasAudio);

  useEffect(() => {
    const watchedTracks = new Set<MediaStreamTrack>();

    function updateAvailability() {
      const available = stream.getAudioTracks().some((track) => track.readyState === "live");
      setHasAudio(available);
      if (!available) setOpen(false);
    }

    function watchTrack(track: MediaStreamTrack) {
      if (track.kind !== "audio" || watchedTracks.has(track)) return;
      watchedTracks.add(track);
      track.addEventListener("ended", updateAvailability);
    }

    function unwatchTrack(track: MediaStreamTrack) {
      if (!watchedTracks.delete(track)) return;
      track.removeEventListener("ended", updateAvailability);
    }

    function onAddTrack(event: MediaStreamTrackEvent) {
      if (event.track.kind !== "audio") return;
      watchTrack(event.track);
      updateAvailability();
    }

    function onRemoveTrack(event: MediaStreamTrackEvent) {
      if (event.track.kind !== "audio") return;
      unwatchTrack(event.track);
      updateAvailability();
    }

    stream.getAudioTracks().forEach(watchTrack);
    stream.addEventListener("addtrack", onAddTrack);
    stream.addEventListener("removetrack", onRemoveTrack);

    return () => {
      stream.removeEventListener("addtrack", onAddTrack);
      stream.removeEventListener("removetrack", onRemoveTrack);
      watchedTracks.forEach(unwatchTrack);
    };
  }, [stream]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function closePopover() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closePopover);
    window.addEventListener("scroll", closePopover, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closePopover);
      window.removeEventListener("scroll", closePopover, true);
    };
  }, [open]);

  if (!hasAudio) return null;

  const displayedVolume = viewerAudio.muted ? 0 : viewerAudio.volume;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          viewerAudio.resumeAudio();
          if (open) {
            setOpen(false);
            return;
          }
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            const viewportMargin = 16;
            const width = Math.min(288, window.innerWidth - viewportMargin * 2);
            const left = Math.min(
              Math.max(viewportMargin, rect.right - width),
              window.innerWidth - width - viewportMargin
            );
            const estimatedHeight = 220;
            const top =
              rect.bottom + 8 + estimatedHeight <= window.innerHeight - viewportMargin
                ? rect.bottom + 8
                : Math.max(viewportMargin, rect.top - estimatedHeight - 8);
            setPopoverPosition({ top, left, width });
          }
          setOpen(true);
        }}
        title={`Volume da transmissão de ${label}: ${displayedVolume}%`}
        aria-label={`Volume da transmissão de ${label}: ${displayedVolume}%`}
        aria-expanded={open}
        aria-controls={`${sliderId}-popover`}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {viewerAudio.muted || viewerAudio.volume === 0 ? (
          <SpeakerMuteIcon className="h-4 w-4" />
        ) : (
          <SpeakerIcon className="h-4 w-4" />
        )}
        {showLabel && <span className="max-w-24 truncate">{label}</span>}
        <span className="tabular-nums">{displayedVolume}%</span>
      </button>

      {open && (
        <div
          id={`${sliderId}-popover`}
          style={popoverPosition}
          className="fixed z-30 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Volume da transmissão
              </p>
              {showLabel && (
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
              )}
            </div>
            <output className="shrink-0 text-lg font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
              {displayedVolume}%
            </output>
          </div>

          <label className="sr-only" htmlFor={sliderId}>
            Volume da transmissão de {label}
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={MAX_VIEWER_VOLUME}
            step={5}
            value={viewerAudio.volume}
            onPointerDown={viewerAudio.resumeAudio}
            onKeyDown={viewerAudio.resumeAudio}
            onChange={(event) => viewerAudio.setVolume(Number(event.target.value))}
            aria-valuetext={viewerAudio.muted ? `Mudo; retorna a ${viewerAudio.volume}%` : `${viewerAudio.volume}%`}
            className="mt-3 block h-5 w-full cursor-pointer accent-zinc-950 dark:accent-zinc-50"
          />
          <div className="relative mt-0.5 h-4 text-[10px] leading-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true">
            <span className="absolute left-0">0%</span>
            <span className="absolute left-1/3 -translate-x-1/2">100% original</span>
            <span className="absolute right-0">300%</span>
          </div>

          <button
            type="button"
            onClick={viewerAudio.toggleMuted}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {viewerAudio.muted ? (
              <SpeakerIcon className="h-4 w-4" />
            ) : (
              <SpeakerMuteIcon className="h-4 w-4" />
            )}
            {viewerAudio.muted ? `Ativar som em ${viewerAudio.volume}%` : "Mutar"}
          </button>
        </div>
      )}
    </div>
  );
}
