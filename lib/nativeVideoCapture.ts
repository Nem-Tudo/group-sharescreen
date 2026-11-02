"use client";

// A screen share captured and encoded on the GPU by the desktop app — the
// page's half. An experiment, behind the NATIVE_VIDEO_FEATURE rollout.
//
// Why
// ---
// Chromium's own share copies every frame off the GPU and encodes it at
// normal priority, next to a game that wants the whole machine; the share
// stutters exactly while the game is in front. The desktop app can instead
// run golive-videocap, which captures, scales and encodes without the frame
// ever leaving the GPU, at raised priority, and hands over finished H.264
// (see electron/native/src/videocap.cpp).
//
// How that H.264 reaches the peers
// --------------------------------
// WebRTC in the browser only accepts raw frames, so each peer connection gets
// a stand-in: a 16x16 track (a MediaStreamTrackGenerator) whose frames are
// encoded as usual, and whose encoded output is intercepted (encoded
// insertable streams) and replaced, frame for frame, with the helper's. The
// peers decode the helper's stream; everything else — signalling, congestion
// control, retransmission — is the ordinary path.
//
// That swap only works if the two streams stay in step, which is what
// SenderSink is about (lib/nativeVideoSink.ts, run in a worker so the page's
// main thread cannot hold the picture still), and what was worked out by
// experiment:
//
//   - One stand-in frame is written per helper frame, and the next only once
//     the previous has come out of the encoder ("lockstep"). The encoder's
//     output is the only place a frame can be matched to what went in: the
//     RTP timestamp does not follow the frame's own timestamp.
//   - The receiver trusts the stand-in's frame dependencies, not the payload.
//     A frame dropped anywhere breaks that chain, so nothing is ever dropped
//     inside the transform; a sender that falls out of step waits for the next
//     IDR instead.
//   - A receiver that lost the picture asks for a keyframe, and only takes one
//     the stand-in marked as such. So a stand-in keyframe is held until the
//     helper produces a fresh IDR to put in it.
//   - Every IDR carries its SPS/PPS (see ParameterSetKeeper); without them a
//     viewer cannot start on it.
//
// One encoded stream goes to everyone, so its bitrate follows the weakest
// direct link (nativeTargetKbps) — the single-stream trade Discord makes —
// instead of the per-viewer tiers of the ordinary path.

import { getDesktopBridge } from "./desktop";
import { noteGpuShareEnded } from "./gpuShareSurvey";
import type { NativeSinkStats } from "./nativeVideoSink";
import {
  ParameterSetKeeper,
  codecStringFromSps,
  nativeBitrateCommand,
  nativeTargetKbps,
  type NativeFrameMeta,
} from "./nativeVideoFrames";

export type { NativeSinkStats } from "./nativeVideoSink";

/** The rollout this path is behind (see lib/features.ts). */
export const NATIVE_VIDEO_FEATURE = "native-video-capture";

/**
 * Keeping chosen applications out of the *picture* of a screen share — the
 * black rectangle with "Oculto pelo usuário" written across it. A separate
 * rollout from the capture it rides on, because it is a separate thing to
 * offer somebody, but it can only exist on top of it: covering a window is
 * something the helper does while it encodes, and Chromium's capture has no
 * equivalent (see HiddenWindows in electron/native/src/videocap.cpp).
 */
export const HIDDEN_WINDOWS_FEATURE = "hidden-windows";

/** Counted on the website, where the picker that collects them cannot reach. */
export const HIDDEN_WINDOWS_EVENTS = {
  /** The picker's panel was opened on the way to this share. */
  open: "hidden_windows_open",
  /** A share went out with windows covered. value: how many applications. */
  share: "hidden_windows_share",
} as const;

/**
 * Tells the shell whether a share from this page would go through the helper,
 * which is what decides whether the picker offers to hide anything. Safe to
 * call anywhere: it does nothing outside the desktop app.
 */
export function setNativeVideoIntent(wanted: boolean): void {
  getDesktopBridge()?.nativeVideo?.setIntent?.(wanted);
}

