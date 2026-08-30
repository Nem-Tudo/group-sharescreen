"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MdMusicNote,
  MdPlayArrow,
  MdPause,
  MdSkipNext,
  MdSkipPrevious,
  MdReplay10,
  MdForward10,
  MdClose,
  MdPlaylistPlay,
  MdLock,
  MdLockOpen,
} from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { VolumeSlider } from "@/components/VolumeSlider";
import { signalingClient } from "@/lib/signalingClient";
import { musicPosition, formatMusicTime, type MusicSource } from "@/lib/musicSource";
import { isYouTubeVideoId } from "@/lib/videoSource";
import {
  loadYouTubeApi,
  applyPlayerVolume,
  PLAYER_STATE,
  type EmbeddedPlayer,
} from "@/lib/youtubePlayer";
import { getStoredMusicVolume, setStoredMusicVolume } from "@/lib/mediaPreferences";

// The default clock for the `serverNow` prop below. Module-level and
// arrow-wrapped on purpose: `signalingClient.serverNow` handed over bare would
// be called with no `this` and blow up on its own field.
const defaultServerNow = () => signalingClient.serverNow();

// How far out of step with the room this player may drift before it is pulled
// back. Looser than a video tile's third of a second (see VideoSourceTile):
// nobody is comparing two screens frame by frame here, and every correction
// costs a re-buffer that is *audible* in a way a video's is not. A second and
// a half is close enough that the room is on the same part of the same song.
const DRIFT_TOLERANCE_SECONDS = 1.5;
const DRIFT_CHECK_MS = 2000;
// A seek doesn't land instantly — the player re-buffers, and during that it
// reads as badly behind. Correcting again inside that window is how a seek
// loop starts.
const SEEK_SETTLE_MS = 2000;
// The room extrapolates a playing track's position from the last report, so a
// report from twenty minutes ago carries twenty minutes of that reporter's own
// buffering as error. Whoever put the music on re-reports on this interval to
// keep everyone's arithmetic anchored to something recent.
const OWNER_HEARTBEAT_MS = 15_000;
// A seek/play issued to follow the room fires the same events a person
// pressing the button would; reporting those back would bounce around the
// room forever.
const REMOTE_APPLY_QUIET_MS = 500;
// How long this client's own action is allowed to be ahead of the record
// without being corrected back to it — the round trip of a push landing on the
// server and coming home. Deliberately short: it is the window in which this
// player is right and the record is stale, and every millisecond past that is
// a window in which somebody else's pause goes unheard.
const SELF_ECHO_MS = 1500;
// Scrubbing produces a state change per frame of the drag. Pushes are
// coalesced: the first goes out immediately (so a plain pause is instant for
// everyone), the rest collapse into one trailing send carrying the final
// position.
const PUSH_MIN_INTERVAL_MS = 300;
const PUSH_SETTLE_MS = 350;
// How often the progress readout re-reads the player. Fast enough that the
// bar moves smoothly, slow enough to be nothing on a timer.
const PROGRESS_TICK_MS = 500;
// Autoplay with sound is blocked until a page has been interacted with. Most
// people reach a room through several clicks, so this rarely fires — but when
// it does, the bar has to say so rather than silently playing nothing.
const AUTOPLAY_CHECK_MS = 2500;

