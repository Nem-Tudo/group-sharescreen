// The room's music — mirrors the server's RoomMusicSource (see
// server/signaling.ts), which is the authority on all of it. Nothing streams:
// every participant embeds the same audio themselves and only this record
// travels, exactly like a video source (lib/videoSource.ts). What differs is
// the social shape, and that is the whole point of it being its own thing:
//
//   - one per room, so a room has *a* soundtrack rather than a pile of them;
//   - only the owner and admins put it on or steer it, because it is one
//     shared output for everybody rather than something a participant brings;
//   - it plays audio-only in a bar (see components/MusicBar) rather than
//     taking a tile away from what people came to watch.

import { parseYouTubeSource } from "./videoSource";

// Only YouTube today. The obvious alternatives were looked at and don't fit a
// *shared, synchronized* player:
//
//   - Spotify's Embed IFrame API can be driven (play/pause/seek) and would
//     synchronize fine, but it plays 30-second previews for anyone not signed
//     into Spotify Premium in that same browser. A room where most people
//     hear half a minute and stop is worse than no feature.
//   - Deezer's widget has the same shape of limitation.
//
// Both would work as "everyone opens their own player", which is not what
// this is. The kind field exists so adding one later is a new branch here and
// in MusicBar rather than a change of shape everywhere.
export type MusicSourceKind = "youtube";

export type MusicSource = {
  id: string;
  kind: MusicSourceKind;
  // The 11-character video id, or the playlist id when a playlist URL was
  // pasted with no `v=`. Never the pasted URL: the server re-parses it and
  // its answer is what every listener embeds.
  videoId: string;
  playlistId?: string;
  // Which item of the playlist is playing, 0-based (YT.Player's
  // getPlaylistIndex). Playback state, not identity — it moves as the queue
  // advances, like positionSeconds.
  playlistIndex?: number;
  // Who put it on. Shown, not enforced: control follows the room's owner and
  // admins, so an admin who didn't add it can still skip a track.
  addedById: string;
  addedByName: string;
  playing: boolean;
  playbackRate: number;
  positionSeconds: number;
  // Server clock (see musicPosition below).
  updatedAt: number;
};

// Where the music should be *right now*, extrapolated from the last state the
// server broadcast — same arithmetic as videoSourcePosition, and the same
// reason for it: a playing track's position is a function of time, so the
// room stays together without anyone streaming position updates. A negative
// elapsed time (this viewer's clock behind the server's) is treated as "no
// time has passed" rather than as a rewind.
export function musicPosition(music: MusicSource, now = Date.now()): number {
  if (!music.playing) return music.positionSeconds;
  const elapsed = Math.max(0, (now - music.updatedAt) / 1000);
  return music.positionSeconds + elapsed * (music.playbackRate || 1);
}

// Client-side twin of the server's parse, used only to tell someone their
// link is wrong before sending it — never as the gate.
export function parseMusicUrl(raw: string): { videoId: string; playlistId: string | null } | null {
  const parsed = parseYouTubeSource(raw);
  if (!parsed) return null;
  const videoId = parsed.videoId || parsed.playlistId;
  if (!videoId) return null;
  return { videoId, playlistId: parsed.playlistId };
}

// mm:ss, or h:mm:ss past an hour — a DJ set or a long mix is a normal thing
// to put on, and 78:31 is not a readable timestamp.
export function formatMusicTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(secs).padStart(2, "0")}`;
}
