"use client";

// "Gravar chamada": the whole call, recorded in this browser — every voice,
// every screen and camera, not one tile the way "Gravação" does it (see
// TileRecorder in lib/clipBuffer).
//
// What comes out, as chosen in components/CallRecordingModal:
//   - "video": one MP4 laid out like the room (a grid of the transmissions,
//     names on them, a ring on whoever is talking), with either one audio
//     track (everything mixed) or one per voice/screen;
//   - "zip": each screen/camera as its own MP4 (picture only) and the sound
//     as MP3 — one per voice/screen, or one of everything mixed;
//   - "both": the zip, with the room's MP4 inside it too.
//
// Every file has the same length, start to end of the recording, so they
// line up on any editor's timeline by just dropping them at zero. Somebody
// who joins halfway gets silence (or a black picture) up to that point, and
// somebody who leaves gets it from there to the end. That is also why none of
// this uses MediaRecorder: it cannot start a file anywhere but "now", and it
// cannot put more than one audio track in a file. Everything is encoded with
// WebCodecs through mediabunny, with every timestamp read from one clock —
// the audio graph's.
//
// Capture:
//   - sound: each stream goes through a GainNode (the volume picked in the
//     modal) into an AudioWorklet (public/worklets/call-capture.js) that
//     hands raw PCM back; mixed, they all meet in one bus with one worklet;
//   - picture: a hidden <video> per stream, drawn into a canvas on a clock
//     that lives in a worker (public/workers/call-ticker.js), because a page
//     timer in a background tab would drop to one frame a second.
//
// Everything is encoded while the call happens, so stopping only has to close
// the files. The single-video option is the one exception: its tracks are
// written as separate files during the call (a track cannot be added to an
// MP4 once it has started, and people join whenever they like) and put
// together at the end, which copies them without re-encoding.
//
// Nothing is uploaded. The files live as Blobs until they are downloaded.

import type { AudioCodec, AudioSampleSource, CanvasSource, Output, VideoCodec } from "mediabunny";
import { ensureSharedAudioContextRunning, getSharedAudioContext } from "./audioContext";

type Mediabunny = typeof import("mediabunny");

export type CallSourceKind = "voice" | "screen" | "camera" | "file";

export type CallSource = {
  // Stable for as long as the transmission lasts, e.g. "voice:<peerId>".
  id: string;
  kind: CallSourceKind;
  // Who it belongs to; the voice and the screen of one person share it, which
  // is how the room's video knows whose tile to ring while they talk.
  ownerId: string;
  name: string;
  self: boolean;
  stream: MediaStream;
  // Only its sound is recorded (music playing from a file).
  audioOnly?: boolean;
};

export type CallExport = "video" | "zip" | "both";

export type CallRecordingSettings = {
  separateTracks: boolean;
  includeMyVoice: boolean;
  includeMyScreen: boolean;
  output: CallExport;
};

// Words that end up in file names, in the viewer's language.
export type CallRecordingLabels = {
  call: string;
  audio: string;
  voice: string;
  screen: string;
  camera: string;
  file: string;
};

export type CallRecordingResult = {
  blob: Blob;
  fileName: string;
  durationMs: number;
  // Files that could not be packed (a zip past 4 GB): handed over one by one.
  looseFiles?: { name: string; blob: Blob }[];
};

export class CallRecordingUnsupportedError extends Error {}

const FPS = 30;
const MAX_LONG = 1920;
const MAX_SHORT = 1080;
// Separate silence into pieces this long, so a person joining an hour in is
// not one gigantic buffer.
const SILENCE_PIECE_S = 1;
const WORKLET_URL = "/worklets/call-capture.js";
const TICKER_URL = "/workers/call-ticker.js";

export function callRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof Worker !== "undefined"
  );
}

// Loaded on the first recording rather than with the room: nobody who never
// records should pay for the muxers.
let libPromise: Promise<Mediabunny> | null = null;
function loadLib(): Promise<Mediabunny> {
  libPromise ??= import("mediabunny").catch((err: unknown) => {
    libPromise = null;
    throw err;
  });
  return libPromise;
}

let mp3Ready: Promise<void> | null = null;
function loadMp3(lib: Mediabunny): Promise<void> {
  mp3Ready ??= (async () => {
    if (await lib.canEncodeAudio("mp3")) return;
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
  })().catch((err: unknown) => {
    mp3Ready = null;
    throw err;
  });
  return mp3Ready;
}

