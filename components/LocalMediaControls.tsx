"use client";

import { useSyncExternalStore, useState, useEffect, type ReactNode } from "react";
import {
  MdPlayArrow,
  MdPause,
  MdSkipNext,
  MdSkipPrevious,
  MdPlaylistPlay,
  MdReplay10,
  MdForward10,
  MdClose,
  MdLock,
  MdLockOpen,
} from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { VolumeSlider } from "@/components/VolumeSlider";
import {
  localMediaSources,
  localFilePosition,
  type LocalMediaAction,
  type LocalMediaSlot,
} from "@/lib/localMediaSource";
import { signalingClient, type SharedFile } from "@/lib/signalingClient";
import { formatMusicTime } from "@/lib/musicSource";

// The transport for a local file being played into the room, drawn inside its
// own tile (see VideoTile's `transport` slot).
//
// In the tile and not in a bar at the top of the page, because that is where
// the thing being controlled is: these buttons drive *this* picture, and a
// strip somewhere else has to be connected to it by the reader. It also means
// the controls follow the tile into focus and fullscreen instead of being left
// behind above them.
//
// Two callers, and the difference between them is only where the buttons send
// what they do:
//
//   - the person playing the file drives their own machine directly;
//   - anyone else, when that file says "todos podem controlar", sends the same
//     action to them and their client does it (see useRoomMedia's file-control
//     listener). The picture everyone sees is the result either way.
//
// The readouts differ the same way: locally the element is right there, and
// remotely the position is extrapolated from the last state its owner
// announced — the same arithmetic a room video source uses.

// How often the remote readout re-computes. It is arithmetic on a timestamp,
// not a poll of anything, so this only decides how smoothly the bar moves.
const REMOTE_TICK_MS = 500;

export function LocalMediaControls({
  slot,
  canRestrictControl,
  onRequestAccount,
  onStop,
}: {
  slot: LocalMediaSlot;
  // Whether "só eu posso controlar" is available to this person at all — an
  // account can claim it, a guest cannot (see the server's allowedControlMode,
  // which forces a guest's files open however they are announced).
  canRestrictControl: boolean;
  onRequestAccount?: () => void;
  // Taking it off the room. Only offered to whoever is playing it: for anyone
  // else "controlar" means play/pause/skip, never ending someone's broadcast.
  onStop: () => void;
}) {
  const source = localMediaSources[slot];
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [volume, setVolume] = useState(1);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const current = state.queue[state.index] ?? null;
  if (!current) return null;

  return (
    <Transport
      title={current.name}
      queue={state.queue.map((item) => item.name)}
      index={state.index}
      playing={state.playing}
      position={scrubbing ?? state.position}
      duration={state.duration}
      failed={state.failed}
      music={state.mode === "music"}
      scrubbing={scrubbing}
      setScrubbing={setScrubbing}
      listOpen={listOpen}
      setListOpen={setListOpen}
      onAction={(request) => {
        switch (request.action) {
          case "toggle":
            source.togglePlay();
            break;
          case "next":
            source.next();
            break;
          case "previous":
            source.previous();
            break;
          case "seek":
            source.seekTo(request.seconds);
            break;
          case "playAt":
            void source.playAt(request.index);
            break;
        }
      }}
      onStop={onStop}
      // Changed here rather than only when the file was picked: deciding to
      // hand the wheel over halfway through a film should not mean taking the
      // film off and putting it on again.
      controlMode={state.controlMode}
      restrictedLabel={
        state.mode === "music" ? "Só você e a administração da sala" : "Só você"
      }
      canRestrictControl={canRestrictControl}
      onRequestAccount={onRequestAccount}
      onControlModeChange={(next) => source.setControlMode(next)}
      volume={volume}
      onVolumeChange={(next) => {
        setVolume(next);
        source.setLocalVolume(next);
      }}
    />
  );
}

