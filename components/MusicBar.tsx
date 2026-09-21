"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  MdQueueMusic,
  MdShuffle,
} from "react-icons/md";
import { Tooltip } from "@/components/Tooltip";
import { MusicQueuePanel } from "@/components/MusicQueuePanel";
import { markFeatureUsed } from "@/components/NewBadge";
import { shuffledNeighbour, shuffledOrder } from "@/lib/musicShuffle";
import {
  TILE_EXPERIMENT_EVENTS,
  trackTileExperiment,
  useTileExperiment,
  useTileExperimentTip,
} from "@/lib/clipsMode";
import { VolumeSlider } from "@/components/VolumeSlider";
import { signalingClient } from "@/lib/signalingClient";
import { isPageHidden, onPageHiddenChange } from "@/lib/pageHidden";
import { musicPosition, formatMusicTime, type MusicSource } from "@/lib/musicSource";
import { isYouTubeVideoId } from "@/lib/videoSource";
import {
  loadYouTubeApi,
  applyPlayerVolume,
  PLAYER_STATE,
  type EmbeddedPlayer,
} from "@/lib/youtubePlayer";
import { getStoredMusicVolume, setStoredMusicVolume } from "@/lib/mediaPreferences";
import { useT } from "@/lib/useI18n";

// Where the YouTube player itself lives: a node of its own at the end of the
// document, which nothing ever moves.
//
// It used to sit inside the bar. That was fine until the room stopped being a
// page: the call is mounted once now and its node is carried from outlet to
// outlet as the person navigates (see components/RoomCallHost) — which keeps a
// <video> playing, but an <iframe> moved in the document is *reloaded* by the
// browser. The embed came back with the parameters it was first made with,
// including the position it started at, so every time somebody opened the
// voice room or went to another one the song started over from there.
//
// Parked at 1x1 with the sound on rather than hidden, for the reason the bar
// always gave: `display: none` is something browsers may treat as "not
// playing" and quietly stop.
let playerHost: HTMLDivElement | null = null;