/**
 * The experiment's treatments, as named in the admin panel. Any other name
 * is treated as `forced`.
 *
 *   forced   — always used where the machine can; no switch.
 *   opt-in   — a switch in the quality panel, off until turned on.
 *   opt-out  — the same switch, on until turned off.
 */
export const NATIVE_VIDEO_VARIANTS = {
  forced: "forced",
  optIn: "opt-in",
  optOut: "opt-out",
} as const;

// Chromium's non-standard main-thread generator. Not in the DOM typings.
interface TrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}
declare const MediaStreamTrackGenerator: {
  new (init: { kind: "video" }): TrackGenerator;
};

// Chromium's legacy encoded insertable streams. Not in the DOM typings either.
interface EncodedStreams {
  readable: ReadableStream<unknown>;
  writable: WritableStream<unknown>;
}
type SenderWithStreams = RTCRtpSender & { createEncodedStreams?: () => EncodedStreams };

interface NativeFrame {
  data: Uint8Array;
  key: boolean;
}

// Generated from lib/nativeVideoSink.worker.ts (see lib/nativeVideoSink.build.mjs).
// Bump the version whenever it changes: a browser goes on using the one it has.
const SINK_WORKER_VERSION = 1;
const SINK_WORKER_URL = `/workers/native-video-sink.js?v=${SINK_WORKER_VERSION}`;

// Far past any frame rate there is: see MIN_WRITE_GAP_MS in lib/nativeVideoSink.
const NATIVE_SENDER_MAX_FPS = 1000;

// One helper encoder serves every viewer, so each viewer's keyframe request is
// an IDR — several times a normal frame, at a constant bitrate — for all of
// them; with ten viewers a shorter gap would let several through a second.
// Requests are coalesced to one IDR a second, and one that lands inside the gap
// is answered at its end instead of being dropped.
const KEY_REQUEST_GAP_MS = 1000;

const sinkStats = new WeakMap<RTCPeerConnection, NativeSinkStats>();

/** This connection's GPU-capture counters, or null when it carries no GPU capture. */
export function nativeSinkStats(pc: RTCPeerConnection): NativeSinkStats | null {
  return sinkStats.get(pc) ?? null;
}

const pausedSinks = new WeakSet<RTCPeerConnection>();

/** Whether this connection's viewer is not looking, so no GPU capture is going to them. */
export function nativeSinkPaused(pc: RTCPeerConnection): boolean {
  return pausedSinks.has(pc);
}
// How often the links are sampled. Deliberately not the 2000 ms of the shared
// mediaStats pump: two timers on the same period land on the same tick for
// minutes on end.
const BITRATE_INTERVAL_MS = 2500;
// getStats() calls per pass. A pass has to cost the same in a room of thirty as
// in a room of three. The peers this pass skips are read by the next ones, and
// their previous reading stands in the meantime (see adjustBitrate).
const STATS_PER_PASS = 3;
// How much of each new reading goes into the running estimate. The bandwidth
// estimator probes upward and backs off continuously; fed in raw, its swing
// is the thing that decides the encoder's bitrate.
const BITRATE_SMOOTHING = 0.3;

function hasPlatformSupport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof VideoDecoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    "MediaStreamTrackGenerator" in window &&
    typeof (RTCRtpSender.prototype as SenderWithStreams).createEncodedStreams === "function"
  );
}

/** Whether this is a desktop app that shipped the helper, in a capable renderer. */
export function hasNativeVideoBridge(): boolean {
  return Boolean(getDesktopBridge()?.nativeVideo) && hasPlatformSupport();
}

let probed: Promise<boolean> | null = null;
// Set once a native share has failed in a way worth not repeating this
// session: the next share goes the ordinary way.
let disabledForSession = false;

/** Asks the shell whether this machine can do it. Cached; safe to call early. */
export function probeNativeVideo(): Promise<boolean> {
  const bridge = getDesktopBridge()?.nativeVideo;
  if (!bridge || !hasPlatformSupport()) return Promise.resolve(false);
  probed ??= bridge.probe().then(
    (result) => result.supported,
    () => false
  );
  return probed;
}