// Someone else's file. Same transport either way — what changes is whether it
// does anything.
//
// Shown even to someone who may not drive it, greyed out rather than absent:
// where the track is, how long it runs and which of how many it is are things
// a listener wants to know regardless of who holds the wheel, and a strip that
// simply vanishes for them reads as "this is broken" rather than as "this one
// is not yours to touch".
export function RemoteMediaControls({
  peerId,
  file,
  canControl,
}: {
  peerId: string;
  file: SharedFile;
  canControl: boolean;
}) {
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // The announcement only lands on discrete events, so the readout between
  // them is arithmetic (see localFilePosition) rather than anything received.
  // The clock is what this ticks on; the position itself is derived from it
  // and from whatever the last announcement said, so a fresh announcement is
  // reflected on the next render without an effect having to copy it into
  // state.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REMOTE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const position = localFilePosition(file, now);

  function send(request: LocalMediaAction) {
    // Belt and braces: the buttons are disabled, and the owner's client would
    // refuse this anyway (see LocalMediaSource.applyRemote, the check that
    // actually counts).
    if (!canControl) return;
    signalingClient.sendSignal(peerId, { kind: "file-control", channel: file.channel, ...request });
  }

  return (
    <Transport
      title={file.name}
      // The queue's contents are the other machine's business; all a viewer
      // needs is where in it they are, which the counter below already says.
      queue={null}
      index={file.index}
      count={file.count}
      playing={file.playing}
      position={scrubbing ?? position}
      duration={file.duration}
      failed={null}
      music={false}
      scrubbing={scrubbing}
      setScrubbing={setScrubbing}
      listOpen={listOpen}
      setListOpen={setListOpen}
      onAction={send}
      disabled={!canControl}
    />
  );
}

