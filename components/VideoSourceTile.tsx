"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FocusIcon, HyperfocusIcon, FullscreenIcon, FullscreenExitIcon, EyeOffIcon } from "@/components/icons";
import { Tooltip } from "@/components/Tooltip";
import { VolumeSlider } from "@/components/VolumeSlider";
import { VideoFiltersPanel, useVideoFilters, getFilterStyle } from "@/components/VideoFilters";
import { MdClose, MdSettings } from "react-icons/md";
import { videoSourcePosition, type VideoSource } from "@/lib/videoSource";
import { signalingClient } from "@/lib/signalingClient";
import { BetaMark } from "./BetaMark";

// How far out of step with the room this player may drift before it is
// pulled back, and how often that is checked. Tight: a third of a second is
// about where two screens side by side stop looking like the same video.
// It can't go much below that — a seek is not free, and correcting noise
// that YouTube's own buffering created would be a player that constantly
// yanks itself around.
const DRIFT_TOLERANCE_SECONDS = 0.35;
const DRIFT_CHECK_MS = 1000;
// Past this, catching up gradually would take longer than it's worth and the
// jump is the lesser evil. Under it, the correction is a small change of
// speed instead — a seek costs a re-buffer, and re-buffering is itself what
// put the player behind, so seeking at every third of a second would chase
// its own tail forever.
const DRIFT_SEEK_SECONDS = 1.75;
// How hard the catch-up pulls: ±12% of the room's speed, which closes a
// second of lag in about eight and is hard to notice while it happens.
const DRIFT_NUDGE_FACTOR = 0.12;
// Stop nudging once this close, rather than at zero — chasing the last
// milliseconds would leave the rate permanently oscillating.
const DRIFT_SETTLED_SECONDS = 0.1;
// A seek doesn't land instantly: the player re-buffers, and during that it
// reads as badly behind. Correcting again inside that window is how a seek
// loop starts.
const SEEK_SETTLE_MS = 1500;
// The room extrapolates a playing video's position from the owner's last
// report, so a report from twenty minutes ago carries twenty minutes of the
// owner's own buffering as error. They re-report on this interval to keep
// the room's arithmetic anchored to something recent.
const OWNER_HEARTBEAT_MS = 10_000;
// A seek/play issued to follow someone else fires the same events a person
// pressing the button would, and reporting those back would bounce around
// the room forever. Short on purpose: this used to be more than a second,
// which was long enough to *eat a real action* — pause, then immediately
// scrub, and the scrub landed inside the window and was never sent. Long
// enough to swallow the event storm a programmatic seek makes, no longer.
const REMOTE_APPLY_QUIET_MS = 400;
// Scrubbing produces a state change per frame of the drag, and each one is
// a message. They're coalesced: the first goes out immediately (so a plain
// pause is instant for everyone), the rest collapse into one trailing send
// once the burst settles, which is the one that carries the final position.
const STATE_PUSH_MIN_INTERVAL_MS = 300;
const STATE_PUSH_SETTLE_MS = 350;
// The shape both platforms' players are wrapped down to below — YT.Player
// already looks like this and is used directly; Twitch.Player doesn't
// (different methods, no seek/rate on a channel embed at all — see
// buildTwitchPlayer), so it's adapted to it instead of the sync logic
// further down needing to know which platform it's driving.
//
// Either script is loaded once for the whole page, the first time a source
// tile of that kind mounts, and not from the document head: a room with no
// video source (the overwhelming majority) should not be pulling either
// platform's script at all.
type EmbeddedPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  // 0 while a live broadcast's metadata hasn't loaded yet, and 0 for the
  // rest of its life once it has — see isLiveBroadcast below.
  getDuration?: () => number;
  getPlayerState: () => number;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  // 0-100, unlike everything else here — YouTube's scale, not ours.
  // Optional/called with ?. like getPlaybackRate above: the API object is
  // whatever YouTube's script hands back, not something we can typecheck.
  setVolume?: (volume: number) => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  destroy: () => void;
};
type YTNamespace = {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => EmbeddedPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
};
// Twitch's embed player, unlike YouTube's, is constructed against an element
// *id* rather than the node itself, has no seek/duration/rate concept for a
// channel embed, and reports state through named events rather than a
// polled getPlayerState() — see buildTwitchPlayer, which is what actually
// bridges these to EmbeddedPlayer's shape.
type TwitchPlayerInstance = {
  play: () => void;
  pause: () => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  getMuted: () => boolean;
  addEventListener: (event: string, callback: () => void) => void;
};
type TwitchNamespace = {
  Player: {
    new (elementId: string, options: Record<string, unknown>): TwitchPlayerInstance;
    READY: string;
    PLAY: string;
    PAUSE: string;
    ENDED: string;
  };
};
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
    Twitch?: TwitchNamespace;
  }
}

