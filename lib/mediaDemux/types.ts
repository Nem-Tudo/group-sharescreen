// What the local-file audio engine (lib/multiAudioEngine.ts) needs from a
// container: the audio tracks it holds, and their packets in time order. The
// picture is never read here — the <video> element keeps playing the file as
// it always did; this exists only for the audio tracks Chromium will not play
// (it plays one track of a file, and only some codecs).

export type AudioTrackInfo = {
  /** The container's own track number/id. */
  id: number;
  /** Position among the file's audio tracks, from 0. */
  index: number;
  /** As the container names it: "A_AAC", "A_OPUS", "mp4a", "ac-3"... */
  codecId: string;
  /** The WebCodecs codec string, or null when there is no mapping at all. */
  codec: string | null;
  description?: Uint8Array;
  sampleRate: number;
  channels: number;
  /** BCP 47 or ISO 639-2, as found; null when absent or "und". */
  language: string | null;
  name: string | null;
  isDefault: boolean;
  /** How long one frame lasts, when the container says (for laced blocks). */
  frameDurationUs: number | null;
  /** Matroska "header stripping": bytes to put back in front of every frame. */
  headerStrip?: Uint8Array;
  /** Compressed or encrypted in a way this reader does not undo. */
  unreadable?: boolean;
};

export type AudioPacket = {
  trackId: number;
  timestampUs: number;
  data: Uint8Array;
};

export interface AudioDemuxer {
  readonly tracks: AudioTrackInfo[];
  /** Positions reading at or before `seconds`; the engine drops what comes early. */
  seek(seconds: number): Promise<void>;
  /** The next packets of every audio track, in time order; null at the end. */
  read(): Promise<AudioPacket[] | null>;
}