const workletContexts = new WeakMap<AudioContext, Promise<void>>();
function loadWorklet(ctx: AudioContext): Promise<void> {
  let promise = workletContexts.get(ctx);
  if (!promise) {
    promise = ctx.audioWorklet.addModule(WORKLET_URL).catch((err: unknown) => {
      workletContexts.delete(ctx);
      throw err;
    });
    workletContexts.set(ctx, promise);
  }
  return promise;
}

// ---------------------------------------------------------------------------
// Where encoded bytes go: Blob pieces rather than one growing ArrayBuffer,
// which for an hour of 1080p would be gigabytes of one allocation. The muxer
// writes almost everything in order; the few writes that go back (sizes in
// headers filled in at the end) are kept aside and spliced in when the file
// is asked for.

class BlobSink {
  private parts: Blob[] = [];
  private size = 0;
  private patches: { position: number; data: Uint8Array<ArrayBuffer> }[] = [];

  target(lib: Mediabunny) {
    return new lib.StreamTarget(
      new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
        write: (chunk) => this.write(new Uint8Array(chunk.data), chunk.position),
      }),
      { chunked: true, chunkSize: 4 * 1024 * 1024 },
    );
  }

  private write(data: Uint8Array<ArrayBuffer>, position: number) {
    if (position > this.size) {
      this.parts.push(new Blob([new Uint8Array(position - this.size)]));
      this.size = position;
    }
    if (position === this.size) {
      this.parts.push(new Blob([data]));
      this.size += data.byteLength;
      return;
    }
    // Starts inside what is already written: the overlapping part is a patch,
    // anything past the end is appended.
    const overlap = Math.min(data.byteLength, this.size - position);
    this.patches.push({ position, data: data.slice(0, overlap) });
    if (overlap < data.byteLength) {
      const rest = data.slice(overlap);
      this.parts.push(new Blob([rest]));
      this.size += rest.byteLength;
    }
  }

  blob(type: string): Blob {
    let blob = new Blob(this.parts, { type });
    for (const { position, data } of this.patches) {
      blob = new Blob([blob.slice(0, position), data, blob.slice(position + data.byteLength)], { type });
    }
    return blob;
  }
}

// ---------------------------------------------------------------------------
// Sound

let zeros = new Float32Array(0);
function zeroPlanar(frames: number): Float32Array {
  if (zeros.length < frames * 2) zeros = new Float32Array(frames * 2);
  return zeros.subarray(0, frames * 2);
}

class AudioWriter {
  private output: Output;
  private source: AudioSampleSource;
  private sink = new BlobSink();
  private chain: Promise<void>;
  failed = false;

  constructor(
    private lib: Mediabunny,
    readonly container: "mp4" | "mp3",
    codec: AudioCodec,
    private sampleRate: number,
    readonly trackName: string,
  ) {
    const format = container === "mp3" ? new lib.Mp3OutputFormat() : new lib.Mp4OutputFormat({ fastStart: false });
    this.output = new lib.Output({ format, target: this.sink.target(lib) });
    this.source = new lib.AudioSampleSource({ codec, bitrate: container === "mp3" ? 160_000 : 128_000 });
    this.output.addAudioTrack(
      this.source,
      { name: trackName } as unknown as Parameters<Output["addAudioTrack"]>[1],
    );
    this.chain = this.output.start().catch(() => {
      this.failed = true;
    });
  }

  write(left: Float32Array, right: Float32Array, frame: number) {
    const data = new Float32Array(left.length * 2);
    data.set(left);
    data.set(right, left.length);
    this.push(data, frame);
  }

  // `frames` of silence from one shared buffer of zeros: an hour of it for
  // somebody who joined late is an hour of encoding, not of memory.
  silence(frames: number, frame: number) {
    this.push(zeroPlanar(frames), frame);
  }

  private push(data: Float32Array, frame: number) {
    const sample = new this.lib.AudioSample({
      data,
      format: "f32-planar",
      numberOfChannels: 2,
      sampleRate: this.sampleRate,
      timestamp: frame / this.sampleRate,
    });
    this.chain = this.chain
      .then(() => (this.failed ? undefined : this.source.add(sample)))
      .catch(() => {
        this.failed = true;
      })
      .finally(() => sample.close());
  }

  async finish(): Promise<Blob | null> {
    await this.chain;
    if (this.failed) {
      await this.output.cancel().catch(() => {});
      return null;
    }
    this.source.close();
    await this.output.finalize();
    return this.sink.blob(this.container === "mp3" ? "audio/mpeg" : "audio/mp4");
  }

  cancel() {
    void this.output.cancel().catch(() => {});
  }
}

