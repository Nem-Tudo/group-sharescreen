"use client";

// "Transcrição": what everybody in the call said, as text (Pro Max). The
// room's voices are the same streams "Gravar chamada" records (CallSource,
// see lib/callRecording), and like it this works on each person's own voice
// separately — which is what makes "who said it" free: no model has to guess
// the speaker, every piece of audio already belongs to one.
//
// Per voice:
//   1. the stream goes through the recorder's capture worklet
//      (public/worklets/call-capture.js), which hands back raw PCM;
//   2. it is brought down to 16 kHz mono (what Whisper works in) and cut into
//      utterances by its loudness against that voice's own noise floor —
//      silence is never sent anywhere;
//   3. utterances are gathered for a few seconds and sent together, joined
//      by a short gap (Groq bills each request as at least 10 s, so a "sim"
//      on its own would cost ten times what it says), to the API's
//      /transcribe, which asks Groq's Whisper;
//   4. the answer's segments are put back on the call's clock, one line each.
//
// Translation, when asked for, happens line by line as they arrive, in small
// batches. Nothing is stored anywhere but in this tab.

import { ensureSharedAudioContextRunning, getSharedAudioContext } from "./audioContext";
import { loadWorklet, type CallSource, type CallSourceKind } from "./callRecording";
import { transcribeAudio, type TranscriptApiError } from "./transcriptApi";

export type TranscriptTimestamps = "relative" | "clock" | "none";

export type TranscriptSettings = {
  // "auto", or a code the API knows (pt, en, es…). A fixed one is more
  // accurate: Whisper guesses the language from each few seconds on its own.
  language: string;
  // "none", or the code every line is also translated into.
  translateTo: string;
  // With a translation: keep the original line above it.
  keepOriginal: boolean;
  includeMyVoice: boolean;
  // The sound of screens and videos (a film, a YouTube video) too, not only
  // the microphones.
  includeScreenAudio: boolean;
  // One file per person besides the whole conversation.
  separateFiles: boolean;
  timestamps: TranscriptTimestamps;
  formats: { srt: boolean; vtt: boolean; json: boolean; md: boolean };
  // Consecutive lines of the same person, close together, as one.
  mergeLines: boolean;
  // Names and words Whisper should spell right (a prompt).
  vocabulary: string;
  // The last lines over the room, like subtitles.
  liveCaptions: boolean;
  // A summary of the call (topics, decisions, tasks) at the end.
  summary: boolean;
};

export const DEFAULT_TRANSCRIPT_SETTINGS: TranscriptSettings = {
  language: "auto",
  translateTo: "none",
  keepOriginal: true,
  includeMyVoice: true,
  includeScreenAudio: false,
  separateFiles: false,
  timestamps: "clock",
  formats: { srt: false, vtt: false, json: false, md: false },
  mergeLines: true,
  vocabulary: "",
  liveCaptions: false,
  summary: false,
};

export const TRANSCRIPT_LANGUAGES = [
  "pt",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "nl",
  "pl",
  "ru",
  "uk",
  "tr",
  "ar",
  "hi",
  "ja",
  "ko",
  "zh",
  "id",
  "vi",
  "sv",
] as const;

export type TranscriptEntry = {
  id: number;
  sourceId: string;
  ownerId: string;
  name: string;
  self: boolean;
  kind: CallSourceKind;
  // Wall-clock milliseconds (Date.now()'s scale).
  at: number;
  end: number;
  text: string;
  translation?: string;
};

export type TranscriberError = Extract<
  TranscriptApiError,
  "account-required" | "pro-max-required" | "not-configured" | "daily-limit"
> | "unsupported";

