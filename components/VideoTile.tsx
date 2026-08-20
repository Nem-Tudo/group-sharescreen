"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  SpeakerIcon,
  SpeakerMuteIcon,
  PipIcon,
  PipExitIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  EyeIcon,
  EyeOffIcon,
} from "@/components/icons";
import { VolumeSlider } from "@/components/VolumeSlider";

function noopSubscribe() {
  return () => {};
}
function getPipSupported() {
  return typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);
}
function getPipSupportedServer() {
  return false;
}

export function VideoTile({
  stream,
  label,
  badge,
  muted = false,
  allowUnmute = true,
  volume,
  onVolumeChange,
  fill = false,
  onStopWatching,
  onDoubleClick,
}: {
  stream: MediaStream;
  label: string;
  badge?: string;
  muted?: boolean;
  allowUnmute?: boolean;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  // When true (the lone tile in the room), grow to fill the available
  // space instead of staying locked to a 16:9 card like the grid view.
  fill?: boolean;
  // Only passed for remote peers — lets the viewer stop receiving this
  // specific stream (see WatchRoom/useRoomMedia) without affecting anyone
  // else's tile. Omitted for the local "Você" tile, which has nothing to
  // stop watching.
  onStopWatching?: () => void;
  onDoubleClick?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(muted);
  const [internalVolume, setInternalVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  // Video keeps showing the last frame's black backdrop until the stream
  // actually has data flowing — surface that gap as a spinner instead of a
  // blank black tile, and reset it whenever the stream is swapped out.
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const pipSupported = useSyncExternalStore(noopSubscribe, getPipSupported, getPipSupportedServer);
  const prevStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (videoRef.current && prevStreamRef.current !== stream) {
      prevStreamRef.current = stream;
      setIsVideoLoading(true);
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
    video.volume = Math.min(1, Math.max(0, volume ?? internalVolume));
  }, [internalVolume, isMuted, volume]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // ignored - fullscreen may be blocked by the browser
    }
  }

  async function togglePiP() {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // ignored - PiP requires a direct user gesture and may be unsupported
    }
  }

  function handleVolumeChange(nextVolume: number) {
    if (volume === undefined) setInternalVolume(nextVolume);
    onVolumeChange?.(nextVolume);
    setIsMuted(nextVolume === 0);
  }

  return (
    <div
      ref={containerRef}
      onDoubleClick={onDoubleClick}
      className={`relative w-full overflow-hidden rounded-xl border border-white/10 bg-black ${
        // No min-height floor here: on a short viewport a fixed floor could
        // force this box taller than the space main actually has, which is
        // exactly what pushed the tile past the bottom of the screen and
        // forced a scroll — h-full alone always stays within whatever main
        // gives it.
        fill ? "h-full" : "aspect-video"
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onLoadedData={() => setIsVideoLoading(false)}
        className="h-full w-full object-contain bg-black"
      />
      {isVideoLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/85 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        {badge && (
          <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="absolute right-2 top-2 flex flex-wrap items-center justify-end gap-2">
        {allowUnmute && (
          <VolumeSlider
            value={volume ?? internalVolume}
            label={`Volume da transmissão de ${label}`}
            onChange={handleVolumeChange}
            showIcon={false}
            className="rounded-full bg-black/60 px-2 py-1 text-white"
          />
        )}
        {allowUnmute && (
          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            title={isMuted ? "Ativar som" : "Silenciar"}
            aria-label={isMuted ? "Ativar som" : "Silenciar"}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isMuted ? <SpeakerMuteIcon className="h-5 w-5" /> : <SpeakerIcon className="h-5 w-5" />}
          </button>
        )}
        {pipSupported && (
          <button
            type="button"
            onClick={togglePiP}
            title={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
            aria-label={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isPiP ? <PipExitIcon className="h-5 w-5" /> : <PipIcon className="h-5 w-5" />}
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
        >
          {isFullscreen ? <FullscreenExitIcon className="h-5 w-5" /> : <FullscreenIcon className="h-5 w-5" />}
        </button>
        {onStopWatching && (
          <button
            type="button"
            onClick={onStopWatching}
            title="Parar de assistir"
            aria-label="Parar de assistir"
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            <EyeOffIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}

function PlaceholderTile({
  fill,
  children,
}: {
  fill: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-white/10 bg-black px-4 text-center ${
        // Same reasoning as VideoTile's fill container above: no min-height
        // floor, so this never grows past what main actually has to give.
        fill ? "h-full" : "aspect-video"
      }`}
    >
      {children}
    </div>
  );
}

export function StoppedPeerTile({
  label,
  fill = false,
  onResume,
}: {
  label: string;
  fill?: boolean;
  onResume: () => void;
}) {
  return (
    <PlaceholderTile fill={fill}>
      <p className="text-sm text-zinc-300">
        Você saiu dessa transmissão
        <br />
        <span className="text-zinc-500">({label})</span>
      </p>
      <button
        type="button"
        onClick={onResume}
        className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/20"
      >
        <EyeIcon className="h-5 w-5" />
        Retomar transmissão
      </button>
    </PlaceholderTile>
  );
}

// Shown between the moment resumeWatchingPeer() is called and the moment a
// fresh stream actually arrives — without this, the tile would just vanish
// for that stretch (no tile at all), since it's neither in stoppedPeers
// (cleared immediately) nor in remoteStreams (nothing received yet).
export function ResumingPeerTile({ fill = false }: { fill?: boolean }) {
  return (
    <PlaceholderTile fill={fill}>
      <p className="text-sm text-zinc-400">Retomando...</p>
    </PlaceholderTile>
  );
}