// One worklet, and the files what it hears goes into (an AAC stem for the
// room's video, an MP3 for the zip, or both).
class AudioCapture {
  readonly node: AudioWorkletNode;
  private frame = 0;
  private started = false;
  private limit: number | null = null;
  private flushed: (() => void) | null = null;

  constructor(
    ctx: AudioContext,
    private t0: number,
    private sampleRate: number,
    readonly writers: AudioWriter[],
    keepAlive: AudioNode,
  ) {
    this.node = new AudioWorkletNode(ctx, "golive-call-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    // A worklet nobody listens to is not run: the silent gain is what keeps
    // the graph pulling it.
    this.node.connect(keepAlive);
    this.node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { flushed?: boolean; time?: number; left?: Float32Array; right?: Float32Array };
      if (data.flushed) {
        this.flushed?.();
        return;
      }
      if (data.left && data.right && typeof data.time === "number") this.onChunk(data.time, data.left, data.right);
    };
  }

  private onChunk(time: number, left: Float32Array, right: Float32Array) {
    if (!this.started) {
      this.started = true;
      // How far into the recording this began: that much silence first.
      this.silence(Math.max(0, Math.round((time - this.t0) * this.sampleRate)));
    }
    let n = left.length;
    if (this.limit !== null) n = Math.min(n, this.limit - this.frame);
    if (n <= 0) return;
    const l = n === left.length ? left : left.subarray(0, n);
    const r = n === right.length ? right : right.subarray(0, n);
    for (const writer of this.writers) writer.write(l, r, this.frame);
    this.frame += n;
  }

  private silence(frames: number) {
    const piece = Math.round(SILENCE_PIECE_S * this.sampleRate);
    while (frames > 0) {
      const n = Math.min(piece, frames);
      for (const writer of this.writers) writer.silence(n, this.frame);
      this.frame += n;
      frames -= n;
    }
  }

  // Everything up to `endFrame`, and exactly that: cut if the worklet ran a
  // little past the stop, padded with silence if its stream ended earlier.
  async finish(endFrame: number): Promise<(Blob | null)[]> {
    this.limit = endFrame;
    await new Promise<void>((resolve) => {
      this.flushed = resolve;
      this.node.port.postMessage("flush");
      // A suspended context never answers; don't hang the export on it.
      setTimeout(resolve, 1500);
    });
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.started = true;
    this.silence(endFrame - this.frame);
    return Promise.all(this.writers.map((w) => w.finish()));
  }

  cancel() {
    this.node.port.onmessage = null;
    this.node.disconnect();
    for (const writer of this.writers) writer.cancel();
  }
}

// ---------------------------------------------------------------------------
// Picture

class VideoWriter {
  private output: Output;
  private source: CanvasSource;
  private sink = new BlobSink();
  private chain: Promise<void>;
  private busy = false;
  private last = -1;
  failed = false;

  constructor(lib: Mediabunny, canvas: HTMLCanvasElement, codec: VideoCodec) {
    this.output = new lib.Output({
      format: new lib.Mp4OutputFormat({ fastStart: false }),
      target: this.sink.target(lib),
    });
    this.source = new lib.CanvasSource(canvas, { codec, bitrate: lib.QUALITY_HIGH, keyFrameInterval: 2 });
    this.output.addVideoTrack(this.source, { frameRate: FPS });
    this.chain = this.output.start().catch(() => {
      this.failed = true;
    });
  }

  // Draws and queues one frame at `time` — or skips it while the encoder is
  // still busy with the last, which is how a slow machine degrades: fewer
  // frames, never a growing queue.
  frame(time: number, duration: number, draw: () => void) {
    if (this.busy || this.failed || time <= this.last) return;
    // Every file starts at exactly zero, whatever the first tick said.
    if (this.last < 0) {
      duration += time;
      time = 0;
    }
    draw();
    this.busy = true;
    this.last = time;
    this.chain = this.chain
      .then(() => this.source.add(time, duration))
      .catch(() => {
        this.failed = true;
      })
      .finally(() => {
        this.busy = false;
      });
  }

  // The last frame is stretched to `end`, so every file is the same length.
  async finish(end: number, draw: () => void): Promise<Blob | null> {
    await this.chain;
    if (this.failed) {
      await this.output.cancel().catch(() => {});
      return null;
    }
    const at = Math.max(this.last + 0.001, end - 1 / FPS);
    if (end - at > 0.0005) {
      draw();
      await this.source.add(at, end - at).catch(() => {
        this.failed = true;
      });
    }
    this.source.close();
    await this.output.finalize();
    return this.sink.blob("video/mp4");
  }