// Numeric codes shared by both platforms' wrapped players below. YouTube's
// own script defines the same four values (see YTNamespace.PlayerState) —
// copied here as plain numbers rather than read off it so the sync logic
// doesn't need the script loaded to know what state means what, and so
// buildTwitchPlayer (whose own API has no such enum) can report the same
// numbers for the same meaning.
const PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } as const;

// Muting is separate from volume in YouTube's API (a muted player keeps
// whatever volume it had), so both have to be pushed — and mute/unMute is
// only touched when it actually disagrees with the player, since unMute() on
// a player the browser auto-muted to allow autoplay can cost the playback
// itself.
function applyPlayerVolume(player: EmbeddedPlayer | null, volume: number, muted: boolean) {
  if (!player) return;
  player.setVolume?.(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  const wantMuted = muted || volume === 0;
  if (player.isMuted?.() === wantMuted) return;
  if (wantMuted) player.mute?.();
  else player.unMute?.();
}

// The IFrame API has no "this is a livestream" flag, but a live broadcast
// reports 0 for its duration — both while it's live and, misleadingly,
// before an ordinary video's metadata has finished loading. Callers only
// use this a moment after the player reports PLAYING/BUFFERING, by which
// point a real VOD's duration is already populated, so that transient false
// positive doesn't come up in practice; a false read is also cheap, since
// every caller re-checks on the next tick rather than caching the answer.
//
// It matters because a live broadcast has no timeline to seek on: everyone
// is already watching the same real-time feed, and the position arithmetic
// this file uses for VOD sync (see videoSourcePosition) produces a target
// that a live stream's short DVR window usually can't reach. Calling
// seekTo() toward it anyway doesn't error — it just never lands, so the
// drift check below fires again a second later and tries once more,
// forever. That loop, not anything about loading the video itself, is what
// used to leave a live source buffering endlessly for everyone but the
// person who added it (their own player is never seeked — see the "Follows
// the room" effect).
function isLiveBroadcast(player: EmbeddedPlayer): boolean {
  return (player.getDuration?.() ?? 0) <= 0;
}

// The default clock for the `serverNow` prop below. Module-level and
// arrow-wrapped on purpose: `signalingClient.serverNow` handed over bare
// would be called with no `this` and blow up on its own field.
const defaultServerNow = () => signalingClient.serverNow();

let youtubeApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    // The API calls this global once, for whoever asked first — chaining
    // onto any existing one keeps a second tile mounting in the same tick
    // from replacing the first one's callback.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube API carregada sem Player"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Falha ao carregar o player do YouTube"));
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later tile retry rather than caching the failure forever.
    youtubeApiPromise = null;
    throw err;
  });
  return youtubeApiPromise;
}

let twitchApiPromise: Promise<TwitchNamespace> | null = null;

function loadTwitchApi(): Promise<TwitchNamespace> {
  if (twitchApiPromise) return twitchApiPromise;
  twitchApiPromise = new Promise<TwitchNamespace>((resolve, reject) => {
    if (window.Twitch?.Player) {
      resolve(window.Twitch);
      return;
    }
    // Unlike YouTube's, this script exposes window.Twitch.Player as soon as
    // it finishes executing — no separate global ready-callback to wait on.
    const script = document.createElement("script");
    script.src = "https://player.twitch.tv/js/embed/v1.js";
    script.async = true;
    script.onload = () => {
      if (window.Twitch?.Player) resolve(window.Twitch);
      else reject(new Error("Twitch API carregada sem Player"));
    };
    script.onerror = () => reject(new Error("Falha ao carregar o player da Twitch"));
    document.head.appendChild(script);
  }).catch((err) => {
    twitchApiPromise = null;
    throw err;
  });
  return twitchApiPromise;
}