const sources = new WeakMap<MediaStreamTrack, NativeVideoSource>();

/** The native source behind a share's video track, if it is one. */
export function nativeVideoSourceFor(track: MediaStreamTrack | undefined | null): NativeVideoSource | undefined {
  return track ? sources.get(track) : undefined;
}

/**
 * How the helper captures a whole screen: Desktop Duplication, which draws no
 * frame around it, or Windows Graphics Capture, which on Windows 10 draws a
 * yellow one. A window is always captured with the latter.
 */
export type NativeVideoMethod = "duplication" | "wgc";

export interface NativeVideoOptions {
  maxWidth: number;
  maxHeight: number;
  fps: number;
  bitrateKbps: number;
  captureMethod: NativeVideoMethod;
}

/**
 * Starts the GPU capture of the surface the last getDisplayMedia was answered
 * with, and returns the track that stands for it in the share's stream — a
 * local preview; what the peers receive is attached per connection (see
 * NativeVideoSource.attach). Null whenever it cannot be had, in which case
 * the caller keeps Chromium's capture.
 */
export type NativeVideoStart =
  | {
      source: NativeVideoSource;
      failure?: undefined;
      /** What the picker settled on for this share, for the statistics. */
      hidden?: { count: number; panelOpened: boolean };
    }
  | { source: null; failure: string | null; hidden?: undefined };

export async function startNativeVideo(options: NativeVideoOptions): Promise<NativeVideoStart> {
  const bridge = getDesktopBridge()?.nativeVideo;
  if (!bridge || disabledForSession) return { source: null, failure: null };
  if (!(await probeNativeVideo())) return { source: null, failure: "unsupported" };
  // Subscribed before asking, so the first frames — which arrive before the
  // answer does — are not lost.
  const source = new NativeVideoSource(options.bitrateKbps);
  const result = await bridge.start({ ...options, framePort: Boolean(bridge.framePort) }).catch(() => null);
  if (!result || !result.ok) {
    source.stop();
    // Anything but a missing surface is this machine's answer, and asking
    // again in the same session would only put the person through it twice.
    if (!result || result.reason !== "no-source") disabledForSession = true;
    const failure = result ? `${result.reason}${result.detail ? `: ${result.detail}` : ""}` : "no answer";
    console.warn("[golive] GPU capture unavailable, using the browser's:", failure);
    return { source: null, failure: result?.reason ?? "failed" };
  }
  source.started(result.encoder);
  sources.set(source.track, source);
  console.info(`[golive] GPU capture: ${result.width}x${result.height} via ${result.encoder}`);
  return { source, hidden: result.hidden };
}

/** The connection a stand-in track is on, as the page sees it. */
interface Sink {
  id: number;
  pc: RTCPeerConnection;
  track: TrackGenerator;
  /** This link's bandwidth estimate in kbps; null while unknown or not up. */
  lastAvailableKbps: number | null;
  /** The viewer is not looking, so nothing is being sent to them. */
  paused: boolean;
  onState: () => void;
}

/** What a shell posts to the page's window with the frame port attached. */
const NATIVE_FRAME_PORT_MESSAGE = "golive:native-video-frame-port";

export class NativeVideoSource {
  /** The share's video track: a local preview of what is being sent. */
  readonly track: TrackGenerator;
  encoder = "";