  cancel() {
    void this.output.cancel().catch(() => {});
  }
}

// One hidden <video> per transmission, shared by its own file and the room's
// video. On the page (1px, invisible) rather than detached: a detached
// element is exactly what some browsers stop decoding.
class VideoFeed {
  readonly video: HTMLVideoElement;
  stream: MediaStream | null = null;
  present = false;

  constructor(host: HTMLElement) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    host.appendChild(this.video);
  }

  attach(stream: MediaStream) {
    this.present = true;
    if (this.stream === stream) return;
    this.stream = stream;
    this.video.srcObject = stream;
    void this.video.play().catch(() => {});
  }

  detach() {
    this.present = false;
  }

  drawable(): boolean {
    return (
      this.present &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      Boolean(this.stream?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted))
    );
  }

  dispose() {
    this.video.srcObject = null;
    this.video.remove();
  }
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

// A transmission's own MP4: the size of its first frame (capped at 1080p),
// black whenever it is not on.
class VideoCapture {
  private canvas = document.createElement("canvas");
  private ctx2d: CanvasRenderingContext2D | null = null;
  private writer: VideoWriter | null = null;
  private creating = false;

  constructor(
    private lib: Mediabunny,
    readonly feed: VideoFeed,
    readonly fileName: string,
  ) {}

  tick(time: number) {
    if (this.writer) {
      this.writer.frame(time, 1 / FPS, () => this.draw());
      return;
    }
    if (this.creating || !this.feed.drawable()) return;
    this.creating = true;
    void this.create(time);
  }

  private async create(time: number) {
    const { videoWidth: vw, videoHeight: vh } = this.feed.video;
    const scale = Math.min(1, MAX_LONG / Math.max(vw, vh), MAX_SHORT / Math.min(vw, vh));
    this.canvas.width = even(vw * scale);
    this.canvas.height = even(vh * scale);
    this.ctx2d = this.canvas.getContext("2d", { alpha: false });
    const codec = await this.lib
      .getFirstEncodableVideoCodec(new this.lib.Mp4OutputFormat().getSupportedVideoCodecs(), {
        width: this.canvas.width,
        height: this.canvas.height,
      })
      .catch(() => null);
    if (!codec || !this.ctx2d) return; // stays without a file; the rest goes on
    this.writer = new VideoWriter(this.lib, this.canvas, codec);
    // Black from the start of the recording up to now.
    if (time > 0) this.writer.frame(0, time, () => this.black());
  }