function Transport({
  title,
  queue,
  index,
  count,
  playing,
  position,
  duration,
  failed,
  music,
  scrubbing,
  setScrubbing,
  listOpen,
  setListOpen,
  onAction,
  disabled = false,
  onStop,
  controlMode,
  restrictedLabel = "Só você",
  canRestrictControl = false,
  onRequestAccount,
  onControlModeChange,
  volume,
  onVolumeChange,
}: {
  title: string;
  queue: string[] | null;
  index: number;
  count?: number;
  playing: boolean;
  position: number;
  duration: number;
  failed: string | null;
  music: boolean;
  scrubbing: number | null;
  setScrubbing: (value: number | null) => void;
  listOpen: boolean;
  setListOpen: (updater: (open: boolean) => boolean) => void;
  onAction: (request: LocalMediaAction) => void;
  disabled?: boolean;
  onStop?: () => void;
  controlMode?: "owner" | "anyone";
  restrictedLabel?: string;
  canRestrictControl?: boolean;
  onRequestAccount?: () => void;
  onControlModeChange?: (next: "owner" | "anyone") => void;
  volume?: number;
  onVolumeChange?: (value: number) => void;
}) {
  const total = queue?.length ?? count ?? 1;
  const many = total > 1;

  return (
    <div className="flex w-full flex-col text-white">
      {/* The queue, above the controls rather than below them: it opens
          upwards into the picture, where there is room, instead of pushing the
          transport off the bottom edge of the tile. */}
      {listOpen && queue && many && (
        <ul className="mx-2 mb-1 max-h-32 overflow-y-auto rounded-lg bg-black/70 p-1 backdrop-blur-sm">
          {queue.map((name, itemIndex) => (
            <li key={`${itemIndex}-${name}`}>
              <button
                type="button"
                onClick={() => onAction({ action: "playAt", index: itemIndex })}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition hover:bg-white/15 ${
                  itemIndex === index ? "font-semibold" : "opacity-80"
                }`}
              >
                <span className="w-6 shrink-0 text-right font-mono tabular-nums opacity-70">
                  {itemIndex + 1}
                </span>
                <span className="truncate">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {failed && <p className="truncate px-3 pb-0.5 text-[11px] text-amber-300">{failed}</p>}

      {/* Symmetric padding, so the row sits in the middle of whatever box it
          is given. It used to be bottom-only, which is right for the tile
          overlay it was written for (the gradient above supplies the top) and
          wrong everywhere else — inside the music strip it pushed the whole
          transport a few pixels above centre. The tile compensates by moving
          its name bar up instead (see VideoTile's `transport` offset). */}
      <div className="flex w-full items-center gap-2 px-2 py-1">
        <div className="flex shrink-0 items-center gap-0.5">
          {many && (
            <ControlButton
              label="Anterior"
              disabled={disabled}
              onClick={() => onAction({ action: "previous" })}
            >
              <MdSkipPrevious className="h-4 w-4" />
            </ControlButton>
          )}
          <ControlButton
            label="Voltar 10 segundos"
            disabled={disabled}
            onClick={() => onAction({ action: "seek", seconds: position - 10 })}
            className="hidden sm:flex"
          >
            <MdReplay10 className="h-4 w-4" />
          </ControlButton>
          <ControlButton
            label={playing ? "Pausar" : "Tocar"}
            disabled={disabled}
            onClick={() => onAction({ action: "toggle" })}
          >
            {playing ? <MdPause className="h-4 w-4" /> : <MdPlayArrow className="h-4 w-4" />}
          </ControlButton>
          <ControlButton
            label="Avançar 10 segundos"
            disabled={disabled}
            onClick={() => onAction({ action: "seek", seconds: position + 10 })}
            className="hidden sm:flex"
          >
            <MdForward10 className="h-4 w-4" />
          </ControlButton>
          {many && (
            <ControlButton
              label="Próximo"
              disabled={disabled}
              onClick={() => onAction({ action: "next" })}
            >
              <MdSkipNext className="h-4 w-4" />
            </ControlButton>
          )}
        </div>

        {many && (
          <span className="shrink-0 text-[11px] tabular-nums opacity-80">
            {index + 1}/{total}
          </span>
        )}

        <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-90">
          {formatMusicTime(position)}
        </span>
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          step={1}
          value={Math.min(position, duration > 0 ? duration : 100)}
          disabled={disabled || duration <= 0}
          aria-label={`Posição de ${title}`}
          onChange={(e) => setScrubbing(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubbing !== null) onAction({ action: "seek", seconds: scrubbing });
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing !== null) onAction({ action: "seek", seconds: scrubbing });
            setScrubbing(null);
          }}
          className="h-1 w-full min-w-10 cursor-pointer appearance-none rounded-full bg-white/30 accent-white disabled:cursor-default"
        />
        <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-90">
          {duration > 0 ? formatMusicTime(duration) : "--:--"}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          {queue && many && (
            <ControlButton label="Ver a fila" onClick={() => setListOpen((open) => !open)}>
              <MdPlaylistPlay className="h-4 w-4" />
            </ControlButton>
          )}
          {/* Only this device's speakers. The room hears the captured track,
              which is taken before this is applied — turning it down here is
              for the person playing it, not for everybody. */}
          {volume !== undefined && onVolumeChange && (
            <VolumeSlider
              value={volume}
              label="Volume no seu computador (não muda para a sala)"
              onChange={onVolumeChange}
              className="hidden w-20 lg:flex"
            />
          )}
          {controlMode && onControlModeChange && (
            <ControlButton
              label={
                controlMode === "anyone"
                  ? canRestrictControl
                    ? `Todos podem controlar. Clique para deixar ${restrictedLabel.toLowerCase()}`
                    : "Utilize uma conta para restringir o controle"
                  : `${restrictedLabel} controla. Clique para liberar para todos`
              }
              disabled={controlMode === "anyone" && !canRestrictControl}
              onClick={
                controlMode === "anyone" && !canRestrictControl
                  ? () => onRequestAccount?.()
                  : () => onControlModeChange(controlMode === "anyone" ? "owner" : "anyone")
              }
            >
              {controlMode === "anyone" ? (
                <MdLockOpen className="h-4 w-4" />
              ) : (
                <MdLock className="h-4 w-4" />
              )}
            </ControlButton>
          )}
          {onStop && (
            <ControlButton
              label={music ? "Tirar a música da sala" : "Remover esse vídeo da sala (para todos)"}
              onClick={onStop}
            >
              <MdClose className="h-4 w-4" style={{ color: "red" }} />
            </ControlButton>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  label,
  onClick,
  disabled = false,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    // Wrapped, so the hint still opens on a disabled button — which emits no
    // pointer events of its own, and is exactly the one that needs explaining.
    <Tooltip content={label} wrapperClassName="flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition ${
          disabled
            ? "opacity-40 hover:bg-transparent"
            : "hover:bg-white/20"
        } ${className}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