  private readonly bridge = getDesktopBridge()!.nativeVideo!;
  private readonly worker: Worker;
  private readonly sinks = new Map<number, Sink>();
  private nextSinkId = 1;
  private readonly preview: Preview;
  private readonly unsubscribe: () => void;
  private readonly bitrateTimer: ReturnType<typeof setInterval>;
  private readonly onPortMessage: ((event: MessageEvent) => void) | null = null;
  private adjusting = false;
  private ceilingKbps: number;
  private currentKbps: number;
  private smoothedKbps = 0;
  private lastRaise = 0;
  private statsCursor = 0;
  private lastKeyRequest = 0;
  private keyTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(ceilingKbps: number) {
    this.ceilingKbps = ceilingKbps;
    this.currentKbps = ceilingKbps;
    this.track = new MediaStreamTrackGenerator({ kind: "video" });
    this.preview = new Preview(this.track, () => this.requestKeyFrame());
    this.worker = new Worker(SINK_WORKER_URL);
    this.worker.onmessage = (event: MessageEvent) => this.onWorkerMessage(event.data);
    this.worker.postMessage({ type: "preview", active: true });
    // A shell new enough to hand frames straight to the worker sends this port
    // when the capture starts (see electron/nativeVideo.ts). Older ones go on
    // delivering to onFrame below, one hop through this thread.
    if (this.bridge.framePort) {
      this.onPortMessage = (event: MessageEvent) => {
        if (event.source !== window || event.data !== NATIVE_FRAME_PORT_MESSAGE || !event.ports[0]) return;
        this.worker.postMessage({ type: "port", port: event.ports[0] }, [event.ports[0]]);
      };
      window.addEventListener("message", this.onPortMessage);
    }
    this.unsubscribe = this.bridge.onFrame(
      (meta, data) => this.onFrame(meta, data),
      (reason) => this.onEnded(reason)
    );
    this.bitrateTimer = setInterval(() => {
      // One pass at a time: getStats on a loaded machine can outlast the
      // interval, and two passes would read the same counters.
      if (this.adjusting) return;
      this.adjusting = true;
      void this.adjustBitrate().finally(() => {
        this.adjusting = false;
      });
    }, BITRATE_INTERVAL_MS);
    // The share's teardown stops every track in its stream without knowing
    // where they came from (see stop() in useRoomMedia's useBroadcastChannel);
    // this is what makes that enough to end the helper too.
    const stopTrack = this.track.stop.bind(this.track);
    this.track.stop = () => {
      this.stop();
      stopTrack();
    };
  }

  /** The helper answered that it is running. */
  started(encoder: string): void {
    this.encoder = encoder;
    // Its first IDR may have gone out before the page was listening.
    this.requestKeyFrame();
  }

  /**
   * Puts this capture on a peer connection. The connection must have been
   * built with `encodedInsertableStreams: true`, and then every other sender
   * on it must go through passThrough.
   */
  attach(pc: RTCPeerConnection, stream: MediaStream): RTCRtpSender {
    const track = new MediaStreamTrackGenerator({ kind: "video" });
    this.nextSinkId += 1;
    const id = this.nextSinkId;
    const sender = pc.addTrack(track, stream);
    const streams = (sender as SenderWithStreams).createEncodedStreams?.();
    const writable = track.writable;
    if (streams) {
      this.worker.postMessage(
        { type: "sink", id, writable, encodedReadable: streams.readable, encodedWritable: streams.writable },
        [writable, streams.readable, streams.writable] as unknown as Transferable[]
      );
    }
    const sink: Sink = {
      id,
      pc,
      track,
      lastAvailableKbps: null,
      paused: false,
      onState: () => this.onConnectionState(sink),
    };
    this.sinks.set(id, sink);
    pc.addEventListener("connectionstatechange", sink.onState);
    sink.onState();
    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    if (transceiver) preferH264(transceiver);
    void configureSender(sender, this.ceilingKbps);
    return sender;
  }

  /** For every other sender on a connection carrying this capture. */
  passThrough(sender: RTCRtpSender): void {
    const streams = (sender as SenderWithStreams).createEncodedStreams?.();
    if (!streams) return;
    this.worker.postMessage(
      { type: "passthrough", readable: streams.readable, writable: streams.writable },
      [streams.readable, streams.writable] as unknown as Transferable[]
    );
  }

  /** A viewer stopped looking, or came back (see qualityNegotiation's idle request). */
  setViewerPaused(pc: RTCPeerConnection, paused: boolean): void {
    for (const sink of this.sinks.values()) {
      if (sink.pc !== pc || sink.paused === paused) continue;
      sink.paused = paused;
      if (paused) pausedSinks.add(pc);
      else pausedSinks.delete(pc);
      this.worker.postMessage({ type: "paused", id: sink.id, paused });
    }
  }

