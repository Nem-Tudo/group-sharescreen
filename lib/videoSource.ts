// A video someone added to the room from an external service — mirrors the
// server's RoomVideoSource (see server/signaling.ts), which is the authority
// on all of it. Nothing here streams: every participant embeds the same
// video themselves, and only this record travels, which is what makes the
// room watch the same frame at the same time.
export type VideoSourceKind = "youtube" | "twitch" | "kick";

export type VideoSource = {
  id: string;
  kind: VideoSourceKind;
  // YouTube video id, or the channel login for Twitch/Kick — see the parse*
  // helpers below. Never the pasted URL; the server re-parses and its answer
  // is what everyone embeds. For a playlist-only YouTube URL (no `v=`), this
  // is the playlist id itself — the embed keys off `playlistId` below rather
  // than treating this as an 11-character video.
  videoId: string;
  // YouTube playlist id when the pasted URL carried a `list=` (watch?v=&list=,
  // /playlist?list=, youtu.be/?list=). The embed loads this as listType=playlist
  // so the room watches the queue, not just the opening video. Absent for a
  // single video and for Twitch/Kick. Optional because a server that predates
  // this field simply never sends it, and those sources play as they always have.
  playlistId?: string;
  // Which item in that playlist is playing, 0-based — same meaning as
  // YT.Player.getPlaylistIndex. Playback state, not identity: it moves as the
  // queue advances, via video-source-state, the same way positionSeconds does.
  // Absent when there is no playlist, or from a server/client that doesn't
  // know about it.
  playlistIndex?: number;
  addedById: string;
  addedByName: string;
  // "owner" (only addedById may steer it) or "anyone" (the whole room may) —
  // see VideoSourceTile's canControl, which this decides alongside identity.
  controlMode: "owner" | "anyone";
  playing: boolean;
  positionSeconds: number;
  // Shared playback speed. Part of the position arithmetic below, not just a
  // display setting.
  playbackRate: number;
  // Server clock (see videoSourcePosition below).
  updatedAt: number;
};

// Where the video should be *right now*, extrapolated from the last state
// the server broadcast: a playing video's position is a function of time, so
// the room stays in sync without anyone streaming position updates. Uses the
// viewer's own clock against the server's `updatedAt`, so a badly-set local
// clock shows up as a constant offset — hence the guard: a negative elapsed
// time (clock behind the server) is treated as "no time has passed" rather
// than as a rewind.
export function videoSourcePosition(source: VideoSource, now = Date.now()): number {
  if (!source.playing) return source.positionSeconds;
  const elapsed = Math.max(0, (now - source.updatedAt) / 1000);
  // Speed matters here: at 1.5x the video covers 1.5 seconds of itself per
  // second of wall clock, and ignoring that drifts further out the longer it
  // plays. `|| 1` covers a source from a server that predates the field.
  return source.positionSeconds + elapsed * (source.playbackRate || 1);
}

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
// User-created (PL), channel uploads (UU), favorites (FL), albums (OLAK5uy_),
// and Mix/radio (RD). Watch Later (WL) and Liked (LL) are per-account and
// cannot be embedded, so they're refused rather than accepted only to fail
// in every iframe.
const YOUTUBE_PLAYLIST_ID_RE = /^(PL|UU|FL|OLAK5uy_|RD)[A-Za-z0-9_-]{10,128}$/;

export function isYouTubeVideoId(id: string): boolean {
  return YOUTUBE_VIDEO_ID_RE.test(id);
}

function isYouTubeHost(host: string): boolean {
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  );
}

function parseYouTubeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  return isYouTubeHost(host) ? url : null;
}

// Client-side twin of the server's parseYouTubeVideoId — used only to tell
// someone their link is wrong before sending it, never as the gate: the
// server parses the URL again and its answer is the one that ends up in
// everyone's iframe.
export function parseYouTubeVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (YOUTUBE_VIDEO_ID_RE.test(trimmed)) return trimmed;
  const url = parseYouTubeUrl(trimmed);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    const [, section, value] = url.pathname.split("/");
    if (section === "embed" || section === "live" || section === "shorts" || section === "v") {
      id = value ?? null;
    }
  }
  return id && YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
}

// Same twin-of-the-server caveat as parseYouTubeVideoId. A watch URL with both
// `v=` and `list=` yields the list id here and the video id from
// parseYouTubeVideoId — see parseYouTubeSource, which is what the add-source
// modal actually calls.
export function parseYouTubePlaylistId(raw: string): string | null {
  const trimmed = raw.trim();
  if (YOUTUBE_PLAYLIST_ID_RE.test(trimmed)) return trimmed;
  const url = parseYouTubeUrl(trimmed);
  if (!url) return null;
  const list = url.searchParams.get("list");
  return list && YOUTUBE_PLAYLIST_ID_RE.test(list) ? list : null;
}

export type YouTubeSourceRef = {
  videoId: string | null;
  playlistId: string | null;
};

export function parseYouTubeSource(raw: string): YouTubeSourceRef | null {
  const videoId = parseYouTubeVideoId(raw);
  const playlistId = parseYouTubePlaylistId(raw);
  if (!videoId && !playlistId) return null;
  return { videoId, playlistId };
}

// Per-tile volume dials persist across re-adds of the same video (see
// WatchRoom's transmissionVolumes). A playlist is one source even as the
// current video changes, so the playlist id is the stable key when present.
export function videoSourceVolumeKey(source: Pick<VideoSource, "videoId" | "playlistId">): string {
  return `video:${source.playlistId || source.videoId}`;
}

const TWITCH_CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_]{3,24}$/;

// Client-side twin of the server's parseTwitchChannel (see server/signaling.ts)
// — same caveat as parseYouTubeVideoId above: only to reject an obvious
// mistake before sending, never the gate. Accepts a bare channel name or a
// twitch.tv/<channel> URL; a VOD or clip link (more than one path segment)
// is rejected rather than guessed at, since only a live channel embed is
// supported.
export function parseTwitchChannel(raw: string): string | null {
  const trimmed = raw.trim();
  if (TWITCH_CHANNEL_RE.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
  if (host !== "twitch.tv") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const channel = segments[0];
  return TWITCH_CHANNEL_RE.test(channel) ? channel : null;
}

// Kick slugs: 3-25 letters/digits/underscore. Slightly wider than Twitch's
// (Kick allows a leading digit), and used the same way: a bare name typed
// with no URL, or a kick.com/<channel> / player.kick.com/<channel> link.
// Extra path segments (VODs, clips, /videos/…) are rejected — the embed is
// a live channel iframe with no timeline, same constraint as Twitch.
const KICK_CHANNEL_RE = /^[A-Za-z0-9_]{3,25}$/;

export function parseKickChannel(raw: string): string | null {
  const trimmed = raw.trim();
  if (KICK_CHANNEL_RE.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
  if (host !== "kick.com" && host !== "player.kick.com") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;
  const channel = segments[0];
  return KICK_CHANNEL_RE.test(channel) ? channel : null;
}

// Twitch and Kick channel embeds have no seek/duration API, so "only I can
// control" is a lie — the platform's own chrome is always there. The modal
// and the server both force controlMode to "anyone" for these.
export function isLiveChannelSource(kind: VideoSourceKind): boolean {
  return kind === "twitch" || kind === "kick";
}

export function parseVideoSourceInput(kind: VideoSourceKind, raw: string): string | null {
  if (kind === "youtube") {
    const parsed = parseYouTubeSource(raw);
    return parsed ? parsed.videoId || parsed.playlistId : null;
  }
  if (kind === "twitch") return parseTwitchChannel(raw);
  return parseKickChannel(raw);
}
