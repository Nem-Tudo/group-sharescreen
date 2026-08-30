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
  FocusIcon,
  HyperfocusIcon,
  MicIcon,
  MicOffIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
} from "@/components/icons";
import { VolumeSlider } from "@/components/VolumeSlider";
import { Tooltip } from "@/components/Tooltip";
import { MAX_GAIN } from "@/lib/audioGain";
import { useGainedAudio } from "@/lib/useGainedAudio";

function noopSubscribe() {
  return () => { };
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
  accessibleLabel,
  badge,
  muted = false,
  allowUnmute = true,
  volume,
  onVolumeChange,
  fill = false,
  compact = false,
  onStopWatching,
  onDoubleClick,
  onRenderedSizeChange,
  onFocus,
  isSpotlighted = false,
  onHyperfocus,
  isHyperfocused = false,
  isMicOn,
  onToggleMic,
  micsMuted,
  onToggleMicsMuted,
  className = "",
}: {
  stream: MediaStream;
  label: ReactNode;
  // Plain-text version of `label` for aria-label/title attributes, which
  // can't render a component (DisplayUserName) the way `label` itself can.
  // Defaults to a generic phrase when the caller has nothing better.
  accessibleLabel?: string;
  badge?: string;
  // Extra classes for the root tile — e.g. WatchRoom's spotlight grid span.
  className?: string;
  muted?: boolean;
  allowUnmute?: boolean;
  // Up to audioGain.ts's MAX_GAIN (300%) — see useGainedAudio below.
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  // Reports how large this tile is actually drawn, in CSS pixels. The viewer
  // uses it to ask the broadcaster for a matching quality tier (see
  // qualityNegotiation) — in a 30-person grid each tile is ~320px wide, so
  // without this the sender is encoding 1080p and throwing ~95% of those
  // pixels away, on their CPU and their uplink both. Omitted for the local
  // preview, which nobody is sending to us.
  onRenderedSizeChange?: (width: number, height: number) => void;
  // When true (the lone tile in the room), grow to fill the available
  // space instead of staying locked to a 16:9 card like the grid view.
  fill?: boolean;
  // A thumbnail rather than a tile — see the filmstrip under the stage in
  // WatchRoom's "Focar". Drops the control cluster and shrinks the name, both
  // for the same reason: at 200px wide there is no room for eight buttons,
  // and on a touchscreen (where the cluster has no hover to hide behind and
  // so is always on) they would cover the picture entirely. Whatever wraps a
  // compact tile is expected to be what handles a click on it.
  compact?: boolean;
  // Only passed for remote peers — lets the viewer stop receiving this
  // specific stream (see WatchRoom/useRoomMedia) without affecting anyone
  // else's tile. Omitted for the local "Você" tile, which has nothing to
  // stop watching.
  onStopWatching?: () => void;
  onDoubleClick?: () => void;
  // "Focar": grow this tile and shrink the rest, without touching anyone's
  // connection — see WatchRoom's spotlightId. Omitted where focusing makes
  // no sense (e.g. the admin moderation viewer).
  onFocus?: () => void;
  isSpotlighted?: boolean;
  // "Hiperfoco": grow this tile to near-fullscreen and actively disconnect
  // every other transmission to free up bandwidth/CPU — see WatchRoom's
  // hyperfocusId/enterHyperfocus.
  onHyperfocus?: () => void;
  isHyperfocused?: boolean;
  // The page's own mic controls (see WatchRoom's isMicOn/toggleMic and
  // micsMuted/toggleMicsMuted) — normally reachable from the header, but the
  // header is outside the element the Fullscreen API puts on screen when a
  // tile goes fullscreen on mobile. Surfacing them here, alongside the
  // fullscreen-tap-to-reveal controls below, is what keeps them reachable
  // once the header disappears. Omitted where a tile has no business
  // exposing them (e.g. the admin moderation viewer).
  isMicOn?: boolean;
  onToggleMic?: () => void;
  micsMuted?: boolean;
  onToggleMicsMuted?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMuted, setIsMuted] = useState(muted);
  const [internalVolume, setInternalVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Hover has no equivalent on a touchscreen, so the tap-to-toggle below is
  // the only way to reveal controls once native fullscreen swallows the
  // header — defaults to hidden on entry so the video actually gets the
  // whole screen instead of a permanent button bar across it.
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  // Video keeps showing the last frame's black backdrop until the stream
  // actually has data flowing — surface that gap as a spinner instead of a
  // blank black tile, and reset it whenever the stream is swapped out.
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const pipSupported = useSyncExternalStore(noopSubscribe, getPipSupported, getPipSupportedServer);

  // Resetting the spinner is derived state, not a side effect: it is a pure
  // function of "the stream changed". React's documented pattern for that is
  // to adjust during render, which is also cheaper than the effect version —
  // the effect committed a render with the *old* loading flag and then
  // immediately re-rendered, and in a 30-tile room with people joining and
  // leaving that doubled render happened constantly.
  const [renderedStream, setRenderedStream] = useState(stream);
  if (renderedStream !== stream) {
    setRenderedStream(stream);
    setIsVideoLoading(true);
  }

  // Attaching the stream to the element stays an effect: that genuinely is a
  // side effect on a DOM node.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useGainedAudio(videoRef, stream, volume ?? internalVolume, isMuted);

  useEffect(() => {
    const video = videoRef.current;

    function onFullscreenChange() {
      const nowFullscreen = document.fullscreenElement === containerRef.current;
      setIsFullscreen(nowFullscreen);
      if (nowFullscreen) setFullscreenControlsVisible(false);
    }

    function onWebkitBeginFullscreen() {
      setIsFullscreen(true);
      setFullscreenControlsVisible(false);
    }

    function onWebkitEndFullscreen() {
      setIsFullscreen(false);
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);

    video?.addEventListener(
      "webkitbeginfullscreen",
      onWebkitBeginFullscreen
    );

    video?.addEventListener(
      "webkitendfullscreen",
      onWebkitEndFullscreen
    );

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);

      video?.removeEventListener(
        "webkitbeginfullscreen",
        onWebkitBeginFullscreen
      );

      video?.removeEventListener(
        "webkitendfullscreen",
        onWebkitEndFullscreen
      );
    };
  }, []);

  // Watches the <video> itself rather than the container: the container may
  // be letterboxed around a differently-shaped video, and it is the video's
  // own drawn size that decides how many pixels are actually useful.
  // ResizeObserver (not a resize listener) because most size changes here
  // come from layout — the grid reflowing as people join, fullscreen, PiP —
  // and never fire a window resize at all.
  // Held in a ref so callers may pass an inline arrow without tearing down
  // and rebuilding the observer on every single render.
  const sizeCallbackRef = useRef(onRenderedSizeChange);
  useEffect(() => {
    sizeCallbackRef.current = onRenderedSizeChange;
  }, [onRenderedSizeChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      sizeCallbackRef.current?.(Math.round(box.width), Math.round(box.height));
    });
    observer.observe(video);
    return () => observer.disconnect();
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

  type WebkitVideo = HTMLVideoElement & {
    webkitSupportsFullscreen?: boolean;
    webkitDisplayingFullscreen?: boolean;
    webkitEnterFullscreen?: () => void;
  };

  async function toggleFullscreen() {
    const video = videoRef.current;
    const container = containerRef.current;

    if (!video || !container) return;

    const webkitVideo = video as WebkitVideo;

    // iPhone / Safari
    if (webkitVideo.webkitSupportsFullscreen) {
      if (webkitVideo.webkitDisplayingFullscreen) {
        return;
      }

      webkitVideo.webkitEnterFullscreen?.();
      return;
    }

    // Chrome / Safari desktop / Android etc.
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
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

  // Tapping the video itself — not one of the buttons layered over it,
  // which are siblings rather than descendants of <video> so their clicks
  // never reach this handler — toggles the controls while fullscreen. Outside
  // fullscreen the existing hover/touch-always-on behavior is untouched.
  function handleVideoTap() {
    if (isFullscreen) setFullscreenControlsVisible((v) => !v);
  }

  const nameForLabel = accessibleLabel ?? "essa transmissão";
  // A mouse's hover already reveals/hides controls perfectly well, in or out
  // of fullscreen, so that behavior (the `[@media(hover:hover)]` fragment
  // below) is left untouched. It's touch devices — no hover to speak of —
  // that need the tap-to-toggle: outside fullscreen they fall back to
  // always-on (nothing else can reveal them there), but inside fullscreen
  // that would just paper the video in permanent buttons, so they start
  // hidden and only appear once handleVideoTap flips them on.
  const touchHiddenInFullscreen = isFullscreen && !fullscreenControlsVisible;
  const overlayVisibilityClass = `${touchHiddenInFullscreen ? "opacity-0 pointer-events-none" : "opacity-100"
    } [@media(hover:hover)]:pointer-events-auto [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100`;

  return (
    <div
      ref={containerRef}
      onDoubleClick={onDoubleClick}
      className={`group relative w-full overflow-hidden rounded-xl border border-white/10 bg-black ${
        // No min-height floor here: on a short viewport a fixed floor could
        // force this box taller than the space main actually has, which is
        // exactly what pushed the tile past the bottom of the screen and
        // forced a scroll — h-full alone always stays within whatever main
        // gives it.
        fill ? "h-full" : "aspect-video"
        } ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onLoadedData={() => setIsVideoLoading(false)}
        onClick={handleVideoTap}
        className="h-full w-full object-contain bg-black"
      />
      {isVideoLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
        </div>
      )}
      <div
        className={`absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/85 to-transparent transition-opacity ${compact ? "px-2 py-1" : "px-3 py-2"
          } ${
          // A thumbnail's name is the only thing identifying it, so unlike the
          // buttons it stays put — and stays put *visibly*, rather than
          // waiting for a hover that a strip of twelve faces should not
          // require to be readable.
          compact ? "opacity-100" : overlayVisibilityClass
          }`}
      >
        <span className={`truncate font-medium text-white ${compact ? "text-xs" : "text-sm"}`}>
          {label}
        </span>
        {badge && !compact && (
          <span className="rounded-full bg-red-500/90 px-2 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </div>
      {/* Outside fullscreen: hidden until hovered, so a busy grid isn't
          wall-to-wall buttons — but always shown on a touch device, which
          has no hover state to reveal them with in the first place. In
          fullscreen: hidden until the video itself is tapped (see
          handleVideoTap), since a touch device has no hover to fall back
          on and a permanent button bar defeats the point of fullscreen. */}
      <div
        className={`absolute right-2 top-2 flex flex-wrap items-center justify-end gap-2 transition-opacity ${compact ? "hidden" : ""
          } ${overlayVisibilityClass}`}
      >
        {isFullscreen && onToggleMic && (
          <Tooltip content={isMicOn ? "Desativar microfone" : "Ativar microfone"}>
            <button
              type="button"
              onClick={onToggleMic}
              aria-label={isMicOn ? "Desativar microfone" : "Ativar microfone"}
              className={`rounded-full p-2 text-white active:bg-black/80 ${isMicOn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                }`}
            >
              {isMicOn ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
            </button>
          </Tooltip>
        )}
        {isFullscreen && onToggleMicsMuted && (
          <Tooltip content={micsMuted ? "Reativar microfones" : "Silenciar microfones"}>
            <button
              type="button"
              onClick={onToggleMicsMuted}
              aria-label={micsMuted ? "Reativar microfones" : "Silenciar microfones"}
              className={`rounded-full p-2 text-white active:bg-black/80 ${micsMuted ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
            >
              {micsMuted ? (
                <HeadphonesOffIcon className="h-5 w-5" />
              ) : (
                <HeadphonesIcon className="h-5 w-5" />
              )}
            </button>
          </Tooltip>
        )}
        {allowUnmute && (
          <VolumeSlider
            value={volume ?? internalVolume}
            label={`Volume da transmissão de ${nameForLabel}`}
            onChange={handleVolumeChange}
            showIcon={false}
            max={MAX_GAIN}
            className="rounded-full bg-black/60 px-2 py-1 text-white"
          />
        )}
        {allowUnmute && (
          <Tooltip content={isMuted ? "Ativar som" : "Silenciar"}>
            <button
              type="button"
              onClick={() => setIsMuted((m) => !m)}
              aria-label={isMuted ? "Ativar som" : "Silenciar"}
              className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
            >
              {isMuted ? (
                <SpeakerMuteIcon className="h-5 w-5" />
              ) : (
                <SpeakerIcon className="h-5 w-5" />
              )}
            </button>
          </Tooltip>
        )}
        {pipSupported && (
          <Tooltip content={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}>
            <button
              type="button"
              onClick={togglePiP}
              aria-label={isPiP ? "Sair do picture-in-picture" : "Picture-in-picture"}
              className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
            >
              {isPiP ? <PipExitIcon className="h-5 w-5" /> : <PipIcon className="h-5 w-5" />}
            </button>
          </Tooltip>
        )}
        {onFocus && (
          <Tooltip content={isSpotlighted ? "Remover destaque" : `Focar em ${nameForLabel}`}>
            <button
              type="button"
              onClick={onFocus}
              aria-label={isSpotlighted ? "Remover destaque" : `Focar em ${nameForLabel}`}
              aria-pressed={isSpotlighted}
              className={`rounded-full p-2 text-white active:bg-black/80 ${isSpotlighted
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-black/60 hover:bg-black/80"
                }`}
            >
              <FocusIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        )}
        {onHyperfocus && (
          <Tooltip content={`Hiperfoco em ${nameForLabel}. Esconde as outras transmissões`}>
            <button
              type="button"
              onClick={onHyperfocus}
              aria-label={`Hiperfoco em ${nameForLabel}`}
              aria-pressed={isHyperfocused}
              className={`rounded-full p-2 text-white active:bg-black/80 ${isHyperfocused
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-black/60 hover:bg-black/80"
                }`}
            >
              <HyperfocusIcon className="h-5 w-5" />
            </button>
          </Tooltip>
        )}
        <Tooltip content={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
          >
            {isFullscreen ? (
              <FullscreenExitIcon className="h-5 w-5" />
            ) : (
              <FullscreenIcon className="h-5 w-5" />
            )}
          </button>
        </Tooltip>
        {onStopWatching && (
          <Tooltip content="Parar de assistir">
            <button
              type="button"
              onClick={onStopWatching}
              aria-label="Parar de assistir"
              className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 active:bg-black/80"
            >
              <EyeOffIcon className="h-5 w-5" />
            </button>
          </Tooltip>
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
  label: ReactNode;
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
