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
// control, retransmission, the relay tree — is the ordinary path.
//
// That swap only works if the two streams stay in step, which is what
// SenderSink is about, and what was worked out by experiment:
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
import {
  ParameterSetKeeper,
  codecStringFromSps,
  nativeTargetKbps,
  type NativeFrameMeta,
} from "./nativeVideoFrames";

/** The rollout this path is behind (see lib/features.ts). */
export const NATIVE_VIDEO_FEATURE = "native-video-capture";

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
  readable: ReadableStream<EncodedFrame>;
  writable: WritableStream<EncodedFrame>;
}
interface EncodedFrame {
  type?: "key" | "delta" | "empty";
  data: ArrayBuffer;
}
type SenderWithStreams = RTCRtpSender & { createEncodedStreams?: () => EncodedStreams };

interface NativeFrame {
  data: Uint8Array;
  key: boolean;
}

const KEY_REQUEST_GAP_MS = 250;
const HOLD_KEY_TIMEOUT_MS = 1000;
const STALL_TIMEOUT_MS = 300;
const BITRATE_INTERVAL_MS = 2000;

function hasPlatformSupport(): boolean {
  return (
    typeof window !== "undefined" &&
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

export interface NativeVideoOptions {
  maxWidth: number;
  maxHeight: number;
  fps: number;
  bitrateKbps: number;
}

/**
 * Starts the GPU capture of the surface the last getDisplayMedia was answered
 * with, and returns the track that stands for it in the share's stream — a
 * local preview; what the peers receive is attached per connection (see
 * NativeVideoSource.attach). Null whenever it cannot be had, in which case
 * the caller keeps Chromium's capture.
 */
export type NativeVideoStart =
  | { source: NativeVideoSource; failure?: undefined }
  | { source: null; failure: string | null };

export async function startNativeVideo(options: NativeVideoOptions): Promise<NativeVideoStart> {
  const bridge = getDesktopBridge()?.nativeVideo;
  if (!bridge || disabledForSession) return { source: null, failure: null };
  if (!(await probeNativeVideo())) return { source: null, failure: "unsupported" };
  // Subscribed before asking, so the first frames — which arrive before the
  // answer does — are not lost.
  const source = new NativeVideoSource(options.bitrateKbps, options.fps);
  const result = await bridge.start(options).catch(() => null);
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
  return { source };
}

export class NativeVideoSource {
  /** The share's video track: a local preview of what is being sent. */
  readonly track: TrackGenerator;
  encoder = "";

  private readonly bridge = getDesktopBridge()!.nativeVideo!;
  private readonly keeper = new ParameterSetKeeper();
  private readonly sinks = new Set<SenderSink>();
  private readonly preview: Preview;
  private readonly unsubscribe: () => void;
  private readonly bitrateTimer: ReturnType<typeof setInterval>;
  private ceilingKbps: number;
  private currentKbps: number;
  private lastKeyRequest = 0;
  private stopped = false;
  lastKey: NativeFrame | null = null;
  readonly fps: number;

  constructor(ceilingKbps: number, fps: number) {
    this.ceilingKbps = ceilingKbps;
    this.currentKbps = ceilingKbps;
    this.fps = fps;
    this.track = new MediaStreamTrackGenerator({ kind: "video" });
    this.preview = new Preview(this.track, this.keeper, () => this.requestKeyFrame());
    this.unsubscribe = this.bridge.onFrame(
      (meta, data) => this.onFrame(meta, data),
      (reason) => this.onEnded(reason)
    );
    this.bitrateTimer = setInterval(() => void this.adjustBitrate(), BITRATE_INTERVAL_MS);
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
   * on it must go through passThroughSender.
   */
  attach(pc: RTCPeerConnection, stream: MediaStream): RTCRtpSender {
    const sink = new SenderSink(this, pc);
    this.sinks.add(sink);
    const sender = pc.addTrack(sink.track, stream);
    sink.attach(sender);
    const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
    if (transceiver) preferH264(transceiver);
    void configureSender(sender, this.ceilingKbps);
    const forget = () => {
      if (pc.connectionState !== "closed") return;
      pc.removeEventListener("connectionstatechange", forget);
      sink.close();
      this.sinks.delete(sink);
    };
    pc.addEventListener("connectionstatechange", forget);
    return sender;
  }

  /** The share's bitrate dial moved. */
  setCeiling(kbps: number): void {
    if (kbps === this.ceilingKbps) return;
    this.ceilingKbps = kbps;
    void this.adjustBitrate();
  }

  requestKeyFrame(): void {
    const now = performance.now();
    if (now - this.lastKeyRequest < KEY_REQUEST_GAP_MS) return;
    this.lastKeyRequest = now;
    this.bridge.control({ keyFrame: true });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.bitrateTimer);
    this.unsubscribe();
    this.bridge.stop();
    for (const sink of this.sinks) sink.close();
    this.sinks.clear();
    this.preview.close();
  }

  private onFrame(_meta: NativeFrameMeta, raw: Uint8Array) {
    if (this.stopped) return;
    const { data, idr } = this.keeper.process(raw);
    const frame: NativeFrame = { data, key: idr };
    if (idr) this.lastKey = frame;
    for (const sink of this.sinks) sink.onNative(frame);
    this.preview.push(frame);
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
    const estimates = await Promise.all([...this.sinks].map((sink) => sink.availableKbps()));
    const target = nativeTargetKbps(this.ceilingKbps, estimates);
    if (Math.abs(target - this.currentKbps) / this.currentKbps < 0.08) return;
    this.currentKbps = target;
    this.bridge.control({ bitrateKbps: target });
  }
}

/**
 * For every sender on a connection built with encodedInsertableStreams that
 * is *not* the native video: Chromium sends nothing on such a connection for
 * a sender whose streams were never piped.
 */
export function passThroughSender(sender: RTCRtpSender): void {
  const streams = (sender as SenderWithStreams).createEncodedStreams?.();
  if (streams) void streams.readable.pipeTo(streams.writable).catch(() => {});
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
    params.encodings[0].maxFramerate = 240;
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

/** One peer connection's stand-in track, and the swap behind it. */
class SenderSink {
  readonly track: TrackGenerator;
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>;
  private readonly source: NativeVideoSource;
  private readonly pc: RTCPeerConnection;
  private queue: NativeFrame[] = [];
  private inflight: NativeFrame | null = null;
  private held: { frame: EncodedFrame; controller: TransformStreamDefaultController<EncodedFrame>; resolve: () => void } | null = null;
  private needKey = true;
  private closed = false;
  private timestamp = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly blank: Uint8Array;
  private readonly onState = () => this.onConnectionState();

  constructor(source: NativeVideoSource, pc: RTCPeerConnection) {
    this.source = source;
    this.pc = pc;
    this.track = new MediaStreamTrackGenerator({ kind: "video" });
    this.writer = this.track.writable.getWriter();
    // A black 16x16 I420 frame: Y at 16, chroma at 128.
    this.blank = new Uint8Array(16 * 16 + 2 * 8 * 8);
    this.blank.fill(16, 0, 16 * 16);
    this.blank.fill(128, 16 * 16);
    pc.addEventListener("connectionstatechange", this.onState);
  }

  attach(sender: RTCRtpSender) {
    const streams = (sender as SenderWithStreams).createEncodedStreams?.();
    if (!streams) return;
    const transform = new TransformStream<EncodedFrame, EncodedFrame>({
      transform: (frame, controller) => this.onEncoded(frame, controller),
    });
    void streams.readable.pipeThrough(transform).pipeTo(streams.writable).catch(() => {});
  }

  /** The link's current bandwidth estimate, in kbps, or null. */
  async availableKbps(): Promise<number | null> {
    if (this.closed || this.pc.connectionState !== "connected") return null;
    try {
      const stats = await this.pc.getStats();
      let best: number | null = null;
      stats.forEach((report) => {
        if (report.type !== "candidate-pair") return;
        const pair = report as RTCIceCandidatePairStats;
        if (!pair.nominated || pair.state !== "succeeded") return;
        if (typeof pair.availableOutgoingBitrate === "number") best = pair.availableOutgoingBitrate / 1000;
      });
      return best;
    } catch {
      return null;
    }
  }

  onNative(frame: NativeFrame) {
    if (this.closed) return;
    if (this.held) {
      if (!frame.key) return;
      this.release(frame);
      return;
    }
    if (this.needKey) {
      if (!frame.key) return;
      this.needKey = false;
    }
    this.queue.push(frame);
    this.pump();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pc.removeEventListener("connectionstatechange", this.onState);
    if (this.stallTimer) clearTimeout(this.stallTimer);
    if (this.held) {
      const { resolve } = this.held;
      this.held = null;
      resolve();
    }
    this.queue = [];
    void this.writer.close().catch(() => {});
  }

  private onConnectionState() {
    if (this.pc.connectionState === "connected") {
      // Frames written before the link was up were thrown away by the
      // encoder; start over from an IDR.
      this.resync();
    }
  }

  private resync() {
    this.inflight = null;
    this.queue = [];
    this.needKey = true;
    this.source.requestKeyFrame();
  }

  private pump() {
    if (this.closed || this.inflight || this.held || this.queue.length === 0) return;
    // Anything written before the link is up is discarded by the encoder,
    // and would only leave this sink waiting on output that never comes.
    if (this.pc.connectionState !== "connected") return;
    // A backlog means the stand-in encoder is slower than the helper. The
    // chain cannot skip frames, so it restarts at the next IDR instead of
    // falling further behind.
    if (this.queue.length > 30) {
      this.resync();
      return;
    }
    this.inflight = this.queue.shift()!;
    this.timestamp += Math.round(1_000_000 / this.source.fps);
    const frame = new VideoFrame(this.blank, {
      format: "I420",
      codedWidth: 16,
      codedHeight: 16,
      timestamp: this.timestamp,
    });
    void this.writer.write(frame).catch(() => {});
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      // The encoder dropped what it was given; whatever was in flight is lost.
      if (this.inflight) this.resync();
    }, STALL_TIMEOUT_MS);
  }

  private fill(frame: EncodedFrame, controller: TransformStreamDefaultController<EncodedFrame>, native: NativeFrame) {
    const copy = new Uint8Array(native.data.byteLength);
    copy.set(native.data);
    frame.data = copy.buffer;
    controller.enqueue(frame);
  }

  private release(native: NativeFrame) {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.needKey = false;
    this.fill(held.frame, held.controller, native);
    held.resolve();
  }

  private onEncoded(frame: EncodedFrame, controller: TransformStreamDefaultController<EncodedFrame>): void | Promise<void> {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
    const native = this.inflight;
    this.inflight = null;
    if (this.closed) return;

    if (frame.type === "key" && !(native && native.key)) {
      // A receiver needs a picture to start from, and will only take it in
      // this slot. Held until the helper makes one.
      this.queue = [];
      this.needKey = true;
      this.source.requestKeyFrame();
      return new Promise<void>((resolve) => {
        this.held = { frame, controller, resolve };
        setTimeout(() => {
          if (this.held?.frame !== frame) return;
          const fallback = this.source.lastKey;
          if (fallback) this.release(fallback);
          else {
            this.held = null;
            resolve();
          }
        }, HOLD_KEY_TIMEOUT_MS);
      }).then(() => queueMicrotask(() => this.pump()));
    }

    if (!native) {
      // Out of step: something came out that nothing is waiting for. Sending
      // it would put the stand-in's own picture on the wire.
      this.resync();
      return;
    }
    this.fill(frame, controller, native);
    queueMicrotask(() => this.pump());
  }
}

// ---------------------------------------------------------------------------

/** Decodes the helper's stream into the share's own video track. */
class Preview {
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>;
  private decoder: VideoDecoder | null = null;
  private waitingForKey = true;
  private writing = false;
  private ended = false;

  constructor(
    track: TrackGenerator,
    private readonly keeper: ParameterSetKeeper,
    private readonly requestKey: () => void
  ) {
    this.writer = track.writable.getWriter();
  }

  push(frame: NativeFrame) {
    if (this.ended) return;
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
      },
      () => {
        this.writing = false;
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