  private black() {
    if (!this.ctx2d) return;
    this.ctx2d.fillStyle = "#000";
    this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw() {
    this.black();
    if (this.ctx2d && this.feed.drawable()) {
      drawContain(this.ctx2d, this.feed.video, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  async finish(end: number): Promise<Blob | null> {
    if (!this.writer) return null;
    return this.writer.finish(end, () => this.draw());
  }

  cancel() {
    this.writer?.cancel();
  }
}

// ---------------------------------------------------------------------------
// The recorder

type AudioFeed = {
  id: string;
  ownerId: string;
  kind: CallSourceKind;
  stream: MediaStream | null;
  node: MediaStreamAudioSourceNode | null;
  gain: GainNode;
  analyser: AnalyserNode;
  capture: AudioCapture | null;
  present: boolean;
  fileName: string;
  trackName: string;
};

type Meta = { name: string; kind: CallSourceKind; ownerId: string };

// A tile's colour for someone with no picture, from their name — the same
// person gets the same colour for the whole recording.
const CARD_COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#06b6d4", "#ef4444", "#84cc16"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return CARD_COLORS[Math.abs(h) % CARD_COLORS.length];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// The grid that wastes least of the frame for n 16:9 tiles.
function gridFor(n: number, width: number, height: number, gap: number) {
  let best = { cols: 1, rows: 1, w: 0, h: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (width - gap * (cols + 1)) / cols;
    const cellH = (height - gap * (rows + 1)) / rows;
    const w = Math.min(cellW, (cellH * 16) / 9);
    const h = (w * 9) / 16;
    if (w * h > best.w * best.h) best = { cols, rows, w, h };
  }
  return best;
}

export class CallRecorder {
  private lib!: Mediabunny;
  private ctx!: AudioContext;
  private t0 = 0;
  private sampleRate = 48000;
  private keepAlive!: GainNode;
  private mixBus: GainNode | null = null;
  private mixCapture: AudioCapture | null = null;
  private host!: HTMLDivElement;
  private ticker: Worker | null = null;
  private audio = new Map<string, AudioFeed>();
  private feeds = new Map<string, VideoFeed>();
  private captures = new Map<string, VideoCapture>();
  private meta = new Map<string, Meta>();
  private volumes: Record<string, number>;
  private composite: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; writer: VideoWriter } | null = null;
  private aacCodec: AudioCodec | null = null;
  private usedNames = new Set<string>();
  private levelBuffer = new Float32Array(512);
  private stopped = false;
  private startedAt = 0;
  private pending: CallSource[] = [];
  private ready = false;

  constructor(
    private settings: CallRecordingSettings,
    volumes: Record<string, number>,
    private labels: CallRecordingLabels,
  ) {
    this.volumes = { ...volumes };
  }

  private get wantsVideo() {
    return this.settings.output !== "zip";
  }
  private get wantsZip() {
    return this.settings.output !== "video";
  }

  async start(sources: CallSource[]): Promise<void> {
    if (!callRecordingSupported()) throw new CallRecordingUnsupportedError();
    const ctx = getSharedAudioContext();
    if (!ctx) throw new CallRecordingUnsupportedError();
    this.ctx = ctx;
    this.pending = sources;
    await ensureSharedAudioContextRunning();
    const [lib] = await Promise.all([loadLib(), loadWorklet(ctx)]);
    this.lib = lib;
    this.sampleRate = ctx.sampleRate;
    if (this.wantsZip) await loadMp3(lib);

    const mp4 = new lib.Mp4OutputFormat();
    if (this.wantsVideo) {
      this.aacCodec = await lib.getFirstEncodableAudioCodec(mp4.getSupportedAudioCodecs(), {
        numberOfChannels: 2,
        sampleRate: this.sampleRate,
      });
      if (!this.aacCodec) throw new CallRecordingUnsupportedError();
    }
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const width = coarse ? 1280 : 1920;
    const height = coarse ? 720 : 1080;
    const videoCodec = await lib.getFirstEncodableVideoCodec(mp4.getSupportedVideoCodecs(), { width, height });
    if (!videoCodec) throw new CallRecordingUnsupportedError();
    if (this.stopped) return;

    this.host = document.createElement("div");
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.cssText =
      "position:fixed;left:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
    document.body.appendChild(this.host);

    this.keepAlive = ctx.createGain();
    this.keepAlive.gain.value = 0;
    this.keepAlive.connect(ctx.destination);
    this.t0 = ctx.currentTime;
    this.startedAt = Date.now();

    if (!this.settings.separateTracks) {
      this.mixBus = ctx.createGain();
      this.mixCapture = new AudioCapture(ctx, this.t0, this.sampleRate, this.audioWriters(this.labels.audio), this.keepAlive);
      this.mixBus.connect(this.mixCapture.node);
    }

    if (this.wantsVideo) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const c2d = canvas.getContext("2d", { alpha: false });
      if (!c2d) throw new CallRecordingUnsupportedError();
      this.composite = { canvas, ctx: c2d, writer: new VideoWriter(lib, canvas, videoCodec) };
    }

    this.ready = true;
    this.update(this.pending);

    this.ticker = new Worker(TICKER_URL);
    this.ticker.onmessage = () => this.tick();
    this.ticker.postMessage({ fps: FPS });
  }

  elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  private now(): number {
    return Math.max(0, this.ctx.currentTime - this.t0);
  }

  private uniqueName(base: string, ext: string): string {
    const safe = base.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || this.labels.call;
    let name = `${safe}.${ext}`;
    for (let i = 2; this.usedNames.has(name.toLowerCase()); i++) name = `${safe} (${i}).${ext}`;
    this.usedNames.add(name.toLowerCase());
    return name;
  }

  private kindLabel(kind: CallSourceKind): string {
    return kind === "voice"
      ? this.labels.voice
      : kind === "screen"
        ? this.labels.screen
        : kind === "camera"
          ? this.labels.camera
          : this.labels.file;
  }

  private audioWriters(trackName: string): AudioWriter[] {
    const writers: AudioWriter[] = [];
    if (this.wantsVideo && this.aacCodec) {
      writers.push(new AudioWriter(this.lib, "mp4", this.aacCodec, this.sampleRate, trackName));
    }
    if (this.wantsZip) writers.push(new AudioWriter(this.lib, "mp3", "mp3", this.sampleRate, trackName));
    return writers;
  }

  private included(source: CallSource): boolean {
    if (!source.self) return true;
    return source.kind === "voice" ? this.settings.includeMyVoice : this.settings.includeMyScreen;
  }

  /** The room's transmissions right now; call on every change. */
  update(sources: CallSource[]) {
    if (this.stopped) return;
    if (!this.ready) {
      this.pending = sources;
      return;
    }
    const seenAudio = new Set<string>();
    const seenVideo = new Set<string>();
    for (const source of sources) {
      if (!this.included(source)) continue;
      if (!this.meta.has(source.id)) {
        this.meta.set(source.id, { name: source.name, kind: source.kind, ownerId: source.ownerId });
      }
      if (source.kind !== "voice" && !source.audioOnly && source.stream.getVideoTracks().length > 0) {
        seenVideo.add(source.id);
        this.attachVideo(source);
      }
      if (source.stream.getAudioTracks().length > 0) {
        seenAudio.add(source.id);
        this.attachAudio(source);
      }
    }
    for (const [id, feed] of this.feeds) if (!seenVideo.has(id)) feed.detach();
    for (const [id, feed] of this.audio) {
      if (!seenAudio.has(id) && feed.present) {
        feed.present = false;
        feed.node?.disconnect();
        feed.node = null;
        feed.stream = null;
      }
    }
  }

  private attachVideo(source: CallSource) {
    let feed = this.feeds.get(source.id);
    if (!feed) {
      feed = new VideoFeed(this.host);
      this.feeds.set(source.id, feed);
      if (this.wantsZip) {
        const name = this.uniqueName(`${source.name} - ${this.kindLabel(source.kind)}`, "mp4");
        this.captures.set(source.id, new VideoCapture(this.lib, feed, name));
      }
    }
    feed.attach(source.stream);
  }

  private attachAudio(source: CallSource) {
    let feed = this.audio.get(source.id);
    if (!feed) {
      const gain = this.ctx.createGain();
      gain.gain.value = this.volumes[source.id] ?? 1;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = this.levelBuffer.length;
      gain.connect(analyser);
      const trackName = `${source.name} - ${this.kindLabel(source.kind)}`;
      let capture: AudioCapture | null = null;
      if (this.mixBus) gain.connect(this.mixBus);
      else {
        capture = new AudioCapture(this.ctx, this.t0, this.sampleRate, this.audioWriters(trackName), this.keepAlive);
        gain.connect(capture.node);
      }
      feed = {
        id: source.id,
        ownerId: source.ownerId,
        kind: source.kind,
        stream: null,
        node: null,
        gain,
        analyser,
        capture,
        present: false,
        fileName: this.uniqueName(trackName, "mp3"),
        trackName,
      };
      this.audio.set(source.id, feed);
    }
    feed.present = true;
    if (feed.stream === source.stream) return;
    feed.node?.disconnect();
    feed.stream = source.stream;
    try {
      feed.node = this.ctx.createMediaStreamSource(source.stream);
      feed.node.connect(feed.gain);
    } catch {
      feed.node = null;
    }
  }

  setVolume(id: string, volume: number) {
    this.volumes[id] = volume;
    const feed = this.audio.get(id);
    if (feed) feed.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.02);
  }

  private tick() {
    if (this.stopped) return;
    const time = this.now();
    if (this.composite) this.composite.writer.frame(time, 1 / FPS, () => this.drawComposite());
    for (const capture of this.captures.values()) capture.tick(time);
  }

  private speaking(ownerId: string): boolean {
    for (const feed of this.audio.values()) {
      if (feed.kind !== "voice" || feed.ownerId !== ownerId || !feed.present) continue;
      feed.analyser.getFloatTimeDomainData(this.levelBuffer);
      let sum = 0;
      for (let i = 0; i < this.levelBuffer.length; i++) sum += this.levelBuffer[i] * this.levelBuffer[i];
      if (Math.sqrt(sum / this.levelBuffer.length) > 0.02) return true;
    }
    return false;
  }

  // The room as a picture: the transmissions in a grid, or — when nobody is
  // showing anything — a card per person in the call.
  private drawComposite() {
    const composite = this.composite;
    if (!composite) return;
    const { canvas, ctx } = composite;
    const W = canvas.width;
    const H = canvas.height;
    const unit = H / 1080;
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, W, H);

    const videos = [...this.feeds.entries()].filter(([, feed]) => feed.drawable());
    const cards = videos.length
      ? []
      : [...this.audio.values()].filter((feed) => feed.present && feed.kind === "voice");
    const n = videos.length || cards.length;
    if (!n) return;
    const gap = Math.round(16 * unit);
    const grid = gridFor(n, W, H, gap);
    const rowsUsed = Math.ceil(n / grid.cols);
    const top = (H - (rowsUsed * grid.h + (rowsUsed - 1) * gap)) / 2;
    const radius = 14 * unit;
    const font = `600 ${Math.round(Math.max(14, Math.min(28, grid.h * 0.06)))}px system-ui, -apple-system, "Segoe UI", sans-serif`;

    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / grid.cols);
      const inRow = Math.min(grid.cols, n - row * grid.cols);
      const left = (W - (inRow * grid.w + (inRow - 1) * gap)) / 2;
      const x = left + (i % grid.cols) * (grid.w + gap);
      const y = top + row * (grid.h + gap);
      const meta = this.meta.get(videos.length ? videos[i][0] : cards[i].id);
      const name = meta?.name ?? "";
      const talking = meta ? this.speaking(meta.ownerId) : false;