  /** This connection is going away. */
  detach(pc: RTCPeerConnection): void {
    for (const sink of [...this.sinks.values()]) if (sink.pc === pc) this.closeSink(sink);
  }

  private closeSink(sink: Sink) {
    if (!this.sinks.delete(sink.id)) return;
    sink.lastAvailableKbps = null;
    sink.pc.removeEventListener("connectionstatechange", sink.onState);
    this.worker.postMessage({ type: "close", id: sink.id });
  }

  private onConnectionState(sink: Sink) {
    const state = sink.pc.connectionState;
    if (state === "closed") {
      this.closeSink(sink);
      return;
    }
    this.worker.postMessage({ type: "state", id: sink.id, connected: state === "connected" });
  }

  private onWorkerMessage(message: {
    type: string;
    key?: boolean;
    data?: ArrayBuffer;
    stats?: Array<{ id: number } & NativeSinkStats>;
  }) {
    if (this.stopped) return;
    if (message.type === "need-key") {
      this.requestKeyFrame();
    } else if (message.type === "preview-frame" && message.data) {
      this.preview.push({ key: message.key === true, data: new Uint8Array(message.data) });
    } else if (message.type === "stats" && message.stats) {
      for (const { id, ...stats } of message.stats) {
        const sink = this.sinks.get(id);
        if (sink) sinkStats.set(sink.pc, stats);
      }
    }
  }

  /** The share's bitrate dial moved. */
  setCeiling(kbps: number): void {
    if (kbps === this.ceilingKbps) return;
    this.ceilingKbps = kbps;
    // A dial somebody moved, not a reading: it applies now rather than being
    // smoothed towards over the next half minute. Only downwards — a raised
    // ceiling is still only permission to use the link, not evidence that it
    // is there.
    if (this.smoothedKbps > kbps) this.smoothedKbps = kbps;
    void this.adjustBitrate();
  }

  requestKeyFrame(): void {
    if (this.stopped) return;
    const now = performance.now();
    const wait = KEY_REQUEST_GAP_MS - (now - this.lastKeyRequest);
    if (wait > 0) {
      this.keyTimer ??= setTimeout(() => {
        this.keyTimer = null;
        this.requestKeyFrame();
      }, wait);
      return;
    }
    this.lastKeyRequest = now;
    this.bridge.control({ keyFrame: true });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // Every way a GPU share ends comes through here — the button in the room,
    // Windows' own "parar de compartilhar", the helper dying — which is why
    // the survey is armed from here and not from the room's stop handler.
    noteGpuShareEnded();
    if (this.keyTimer) clearTimeout(this.keyTimer);
    this.keyTimer = null;
    clearInterval(this.bitrateTimer);
    this.unsubscribe();
    if (this.onPortMessage) window.removeEventListener("message", this.onPortMessage);
    this.bridge.stop();
    this.worker.postMessage({ type: "stop" });
    for (const sink of this.sinks.values()) sink.pc.removeEventListener("connectionstatechange", sink.onState);
    this.sinks.clear();
    this.preview.close();
    // Past the sinks closing their streams.
    setTimeout(() => this.worker.terminate(), 1000);
  }

  /** Whether our own preview of this share is on screen. See Preview.setActive. */
  setPreviewActive(active: boolean) {
    this.preview.setActive(active);
    this.worker.postMessage({ type: "preview", active });
  }

  private onFrame(meta: NativeFrameMeta, raw: Uint8Array) {
    if (this.stopped) return;
    const whole = raw.byteOffset === 0 && raw.byteLength === raw.buffer.byteLength;
    const buffer = (whole ? raw.buffer : raw.slice().buffer) as ArrayBuffer;
    this.worker.postMessage({ type: "frame", data: buffer, timeMs: meta.timeMs }, [buffer]);
  }

  private onEnded(reason: "target-gone" | "failed") {
    if (this.stopped) return;
    // A helper that failed on its own is not tried again this session. A
    // window that was closed is the person's doing, and says nothing about
    // the next share.
    if (reason === "failed") disabledForSession = true;
    this.stop();
    // Ends the track, which the share treats like any capture ending.
    this.preview.end();
  }