const RATE = 16_000;
const FRAME = 320; // 20 ms
const PREROLL_FRAMES = 15; // 300 ms kept from before the voice started
const END_SILENCE_FRAMES = 40; // 800 ms of quiet ends an utterance
const KEEP_TAIL_FRAMES = 10; // …of which 200 ms are kept
const MAX_UTTERANCE_FRAMES = 1_250; // 25 s: longer is cut and goes on
const MIN_VOICED_FRAMES = 12; // under 240 ms of voice is a click, not a word
const LIVE_END_SILENCE_FRAMES = 18; // 360 ms in real-time mode
const LIVE_MAX_UTTERANCE_FRAMES = 400; // 8 s in real-time mode
const BATCH_TARGET_S = 12;
const BATCH_MAX_S = 30;
const BATCH_WAIT_MS = 6_000; // the longest a finished utterance waits for company
const BATCH_GAP_S = 0.5;
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;

// What Whisper writes over silence and noise, learned from subtitles of
// videos: never somebody in a call.
const HALLUCINATIONS = new Set(
  [
    "obrigado por assistir",
    "obrigada por assistir",
    "obrigado por assistir ao vídeo",
    "inscrevase no canal",
    "legendas pela comunidade amaraorg",
    "legenda adriana zanotto",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "subtitles by the amaraorg community",
    "gracias por ver",
    "gracias por ver el video",
    "subtítulos realizados por la comunidad de amaraorg",
    "suscríbete",
    "sous-titres réalisés para la communauté damaraorg",
    "untertitel im auftrag des zdf",
  ].map(normalize),
);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isHallucination(text: string): boolean {
  const n = normalize(text);
  return !n || HALLUCINATIONS.has(n) || n.includes("amaraorg");
}

export function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

type Utterance = { start: number; samples: Float32Array };

// One voice, down to 16 kHz and cut where it stops talking. Times are the
// audio graph's clock (AudioContext.currentTime).
export class Segmenter {
  private ratio: number;
  private phase = 0;
  private sum = 0;
  private count = 0;
  private clock: number | null = null;
  private frame = new Float32Array(FRAME);
  private filled = 0;
  private frameStart = 0;
  private floor = 0.003;
  private preroll: { data: Float32Array; t: number }[] = [];
  private active: { data: Float32Array; t: number }[] | null = null;
  private voiced = 0;
  private silentRun = 0;
  // Real-time mode (live captions, translation): a shorter pause ends a
  // sentence and a monologue is cut more often, so text arrives sooner.
  live = false;

  constructor(
    inputRate: number,
    private emit: (utterance: Utterance) => void,
  ) {
    this.ratio = inputRate / RATE;
  }

  push(time: number, left: Float32Array, right: Float32Array) {
    const inputRate = this.ratio * RATE;
    // The worklet's chunks are continuous; a jump means the graph stalled
    // (a background tab), and the chunk's own time is the truth.
    if (this.clock === null || Math.abs(time - this.clock) > 0.25) this.clock = time;
    for (let i = 0; i < left.length; i++) {
      this.sum += (left[i] + right[i]) / 2;
      this.count++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        this.sample(this.sum / this.count, time + i / inputRate);
        this.sum = 0;
        this.count = 0;
      }
    }
    this.clock = time + left.length / inputRate;
  }

  private sample(value: number, t: number) {
    if (this.filled === 0) this.frameStart = t;
    this.frame[this.filled++] = value;
    if (this.filled === FRAME) {
      this.onFrame(this.frame.slice(), this.frameStart);
      this.filled = 0;
    }
  }

  private onFrame(data: Float32Array, t: number) {
    let energy = 0;
    for (let i = 0; i < data.length; i++) energy += data[i] * data[i];
    const rms = Math.sqrt(energy / data.length);
    const speech = rms > Math.max(0.006, this.floor * 3.5);
    // The floor follows quiet quickly and loud only very slowly, so a long
    // sentence does not become the new "silence".
    this.floor = rms < this.floor ? this.floor * 0.9 + rms * 0.1 : this.floor * 0.9995 + rms * 0.0005;
    this.floor = Math.max(0.0005, this.floor);

    const piece = { data, t };
    if (!this.active) {
      if (speech) {
        this.active = [...this.preroll, piece];
        this.preroll = [];
        this.voiced = 1;
        this.silentRun = 0;
      } else {
        this.preroll.push(piece);
        if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      }
      return;
    }
    this.active.push(piece);
    if (speech) {
      this.voiced++;
      this.silentRun = 0;
    } else {
      this.silentRun++;
    }
    if (this.silentRun >= (this.live ? LIVE_END_SILENCE_FRAMES : END_SILENCE_FRAMES)) {
      this.finish(this.silentRun - KEEP_TAIL_FRAMES);
    } else if (this.active.length >= (this.live ? LIVE_MAX_UTTERANCE_FRAMES : MAX_UTTERANCE_FRAMES)) {
      // Still talking: cut here and go straight on into the next one.
      this.finish(0);
      this.active = [];
      this.voiced = 0;
    }
  }

  /** Ends the utterance in progress, dropping `dropTail` frames of trailing quiet. */
  finish(dropTail = Math.max(0, this.silentRun - KEEP_TAIL_FRAMES)) {
    const frames = this.active;
    const voiced = this.voiced;
    this.active = null;
    this.voiced = 0;
    this.silentRun = 0;
    if (!frames?.length || voiced < MIN_VOICED_FRAMES) return;
    const kept = frames.slice(0, Math.max(1, frames.length - dropTail));
    const samples = new Float32Array(kept.length * FRAME);
    kept.forEach((f, i) => samples.set(f.data, i * FRAME));
    this.emit({ start: kept[0].t, samples });
  }
}

