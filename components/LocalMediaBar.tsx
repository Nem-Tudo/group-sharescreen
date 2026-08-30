"use client";

import { useSyncExternalStore, useState, type ReactNode } from "react";
import {
  MdPlayArrow,
  MdPause,
  MdSkipNext,
  MdSkipPrevious,
  MdPlaylistPlay,
  MdMovie,
  MdMusicNote,
  MdStop,
} from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { VolumeSlider } from "@/components/VolumeSlider";
import { localMediaSource } from "@/lib/localMediaSource";
import { formatMusicTime } from "@/lib/musicSource";

// The transport for a local file being broadcast (see lib/localMediaSource.ts).
// Shown only to the person doing the broadcasting: the room receives live
// video and audio, so there is nothing for anyone else to control here — what
// they see is the result of these buttons, the same way they see a paused
// video on a shared screen.
//
// A strip under the header rather than controls inside the tile, for two
// reasons: the queue (which track of how many, what is next) has nowhere to
// live in a tile that may be one of nine, and the broadcaster very often is
// not looking at their own preview at all.
export function LocalMediaBar({ onStop }: { onStop: () => void }) {
  const state = useSyncExternalStore(
    localMediaSource.subscribe,
    localMediaSource.getSnapshot,
    localMediaSource.getSnapshot
  );
  const [volume, setVolume] = useState(1);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const current = state.queue[state.index] ?? null;
  if (!current) return null;

  const shown = scrubbing ?? state.position;
  const many = state.queue.length > 1;

  return (
    <div className="flex w-full shrink-0 flex-col border-b border-sky-700/40 bg-sky-600 text-white dark:bg-sky-700">
      <div className="flex w-full flex-nowrap items-center gap-x-3 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {current.hasVideo ? (
            <MdMovie className="h-4 w-4 shrink-0 opacity-90" />
          ) : (
            <MdMusicNote className="h-4 w-4 shrink-0 opacity-90" />
          )}
          <div className="min-w-0">
            <Tooltip content={current.name}>
              <p className="truncate text-xs font-semibold leading-tight">{current.name}</p>
            </Tooltip>
            <p className="truncate text-[11px] leading-tight opacity-80">
              {state.failed
                ? state.failed
                : many
                  ? `${state.index + 1} de ${state.queue.length} · transmitindo do seu computador`
                  : "transmitindo do seu computador"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {many && (
            <BarButton label="Anterior" onClick={() => localMediaSource.previous()}>
              <MdSkipPrevious className="h-5 w-5" />
            </BarButton>
          )}
          <BarButton
            label={state.playing ? "Pausar" : "Tocar"}
            onClick={() => localMediaSource.togglePlay()}
          >
            {state.playing ? <MdPause className="h-5 w-5" /> : <MdPlayArrow className="h-5 w-5" />}
          </BarButton>
          {many && (
            <BarButton label="Próximo" onClick={() => localMediaSource.next()}>
              <MdSkipNext className="h-5 w-5" />
            </BarButton>
          )}
          {many && (
            <BarButton label="Ver a fila" onClick={() => setListOpen((open) => !open)}>
              <MdPlaylistPlay className="h-5 w-5" />
            </BarButton>
          )}
        </div>

        <div className="hidden min-w-0 flex-[2] items-center gap-2 sm:flex">
          <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-90">
            {formatMusicTime(shown)}
          </span>
          <input
            type="range"
            min={0}
            max={state.duration > 0 ? state.duration : 100}
            step={1}
            value={Math.min(shown, state.duration > 0 ? state.duration : 100)}
            disabled={state.duration <= 0}
            aria-label="Posição do arquivo"
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onPointerUp={() => {
              if (scrubbing !== null) localMediaSource.seekTo(scrubbing);
              setScrubbing(null);
            }}
            onKeyUp={() => {
              if (scrubbing !== null) localMediaSource.seekTo(scrubbing);
              setScrubbing(null);
            }}
            className="h-1 w-full min-w-16 cursor-pointer appearance-none rounded-full bg-white/30 accent-white disabled:cursor-default"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-90">
            {state.duration > 0 ? formatMusicTime(state.duration) : "--:--"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Only this device's speakers. The room hears the captured track,
              which is taken before this is applied — turning it down here is
              for the person broadcasting, not for everybody. */}
          <VolumeSlider
            value={volume}
            label="Volume no seu computador (não muda para a sala)"
            onChange={(next) => {
              setVolume(next);
              localMediaSource.setLocalVolume(next);
            }}
            className="hidden w-24 sm:flex"
          />
          <BarButton label="Parar de transmitir o arquivo" onClick={onStop}>
            <MdStop className="h-4 w-4" />
          </BarButton>
        </div>
      </div>

      {listOpen && many && (
        <ul className="max-h-40 overflow-y-auto border-t border-white/20 px-2 py-1">
          {state.queue.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void localMediaSource.playAt(index)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition hover:bg-white/15 ${
                  index === state.index ? "font-semibold" : "opacity-80"
                }`}
              >
                <span className="w-6 shrink-0 text-right font-mono tabular-nums opacity-70">
                  {index + 1}
                </span>
                <span className="truncate">{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-white/20"
      >
        {children}
      </button>
    </Tooltip>
  );
}