  private async adjustBitrate() {
    if (this.stopped) return;
    // pc.close() fires no event; this is the backstop for one nobody reported.
    for (const sink of [...this.sinks.values()]) {
      if (sink.pc.connectionState === "closed") this.closeSink(sink);
    }
    // Whoever is not being sent anything says nothing about the rate.
    const sinks = [...this.sinks.values()].filter((sink) => !sink.paused);
    // A few links per pass, one at a time, going round.
    const visits = Math.min(STATS_PER_PASS, sinks.length);
    for (let i = 0; i < visits; i += 1) {
      await this.sample(sinks[(this.statsCursor + i) % sinks.length]);
      if (this.stopped) return;
    }
    if (sinks.length > 0) this.statsCursor = (this.statsCursor + visits) % sinks.length;

    // Every link's most recent reading, not only the ones this pass reached:
    // a steady stream's estimate is just as true a few seconds old, and it is
    // the weakest link that sets the rate whether or not its turn came up.
    const target = nativeTargetKbps(
      this.ceilingKbps,
      sinks.map((sink) => sink.lastAvailableKbps)
    );
    this.smoothedKbps =
      this.smoothedKbps === 0
        ? target
        : this.smoothedKbps * (1 - BITRATE_SMOOTHING) + target * BITRATE_SMOOTHING;
    const smoothed = Math.round(this.smoothedKbps);
    const command = nativeBitrateCommand(this.currentKbps, smoothed, performance.now() - this.lastRaise);
    if (command === null) return;
    if (command > this.currentKbps) this.lastRaise = performance.now();
    this.currentKbps = command;
    this.bridge.control({ bitrateKbps: command });
  }

  // Reads one link's bandwidth estimate into lastAvailableKbps. Held there
  // rather than fetched on demand so that the bitrate pass can read every link
  // while only asking a few of them.
  private async sample(sink: Sink): Promise<void> {
    if (sink.pc.connectionState !== "connected") {
      sink.lastAvailableKbps = null;
      return;
    }
    try {
      const stats = await sink.pc.getStats();
      let best: number | null = null;
      stats.forEach((report) => {
        if (report.type !== "candidate-pair") return;
        const pair = report as RTCIceCandidatePairStats;
        if (!pair.nominated || pair.state !== "succeeded") return;
        if (typeof pair.availableOutgoingBitrate === "number") best = pair.availableOutgoingBitrate / 1000;
      });
      sink.lastAvailableKbps = best;
    } catch {
      // Left at the last reading: one failed pass says nothing about the link.
    }
  }
}

/** The RTCPeerConnection options a connection carrying native video needs. */
export function nativeVideoPeerConfig(config: RTCConfiguration): RTCConfiguration {
  return { ...config, encodedInsertableStreams: true } as RTCConfiguration;
}

// Only H.264 with FU-A fragmentation (packetization-mode=1) can carry the
// helper's frames. Constrained Baseline first: what the helper asks its
// encoder for, and what every receiver decodes.
function preferH264(transceiver: RTCRtpTransceiver) {
  if (typeof RTCRtpSender.getCapabilities !== "function") return;
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const h264 = codecs.filter(
    (c) => c.mimeType.toLowerCase() === "video/h264" && /packetization-mode=1/.test(c.sdpFmtpLine ?? "")
  );
  const rank = (c: RTCRtpCodec) => (/profile-level-id=42e0/.test(c.sdpFmtpLine ?? "") ? 0 : 1);
  h264.sort((a, b) => rank(a) - rank(b));
  // Retransmission and FEC are not codecs of their own but have to stay in
  // the list: without RTX a lost packet cannot be resent, and one lost packet
  // costs a whole IDR here.
  const helpers = codecs.filter((c) => /^video\/(rtx|red|ulpfec|flexfec-03)$/i.test(c.mimeType));
  const usable = h264.length > 0 ? [...h264, ...helpers] : [];
  try {
    if (usable.length > 0) transceiver.setCodecPreferences(usable);
  } catch {
    // An older engine that refuses the call; negotiation then decides.
  }
}