type Meta = { sourceId: string; ownerId: string; name: string; self: boolean; kind: CallSourceKind };

type Voice = {
  meta: Meta;
  stream: MediaStream | null;
  tracks: string;
  node: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode;
  segmenter: Segmenter;
  batch: Utterance[];
  batchSeconds: number;
  oldestEnd: number;
};

type Job = { meta: Meta; pieces: { start: number; offset: number; seconds: number }[]; wav: Blob; attempts: number };

export type TranscriberOptions = {
  // "auto" or a language code (see TRANSCRIPT_LANGUAGES).
  language: string;
  // Names and words to spell right.
  vocabulary: string;
  // Real-time: every sentence is sent the moment it ends, instead of waiting
  // a few seconds for company (cheaper, but seconds later).
  live: boolean;
};

export type TranscriberCallbacks = {
  // One line, as soon as it is known — with the language Whisper heard.
  onEntry: (entry: TranscriptEntry, language: string | null) => void;
  onPending: (pending: number) => void;
  // A reason every further request would fail the same way: nothing more is
  // sent.
  onFatal: (error: TranscriberError) => void;
  // Pieces that could not be transcribed after retrying.
  onLost: (count: number) => void;
};

/**
 * Turns the voices it is told to (see setFilter) into lines of text. Owned
 * by lib/liveTranscriptShare, which decides which voices this browser is the
 * one to transcribe for the whole room.
 */