export function MusicBar({
  music,
  canControl,
  isRoomManager,
  isMusicOwner,
  onReplace,
  serverNow = defaultServerNow,
}: {
  music: MusicSource;
  // Owner and admins of the room. Everyone else gets the same bar with the
  // transport disabled — the volume, which is theirs alone, still works.
  canControl: boolean;
  // Whether this viewer runs the room. Separate from canControl, which the
  // music's own controlMode can widen to everybody: opening the decks up is a
  // management decision, and must not become one that anyone who was let in
  // can then take back.
  isRoomManager: boolean;
  // Whether this viewer is the one who put the music on. Only they run the
  // position heartbeat, so a room full of admins doesn't have five clients
  // re-reporting the same track over each other.
  isMusicOwner: boolean;
  onReplace: () => void;
  // The room's clock rather than this device's — a position extrapolated from
  // a server timestamp against a badly-set local clock is wrong by a constant
  // no amount of drift correction can find. See signalingClient.serverNow.
  serverNow?: () => number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<EmbeddedPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [volume, setVolume] = useState(() => getStoredMusicVolume());
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  // Held while a drag is in progress so the progress tick doesn't fight the
  // thumb the person is holding.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  // Everything the player callbacks need to read at the moment they fire,
  // rather than the values that existed when the player was built.
  const musicRef = useRef(music);
  const canControlRef = useRef(canControl);
  const volumeRef = useRef(volume);
  const serverNowRef = useRef(serverNow);
  useEffect(() => {
    musicRef.current = music;
    canControlRef.current = canControl;
    volumeRef.current = volume;
    serverNowRef.current = serverNow;
  }, [music, canControl, volume, serverNow]);

  // While this is in the future, anything the player reports is the result of
  // this component following the room rather than of a person pressing
  // something — and must not be sent back.
  const applyingRemoteUntilRef = useRef(0);
  const seekSettledAtRef = useRef(0);
  const lastPushAtRef = useRef(0);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markApplyingRemote = useCallback(() => {
    applyingRemoteUntilRef.current = Date.now() + REMOTE_APPLY_QUIET_MS;
  }, []);
  const isApplyingRemote = () => Date.now() < applyingRemoteUntilRef.current;

  // Sends where this player actually is. Read at send time rather than
  // captured at schedule time, so a burst of events collapses into the truth
  // at the end instead of a queue of stale snapshots.
  const pushNow = useCallback(() => {
    const player = playerRef.current;
    const current = musicRef.current;
    if (!player || !canControlRef.current) return;
    const state = player.getPlayerState();
    // A track ending inside a playlist is the queue advancing, not the music
    // stopping — and the next item is a moment away. Reporting `playing:
    // false` here is a lie the whole room then acts on: everybody pauses, and
    // the track that was about to start starts paused.
    //
    // Skipped entirely rather than reported as playing: the PLAYING that
    // follows a second later carries the truth, including the new index, and
    // an extrapolated position running a second past the end of a finished
    // track is nothing anyone can hear.
    if (state === PLAYER_STATE.ENDED && current.playlistId) return;
    lastPushAtRef.current = Date.now();
    const index = player.getPlaylistIndex?.();
    signalingClient.setMusicState(
      current.id,
      state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING,
      player.getCurrentTime() || 0,
      player.getPlaybackRate() || 1,
      typeof index === "number" && index >= 0 ? index : undefined
    );
  }, []);

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    const sinceLast = Date.now() - lastPushAtRef.current;
    if (sinceLast >= PUSH_MIN_INTERVAL_MS) pushNow();
    // Always schedule the trailing one too: the immediate send above carries
    // the state at the *start* of a drag, and the settle timer is what
    // carries where it ended up.
    pushTimerRef.current = setTimeout(() => {
      pushTimerRef.current = null;
      pushNow();
    }, PUSH_SETTLE_MS);
  }, [pushNow]);

  // Build the player. Keyed on the source's identity — a replacement is a new
  // player, not a reconfigured one — and deliberately not on `canControl`:
  // this embed is never visible, so there are no native controls to rebuild
  // for, and a promotion mid-song must not restart it for the whole room.
  const sourceKey = `${music.id}:${music.videoId}:${music.playlistId ?? ""}`;
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    setReady(false);
    setLoadError(false);
    setNeedsGesture(false);
    setTitle(null);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        markApplyingRemote();
        const now = musicRef.current;
        const playlistId = now.playlistId;
        // A playlist-only URL stores the playlist id in videoId (see
        // parseMusicUrl) — that is not an 11-character video, and handing it
        // over as videoId would just error. listType + list is what loads the
        // queue; videoId is only the starting item when the paste had a `v=`.
        const videoId = isYouTubeVideoId(now.videoId) ? now.videoId : undefined;
        playerRef.current = new YT.Player(mountRef.current, {
          width: "100%",
          height: "100%",
          ...(videoId ? { videoId } : {}),
          playerVars: {
            autoplay: now.playing ? 1 : 0,
            // Nobody ever sees this iframe (see the wrapper below), so
            // YouTube's own chrome would only be a keyboard trap.
            controls: 0,
            disablekb: 1,
            // Where the room already is — someone arriving mid-song starts
            // mid-song rather than at the beginning.
            start: Math.floor(musicPosition(now, serverNowRef.current())),
            ...(playlistId
              ? {
                  listType: "playlist",
                  list: playlistId,
                  ...(typeof now.playlistIndex === "number"
                    ? { index: now.playlistIndex }
                    : {}),
                }
              : {}),
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              applyPlayerVolume(playerRef.current, volumeRef.current, false);
              setReady(true);
            },
            onError: () => {
              if (!cancelled) setLoadError(true);
            },
            onStateChange: (event: { data: number }) => {
              if (cancelled) return;
              // The track that is actually playing changes under us as a
              // playlist advances, so the name is re-read on every
              // transition rather than once at load.
              const data = playerRef.current?.getVideoData?.();
              if (data?.title) setTitle(data.title);
              if (event.data === PLAYER_STATE.PLAYING) setNeedsGesture(false);
              // Only what a person here did travels, and only if they are
              // allowed to drive. A play/pause this bar just performed to
              // follow the room is exactly what must not be echoed back.
              if (!canControlRef.current || isApplyingRemote()) return;
              if (
                event.data === PLAYER_STATE.PLAYING ||
                event.data === PLAYER_STATE.PAUSED ||
                event.data === PLAYER_STATE.ENDED ||
                event.data === PLAYER_STATE.BUFFERING
              ) {
                schedulePush();
              }
            },
            onPlaybackRateChange: () => {
              if (cancelled || !canControlRef.current || isApplyingRemote()) return;
              schedulePush();
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
      playerRef.current?.destroy();
      playerRef.current = null;
      // The API replaces the mount node's content with its iframe, so the
      // next mount needs it emptied.
      if (mount) mount.innerHTML = "";
    };
  }, [sourceKey, markApplyingRemote, schedulePush]);

  // This listener's own volume.
  useEffect(() => {
    applyPlayerVolume(playerRef.current, volume, false);
  }, [volume, ready]);

  // Follows the room: play/pause, the playlist's current item, and the
  // position everyone extrapolates from. Runs on every change to the record
  // *and* on a timer, since a playing track's target moves on its own.
  useEffect(() => {
    if (!ready) return;

    function sync() {
      const player = playerRef.current;
      const current = musicRef.current;
      if (!player) return;
      const state = player.getPlayerState();
      const playerPlaying = state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;

      // Two different "leave me alone" windows, because two different things
      // are being protected from.
      //
      // `driving` is the long one, and only the drift seek uses it: whoever is
      // steering is where the record comes from, and seeking their player to
      // the record they just wrote fights every scrub they make.
      //
      // `justActed` is short, and it is what the queue and play/pause
      // corrections use. Those must not be skipped for a whole heartbeat —
      // another manager pausing has to be followed within a second, not
      // fifteen — but they do have to survive the round trip of this client's
      // own action coming back. A playlist advancing on its own is exactly
      // that: for a tick the player is on item N+1 while the record still says
      // N, and without this window the queue correction drags it back to N
      // while the play/pause correction pauses it. Which, together with the
      // ENDED report pushNow no longer sends, is the whole of "every track
      // after the first starts paused".
      const driving =
        canControlRef.current && Date.now() - lastPushAtRef.current < OWNER_HEARTBEAT_MS;
      const justActed =
        canControlRef.current && Date.now() - lastPushAtRef.current < SELF_ECHO_MS;

      // The queue first: chasing a timestamp that belongs to a different
      // track is worse than not chasing at all.
      if (
        !justActed &&
        current.playlistId &&
        typeof current.playlistIndex === "number" &&
        player.getPlaylistIndex &&
        player.playVideoAt
      ) {
        const index = player.getPlaylistIndex();
        if (index >= 0 && index !== current.playlistIndex) {
          markApplyingRemote();
          seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
          player.playVideoAt(current.playlistIndex);
          return;
        }
      }

      if (!justActed && current.playing !== playerPlaying) {
        markApplyingRemote();
        if (current.playing) player.playVideo();
        else player.pauseVideo();
      }

      if (driving || !current.playing || Date.now() < seekSettledAtRef.current) return;

      const target = musicPosition(current, serverNowRef.current());
      const actual = player.getCurrentTime() || 0;
      if (Math.abs(target - actual) > DRIFT_TOLERANCE_SECONDS) {
        markApplyingRemote();
        seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
        player.seekTo(target, true);
      }
    }

    sync();
    const timer = setInterval(sync, DRIFT_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready, music, markApplyingRemote]);

  // Keeps the room's arithmetic anchored (see OWNER_HEARTBEAT_MS). Only the
  // person who put the music on, and only while it is playing.
  useEffect(() => {
    if (!ready || !isMusicOwner || !canControl || !music.playing) return;
    const timer = setInterval(() => pushNow(), OWNER_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [ready, isMusicOwner, canControl, music.playing, pushNow]);

  // The readout. Reads the player when it has one and falls back to the
  // room's own arithmetic before it is ready, so the bar is never blank.
  useEffect(() => {
    function tick() {
      const player = playerRef.current;
      if (player && ready) {
        setPosition(player.getCurrentTime() || 0);
        setDuration(player.getDuration?.() ?? 0);
        const data = player.getVideoData?.();
        if (data?.title) setTitle((prev) => (prev === data.title ? prev : data.title ?? null));
      } else {
        setPosition(musicPosition(musicRef.current, serverNowRef.current()));
      }
    }
    tick();
    const timer = setInterval(tick, PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [ready]);

  // Autoplay with sound needs the page to have been interacted with. When it
  // hasn't been, the player sits at PAUSED/unstarted while the room believes
  // the music is playing — which looks like nothing happening at all unless
  // the bar says so and offers the click that fixes it.
  useEffect(() => {
    if (!ready || !music.playing) return;
    const timer = setTimeout(() => {
      const state = playerRef.current?.getPlayerState();
      if (state !== PLAYER_STATE.PLAYING && state !== PLAYER_STATE.BUFFERING) {
        setNeedsGesture(true);
      }
    }, AUTOPLAY_CHECK_MS);
    return () => clearTimeout(timer);
  }, [ready, music.playing, music.id]);

  const changeVolume = (next: number) => {
    setVolume(next);
    setStoredMusicVolume(next);
  };

  // Every transport action below is local-first: it drives this player and
  // lets the resulting event push the new state, which is the same path a
  // person clicking YouTube's own controls would take. Only seeking pushes
  // directly, since a seek to where the player already was fires nothing.
  const togglePlay = () => {
    const player = playerRef.current;
    if (!player || !canControl) return;
    if (music.playing) player.pauseVideo();
    else player.playVideo();
  };

  const seekTo = (seconds: number) => {
    const player = playerRef.current;
    if (!player || !canControl) return;
    seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
    player.seekTo(Math.max(0, seconds), true);
    schedulePush();
  };

  const skip = (direction: 1 | -1) => {
    const player = playerRef.current;
    if (!player || !canControl) return;
    seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
    if (direction === 1) player.nextVideo?.();
    else player.previousVideo?.();
    // The queue index only updates once the next item has loaded, so the
    // push that carries it has to wait for that rather than read -1 now.
    setTimeout(() => pushNow(), 700);
  };

  const activateAudio = () => {
    const player = playerRef.current;
    if (!player) return;
    player.unMute?.();
    applyPlayerVolume(player, volume || 0.5, false);
    if (volume === 0) changeVolume(0.5);
    player.playVideo();
    setNeedsGesture(false);
  };

  const hasPlaylist = Boolean(music.playlistId);
  const shownPosition = scrubbing ?? position;
  const disabledControl = !canControl || !ready;

  return (
    <div className="relative flex w-full shrink-0 flex-col border-b border-sky-700/40 bg-sky-600 text-white dark:bg-sky-700">
      {/* The player itself. Audio only: it is parked at 1x1 with the sound
          left on rather than hidden with `display: none`, which browsers are
          entitled to treat as "not playing" and quietly stop. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
      >
        <div ref={mountRef} />
      </div>

      <div className="flex w-full flex-nowrap items-center gap-x-3 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MdMusicNote className="h-4 w-4 shrink-0 opacity-90" />
          <div className="min-w-0">
            <Tooltip content={title ?? undefined}>
              <p className="truncate text-xs font-semibold leading-tight">
                {loadError
                  ? "Não foi possível carregar a música"
                  : (title ?? (ready ? "Música da sala" : "Carregando música..."))}
              </p>
            </Tooltip>
            <p className="truncate text-[11px] leading-tight opacity-80">
              {hasPlaylist && <MdPlaylistPlay className="mr-1 inline h-3 w-3 align-[-2px]" />}
              colocada por {music.addedByName}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {hasPlaylist && (
            <MusicButton
              label="Faixa anterior"
              disabled={disabledControl}
              onClick={() => skip(-1)}
            >
              <MdSkipPrevious className="h-5 w-5" />
            </MusicButton>
          )}
          <MusicButton
            label="Voltar 10 segundos"
            disabled={disabledControl}
            onClick={() => seekTo(position - 10)}
            className="hidden sm:flex"
          >
            <MdReplay10 className="h-5 w-5" />
          </MusicButton>
          <MusicButton
            label={music.playing ? "Pausar" : "Tocar"}
            disabled={disabledControl}
            onClick={togglePlay}
          >
            {music.playing ? <MdPause className="h-5 w-5" /> : <MdPlayArrow className="h-5 w-5" />}
          </MusicButton>
          <MusicButton
            label="Avançar 10 segundos"
            disabled={disabledControl}
            onClick={() => seekTo(position + 10)}
            className="hidden sm:flex"
          >
            <MdForward10 className="h-5 w-5" />
          </MusicButton>
          {hasPlaylist && (
            <MusicButton label="Próxima faixa" disabled={disabledControl} onClick={() => skip(1)}>
              <MdSkipNext className="h-5 w-5" />
            </MusicButton>
          )}
        </div>

        {/* The scrubber. Shown to everyone as a progress readout; only a
            manager can move it, and only on a track with a real duration —
            a live stream has none to scrub along. */}
        <div className="hidden min-w-0 flex-[2] items-center gap-2 sm:flex">
          <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-90">
            {formatMusicTime(shownPosition)}
          </span>
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={1}
            value={Math.min(shownPosition, duration > 0 ? duration : 100)}
            disabled={disabledControl || duration <= 0}
            aria-label="Posição da música"
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onPointerUp={() => {
              if (scrubbing !== null) seekTo(scrubbing);
              setScrubbing(null);
            }}
            onKeyUp={() => {
              if (scrubbing !== null) seekTo(scrubbing);
              setScrubbing(null);
            }}
            className="h-1 w-full min-w-16 cursor-pointer appearance-none rounded-full bg-white/30 accent-white disabled:cursor-default"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-90">
            {duration > 0 ? formatMusicTime(duration) : "--:--"}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {needsGesture && (
            <button
              type="button"
              onClick={activateAudio}
              className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              Ativar som
            </button>
          )}
          <VolumeSlider
            value={volume}
            label="Volume da música"
            onChange={changeVolume}
            className="hidden w-24 sm:flex"
          />
          {isRoomManager && (
            <MusicButton
              label={
                music.controlMode === "anyone"
                  ? "Todos podem controlar. Clique para deixar só com a administração"
                  : "Só o dono e os administradores controlam. Clique para liberar para todos"
              }
              onClick={() =>
                signalingClient.setMusicControlMode(
                  music.controlMode === "anyone" ? "owner" : "anyone"
                )
              }
            >
              {music.controlMode === "anyone" ? (
                <MdLockOpen className="h-4 w-4" />
              ) : (
                <MdLock className="h-4 w-4" />
              )}
            </MusicButton>
          )}
          {isRoomManager && (
            <>
              <MusicButton label="Trocar música" onClick={onReplace}>
                <MdMusicNote className="h-4 w-4" />
              </MusicButton>
              <MusicButton
                label="Tirar a música da sala"
                onClick={() => signalingClient.clearMusicSource()}
              >
                <MdClose className="h-4 w-4" />
              </MusicButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MusicButton({
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
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