// Adapts a freshly-constructed Twitch.Player down to EmbeddedPlayer, so
// everything below this function — the drift correction, the follow-the-room
// sync, schedulePush — can drive either platform without knowing which one
// it has. A channel embed (the only kind this file asks for — see the
// `channel` option below) has no seek, no duration, and no rate control, so
// those are stubbed rather than wired to anything: getDuration's stub
// answer (undefined, read by isLiveBroadcast as 0) is what makes every
// other effect already treat a Twitch source as permanently live, exactly
// like a live YouTube broadcast.
//
// State (for getPlayerState) is tracked locally rather than polled, because
// Twitch's API has nothing to poll — only PLAY/PAUSE/ENDED events, wired
// here to both update that tracked state and, mirroring YT.Player's
// onStateChange below, schedule a push when this viewer is the one driving.
function buildTwitchPlayer(
  elementId: string,
  options: Record<string, unknown>,
  callbacks: { onReady: () => void; shouldPush: () => boolean; schedulePush: () => void }
): EmbeddedPlayer {
  const raw = new window.Twitch!.Player(elementId, options);
  let state: number = PLAYER_STATE.BUFFERING;
  raw.addEventListener(window.Twitch!.Player.READY, callbacks.onReady);
  raw.addEventListener(window.Twitch!.Player.PLAY, () => {
    state = PLAYER_STATE.PLAYING;
    if (callbacks.shouldPush()) callbacks.schedulePush();
  });
  raw.addEventListener(window.Twitch!.Player.PAUSE, () => {
    state = PLAYER_STATE.PAUSED;
    if (callbacks.shouldPush()) callbacks.schedulePush();
  });
  raw.addEventListener(window.Twitch!.Player.ENDED, () => {
    state = PLAYER_STATE.ENDED;
    if (callbacks.shouldPush()) callbacks.schedulePush();
  });
  return {
    playVideo: () => raw.play(),
    pauseVideo: () => raw.pause(),
    seekTo: () => {},
    getCurrentTime: () => 0,
    getPlayerState: () => state,
    getPlaybackRate: () => 1,
    setPlaybackRate: () => {},
    setVolume: (volume) => raw.setVolume(Math.min(1, Math.max(0, volume / 100))),
    mute: () => raw.setMuted(true),
    unMute: () => raw.setMuted(false),
    isMuted: () => raw.getMuted(),
    destroy: () => {},
  };
}