export class CallTranscriber {
  private ctx!: AudioContext;
  private t0 = 0;
  private wallStart = 0;
  private keepAlive!: GainNode;
  private voices = new Map<string, Voice>();
  private nextId = 1;
  private queue: Job[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private fatal = false;
  private ready = false;
  private latest: CallSource[] = [];
  private filter: (source: CallSource) => boolean = () => false;
  private lost = 0;
  private names = new Map<string, string>();

  constructor(
    private options: TranscriberOptions,
    private callbacks: TranscriberCallbacks,
  ) {}

  get startedAtWall(): number {
    return this.wallStart;
  }

  get pending(): number {
    return this.queue.length + this.running;
  }

  get failed(): boolean {
    return this.fatal;
  }

  async start(sources: CallSource[]): Promise<void> {
    this.latest = sources;
    if (typeof AudioWorkletNode === "undefined") throw new Error("unsupported");
    const ctx = getSharedAudioContext();
    if (!ctx) throw new Error("unsupported");
    this.ctx = ctx;
    await ensureSharedAudioContextRunning();
    await loadWorklet(ctx);
    if (this.stopped) return;
    this.keepAlive = ctx.createGain();
    this.keepAlive.gain.value = 0;
    this.keepAlive.connect(ctx.destination);
    this.t0 = ctx.currentTime;
    this.wallStart = Date.now();
    this.ready = true;
    this.update(this.latest);
    this.timer = setInterval(() => this.tick(), 1_000);
  }

  configure(options: Partial<TranscriberOptions>) {
    const wasLive = this.options.live;
    this.options = { ...this.options, ...options };
    if (this.options.live !== wasLive) {
      for (const voice of this.voices.values()) {
        voice.segmenter.live = this.options.live;
        if (this.options.live) this.flushBatch(voice);
      }
    }
  }

  /** Which of the room's sources this browser transcribes. */
  setFilter(filter: (source: CallSource) => boolean) {
    this.filter = filter;
    this.update(this.latest);
  }

  private wall(ctxTime: number): number {
    return Math.round(this.wallStart + (ctxTime - this.t0) * 1000);
  }

  /** The room's transmissions right now; call on every change. */
  update(sources: CallSource[]) {
    this.latest = sources;
    if (!this.ready || this.stopped) return;
    const seen = new Set<string>();
    for (const source of sources) {
      this.names.set(source.ownerId, source.name);
      if (this.fatal || !this.filter(source)) continue;
      const tracks = source.stream
        .getAudioTracks()
        .filter((t) => t.readyState === "live")
        .map((t) => t.id)
        .join(",");
      if (!tracks) continue;
      seen.add(source.id);
      let voice = this.voices.get(source.id);
      if (!voice) voice = this.addVoice(source);
      voice.meta.name = source.name;
      if (voice.stream === source.stream && voice.tracks === tracks) continue;
      voice.node?.disconnect();
      voice.stream = source.stream;
      voice.tracks = tracks;
      try {
        voice.node = this.ctx.createMediaStreamSource(source.stream);
        voice.node.connect(voice.worklet);
      } catch {
        voice.node = null;
      }
    }
    for (const [id, voice] of this.voices) {
      if (seen.has(id)) continue;
      this.removeVoice(voice);
      this.voices.delete(id);
    }
  }

  private addVoice(source: CallSource): Voice {
    const worklet = new AudioWorkletNode(this.ctx, "golive-call-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    worklet.connect(this.keepAlive);
    const voice: Voice = {
      meta: { sourceId: source.id, ownerId: source.ownerId, name: source.name, self: source.self, kind: source.kind },
      stream: null,
      tracks: "",
      node: null,
      worklet,
      segmenter: null as unknown as Segmenter,
      batch: [],
      batchSeconds: 0,
      oldestEnd: 0,
    };
    voice.segmenter = new Segmenter(this.ctx.sampleRate, (u) => this.onUtterance(voice, u));
    voice.segmenter.live = this.options.live;
    worklet.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { time?: number; left?: Float32Array; right?: Float32Array };
      if (data.left && data.right && typeof data.time === "number") voice.segmenter.push(data.time, data.left, data.right);
    };
    this.voices.set(source.id, voice);
    return voice;
  }

  private removeVoice(voice: Voice) {
    voice.segmenter.finish();
    this.flushBatch(voice);
    voice.node?.disconnect();
    voice.worklet.port.onmessage = null;
    voice.worklet.disconnect();
  }

  private onUtterance(voice: Voice, utterance: Utterance) {
    const seconds = utterance.samples.length / RATE;
    if (voice.batch.length && voice.batchSeconds + seconds + BATCH_GAP_S > BATCH_MAX_S) this.flushBatch(voice);
    if (!voice.batch.length) voice.oldestEnd = Date.now();
    voice.batch.push(utterance);
    voice.batchSeconds += seconds + (voice.batch.length > 1 ? BATCH_GAP_S : 0);
    if (this.options.live || voice.batchSeconds >= BATCH_TARGET_S) this.flushBatch(voice);
  }

  private tick() {
    const now = Date.now();
    for (const voice of this.voices.values()) {
      if (voice.batch.length && now - voice.oldestEnd >= BATCH_WAIT_MS) this.flushBatch(voice);
    }
  }

  private flushBatch(voice: Voice) {
    if (!voice.batch.length) return;
    const batch = voice.batch;
    voice.batch = [];
    voice.batchSeconds = 0;
    if (this.fatal) return;
    const gap = Math.round(BATCH_GAP_S * RATE);
    const total = batch.reduce((n, u) => n + u.samples.length, 0) + gap * (batch.length - 1);
    const samples = new Float32Array(total);
    const pieces: Job["pieces"] = [];
    let offset = 0;
    for (const u of batch) {
      samples.set(u.samples, offset);
      pieces.push({ start: u.start, offset: offset / RATE, seconds: u.samples.length / RATE });
      offset += u.samples.length + gap;
    }
    this.queue.push({ meta: { ...voice.meta }, pieces, wav: encodeWav(samples), attempts: 0 });
    this.pump();
  }

  private prompt(): string {
    const names = [...new Set(this.names.values())].slice(0, 20).join(", ");
    const parts = [this.options.vocabulary.trim(), names].filter(Boolean);
    return parts.join(". ").slice(0, 600);
  }

  private settle() {
    if (this.running || this.queue.length) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((w) => w());
  }

  private pump() {
    if (this.fatal) this.queue = [];
    this.callbacks.onPending(this.pending);
    // Real-time work goes first: the newest sentence is the one somebody is
    // waiting to read.
    while (this.running < CONCURRENCY && this.queue.length) {
      const job = this.options.live ? this.queue.pop()! : this.queue.shift()!;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
        this.settle();
      });
    }
    this.settle();
  }

  private async run(job: Job): Promise<void> {
    const language = this.options.language === "auto" ? null : this.options.language;
    for (;;) {
      job.attempts++;
      const result = await transcribeAudio(job.wav, language, this.prompt());
      if (result.ok) {
        this.addSegments(job, result.value.segments, result.value.language);
        return;
      }
      const error = result.error;
      if (
        error === "account-required" ||
        error === "pro-max-required" ||
        error === "not-configured" ||
        error === "daily-limit"
      ) {
        if (!this.fatal) {
          this.fatal = true;
          this.callbacks.onFatal(error);
        }
        return;
      }
      if (error === "bad-audio" || job.attempts >= MAX_ATTEMPTS || this.stopped) {
        this.lost++;
        this.callbacks.onLost(this.lost);
        return;
      }
      const wait = error === "busy" ? (result.retryAfter ?? 5) * 1000 : 1500 * job.attempts;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private addSegments(job: Job, segments: { start: number; end: number; text: string }[], language: string | null) {
    for (const segment of segments) {
      if (isHallucination(segment.text)) continue;
      // Which utterance of the batch this segment starts in, and so where on
      // the call's clock it really was.
      let piece = job.pieces[0];
      for (const p of job.pieces) if (p.offset <= segment.start + 0.05) piece = p;
      const into = Math.min(Math.max(0, segment.start - piece.offset), piece.seconds);
      const length = Math.max(0.3, segment.end - segment.start);
      const start = piece.start + into;
      const entry: TranscriptEntry = {
        id: this.nextId++,
        sourceId: job.meta.sourceId,
        ownerId: job.meta.ownerId,
        name: job.meta.name,
        self: job.meta.self,
        kind: job.meta.kind,
        at: this.wall(start),
        end: this.wall(start + Math.min(length, piece.seconds - into + 0.5)),
        text: segment.text,
      };
      this.callbacks.onEntry(entry, language);
    }
  }

  /** Finishes what is already on its way, then stops. */
  async stop(timeoutMs = 60_000): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.ready) {
      for (const voice of this.voices.values()) this.removeVoice(voice);
      this.voices.clear();
      this.keepAlive.disconnect();
    }
    const idle = new Promise<void>((resolve) => {
      if (!this.running && !this.queue.length) resolve();
      else this.idleWaiters.push(resolve);
    });
    await Promise.race([idle, new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** Stops at once, keeping nothing that was still on its way. */
  cancel() {
    this.fatal = true;
    void this.stop(0);
  }
}