function getPlayerHost(): HTMLDivElement {
  if (playerHost && playerHost.isConnected) return playerHost;
  playerHost = document.createElement("div");
  playerHost.setAttribute("aria-hidden", "true");
  playerHost.dataset.musicPlayerHost = "";
  Object.assign(playerHost.style, {
    position: "fixed",
    left: "0",
    bottom: "0",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(playerHost);
  return playerHost;
}

// The default clock for the `serverNow` prop below. Module-level and
// arrow-wrapped on purpose: `signalingClient.serverNow` handed over bare would
// be called with no `this` and blow up on its own field.
const defaultServerNow = () => signalingClient.serverNow();

// A ordem aleatória é preferência deste navegador, não campo do registro da
// sala: só quem dirige escolhe o próximo índice, e o índice escolhido viaja
// pelo caminho de sempre. Ver lib/musicShuffle para por que isso basta.
const SHUFFLE_KEY = "sharescreen:musicShuffle";

function readShuffle(): boolean {
  // Chamado como estado inicial, que também roda no servidor.
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SHUFFLE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShuffle(on: boolean) {
  try {
    window.localStorage.setItem(SHUFFLE_KEY, on ? "1" : "0");
  } catch {
    // Armazenamento recusado — a preferência só não sobrevive ao reload.
  }
}

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
//
// Era meio segundo, e meio segundo é menos do que um seek demora para virar
// PLAYING: o player passa por BUFFERING e só avisa que está tocando um ou dois
// segundos depois, já fora da janela — aí esse evento, que é a sala sendo
// seguida, voltava para a sala como se fosse alguém apertando play. Com
// controlMode "anyone" isso é todo mundo empurrando a posição de todo mundo, e
// é a metade do "a música fica pulando sozinha".
const REMOTE_APPLY_QUIET_MS = 2500;
// A outra metade: depois desta janela, um evento do player que ninguém aqui
// pediu (a fila virou de faixa, o YouTube re-bufferizou) só vale como notícia
// se este cliente for o que dirige. Quem só está ouvindo com permissão de
// controlar não reporta nada até encostar em algum botão.
const LOCAL_INTENT_MS = 6000;
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
/** How long after a pause or a seek, while paused, the readout is read again. */
const PAUSED_SETTLE_MS = 600;
// Autoplay with sound is blocked until a page has been interacted with. Most
// people reach a room through several clicks, so this rarely fires — but when
// it does, the bar has to say so rather than silently playing nothing.
const AUTOPLAY_CHECK_MS = 2500;

export function MusicBar({
  music,
  canControl,
  isRoomManager,
  isMusicOwner,
  musicOwnerPresent = true,
  onReplace,
  serverNow = defaultServerNow,
  slot = null,
  keepPlayerInPlace = false,
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
  /**
   * Whether the person who put the music on is still in the room. When they
   * are not, nobody was re-anchoring the room's arithmetic and nobody was
   * reporting the queue advancing — a playlist left behind by whoever chose it
   * drifted for everybody and stopped changing tracks in step. With them gone,
   * whoever can control it drives instead (see isDriver below).
   */
  musicOwnerPresent?: boolean;
  onReplace: () => void;
  // The room's clock rather than this device's — a position extrapolated from
  // a server timestamp against a badly-set local clock is wrong by a constant
  // no amount of drift correction can find. See signalingClient.serverNow.
  serverNow?: () => number;
  /**
   * Somewhere else to draw the bar — the strip under a group's header, which
   * stays put across the group's rooms (see GroupAppShell's musicSlot). Only
   * the bar moves there: the player behind it stays where it is (see
   * getPlayerHost), and so does everything this component remembers.
   */
  slot?: HTMLElement | null;
  /**
   * Keep the player outside the room, in the node nothing moves (see
   * getPlayerHost). Set for a group's voice rooms, whose call is carried from
   * page to page with the person. An ordinary room keeps its player inside the
   * bar, exactly as it always has.
   */
  keepPlayerInPlace?: boolean;
}) {
  const t = useT();
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

  // A aba da playlist e a ordem aleatória (experimento "room-music-queue").
  const queueExperiment = useTileExperiment("musicQueue", { track: true });
  const [queueOpen, setQueueOpen] = useState(false);
  const [shuffle, setShuffle] = useState(readShuffle);
  // O que o player diz que a fila é. Lido dele, e não do registro da sala: a
  // lista de ids é a mesma para todo mundo (é a playlist do YouTube), então
  // nada disso precisa viajar.
  const [playlistIds, setPlaylistIds] = useState<string[]>([]);
  const [playerIndex, setPlayerIndex] = useState(-1);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // A ordem que a sala inteira calcularia: a semente é o id da música, que
  // veio do servidor (ver lib/musicShuffle).
  const shuffleOrder = useMemo(
    () => shuffledOrder(`${music.id}:${music.playlistId ?? ""}`, playlistIds.length),
    [music.id, music.playlistId, playlistIds.length]
  );
  const shuffleOrderRef = useRef(shuffleOrder);
  const shuffleRef = useRef(shuffle);
  useEffect(() => {
    shuffleOrderRef.current = shuffleOrder;
    shuffleRef.current = shuffle;
  }, [shuffleOrder, shuffle]);

  // Quem dirige: quem pôs a música, e — se essa pessoa saiu — qualquer um que
  // possa controlar. É o único que reporta o que o player faz sozinho.
  const isDriver = canControl && (isMusicOwner || !musicOwnerPresent);
  const isDriverRef = useRef(isDriver);
  useEffect(() => {
    isDriverRef.current = isDriver;
  }, [isDriver]);

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

  // Enquanto isto estiver no futuro, o que o player disser é consequência de
  // alguém aqui ter apertado alguma coisa — e aí vale reportar mesmo sem ser
  // quem dirige (ver LOCAL_INTENT_MS).
  const localIntentUntilRef = useRef(0);
  const markLocalIntent = useCallback(() => {
    localIntentUntilRef.current = Date.now() + LOCAL_INTENT_MS;
    // Uma ação local encerra a janela de "estou seguindo a sala": o que a
    // pessoa acabou de pedir não pode ser engolido como eco.
    applyingRemoteUntilRef.current = 0;
  }, []);
  const hasLocalIntent = () => Date.now() < localIntentUntilRef.current;

  // Sends where this player actually is. Read at send time rather than
  // captured at schedule time, so a burst of events collapses into the truth
  // at the end instead of a queue of stale snapshots.
  const pushNow = useCallback((options: { heartbeat?: boolean } = {}) => {
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
    const playing = state === PLAYER_STATE.PLAYING || state === PLAYER_STATE.BUFFERING;
    const position = player.getCurrentTime() || 0;
    const index = player.getPlaylistIndex?.();
    // Um batimento (ver OWNER_HEARTBEAT_MS) existe para reancorar a conta da
    // sala; se o registro já concorda com este player, ele não tem notícia
    // nenhuma para dar. Isso é o que deixa vários administradores baterem ao
    // mesmo tempo, quando quem pôs a música saiu, sem virar uma briga de
    // relógios: o primeiro que chegar cala os outros.
    if (options.heartbeat) {
      const agrees =
        current.playing === playing &&
        Math.abs(musicPosition(current, serverNowRef.current()) - position) < 2 &&
        (typeof index !== "number" ||
          index < 0 ||
          current.playlistIndex === undefined ||
          current.playlistIndex === index);
      if (agrees) return;
    }
    lastPushAtRef.current = Date.now();
    signalingClient.setMusicState(
      current.id,
      playing,
      position,
      player.getPlaybackRate() || 1,
      typeof index === "number" && index >= 0 ? index : undefined
    );
  }, []);

  // O player é construído uma vez e seus callbacks vivem com a versão de
  // `pushNow` daquele momento; isto é o que eles chamam para pegar a atual.
  const pushNowRef = useRef(pushNow);
  useEffect(() => {
    pushNowRef.current = pushNow;
  }, [pushNow]);

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
    // A group room's player gets a node of its own inside the host (so two
    // bars never share one); an ordinary room's sits inside the bar, as ever.
    const hosted = keepPlayerInPlace;
    const mount = hosted ? document.createElement("div") : mountRef.current;
    if (!mount) return;
    if (hosted) getPlayerHost().appendChild(mount);
    let cancelled = false;
    setReady(false);
    setLoadError(false);
    setNeedsGesture(false);
    setTitle(null);
    // Outra música, outra fila: o que ficou na tela é da anterior.
    setPlaylistIds([]);
    setPlayerIndex(-1);
    setCurrentVideoId(null);
    setDuration(0);

    loadYouTubeApi()
      .then((YT) => {
        // An ordinary room still checks its bar's mount is there, as it always did.
        if (cancelled || (!hosted && !mountRef.current)) return;
        markApplyingRemote();
        const now = musicRef.current;
        const playlistId = now.playlistId;
        // A playlist-only URL stores the playlist id in videoId (see
        // parseMusicUrl) — that is not an 11-character video, and handing it
        // over as videoId would just error. listType + list is what loads the
        // queue; videoId is only the starting item when the paste had a `v=`.
        const videoId = isYouTubeVideoId(now.videoId) ? now.videoId : undefined;
        playerRef.current = new YT.Player(hosted ? mount : (mountRef.current as HTMLDivElement), {
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
              // A fila e o que está tocando, para a aba da direita.
              const player = playerRef.current;
              const list = player?.getPlaylist?.();
              if (Array.isArray(list)) {
                setPlaylistIds((prev) =>
                  prev.length === list.length && prev.every((id, i) => id === list[i]) ? prev : list
                );
              }
              const index = player?.getPlaylistIndex?.();
              if (typeof index === "number") setPlayerIndex(index);
              if (data?.video_id) setCurrentVideoId(data.video_id);
              // Só o que uma pessoa daqui fez viaja, e só se ela pode dirigir.
              // Um play/pause que esta barra acabou de executar para seguir a
              // sala é exatamente o que não pode voltar.
              if (!canControlRef.current || isApplyingRemote()) return;
              // E, fora de uma ação local, só quem dirige reporta: o resto tem
              // permissão de controlar, não de narrar (ver LOCAL_INTENT_MS).
              if (!isDriverRef.current && !hasLocalIntent()) return;
              // Faixa acabou com a ordem aleatória ligada: o YouTube ia para a
              // seguinte da lista, e quem dirige manda para a sorteada. Todo
              // mundo segue pelo índice, como sempre — é por isso que o modo
              // aleatório não precisa de nada no servidor.
              if (
                event.data === PLAYER_STATE.ENDED &&
                musicRef.current.playlistId &&
                shuffleRef.current &&
                isDriverRef.current &&
                shuffleOrderRef.current.length > 1 &&
                player?.playVideoAt
              ) {
                const from = typeof index === "number" && index >= 0 ? index : 0;
                const next = shuffledNeighbour(shuffleOrderRef.current, from, 1);
                seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
                player.playVideoAt(next);
                trackTileExperiment(TILE_EXPERIMENT_EVENTS.musicQueue.advance);
                // O índice novo só existe depois que o item carrega.
                setTimeout(() => pushNowRef.current(), 700);
                return;
              }
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
              if (!isDriverRef.current && !hasLocalIntent()) return;
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
      // A hosted mount is this player's alone and goes with it. The bar's own
      // is emptied instead: the API replaces the mount node's content with its
      // iframe, so the next mount needs it cleared.
      if (hosted) mount.remove();
      else mount.innerHTML = "";
    };
  }, [sourceKey, markApplyingRemote, schedulePush, keepPlayerInPlace]);

  // This listener's own volume.
  useEffect(() => {
    applyPlayerVolume(playerRef.current, volume, false);
  }, [volume, ready]);

  // Follows the room: play/pause, the playlist's current item, and the
  // position everyone extrapolates from. Runs on every change to the record
  // *and* on a timer, since a playing track's target moves on its own.
  const syncRef = useRef<() => void>(() => {});
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

      // Um player que está bufferizando não está atrasado: ele está parado
      // esperando rede, e o relógio dele marca exatamente para onde já foi
      // mandado. Corrigir aqui é pedir outro buffer, que atrasa mais, que pede
      // outra correção — o soluço que a sala inteira ouve.
      if (state === PLAYER_STATE.BUFFERING) return;

      const target = musicPosition(current, serverNowRef.current());
      const actual = player.getCurrentTime() || 0;
      // Um alvo além do fim da faixa é um registro velho atravessando a virada
      // da fila (a conta da sala extrapola sem saber onde a música acaba).
      // Buscar lá dentro é pular o fim de toda faixa; melhor deixar acabar e
      // seguir o índice que vem.
      const duration = player.getDuration?.() ?? 0;
      if (duration > 0 && target > duration - 0.5) return;
      if (Math.abs(target - actual) > DRIFT_TOLERANCE_SECONDS) {
        markApplyingRemote();
        seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
        player.seekTo(target, true);
      }
    }

    syncRef.current = sync;
    sync();
    // Um intervalo só, que não é refeito a cada mensagem da sala. Antes ele
    // dependia de `music`, e como o registro chega de novo a cada ação (e a
    // cada batimento), o relógio da correção reiniciava antes de disparar:
    // numa sala ativa a deriva praticamente nunca era conferida.
    const timer = setInterval(() => syncRef.current(), DRIFT_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready, markApplyingRemote]);

  // O registro mudou: seguir na hora, sem esperar o intervalo acima.
  useEffect(() => {
    if (ready) syncRef.current();
  }, [ready, music]);

  // Keeps the room's arithmetic anchored (see OWNER_HEARTBEAT_MS). Only the
  // person who put the music on, and only while it is playing.
  useEffect(() => {
    // Quem dirige, que é quem pôs a música — ou qualquer um que possa
    // controlar, quando essa pessoa já saiu da sala. Sem isso, uma playlist
    // deixada para trás ficava sem ninguém reancorando a conta, e quem chegasse
    // depois entrava com o erro acumulado desde o último relatório.
    if (!ready || !isDriver || !music.playing) return;
    const timer = setInterval(() => pushNow({ heartbeat: true }), OWNER_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [ready, isDriver, music.playing, pushNow]);

  // The readout. Reads the player when it has one and falls back to the
  // room's own arithmetic before it is ready, so the bar is never blank.
  //
  // Only ticks while the music is playing and the page is on screen: a paused
  // song's position moves only when the room says so (a seek, a pause — each
  // a new `music`, which restarts this and reads it again), and a hidden tab
  // shows the readout to nobody. It used to re-render the bar twice a second
  // for the whole life of a room with music in it.
  const musicPlaying = music.playing;
  useEffect(() => {
    function tick() {
      const player = playerRef.current;
      if (player && ready) {
        setPosition(player.getCurrentTime() || 0);
        setDuration(player.getDuration?.() ?? 0);
        const data = player.getVideoData?.();
        if (data?.title) setTitle((prev) => (prev === data.title ? prev : data.title ?? null));
        if (data?.video_id) {
          setCurrentVideoId((prev) => (prev === data.video_id ? prev : (data.video_id ?? null)));
        }
        // A fila às vezes termina de carregar sem mudar de estado, e o índice
        // muda quando o YouTube passa de faixa sozinho: a aba da direita lê
        // daqui para não depender só dos eventos.
        const index = player.getPlaylistIndex?.();
        if (typeof index === "number") setPlayerIndex((prev) => (prev === index ? prev : index));
        const list = player.getPlaylist?.();
        if (Array.isArray(list)) {
          setPlaylistIds((prev) =>
            prev.length === list.length && prev.every((id, i) => id === list[i]) ? prev : list
          );
        }
      } else {
        setPosition(musicPosition(musicRef.current, serverNowRef.current()));
      }
    }
    tick();
    if (!musicPlaying) {
      // Once more when the player has had a moment: a seek or a pause the
      // room just applied (see the sync above) lands a beat after it is asked.
      const settle = setTimeout(tick, PAUSED_SETTLE_MS);
      return () => clearTimeout(settle);
    }
    const timer = setInterval(() => {
      if (!isPageHidden()) tick();
    }, PROGRESS_TICK_MS);
    const unsubscribe = onPageHiddenChange(() => {
      if (!isPageHidden()) tick();
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [ready, musicPlaying, music]);

  // Com a aba aberta e a música pausada nada mais lê o player (o contador só
  // corre tocando), e a lista ficaria vazia até a próxima ação. Um relógio
  // lento só enquanto ela está aberta resolve sem custar nada no resto.
  useEffect(() => {
    if (!queueOpen || !ready) return;
    const read = () => {
      const player = playerRef.current;
      const list = player?.getPlaylist?.();
      if (Array.isArray(list)) {
        setPlaylistIds((prev) =>
          prev.length === list.length && prev.every((id, i) => id === list[i]) ? prev : list
        );
      }
      const index = player?.getPlaylistIndex?.();
      if (typeof index === "number") setPlayerIndex((prev) => (prev === index ? prev : index));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [queueOpen, ready]);

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
    markLocalIntent();
    if (music.playing) player.pauseVideo();
    else player.playVideo();
  };

  const seekTo = (seconds: number) => {
    const player = playerRef.current;
    if (!player || !canControl) return;
    markLocalIntent();
    seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
    player.seekTo(Math.max(0, seconds), true);
    schedulePush();
  };

  // Ir para um item da fila, pelo índice na ordem original — o que viaja para
  // a sala, com ordem aleatória ou sem.
  const playAt = useCallback(
    (index: number) => {
      const player = playerRef.current;
      if (!player?.playVideoAt || !canControl) return;
      markLocalIntent();
      seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
      player.playVideoAt(index);
      setPlayerIndex(index);
      // O índice da fila só muda depois que o próximo item carrega, então o
      // envio que o carrega tem de esperar por isso em vez de ler -1 agora.
      setTimeout(() => pushNow(), 700);
    },
    [canControl, markLocalIntent, pushNow]
  );

  const skip = (direction: 1 | -1) => {
    const player = playerRef.current;
    if (!player || !canControl) return;
    // Com a ordem aleatória ligada, "próxima" é a próxima da ordem sorteada —
    // a mesma que quem dirige usaria quando a faixa acaba sozinha.
    if (shuffle && shuffleOrder.length > 1 && player.playVideoAt) {
      const from = playerIndex >= 0 ? playerIndex : (music.playlistIndex ?? 0);
      playAt(shuffledNeighbour(shuffleOrder, from, direction));
      return;
    }
    markLocalIntent();
    seekSettledAtRef.current = Date.now() + SEEK_SETTLE_MS;
    if (direction === 1) player.nextVideo?.();
    else player.previousVideo?.();
    setTimeout(() => pushNow(), 700);
  };

  const toggleShuffle = () => {
    const next = !shuffle;
    setShuffle(next);
    writeShuffle(next);
    markFeatureUsed("room-music-queue");
    trackTileExperiment(
      next
        ? TILE_EXPERIMENT_EVENTS.musicQueue.shuffleOn
        : TILE_EXPERIMENT_EVENTS.musicQueue.shuffleOff
    );
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
  const queueAvailable = queueExperiment.available && hasPlaylist;
  // O aviso azul fica no botão que leva ao recurso — aqui, o da própria aba
  // (ver CLAUDE.md). Não entra na fila de dicas do "⋯": não disputa espaço com
  // elas porque não mora lá.
  const queueTip = useTileExperimentTip("musicQueue", queueAvailable);

  const openQueue = () => {
    // clicked() conta o clique na dica; sem ela na tela, nao houve clique em
    // dica nenhuma.
    if (queueTip.show) queueTip.clicked();
    markFeatureUsed("room-music-queue");
    trackTileExperiment(
      queueOpen
        ? TILE_EXPERIMENT_EVENTS.musicQueue.modeOff
        : TILE_EXPERIMENT_EVENTS.musicQueue.modeOn
    );
    setQueueOpen(!queueOpen);
  };

  const bar = (
    // Last in the slot, under any local-file soundtracks — the order the room
    // has always drawn them in.
    <div
      className={`relative flex w-full shrink-0 flex-col border-b border-sky-700/40 bg-sky-600 text-white dark:bg-sky-700 ${
        slot ? "order-last" : ""
      }`}
    >
      {/* The player itself, in an ordinary room. Audio only: it is parked at
          1x1 with the sound left on rather than hidden with `display: none`,
          which browsers are entitled to treat as "not playing" and quietly
          stop. A group room's lives outside the bar instead (see
          keepPlayerInPlace). */}
      {!keepPlayerInPlace && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
        >
          <div ref={mountRef} />
        </div>
      )}

      <div className="flex w-full flex-nowrap items-center gap-x-3 px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <MdMusicNote className="h-4 w-4 shrink-0 opacity-90" />
          <div className="min-w-0">
            <Tooltip content={title ?? undefined}>
              <p className="truncate text-xs font-semibold leading-tight">
                {loadError
                  ? t("musicBar.couldNotLoadTheMusic")
                  : (title ?? (ready ? t("musicBar.roomMusic") : t("musicBar.loadingMusic")))}
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
              label={t("musicBar.previousTrack")}
              disabled={disabledControl}
              onClick={() => skip(-1)}
            >
              <MdSkipPrevious className="h-5 w-5" />
            </MusicButton>
          )}
          <MusicButton
            label={t("common.back10Seconds")}
            disabled={disabledControl}
            onClick={() => seekTo(position - 10)}
            className="hidden sm:flex"
          >
            <MdReplay10 className="h-5 w-5" />
          </MusicButton>
          <MusicButton
            label={music.playing ? t("common.pause") : t("common.play")}
            disabled={disabledControl}
            onClick={togglePlay}
          >
            {music.playing ? <MdPause className="h-5 w-5" /> : <MdPlayArrow className="h-5 w-5" />}
          </MusicButton>
          <MusicButton
            label={t("common.forward10Seconds")}
            disabled={disabledControl}
            onClick={() => seekTo(position + 10)}
            className="hidden sm:flex"
          >
            <MdForward10 className="h-5 w-5" />
          </MusicButton>
          {hasPlaylist && (
            <MusicButton label={t("musicBar.nextTrack")} disabled={disabledControl} onClick={() => skip(1)}>
              <MdSkipNext className="h-5 w-5" />
            </MusicButton>
          )}
          {queueAvailable && (
            <MusicButton
              label={shuffle ? t("musicBar.shuffleOn") : t("musicBar.shuffleOff")}
              disabled={disabledControl}
              onClick={() => {
                if (queueTip.show) queueTip.clicked();
                toggleShuffle();
              }}
              className={`hidden sm:flex ${shuffle ? "bg-white/25" : ""}`}
            >
              <MdShuffle className="h-4 w-4" />
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
            aria-label={t("musicBar.musicPosition")}
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
          {queueAvailable && (
            <span className="relative inline-flex shrink-0">
              <MusicButton
                label={t("musicBar.queueTitle")}
                onClick={openQueue}
                className={queueOpen ? "bg-white/25" : queueTip.show ? "ring-2 ring-white" : ""}
              >
                <MdQueueMusic className="h-4 w-4" />
              </MusicButton>
              {queueTip.show && !queueOpen && (
                <span
                  role="status"
                  className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg bg-blue-600 px-3 py-2 text-left text-xs font-medium text-white shadow-lg"
                >
                  <span className="absolute -top-1 right-3 h-2 w-2 rotate-45 bg-blue-600" />
                  <span className="flex items-start gap-2">
                    <span className="flex-1">{t("watch.watchRoom.musicQueueTip")}</span>
                    <button
                      type="button"
                      onClick={queueTip.dismiss}
                      aria-label={t("watch.watchRoom.clipsModeTipDismiss")}
                      className="-m-1 rounded p-1 leading-none text-white/80 hover:text-white"
                    >
                      ✕
                    </button>
                  </span>
                </span>
              )}
            </span>
          )}
          {needsGesture && (
            <button
              type="button"
              onClick={activateAudio}
              className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-50"
            >
              {t("common.turnOnSound")}
            </button>
          )}
          <VolumeSlider
            value={volume}
            label={t("common.musicVolume")}
            onChange={changeVolume}
            className="hidden w-24 sm:flex"
          />
          {isRoomManager && (
            <MusicButton
              label={
                music.controlMode === "anyone"
                  ? t("musicBar.everyoneCanControlItClickTo")
                  : t("musicBar.onlyTheOwnerAndTheAdministrators")
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
              <MusicButton label={t("common.changeMusic")} onClick={onReplace}>
                <MdMusicNote className="h-4 w-4" />
              </MusicButton>
              <MusicButton
                label={t("common.removeTheMusicFromTheRoom")}
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

  // A aba vai para o <body> por conta própria (ver MusicQueuePanel), então ela
  // é a mesma esteja a barra na sala ou na faixa do grupo.
  const queue = queueAvailable ? (
    <MusicQueuePanel
      open={queueOpen}
      onClose={() => setQueueOpen(false)}
      videoIds={playlistIds}
      currentIndex={playerIndex}
      currentVideoId={currentVideoId}
      order={shuffleOrder}
      shuffle={shuffle}
      canShuffle
      onToggleShuffle={toggleShuffle}
      canControl={canControl && ready}
      onPick={(index) => {
        trackTileExperiment(TILE_EXPERIMENT_EVENTS.musicQueue.pick);
        markFeatureUsed("room-music-queue");
        playAt(index);
      }}
    />
  ) : null;

  return (
    <>
      {slot ? createPortal(bar, slot) : bar}
      {queue}
    </>
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