      ctx.save();
      roundRect(ctx, x, y, grid.w, grid.h, radius);
      ctx.fillStyle = "#18181b";
      ctx.fill();
      ctx.clip();
      if (videos.length) {
        drawContain(ctx, videos[i][1].video, x, y, grid.w, grid.h);
      } else {
        const r = Math.min(grid.w, grid.h) * 0.18;
        const cx = x + grid.w / 2;
        const cy = y + grid.h / 2 - r * 0.15;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = colorFor(name);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `700 ${Math.round(r)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(name.trim().slice(0, 1).toUpperCase(), cx, cy + r * 0.05);
        ctx.textAlign = "start";
      }
      ctx.restore();

      if (talking) {
        ctx.save();
        roundRect(ctx, x + 1.5 * unit, y + 1.5 * unit, grid.w - 3 * unit, grid.h - 3 * unit, radius);
        ctx.lineWidth = 4 * unit;
        ctx.strokeStyle = "#10b981";
        ctx.stroke();
        ctx.restore();
      }

      if (name) {
        const label = videos.length && meta && meta.kind !== "screen" ? `${name} · ${this.kindLabel(meta.kind)}` : name;
        ctx.font = font;
        ctx.textBaseline = "middle";
        const padX = 10 * unit;
        const boxH = parseInt(font.split(" ")[1], 10) + 12 * unit;
        const textW = Math.min(ctx.measureText(label).width, grid.w - 40 * unit);
        const bx = x + 10 * unit;
        const by = y + grid.h - boxH - 10 * unit;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        roundRect(ctx, bx, by, textW + padX * 2, boxH, boxH / 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, bx + padX, by + boxH / 2, textW);
      }
    }
  }

  /** Closes every file and puts together what was asked for. */
  async stop(onProgress?: (fraction: number) => void): Promise<CallRecordingResult | null> {
    if (this.stopped) return null;
    this.stopped = true;
    this.ticker?.terminate();
    this.ticker = null;
    if (!this.ready) {
      this.teardown();
      return null;
    }
    const durationMs = Date.now() - this.startedAt;
    const end = this.now();
    const endFrame = Math.round(end * this.sampleRate);
    onProgress?.(0.02);

    // Sound: [aac stem?, mp3?] per capture, in the order audioWriters made them.
    type Track = { blob: Blob | null; name: string; fileName: string };
    const aacStems: Track[] = [];
    const mp3s: Track[] = [];
    const audioCaptures: { capture: AudioCapture; trackName: string; fileName: string }[] = [];
    if (this.mixCapture) {
      audioCaptures.push({
        capture: this.mixCapture,
        trackName: this.labels.audio,
        fileName: this.uniqueName(this.labels.audio, "mp3"),
      });
    }
    for (const feed of this.audio.values()) {
      if (feed.capture) audioCaptures.push({ capture: feed.capture, trackName: feed.trackName, fileName: feed.fileName });
    }
    const audioResults = await Promise.all(
      audioCaptures.map(async ({ capture, trackName, fileName }) => {
        const blobs = await capture.finish(endFrame);
        capture.writers.forEach((writer, i) => {
          const entry = { blob: blobs[i], name: trackName, fileName };
          if (writer.container === "mp4") aacStems.push(entry);
          else mp3s.push(entry);
        });
      }),
    );
    void audioResults;
    onProgress?.(0.3);

    const videoFiles: { name: string; blob: Blob }[] = [];
    for (const capture of this.captures.values()) {
      const blob = await capture.finish(end);
      if (blob) videoFiles.push({ name: capture.fileName, blob });
    }
    onProgress?.(0.5);

    let roomVideo: Blob | null = null;
    if (this.composite) {
      const stem = await this.composite.writer.finish(end, () => this.drawComposite());
      if (stem) {
        roomVideo = await this.remux(
          stem,
          aacStems.filter((t): t is Track & { blob: Blob } => Boolean(t.blob)),
        );
      }
    }
    this.teardown();
    onProgress?.(0.7);

    const stamp = new Date(this.startedAt).toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const base = `${this.labels.call} ${stamp}`;

    if (this.settings.output === "video") {
      onProgress?.(1);
      return roomVideo ? { blob: roomVideo, fileName: `${base}.mp4`, durationMs } : null;
    }

    const files: { name: string; blob: Blob }[] = [];
    if (roomVideo) files.push({ name: this.uniqueName(this.labels.call, "mp4"), blob: roomVideo });
    files.push(...videoFiles);
    for (const mp3 of mp3s) if (mp3.blob) files.push({ name: mp3.fileName, blob: mp3.blob });
    if (!files.length) return null;
    const { buildZip, ZipTooLargeError } = await import("./zipStore");
    try {
      const zip = await buildZip(files, (f) => onProgress?.(0.7 + f * 0.3));
      return { blob: zip, fileName: `${base}.zip`, durationMs };
    } catch (err) {
      if (err instanceof ZipTooLargeError) {
        return { blob: files[0].blob, fileName: files[0].name, durationMs, looseFiles: files.slice(1) };
      }
      throw err;
    }
  }

  // The room's picture and its sound, copied into one MP4 without
  // re-encoding: one audio track per stem, named after its person.
  private async remux(video: Blob, audio: { blob: Blob; name: string }[]): Promise<Blob | null> {
    const lib = this.lib;
    const sink = new BlobSink();
    const output = new lib.Output({ format: new lib.Mp4OutputFormat({ fastStart: false }), target: sink.target(lib) });
    const pumps: (() => Promise<void>)[] = [];
    try {
      const videoInput = new lib.Input({ source: new lib.BlobSource(video), formats: lib.ALL_FORMATS });
      const videoTrack = await videoInput.getPrimaryVideoTrack();
      if (!videoTrack?.codec) return null;
      const videoSource = new lib.EncodedVideoPacketSource(videoTrack.codec);
      output.addVideoTrack(videoSource, { frameRate: FPS });
      const videoConfig = await videoTrack.getDecoderConfig();
      pumps.push(async () => {
        let first = true;
        for await (const packet of new lib.EncodedPacketSink(videoTrack).packets()) {
          await videoSource.add(packet, first && videoConfig ? { decoderConfig: videoConfig } : undefined);
          first = false;
        }
        videoSource.close();
      });

      for (const stem of audio) {
        const input = new lib.Input({ source: new lib.BlobSource(stem.blob), formats: lib.ALL_FORMATS });
        const track = await input.getPrimaryAudioTrack();
        if (!track?.codec) continue;
        const source = new lib.EncodedAudioPacketSource(track.codec);
        output.addAudioTrack(source, { name: stem.name } as unknown as Parameters<Output["addAudioTrack"]>[1]);
        const config = await track.getDecoderConfig();
        pumps.push(async () => {
          let first = true;
          for await (const packet of new lib.EncodedPacketSink(track).packets()) {
            await source.add(packet, first && config ? { decoderConfig: config } : undefined);
            first = false;
          }
          source.close();
        });
      }

      await output.start();
      // Together, not one after the other: the muxer interleaves the tracks
      // and waits on whichever is behind.
      await Promise.all(pumps.map((pump) => pump()));
      await output.finalize();
      return sink.blob("video/mp4");
    } catch {
      await output.cancel().catch(() => {});
      return null;
    }
  }

  /** Throws the recording away. */
  cancel() {
    if (this.stopped) return;
    this.stopped = true;
    this.ticker?.terminate();
    this.ticker = null;
    this.mixCapture?.cancel();
    for (const feed of this.audio.values()) feed.capture?.cancel();
    for (const capture of this.captures.values()) capture.cancel();
    this.composite?.writer.cancel();
    this.teardown();
  }

  private teardown() {
    for (const feed of this.audio.values()) {
      feed.node?.disconnect();
      feed.gain.disconnect();
      feed.analyser.disconnect();
    }
    this.mixBus?.disconnect();
    this.keepAlive?.disconnect();
    for (const feed of this.feeds.values()) feed.dispose();
    this.host?.remove();
    this.audio.clear();
    this.feeds.clear();
  }
}
