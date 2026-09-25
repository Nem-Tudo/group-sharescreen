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
//
// AC3 and E-AC3 — the usual audio of a film in .mkv — are not in any
// browser's WebCodecs. Those tracks are decoded in software instead: FFmpeg's
// decoder built to WASM (@mediabunny/ac3), driven through mediabunny, which
// also reads the file for them (AudioBufferSink). Loaded only when a file has
// such a track: it is a megabyte nobody else should download.

import type { AudioBufferSink, WrappedAudioBuffer } from "mediabunny";
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

// The codecs decoded in software when WebCodecs refuses them (see
// mediaDemux/codecs for the strings).
const SOFTWARE_CODECS = ["ac-3", "ec-3"];

type Mediabunny = typeof import("mediabunny");
let softwareLib: Promise<Mediabunny | null> | null = null;

/** mediabunny with the AC3/E-AC3 decoder registered, or null when it cannot load. */
function loadSoftwareDecoder(): Promise<Mediabunny | null> {
  softwareLib ??= (async () => {
    const lib = await import("mediabunny");
    const { registerAc3Decoder } = await import("@mediabunny/ac3");
    registerAc3Decoder();
    return lib;
  })().catch(() => {
    softwareLib = null;
    return null;
  });
  return softwareLib;
}

/** What both kinds of player share: decoded audio waiting, and what is playing of it. */
abstract class BasePlayer {
  queue: Decoded[] = [];
  scheduled: Scheduled[] = [];
  /** How far into the file decoded audio (or input to the decoder) reaches. */
  lastInputUs = 0;
  failed = false;

  constructor(
    readonly info: AudioTrackInfo,
    readonly out: GainNode
  ) {}

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

  abstract close(): void;
}

/** A track decoded by WebCodecs, fed packets from lib/mediaDemux. */
class TrackPlayer extends BasePlayer {
  decoder: AudioDecoder;
  expectedUs: number | null = null;

