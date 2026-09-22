"use client";

// Every audio track of a local file, decoded by us rather than by the <video>
// element, and played in step with it.
//
// Why this exists: Chromium plays exactly one audio track of a file — the
// first — and only in the codecs it ships. A film in .mkv with several
// languages often has an AC3/DTS track first, which Chromium cannot decode,
// so the whole file came out silent; and even when the first track played,
// nobody could pick another. Here the container is read in JS
// (lib/mediaDemux), each track is decoded with WebCodecs, and each gets an
// output node of its own; LocalMediaSource wires those to the room (one per
// language, each viewer choosing) and to the broadcaster's speakers.
//
// The <video> element stays the clock. Its picture is what the room sees, so
// its currentTime is the truth; this schedules decoded audio against an
// AudioContext timeline anchored to it, and re-anchors whenever the two drift
// apart, the element pauses, stalls, seeks or changes speed.

import type { AudioDemuxer, AudioTrackInfo } from "./mediaDemux";

// How far ahead of the playhead decoded audio is handed to WebAudio, and how
// far ahead of it the demuxer is kept reading.
const SCHEDULE_AHEAD_S = 0.6;
const DECODE_AHEAD_S = 3;
// A track with nothing in a stretch of the file (a commentary that starts
// later) must not make the reader run away to the end looking for it.
const MAX_DECODE_AHEAD_S = 12;
// Beyond this the audio is re-anchored to the picture.
const DRIFT_S = 0.2;
// Consecutive decoded chunks closer than this to where the previous one
// ended are treated as continuous — which is what absorbs laced frames that
// all carry their block's timestamp, and rounding in the container's clock.
const CONTINUITY_US = 300_000;
const TICK_MS = 50;
// Latency added when (re)starting, so the first buffer is not already late.
const START_LEAD_S = 0.06;

type Decoded = { startUs: number; endUs: number; buffer: AudioBuffer };
type Scheduled = { source: AudioBufferSourceNode; item: Decoded };

class TrackPlayer {
  decoder: AudioDecoder;
  queue: Decoded[] = [];
  scheduled: Scheduled[] = [];
  expectedUs: number | null = null;
  lastInputUs = 0;
  failed = false;

  constructor(
    readonly info: AudioTrackInfo,
    readonly config: AudioDecoderConfig,
    readonly out: GainNode,
    private readonly context: AudioContext,
    private readonly onFailed: () => void
  ) {
    this.decoder = this.makeDecoder();
  }

  private makeDecoder(): AudioDecoder {
    const decoder = new AudioDecoder({
      output: (data) => this.onOutput(data),
      error: () => {
        this.failed = true;
        this.onFailed();
      },
    });
    decoder.configure(this.config);
    return decoder;
  }

  private onOutput(data: AudioData) {
    try {
      const frames = data.numberOfFrames;
      const channels = data.numberOfChannels;
      if (frames === 0 || channels === 0) return;
      const buffer = this.context.createBuffer(channels, frames, data.sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const plane = new Float32Array(frames);
        data.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
        buffer.copyToChannel(plane, channel);
      }
      const durationUs = (frames / data.sampleRate) * 1e6;
      let startUs = data.timestamp;
      if (this.expectedUs !== null && Math.abs(startUs - this.expectedUs) < CONTINUITY_US) startUs = this.expectedUs;
      this.expectedUs = startUs + durationUs;
      this.queue.push({ startUs, endUs: startUs + durationUs, buffer });
    } catch {
      // A chunk that cannot be converted is a gap, not a reason to stop.
    } finally {
      data.close();
    }
  }

  decode(timestampUs: number, data: Uint8Array) {
    if (this.failed || this.decoder.state !== "configured") return;
    this.lastInputUs = Math.max(this.lastInputUs, timestampUs);
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: timestampUs, data }));
    } catch {
      this.failed = true;
      this.onFailed();
    }
  }

  /** Stops what is scheduled; puts it back in the queue when `keep`. */
  stopScheduled(keep: boolean) {
    const back: Decoded[] = [];
    for (const entry of this.scheduled) {
      entry.source.onended = null;
      try {
        entry.source.stop();
      } catch {
        // Never started, or already over.
      }
      entry.source.disconnect();
      if (keep) back.push(entry.item);
    }
    this.scheduled = [];
    if (back.length > 0) this.queue = [...back, ...this.queue].sort((a, b) => a.startUs - b.startUs);
  }

  /** Everything decoded or in flight is thrown away (a seek). */
  flush() {
    this.stopScheduled(false);
    this.queue = [];
    this.expectedUs = null;
    this.lastInputUs = 0;
    if (this.failed) return;
    try {
      this.decoder.reset();
      this.decoder.configure(this.config);
    } catch {
      this.failed = true;
    }
  }

  close() {
    this.stopScheduled(false);
    this.queue = [];
    try {
      if (this.decoder.state !== "closed") this.decoder.close();
    } catch {
      // Already closed by an error.
    }
    this.out.disconnect();
  }
}

export type ProbedTrack = { info: AudioTrackInfo; supported: boolean; config: AudioDecoderConfig | null };

/** Which of a file's audio tracks this browser can decode, and with what. */
export async function probeTracks(tracks: AudioTrackInfo[]): Promise<ProbedTrack[]> {
  const out: ProbedTrack[] = [];
  for (const info of tracks) {
    if (!info.codec || info.unreadable || typeof AudioDecoder === "undefined") {
      out.push({ info, supported: false, config: null });
      continue;
    }
    const config: AudioDecoderConfig = {
      codec: info.codec,
      sampleRate: info.sampleRate || 48000,
      numberOfChannels: info.channels || 2,
      ...(info.description ? { description: info.description } : {}),
    };
    try {
      const result = await AudioDecoder.isConfigSupported(config);
      out.push({ info, supported: Boolean(result.supported), config: result.supported ? config : null });
    } catch {
      out.push({ info, supported: false, config: null });
    }
  }
  return out;
}