// The stand-in encoder must never throw a frame away on its own — see the
// header — so nothing may lower its frame rate, and its bitrate cap must not
// be the stand-in's (a 16x16 stream's default is tiny, and the bandwidth
// estimate is only probed up to the streams' caps).
async function configureSender(sender: RTCRtpSender, ceilingKbps: number) {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = ceilingKbps * 1000;
    params.encodings[0].maxFramerate = NATIVE_SENDER_MAX_FPS;
    params.encodings[0].scaleResolutionDownBy = 1;
    params.encodings[0].priority = "high";
    params.encodings[0].networkPriority = "high";
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      "maintain-framerate";
    await sender.setParameters(params);
  } catch {
    // Left at the defaults, which still work, only less well.
  }
}

// ---------------------------------------------------------------------------

/** Decodes the helper's stream into the share's own video track. */
class Preview {
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>;
  private readonly keeper = new ParameterSetKeeper();
  private readonly requestKey: () => void;
  private decoder: VideoDecoder | null = null;
  private waitingForKey = true;
  private writing = false;
  private ended = false;
  private active = true;

  constructor(track: TrackGenerator, requestKey: () => void) {
    this.writer = track.writable.getWriter();
    this.requestKey = requestKey;
  }

  /**
   * Whether anybody can see the preview. While nobody can, nothing is
   * decoded: the viewers are fed the helper's encoded frames directly (see
   * the sinks), so this decode exists only for our own tile — and it ran at
   * full resolution for the whole share, including the usual case of a
   * streamer playing with this window minimised. The track keeps its last
   * picture meanwhile; coming back asks the helper for an IDR, and the
   * preview moves again as soon as it lands.
   */
  setActive(active: boolean) {
    if (this.ended || this.active === active) return;
    this.active = active;
    if (active) {
      this.waitingForKey = true;
      this.requestKey();
    } else {
      this.closeDecoder();
    }
  }

  push(frame: NativeFrame) {
    if (this.ended || !this.active) return;
    if (frame.key) this.keeper.process(frame.data);
    if (this.waitingForKey) {
      if (!frame.key) return;
      if (!this.configure()) return;
      this.waitingForKey = false;
    }
    const decoder = this.decoder!;
    // Behind by more than a moment: start again from the next IDR rather
    // than showing the share later and later.
    if (decoder.decodeQueueSize > 8) {
      this.reset();
      return;
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({ type: frame.key ? "key" : "delta", timestamp: Math.round(performance.now() * 1000), data: frame.data })
      );
    } catch {
      this.reset();
    }
  }

  close() {
    this.ended = true;
    this.closeDecoder();
  }

  /** Ends the track, which is how the share learns the capture is over. */
  end() {
    this.close();
    void this.writer.close().catch(() => {});
  }

  private configure(): boolean {
    this.closeDecoder();
    try {
      const decoder = new VideoDecoder({
        output: (frame) => this.show(frame),
        error: () => this.reset(),
      });
      decoder.configure({
        codec: codecStringFromSps(this.keeper.spsPayload),
        hardwareAcceleration: "prefer-hardware",
        optimizeForLatency: true,
      });
      this.decoder = decoder;
      return true;
    } catch {
      return false;
    }
  }

  private show(frame: VideoFrame) {
    // One frame at a time into the track; a preview can skip frames freely.
    if (this.ended || this.writing) {
      frame.close();
      return;
    }
    this.writing = true;
    this.writer.write(frame).then(
      () => {
        this.writing = false;
        frame.close();
      },
      () => {
        this.writing = false;
        frame.close();
      }
    );
  }

  private reset() {
    this.closeDecoder();
    this.waitingForKey = true;
    this.requestKey();
  }

  private closeDecoder() {
    if (this.decoder && this.decoder.state !== "closed") {
      try {
        this.decoder.close();
      } catch {
        // Already closed by an error.
      }
    }
    this.decoder = null;
  }
}