// One room video source, rendered as a tile that behaves like a transmission
// tile (see VideoTile): same label bar, same focus/hyperfocus buttons, same
// place in the grid. What it is *not* is a MediaStream — it embeds the
// platform's own player (YouTube or Twitch), which is why it can't simply be
// VideoTile with a different source.
//
// Playback is shared: whatever whoever's driving does to their player (play,
// pause, seek) is reported up and applied by everyone else, and a periodic
// drift check silently pulls a lagging player back in line without telling
// the room about it. Who's driving is either just the adder, or the whole
// room, depending on the controlMode chosen when the source was added (see
// canControl below) — either way it's never a separate "controller" role,
// just whoever the source's own settings say may steer it.
export function VideoSourceTile({
  source,
  canControl,
  isOwner,
  onStateChange,
  onRemove,
  onLeave,
  label,
  volume,
  onVolumeChange,
  serverNow = defaultServerNow,
  fill = false,
  className = "",
  onFocus,
  isSpotlighted = false,
  onHyperfocus,
  isHyperfocused = false,
  isTabHidden = false,
}: {
  source: VideoSource;
  // Whether this viewer's play/pause/seek is one the room follows — true for
  // whoever added the source, and for everyone when its controlMode is
  // "anyone" (the server enforces the same rule — see its
  // "video-source-state" handler). Everyone else gets a player with no
  // controls at all and a shield over it, because a click the embed honours
  // locally but the room never hears about would put this viewer out of step
  // with everyone else, silently.
  canControl: boolean;
  // Whether this viewer is the one who added the source — unlike canControl,
  // never widens with controlMode. Ending the video for the whole room (see
  // onRemove below) stays this narrow even when a "anyone" source has opened
  // up play/pause/seek to everybody.
  isOwner: boolean;
  onStateChange: (playing: boolean, positionSeconds: number, playbackRate: number) => void;
  // Ends the video for the whole room — only offered to whoever added it
  // (isOwner), regardless of controlMode.
  onRemove: () => void;
  // Hides it for this viewer alone, exactly like leaving someone's
  // transmission: the room carries on, and there's a placeholder to come
  // back through. What everyone who isn't the adder gets instead of onRemove.
  onLeave: () => void;
  label: ReactNode;
  // This viewer's own volume for this video, 0-1 — the same per-tile dial a
  // transmission gets (see VideoTile), and just as local: nothing about it
  // travels, so turning a video down never touches anyone else's playback.
  //
  // Capped at 1, unlike a transmission's 300%: that ceiling comes from
  // routing a MediaStream through a gain node (see lib/audioGain.ts), and
  // there is no equivalent for audio that lives inside YouTube's iframe —
  // all we can do is set the player's own volume. Left undefined to let the
  // tile keep the dial in its own state instead.
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  // This viewer's best estimate of the *server's* clock, which is the origin
  // every position in `source` is stamped against — see videoSourcePosition.
  // Injectable because it belongs to whichever connection this tile is
  // watching through: a participant has signalingClient (the default), and
  // the moderation viewer has its own separate socket, whose offset is the
  // only one measured for it (see adminClient.serverNow). Passing the wrong
  // one would silently put the moderator's player off by that connection's
  // clock skew, which is exactly the error the drift correction can't see.
  serverNow?: () => number;
  fill?: boolean;
  className?: string;
  onFocus?: () => void;
  isSpotlighted?: boolean;
  onHyperfocus?: () => void;
  isHyperfocused?: boolean;
  isTabHidden?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // Twitch.Player is constructed against an element *id* rather than the
  // node itself (unlike YT.Player) — generated once and kept for the tile's
  // whole lifetime so a rebuild (see the player-creation effect's deps)
  // keeps targeting the same node instead of needing a fresh id every time.
  const [mountId] = useState(() => `video-source-${Math.random().toString(36).slice(2)}`);
  const playerRef = useRef<EmbeddedPlayer | null>(null);
  // Set while a remote update is being applied — see REMOTE_APPLY_QUIET_MS.
  const applyingRemoteRef = useRef(false);
  const applyingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When this player was last seeked, and whether it is currently running
  // fast/slow to close a gap — see the drift effect.
  const lastSeekAtRef = useRef(0);
  const nudgingRef = useRef(false);
  // Read by the player's callbacks, which are created once and would
  // otherwise capture the first render's props forever. Kept current from an
  // effect rather than during render — a ref write in the render body is
  // exactly what React tells you not to do.
  const sourceRef = useRef(source);
  const onStateChangeRef = useRef(onStateChange);
  // Kept in a ref like the callbacks above rather than read directly, so a
  // caller passing an inline arrow can't churn the effects below — the
  // player-creation and drift effects would otherwise re-run every render.
  const serverNowRef = useRef(serverNow);
  // Whether this viewer asked for YouTube's own player chrome. Only ever
  // true for someone who isn't driving: the owner has it from the start.
  // Driving stays with the adder either way — see the sync effect, which
  // keeps pulling this player back to the room's playback.
  const [showNativeControls, setShowNativeControls] = useState(false);
  const canControlRef = useRef(canControl);
  const nativeControlsRef = useRef(false);
  // This viewer's dial, when the caller isn't holding it (see the `volume`
  // prop), plus the mute toggle — which is always local state, since muting
  // is a click on this tile and nothing above it needs to know.
  const [internalVolume, setInternalVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const effectiveVolume = volume ?? internalVolume;
  // Read by the player's onReady callback, which is created once. Asking for
  // YouTube's controls (or the video changing) rebuilds the player, and a
  // fresh player starts at YouTube's default volume — so the desired one has
  // to be re-applied from inside onReady, not only from the effect below.
  const volumeRef = useRef(effectiveVolume);
  const mutedRef = useRef(isMuted);
  useEffect(() => {
    sourceRef.current = source;
    onStateChangeRef.current = onStateChange;
    serverNowRef.current = serverNow;
    canControlRef.current = canControl;
    nativeControlsRef.current = showNativeControls;
    volumeRef.current = effectiveVolume;
    mutedRef.current = isMuted;
  });

  function handleVolumeChange(nextVolume: number) {
    if (volume === undefined) setInternalVolume(nextVolume);
    onVolumeChange?.(nextVolume);
    // Dragging to zero *is* muting, and dragging away from it is unmuting —
    // same coupling the transmission tile has, so the speaker icon never
    // contradicts the slider.
    setIsMuted(nextVolume === 0);
  }


  // Everything the owner reports goes through here, so a play, a speed
  // change and a caption toggle all send the same complete picture — the
  // server merges by field, and a partial update would leave the others to
  // be guessed.
  // Reads the player and reports where it actually is. Never called
  // directly by an event — see schedulePush, which decides *when*.
  const sendCurrentState = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const state = player.getPlayerState();
    // BUFFERING is a "still playing, just not right now" state: reporting it
    // as paused would pause the whole room every time the owner's connection
    // hiccups, and reporting the position mid-buffer is the position they
    // are about to resume from anyway.
    const playing = state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;
    onStateChangeRef.current(playing, player.getCurrentTime(), player.getPlaybackRate?.() ?? 1);
  }, []);

  const lastPushAtRef = useRef(0);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Leading + trailing. The leading send keeps a single pause instant for
  // everyone; the trailing one is what makes a scrub end up right, since the
  // position that matters is the one the drag *finished* on and every event
  // before it is already stale by the time it arrives.
  const schedulePush = useCallback(() => {
    if (!canControlRef.current) return;
    const now = Date.now();
    if (now - lastPushAtRef.current >= STATE_PUSH_MIN_INTERVAL_MS) {
      lastPushAtRef.current = now;
      sendCurrentState();
    }
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      lastPushAtRef.current = Date.now();
      sendCurrentState();
    }, STATE_PUSH_SETTLE_MS);
  }, [sendCurrentState]);

  useEffect(() => {
    const timerRef = pushTimerRef;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);


  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { filters: videoFilters, setFilters: setVideoFilters } = useVideoFilters(source.id || "source");

  // Creates the player once per video. Everything the player needs to know
  // afterwards arrives through the sync effect below rather than by
  // rebuilding it — recreating an iframe on every state change would reload
  // the video each time anyone pressed pause.
  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;

    function markApplyingRemote() {
      applyingRemoteRef.current = true;
      if (applyingTimerRef.current) clearTimeout(applyingTimerRef.current);
      applyingTimerRef.current = setTimeout(() => {
        applyingRemoteRef.current = false;
      }, REMOTE_APPLY_QUIET_MS);
    }

    if (sourceRef.current.kind === "twitch") {
      loadTwitchApi()
        .then(() => {
          if (cancelled || !mountRef.current) return;
          markApplyingRemote();
          playerRef.current = buildTwitchPlayer(
            mountId,
            {
              width: "100%",
              height: "100%",
              channel: sourceRef.current.videoId,
              autoplay: sourceRef.current.playing,
              // Only the owner sees Twitch's controls; for everyone else
              // they would be buttons that appear to work and then get
              // undone by the next sync.
              controls: canControlRef.current || nativeControlsRef.current,
              // Required by Twitch's embed itself — it refuses to load for
              // any hostname not listed here, hence reading it live rather
              // than hardcoding one.
              parent: [window.location.hostname],
            },
            {
              onReady: () => {
                if (cancelled) return;
                applyPlayerVolume(playerRef.current, volumeRef.current, mutedRef.current);
                setReady(true);
              },
              // Same rule as YT.Player's onStateChange below: only travels
              // for whoever is driving, and never for a play/pause this tile
              // just performed to follow someone else.
              shouldPush: () => canControlRef.current && !applyingRemoteRef.current,
              schedulePush,
            }
          );
          // Twitch.Player has no onError equivalent for "this script loaded
          // fine but the channel/parent was rejected" — an invalid channel
          // was already refused server-side (see parseTwitchChannel), and an
          // unlisted parent would be a deploy-config problem, not a runtime
          // one this viewer can do anything about.
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
    } else {
      loadYouTubeApi()
        .then((YT) => {
          if (cancelled || !mountRef.current) return;
          markApplyingRemote();
          playerRef.current = new YT.Player(mountRef.current, {
            // Without these the API stamps its default 640x390 onto the
            // iframe it swaps in for the mount node — and since that node's
            // classes go with it, the iframe ends up *larger than the tile*,
            // with YouTube's whole control bar sitting below the visible area.
            // That is what "the owner has no controls" actually was. The CSS
            // on the wrapper below pins it to the box as well, for the same
            // reason belt goes with braces.
            width: "100%",
            height: "100%",
            videoId: sourceRef.current.videoId,
            playerVars: {
              autoplay: sourceRef.current.playing ? 1 : 0,
              // Only the owner sees YouTube's controls; for everyone else they
              // would be buttons that appear to work and then get undone by
              // the next sync.
              controls: canControlRef.current || nativeControlsRef.current ? 1 : 0,
              disablekb: canControlRef.current || nativeControlsRef.current ? 0 : 1,
              // Where the room already is — someone joining an hour into a
              // video starts an hour in, not at the beginning.
              start: Math.floor(videoSourcePosition(sourceRef.current, serverNowRef.current())),
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
            },
            events: {
              onReady: () => {
                if (cancelled) return;
                applyPlayerVolume(playerRef.current, volumeRef.current, mutedRef.current);
                setReady(true);
              },
              onError: () => {
                if (!cancelled) setLoadError(true);
              },
              onStateChange: (event: { data: number }) => {
                // Only what this viewer did travels, and only if this viewer
                // is the one driving. A play/pause this tile just performed to
                // follow someone else is exactly what must not be echoed back.
                if (!canControlRef.current || applyingRemoteRef.current) return;
                // Every transition schedules a push; which state it *is* gets
                // read at send time, so a burst of them collapses into the
                // truth at the end instead of a queue of stale snapshots.
                if (
                  event.data === PLAYER_STATE.PLAYING ||
                  event.data === PLAYER_STATE.PAUSED ||
                  event.data === PLAYER_STATE.ENDED ||
                  event.data === PLAYER_STATE.BUFFERING
                ) {
                  schedulePush();
                }
              },
              // Speed has its own event.
              onPlaybackRateChange: () => {
                if (!canControlRef.current || applyingRemoteRef.current) return;
                schedulePush();
              },
            },
          });
        })
        .catch(() => {
          if (!cancelled) setLoadError(true);
        });
    }

    return () => {
      cancelled = true;
      if (applyingTimerRef.current) clearTimeout(applyingTimerRef.current);
      playerRef.current?.destroy();
      playerRef.current = null;
      // Either API replaces the mount node's content with its iframe, so the
      // next mount needs it emptied — React puts fresh content back when
      // this effect re-runs (Twitch's targets the same id again, unchanged).
      if (mount) mount.innerHTML = "";
    };
    // `controls` can only be set when the player is built, so asking for the
    // platform's own chrome rebuilds it. YouTube's comes back at the room's
    // current position (see `start` above), the same thing that happens when
    // someone joins mid-video — Twitch's channel embed has no such position
    // to restore, it just rejoins the live edge.
  }, [source.kind, source.videoId, canControl, showNativeControls, mountId, schedulePush]);

  // Later changes to the dial. The initial value is applied from onReady
  // instead (see applyPlayerVolume there) — this effect can't do that job on
  // its own, because a player rebuild leaves `ready` already true and none of
  // these deps changed.
  useEffect(() => {
    if (!ready) return;
    applyPlayerVolume(playerRef.current, effectiveVolume, isMuted);
  }, [ready, effectiveVolume, isMuted]);

  // True only for the classic single-controller case: the adder, on a
  // source nobody else was handed the wheel on. That, and only that, is when
  // this viewer's own player *is* the reference the room extrapolates from —
  // the one case where the two effects below must stay off entirely, because
  // applying the room's state back to them would be correcting the original
  // against a copy of itself. Everyone else follows the broadcast, canControl
  // or not: on a controlMode of "anyone", every controller is also a
  // follower of whoever else last acted, which is exactly what
  // applyingRemoteRef/REMOTE_APPLY_QUIET_MS already exist to make safe (they
  // silence the quiet window right after *this* viewer's own action, the
  // same way they always have).
  const isSoleController = isOwner && source.controlMode !== "anyone";

  // Follows the room. Runs on every broadcast state change (`updatedAt` is
  // what makes even a re-pause at the same position a distinct update).
  //
  // Skipped for the sole controller (see isSoleController above).
  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player || isSoleController) return;
    applyingRemoteRef.current = true;
    if (applyingTimerRef.current) clearTimeout(applyingTimerRef.current);
    applyingTimerRef.current = setTimeout(() => {
      applyingRemoteRef.current = false;
    }, REMOTE_APPLY_QUIET_MS);

    // See isLiveBroadcast — a live source has no position to line up on, so
    // only play/pause below applies to it.
    if (!isLiveBroadcast(player)) {
      const target = videoSourcePosition(source, serverNowRef.current());
      if (Math.abs(player.getCurrentTime() - target) > DRIFT_TOLERANCE_SECONDS) {
        player.seekTo(target, true);
        lastSeekAtRef.current = Date.now();
      }
      // Speed before play: starting at the old rate and correcting a moment
      // later is both audible and a fresh source of drift. Also clears any
      // catch-up nudge in progress — the room just set a new baseline.
      nudgingRef.current = false;
      if (player.getPlaybackRate?.() !== source.playbackRate) {
        player.setPlaybackRate?.(source.playbackRate || 1);
      }
    }
    if (source.playing) player.playVideo();
    else player.pauseVideo();
  }, [ready, source, isSoleController]);

  // Keeps everyone who isn't the sole controller on the room's frame,
  // between broadcasts. Nothing here is ever sent: the room's state hasn't
  // changed, only this copy of it slipped.
  //
  // Two corrections, because they fix different problems. A big gap gets a
  // seek. A small one gets a change of speed — 12% faster or slower until
  // it's closed — which is both invisible to watch and, unlike a seek,
  // doesn't cost the re-buffer that would put the player right back behind.
  useEffect(() => {
    if (!ready || isSoleController) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      const current = sourceRef.current;
      if (!player || applyingRemoteRef.current) return;
      if (Date.now() - lastSeekAtRef.current < SEEK_SETTLE_MS) return;

      const baseRate = current.playbackRate || 1;
      // See isLiveBroadcast — below this point, only play/pause is ever
      // corrected for a live source; the rest chases a position that a live
      // stream can't be seeked to, which is what used to buffer it forever.
      const live = isLiveBroadcast(player);

      if (!current.playing) {
        // The room is paused. Anyone whose player kept going (their own
        // pause button, with native controls showing) is put back.
        if (player.getPlayerState() === PLAYER_STATE.PLAYING) player.pauseVideo();
        if (live) return;
        const stopped = Math.abs(player.getCurrentTime() - current.positionSeconds);
        if (stopped > DRIFT_TOLERANCE_SECONDS) {
          player.seekTo(current.positionSeconds, true);
          lastSeekAtRef.current = Date.now();
        }
        return;
      }

      // The room is playing, so this player must be too — a viewer with
      // native controls can have paused their own copy.
      if (player.getPlayerState() === PLAYER_STATE.PAUSED) player.playVideo();
      if (live) {
        if (nudgingRef.current) {
          player.setPlaybackRate?.(baseRate);
          nudgingRef.current = false;
        }
        return;
      }

      const target = videoSourcePosition(current, serverNowRef.current());
      const drift = target - player.getCurrentTime(); // positive: behind
      const distance = Math.abs(drift);

      if (distance > DRIFT_SEEK_SECONDS) {
        if (nudgingRef.current) {
          player.setPlaybackRate?.(baseRate);
          nudgingRef.current = false;
        }
        player.seekTo(target, true);
        lastSeekAtRef.current = Date.now();
        return;
      }

      if (distance > DRIFT_TOLERANCE_SECONDS) {
        const factor = drift > 0 ? 1 + DRIFT_NUDGE_FACTOR : 1 - DRIFT_NUDGE_FACTOR;
        const wanted = Math.round(baseRate * factor * 100) / 100;
        if (player.getPlaybackRate?.() !== wanted) player.setPlaybackRate?.(wanted);
        nudgingRef.current = true;
        return;
      }

      if (nudgingRef.current && distance <= DRIFT_SETTLED_SECONDS) {
        player.setPlaybackRate?.(baseRate);
        nudgingRef.current = false;
      }
    }, DRIFT_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready, isSoleController]);

  // The owner's side of the same problem: the room extrapolates from their
  // last report, so a long stretch without one drifts by however much their
  // own playback did. Cheap to re-anchor, and it costs nothing while paused.
  useEffect(() => {
    if (!ready || !canControl) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      if (player.getPlayerState() !== PLAYER_STATE.PLAYING) return;
      sendCurrentState();
    }, OWNER_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [ready, canControl, sendCurrentState]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement === containerRef.current) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen?.();
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl bg-zinc-950 ${
        fill ? "h-full w-full" : "w-full"
      } ${className}`}
    >
      {/* A real bar above the video, not an overlay. The site's own chrome
          used to float on top of the iframe, which meant it sat over
          YouTube's controls — its progress bar, its fullscreen button, its
          settings — and there is no z-index arrangement that fixes that,
          because the two are competing for the same corner of the same
          rectangle. So the tile is a column now: our row, then the video,
          and nothing of ours ever covers a pixel of theirs. */}
      <div className="flex shrink-0 items-center justify-between gap-2 bg-zinc-900 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <BetaMark/>
          <span className="truncate text-sm font-medium text-white">{label}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white ${
              source.kind === "twitch" ? "bg-[#9146FF]/90" : "bg-red-500/90"
            }`}
          >
            {source.kind}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          {/* Lives in the bar, not over the video, for the same reason
              everything else here does: the platform's own controls own that
              rectangle. Unlike a transmission's dial this one stops at 100% —
              see the `volume` prop. */}
          <VolumeSlider
            value={isMuted ? 0 : effectiveVolume}
            label="Volume desse vídeo"
            onChange={handleVolumeChange}
            muted={isMuted}
            onToggleMute={() => setIsMuted((m) => !m)}
            className="rounded-full bg-white/10 px-1.5 py-0.5 text-white"
          />
          {/* Legendas, qualidade, velocidade de exibição: tudo isso vive no
              menu da própria plataforma, e a única forma honesta de oferecer
              isso é entregar o menu dela. Só aparece pra quem não controla o
              vídeo — quem adicionou já tem os controles desde o início. */}
          {!canControl && (
            <Tooltip
              content={
                showNativeControls
                  ? "Voltar ao player sem controles"
                  : source.kind === "twitch"
                    ? "Mostra os controles da Twitch pra você ajustar qualidade e afins. Você continua sem controlar a reprodução: play e pause seguem quem adicionou o vídeo."
                    : "Mostra os controles do YouTube pra você ajustar legenda, qualidade e afins. Você continua sem controlar a reprodução: play, pause e avanço seguem quem adicionou o vídeo."
              }
            >
              <button
                type="button"
                onClick={() => setShowNativeControls((shown) => !shown)}
                aria-pressed={showNativeControls}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-white transition ${
                  showNativeControls ? "bg-emerald-600 hover:bg-emerald-700" : "hover:bg-white/10"
                }`}
              >
                <MdSettings className="h-3.5 w-3.5 shrink-0" />
              </button>
            </Tooltip>
          )}
          {onFocus && (
            <Tooltip content={isSpotlighted ? "Remover destaque" : "Focar nesse vídeo"}>
              <button
                type="button"
                onClick={onFocus}
                aria-label={isSpotlighted ? "Remover destaque" : "Focar nesse vídeo"}
                aria-pressed={isSpotlighted}
                className={`rounded-full p-1.5 text-white transition ${
                  isSpotlighted ? "bg-emerald-600 hover:bg-emerald-700" : "hover:bg-white/10"
                }`}
              >
                <FocusIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          {onHyperfocus && (
            <Tooltip content="Hiperfoco nesse vídeo. Esconde as outras transmissões">
              <button
                type="button"
                onClick={onHyperfocus}
                aria-label="Hiperfoco nesse vídeo"
                aria-pressed={isHyperfocused}
                className={`rounded-full p-1.5 text-white transition ${
                  isHyperfocused ? "bg-emerald-600 hover:bg-emerald-700" : "hover:bg-white/10"
                }`}
              >
                <HyperfocusIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
          <VideoFiltersPanel
            tileId={source.id || "source"}
            filters={videoFilters}
            onFiltersChange={setVideoFilters}
          />
          <Tooltip content={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              className="rounded-full p-1.5 text-white transition hover:bg-white/10"
            >
              {isFullscreen ? (
                <FullscreenExitIcon className="h-4 w-4" />
              ) : (
                <FullscreenIcon className="h-4 w-4" />
              )}
            </button>
          </Tooltip>
          {/* Two different actions wearing one slot: the adder ends the
              video for the room (×), everyone else just steps out of it for
              themselves (the same eye as leaving a transmission), which is
              the difference between "this is over" and "not for me". Keyed
              on isOwner rather than canControl on purpose — a controlMode of
              "anyone" hands out play/pause/seek, not the power to end it for
              the room. */}
          {isOwner ? (
            <Tooltip content="Remover esse vídeo da sala (para todos)">
              <button
                type="button"
                onClick={onRemove}
                aria-label="Remover esse vídeo da sala"
                className="rounded-full p-1.5 transition hover:bg-white/10"
              >
                <MdClose className="h-4 w-4" style={{color: "red"}} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Sair desse vídeo">
              <button
                type="button"
                onClick={onLeave}
                aria-label="Sair desse vídeo"
                className="rounded-full p-1.5 text-white transition hover:bg-white/10"
              >
                <EyeOffIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </span>
      </div>

      {/* The video's own rectangle. Nothing of ours is positioned inside it
          except the loading spinner (before there is anything to cover) and,
          for a viewer who isn't driving, a fully transparent shield. */}
      <div
        ref={containerRef}
        style={getFilterStyle(videoFilters)}
        className={`relative bg-black ${fill ? "min-h-0 flex-1" : "aspect-video w-full"}`}
      >
        {/* The API replaces this node with its iframe, so the sizing has to
            come from the parent (see the width/height above too). */}
        <div className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full">
          {/* id is only actually used by the Twitch branch (Twitch.Player
              takes an element id, not a node) — harmless to always set it. */}
          <div ref={mountRef} id={mountId} className="h-full w-full" />
        </div>

        {!ready && !loadError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white/80" />
          </div>
        )}
        {isTabHidden && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/95">
            <p className="text-sm font-medium text-zinc-300">Transmissão pausada</p>
            <p className="mt-1 text-xs text-zinc-500">Tela desfocada</p>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
            <p className="text-sm text-zinc-300">
              {source.kind === "twitch"
                ? "Não foi possível carregar esse canal da Twitch."
                : "Não foi possível carregar esse vídeo do YouTube."}
            </p>
          </div>
        )}
        {!canControl && !showNativeControls && !loadError && (
          // Invisible and deliberately empty: either platform still renders
          // a clickable surface (and a click-to-pause area) even with
          // controls off, and a pause only this viewer knows about is the
          // one thing a synchronized video can't have.
          <div className="absolute inset-0" aria-hidden />
        )}
      </div>
    </div>
  );
}