export class MultiAudioEngine {
  /** By track index: the output of every track that decodes. */
  readonly outputs = new Map<number, GainNode>();
  private players: TrackPlayer[] = [];
  private byId = new Map<number, TrackPlayer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private anchorMedia = 0;
  private anchorContext = 0;
  private feeding = false;
  private ended = false;
  private seq = 0;
  private seekDone: Promise<void> = Promise.resolve();
  private disposed = false;
  private readonly detach: () => void;

  constructor(
    private readonly element: HTMLVideoElement,
    private readonly context: AudioContext,
    private readonly demuxer: AudioDemuxer,
    tracks: ProbedTrack[],
    private readonly onTrackFailed: (index: number) => void
  ) {
    for (const probed of tracks) {
      if (!probed.supported || !probed.config) continue;
      const out = context.createGain();
      // Several channels (5.1) fold down to the stereo every destination is.
      out.channelCount = 2;
      out.channelCountMode = "explicit";
      out.channelInterpretation = "speakers";
      const index = probed.info.index;
      const player = new TrackPlayer(probed.info, probed.config, out, context, () => this.onTrackFailed(index));
      this.players.push(player);
      this.byId.set(probed.info.id, player);
      this.outputs.set(index, out);
    }

    const el = element;
    const resume = () => {
      if (el.paused || el.seeking || el.readyState < 3) return;
      this.running = true;
      this.reanchor();
    };
    const halt = () => {
      this.running = false;
      for (const player of this.players) player.stopScheduled(true);
    };
    const onSeeking = () => this.restartAt(el.currentTime);
    const onRate = () => {
      if (this.running) this.reanchor();
    };
    const listeners: [string, () => void][] = [
      ["play", resume],
      ["playing", resume],
      ["seeked", resume],
      ["canplay", resume],
      ["pause", halt],
      ["waiting", halt],
      ["ended", halt],
      ["seeking", onSeeking],
      ["ratechange", onRate],
    ];
    for (const [name, fn] of listeners) el.addEventListener(name, fn);
    this.detach = () => {
      for (const [name, fn] of listeners) el.removeEventListener(name, fn);
    };

    this.restartAt(el.currentTime);
    resume();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  get playable(): boolean {
    return this.players.some((p) => !p.failed);
  }

  private reanchor() {
    for (const player of this.players) player.stopScheduled(true);
    this.anchorMedia = this.element.currentTime;
    this.anchorContext = this.context.currentTime + START_LEAD_S;
  }

  private restartAt(seconds: number) {
    this.seq += 1;
    this.feeding = false;
    this.ended = false;
    for (const player of this.players) player.flush();
    this.seekDone = this.demuxer.seek(seconds).catch(() => {});
    if (this.running) this.reanchor();
  }

  private tick() {
    if (this.disposed) return;
    void this.feed();
    if (!this.running) return;
    const rate = this.element.playbackRate || 1;
    const now = this.context.currentTime;
    const media = this.anchorMedia + (now - this.anchorContext) * rate;
    if (now >= this.anchorContext && Math.abs(this.element.currentTime - media) > DRIFT_S) {
      this.reanchor();
      return;
    }
    const horizon = Math.max(media, this.anchorMedia) + SCHEDULE_AHEAD_S;
    for (const player of this.players) {
      if (player.failed) continue;
      while (player.queue.length > 0 && player.queue[0].startUs / 1e6 < horizon) {
        const item = player.queue.shift()!;
        const when = this.anchorContext + (item.startUs / 1e6 - this.anchorMedia) / rate;
        const length = item.buffer.duration / rate;
        const earliest = now + 0.02;
        if (when + length <= earliest) continue; // already past
        const source = this.context.createBufferSource();
        source.buffer = item.buffer;
        source.playbackRate.value = rate;
        source.connect(player.out);
        const offset = when < earliest ? (earliest - when) * rate : 0;
        source.start(Math.max(when, earliest), offset);
        const entry: Scheduled = { source, item };
        player.scheduled.push(entry);
        source.onended = () => {
          const at = player.scheduled.indexOf(entry);
          if (at >= 0) player.scheduled.splice(at, 1);
          source.disconnect();
        };
      }
    }
  }

  private async feed() {
    if (this.feeding || this.ended || this.disposed) return;
    const live = this.players.filter((p) => !p.failed);
    if (live.length === 0) return;
    const media = this.element.currentTime;
    const aheads = live.map((p) => p.lastInputUs / 1e6 - media);
    if (Math.min(...aheads) > DECODE_AHEAD_S || Math.max(...aheads) > MAX_DECODE_AHEAD_S) return;
    if (live.some((p) => p.decoder.decodeQueueSize > 40)) return;
    this.feeding = true;
    const seq = this.seq;
    try {
      await this.seekDone;
      if (seq !== this.seq) return;
      const packets = await this.demuxer.read();
      if (seq !== this.seq || this.disposed) return;
      if (!packets) {
        this.ended = true;
        for (const player of live) void player.decoder.flush().catch(() => {});
        return;
      }
      for (const packet of packets) this.byId.get(packet.trackId)?.decode(packet.timestampUs, packet.data);
    } catch {
      // A read that failed is retried on the next tick.
    } finally {
      if (seq === this.seq) this.feeding = false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.detach();
    for (const player of this.players) player.close();
    this.players = [];
    this.byId.clear();
    this.outputs.clear();
  }
}