  constructor(
    info: AudioTrackInfo,
    readonly config: AudioDecoderConfig,
    out: GainNode,
    private readonly context: AudioContext,
    private readonly onFailed: () => void
  ) {
    super(info, out);
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

/**
 * A track decoded in software (AC3/E-AC3). It reads the file on its own,
 * through mediabunny, rather than taking packets from lib/mediaDemux: the
 * decoder is only reachable that way. Kept DECODE_AHEAD_S ahead of the
 * playhead, and restarted from the new position on a seek.
 */
class SoftwareTrackPlayer extends BasePlayer {
  private iterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
  private startS = 0;
  private gen = 0;
  private pulling = false;
  private done = false;

  constructor(
    info: AudioTrackInfo,
    out: GainNode,
    private readonly sink: Promise<AudioBufferSink | null>,
    private readonly playhead: () => number,
    private readonly onFailed: () => void
  ) {
    super(info, out);
  }

  restart(seconds: number) {
    this.gen += 1;
    this.stopScheduled(false);
    this.queue = [];
    this.lastInputUs = 0;
    this.startS = seconds;
    this.done = false;
    this.pulling = false;
    const iterator = this.iterator;
    this.iterator = null;
    if (iterator) void iterator.return(undefined).catch(() => {});
  }

  async pull() {
    if (this.pulling || this.done || this.failed) return;
    this.pulling = true;
    const gen = this.gen;
    try {
      if (!this.iterator) {
        const sink = await this.sink;
        if (gen !== this.gen) return;
        if (!sink) throw new Error("no sink");
        this.iterator = sink.buffers(this.startS);
      }
      const iterator = this.iterator;
      while (this.lastInputUs / 1e6 - this.playhead() < DECODE_AHEAD_S) {
        const next = await iterator.next();
        if (gen !== this.gen) return;
        if (next.done) {
          this.done = true;
          return;
        }
        const { buffer, timestamp, duration } = next.value;
        const startUs = timestamp * 1e6;
        const endUs = (timestamp + duration) * 1e6;
        this.queue.push({ startUs, endUs, buffer });
        this.lastInputUs = endUs;
      }
    } catch {
      if (gen !== this.gen) return;
      this.failed = true;
      this.onFailed();
    } finally {
      if (gen === this.gen) this.pulling = false;
    }
  }

  close() {
    this.restart(0);
    this.done = true;
    this.out.disconnect();
  }
}

export type ProbedTrack = {
  info: AudioTrackInfo;
  supported: boolean;
  /** Set for a track WebCodecs decodes. */
  config: AudioDecoderConfig | null;
  /** A track decoded in software (AC3/E-AC3) instead. */
  software?: boolean;
};

/** Which of a file's audio tracks this browser can decode, and with what. */
export async function probeTracks(tracks: AudioTrackInfo[]): Promise<ProbedTrack[]> {
  const out: ProbedTrack[] = [];
  for (const info of tracks) {
    if (!info.codec || info.unreadable) {
      out.push({ info, supported: false, config: null });
      continue;
    }
    const config: AudioDecoderConfig = {
      codec: info.codec,
      sampleRate: info.sampleRate || 48000,
      numberOfChannels: info.channels || 2,
      ...(info.description ? { description: info.description } : {}),
    };
    let supported = false;
    if (typeof AudioDecoder !== "undefined") {
      try {
        supported = Boolean((await AudioDecoder.isConfigSupported(config)).supported);
      } catch {
        // Unsupported, as far as this is concerned.
      }
    }
    if (supported) out.push({ info, supported: true, config });
    else if (SOFTWARE_CODECS.includes(info.codec) && (await loadSoftwareDecoder()))
      out.push({ info, supported: true, config: null, software: true });
    else out.push({ info, supported: false, config: null });
  }
  return out;
}

/** Whether a track needs the software decoder — which the <video> element cannot play either. */
export function needsSoftwareDecode(info: AudioTrackInfo): boolean {
  return info.codec !== null && SOFTWARE_CODECS.includes(info.codec);
}

export class MultiAudioEngine {
  /** By track index: the output of every track that decodes. */
  readonly outputs = new Map<number, GainNode>();
  private players: BasePlayer[] = [];
  // WebCodecs players, by container track id: the ones the demuxer feeds.
  private byId = new Map<number, TrackPlayer>();
  private decoders: TrackPlayer[] = [];
  private software: SoftwareTrackPlayer[] = [];
  // mediabunny's reading of the file, for the software tracks; null without any.
  private input: Promise<import("mediabunny").Input | null> | null = null;
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
    blob: Blob,
    tracks: ProbedTrack[],
    private readonly onTrackFailed: (index: number) => void
  ) {
    for (const probed of tracks) {
      if (!probed.supported || (!probed.config && !probed.software)) continue;
      const out = context.createGain();
      // Several channels (5.1) fold down to the stereo every destination is.
      out.channelCount = 2;
      out.channelCountMode = "explicit";
      out.channelInterpretation = "speakers";
      const index = probed.info.index;
      const failed = () => this.onTrackFailed(index);
      if (probed.config) {
        const player = new TrackPlayer(probed.info, probed.config, out, context, failed);
        this.players.push(player);
        this.decoders.push(player);
        this.byId.set(probed.info.id, player);
      } else {
        const player = new SoftwareTrackPlayer(probed.info, out, this.sinkFor(blob, probed.info), () => element.currentTime, failed);
        this.players.push(player);
        this.software.push(player);
      }
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
    for (const player of this.decoders) player.flush();
    for (const player of this.software) player.restart(seconds);
    this.seekDone = this.demuxer.seek(seconds).catch(() => {});
    if (this.running) this.reanchor();
  }

  // The mediabunny sink for one software track, matched by its position among
  // the file's audio tracks (mediabunny's `number` counts from 1).
  private async sinkFor(blob: Blob, info: AudioTrackInfo): Promise<AudioBufferSink | null> {
    const lib = await loadSoftwareDecoder();
    if (!lib || this.disposed) return null;
    this.input ??= Promise.resolve(new lib.Input({ source: new lib.BlobSource(blob), formats: lib.ALL_FORMATS }));
    const input = await this.input;
    if (!input || this.disposed) return null;
    const track = (await input.getAudioTracks()).find((t) => t.number === info.index + 1);
    return track ? new lib.AudioBufferSink(track) : null;
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
    if (this.disposed) return;
    // Software tracks read the file themselves, each at its own pace.
    for (const player of this.software) void player.pull();
    if (this.feeding || this.ended) return;
    const live = this.decoders.filter((p) => !p.failed);
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
    this.decoders = [];
    this.software = [];
    this.byId.clear();
    this.outputs.clear();
    void this.input?.then((input) => input?.dispose()).catch(() => {});
  }
}
