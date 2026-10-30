"use client";
import { translate } from "@/lib/i18n";

// The YouTube IFrame API, shared by everything in the app that embeds one:
// the room's video-source tiles (components/VideoSourceTile) and the room's
// music bar (components/MusicBar). One module rather than a copy each,
// because the API is a page-global singleton — one script tag, one
// `window.onYouTubeIframeAPIReady` callback — and two independent loaders
// racing to install that callback is exactly the kind of thing that works
// until two players happen to mount in the same tick.

// The shape a player is used through. YT.Player already looks like this and
// is used directly; VideoSourceTile also adapts Twitch's rather different
// player down to it, which is why the fields a channel embed cannot support
// (seek, duration, rate, playlists) are optional or stubbed there.
export type EmbeddedPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  // 0 while a live broadcast's metadata hasn't loaded yet, and 0 for the
  // rest of its life once it has — see isLiveBroadcast.
  getDuration?: () => number;
  getPlayerState: () => number;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  // Playlist queue — YouTube's player exposes these; Twitch/Kick stubs omit
  // them. getPlaylistIndex returns -1 when no playlist is loaded (or not
  // yet), which callers treat as "nothing to sync".
  getPlaylistIndex?: () => number;
  playVideoAt?: (index: number) => void;
  nextVideo?: () => void;
  previousVideo?: () => void;
  getPlaylist?: () => string[];
  // Swapping what is playing without building another iframe — how the room's
  // own queue advances (see MusicBar). A rebuilt embed costs a second of
  // silence between tracks and re-runs every autoplay gate; this doesn't.
  loadVideoById?: (options: { videoId: string; startSeconds?: number }) => void;
  // What is playing right now, which for a playlist changes under us as the
  // queue advances — the only way to put a track's name on screen without
  // asking YouTube's Data API (and carrying a key for it).
  getVideoData?: () => { video_id?: string; title?: string; author?: string } | undefined;
  // 0-100, unlike everything else here — YouTube's scale, not ours.
  // Optional/called with ?. like getPlaybackRate: the API object is whatever
  // YouTube's script hands back, not something we can typecheck.
  setVolume?: (volume: number) => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  destroy: () => void;
};

export type YTNamespace = {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => EmbeddedPlayer;
  PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Numeric player states. YouTube's own script defines the same four values
// (see YTNamespace.PlayerState) — copied here as plain numbers rather than
// read off it, so sync logic doesn't need the script loaded to know what
// state means what, and so an adapted non-YouTube player can report the same
// numbers for the same meaning.
export const PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } as const;

// Muting is separate from volume in YouTube's API (a muted player keeps
// whatever volume it had), so both have to be pushed — and mute/unMute is
// only touched when it actually disagrees with the player, since unMute() on
// a player the browser auto-muted to allow autoplay can cost the playback
// itself.
export function applyPlayerVolume(
  player: EmbeddedPlayer | null,
  volume: number,
  muted: boolean
) {
  if (!player) return;
  player.setVolume?.(Math.round(Math.min(1, Math.max(0, volume)) * 100));
  const wantMuted = muted || volume === 0;
  if (player.isMuted?.() === wantMuted) return;
  if (wantMuted) player.mute?.();
  else player.unMute?.();
}

let youtubeApiPromise: Promise<YTNamespace> | null = null;

// Loaded on first use rather than from the document head: a room with no
// video and no music — the overwhelming majority — should not be pulling
// YouTube's script at all.
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    // The API calls this global once, for whoever asked first — chaining
    // onto any existing one keeps a second player mounting in the same tick
    // from replacing the first one's callback.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error(translate("youtubePlayer.youtubeApiLoadedWithNoPlayer")));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error(translate("youtubePlayer.couldNotLoadTheYoutubePlayer")));
    document.head.appendChild(script);
  }).catch((err) => {
    // Let a later caller retry rather than caching the failure forever.
    youtubeApiPromise = null;
    throw err;
  });
  return youtubeApiPromise;
}

// Quanto esperar o player escondido abaixo listar a playlist, e quanto ainda
// esperar depois de um erro (o item inicial pode ser o que não toca, mas a
// lista continuar lá).
const PLAYLIST_LIST_TIMEOUT_MS = 12_000;
const PLAYLIST_LIST_AFTER_ERROR_MS = 2_500;

// Os ids de uma playlist do YouTube, sem tocar nada. Os ids só existem dentro
// de um player que carregou a playlist (a Data API pediria chave e cota), então
// isto monta um escondido, lê a lista e o desmonta — o mesmo truque que a barra
// de música usa para expandir a playlist que está tocando, aqui para uma que
// alguém quer pôr na fila. Vazio quando não deu (privada, inexistente, rede).
export async function listYouTubePlaylist(playlistId: string): Promise<string[]> {
  const YT = await loadYouTubeApi();
  return new Promise<string[]>((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      bottom: "0",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      opacity: "0",
      pointerEvents: "none",
    });
    const mount = document.createElement("div");
    host.appendChild(mount);
    document.body.appendChild(host);

    let player: EmbeddedPlayer | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let done = false;
    const finish = (ids: string[]) => {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      clearTimeout(timeout);
      try {
        player?.destroy();
      } catch {
        // Já desmontado; nada a fazer.
      }
      host.remove();
      resolve(ids);
    };
    const timeout = setTimeout(() => finish([]), PLAYLIST_LIST_TIMEOUT_MS);
    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => {
        const list = player?.getPlaylist?.();
        if (Array.isArray(list) && list.length > 0) finish(list);
      }, 300);
    };

    player = new YT.Player(mount, {
      width: "1",
      height: "1",
      playerVars: {
        listType: "playlist",
        list: playlistId,
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
      },
      events: {
        onReady: startPolling,
        // Um item que não toca dá erro com a lista ainda legível; uma playlist
        // privada ou inexistente também dá erro, e aí não há lista nenhuma.
        // Um pouco mais de leitura, e desiste sem esperar o tempo todo.
        onError: () => {
          startPolling();
          setTimeout(() => finish([]), PLAYLIST_LIST_AFTER_ERROR_MS);
        },
      },
    });
  });
}
