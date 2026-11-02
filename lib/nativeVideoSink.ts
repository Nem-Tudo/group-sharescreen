// One peer connection's half of the desktop app's GPU capture: a stand-in track
// whose encoded output is replaced, frame for frame, with the helper's H.264
// (see lib/nativeVideoCapture.ts for why).
//
// This runs in a worker (see nativeVideoSink.worker.ts), and that is the point.
// Every frame takes a round trip through this code, and one frame's turn cannot
// start until the previous one has come out of the encoder. On the page's main
// thread that meant anything else the page was doing, a render of the room or a
// burst of chat, held the picture still for every viewer: in the lab, 100 ms of
// main-thread work a second gave 56 freezes a minute with the frame rate looking
// perfect, which is exactly what the reports showed.
//
// Pure apart from VideoFrame, so the rules can be tested without a worker.

export interface NativeFrame {
  data: Uint8Array;
  key: boolean;
  /** When the helper captured it, in milliseconds on its own clock. */
  timeMs?: number;
}

export interface EncodedFrame {
  type?: "key" | "delta" | "empty";
  data: ArrayBuffer;
}

/** What a sink needs from the capture it hangs off. */
export interface SinkHost {
  /** Ask the helper for a fresh IDR. */
  requestKeyFrame(): void;
  /** The most recent IDR the helper produced. */
  lastKey(): NativeFrame | null;
}

/** How one connection's keyframe slots went, for the reports. */
export interface NativeSinkStats {
  /** Keyframe slots held for a fresh IDR from the helper. */
  keyHolds: number;
  /** Held slots that timed out and were filled with the last IDR instead. */
  keyStale: number;
  /** Times the frame chain restarted from an IDR (backlog, stall, reconnect). */
  resyncs: number;
}

// How long a frame may stay inside the stand-in encoder before it counts as lost.
const STALL_TIMEOUT_MS = 300;
// How long a held keyframe slot waits for the helper's next IDR.
const HOLD_KEY_TIMEOUT_MS = 2500;
// A backlog means the stand-in encoder is slower than the helper.
const MAX_BACKLOG = 30;
// The least time between two stand-in frames. WebRTC's frame rate limiter goes by when
// a frame arrives, not by its timestamp, and throws away one that comes sooner than the
// sender's maxFramerate allows (see NATIVE_SENDER_MAX_FPS). Frames do come in bursts:
// the helper's pipe is read in chunks, and whatever else the page was doing holds them
// back and lets them go together. One frame lost that way is the chain restarting from
// the next IDR, for that viewer, after STALL_TIMEOUT_MS of nothing: 40 to 56 freezes a
// minute in the lab with the page busy for a moment every second or two.
const MIN_WRITE_GAP_MS = 2;

export class SenderSink {
  readonly stats: NativeSinkStats = { keyHolds: 0, keyStale: 0, resyncs: 0 };
  closed = false;
  private queue: NativeFrame[] = [];
  private inflight: NativeFrame | null = null;
  private held: {
    frame: EncodedFrame;
    controller: TransformStreamDefaultController<EncodedFrame>;
    resolve: () => void;
  } | null = null;
  private needKey = true;
  private connected = false;
  // The viewer is not looking: nothing is fed in, and the encoder sits idle.
  private paused = false;
  private timestamp = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWriteAt = -Infinity;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  // A black 16x16 I420 frame: Y at 16, chroma at 128.
  private readonly blank: Uint8Array;
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>;
  private readonly host: SinkHost;

  constructor(writer: WritableStreamDefaultWriter<VideoFrame>, host: SinkHost) {
    this.writer = writer;
    this.host = host;
    this.blank = new Uint8Array(16 * 16 + 2 * 8 * 8);
    this.blank.fill(16, 0, 16 * 16);
    this.blank.fill(128, 16 * 16);
  }

  setConnected(connected: boolean) {
    if (this.closed || this.connected === connected) return;
    this.connected = connected;
    if (connected) {
      // Frames written before the link was up were thrown away by the
      // encoder; start over from an IDR.
      this.resync();
    } else {
      this.queue = [];
    }
  }

  setPaused(paused: boolean) {
    if (this.closed || this.paused === paused) return;
    this.paused = paused;
    this.queue = [];
    if (!paused) this.resync();
  }

  onNative(frame: NativeFrame) {
    if (this.closed || !this.connected || this.paused) return;
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
    if (this.stallTimer) clearTimeout(this.stallTimer);
    if (this.gapTimer) clearTimeout(this.gapTimer);
    if (this.held) {
      const { resolve } = this.held;
      this.held = null;
      resolve();
    }
    this.queue = [];
    void this.writer.close().catch(() => {});
  }

  private resync() {
    this.stats.resyncs += 1;
    this.inflight = null;
    this.queue = [];
    this.needKey = true;
    this.host.requestKeyFrame();
  }

  private pump() {
    if (this.closed || this.inflight || this.held || this.queue.length === 0) return;
    if (!this.connected || this.paused) return;
    // The chain cannot skip frames, so it restarts at the next IDR instead of
    // falling further behind.
    if (this.queue.length > MAX_BACKLOG) {
      this.resync();
      return;
    }
    const wait = this.lastWriteAt + MIN_WRITE_GAP_MS - performance.now();
    if (wait > 0) {
      this.gapTimer ??= setTimeout(() => {
        this.gapTimer = null;
        this.pump();
      }, wait);
      return;
    }
    this.lastWriteAt = performance.now();
    this.inflight = this.queue.shift()!;
    // When it was really captured, which is what the RTP timestamp viewers pace their
    // playout by comes from. A frame interval counted up from zero says the wrong thing
    // whenever frames do not come at a fixed rate, which on a still screen they do not.
    this.timestamp = Math.max(Math.round((this.inflight.timeMs ?? performance.now()) * 1000), this.timestamp + 1000);
    const frame = new VideoFrame(this.blank as Uint8Array<ArrayBuffer>, {
      format: "I420",
      codedWidth: 16,
      codedHeight: 16,
      timestamp: this.timestamp,
    });
    void this.writer.write(frame).then(
      () => frame.close(),
      () => frame.close()
    );
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      // The encoder dropped what it was given; whatever was in flight is lost.
      if (this.inflight) this.resync();
    }, STALL_TIMEOUT_MS);
  }

  private fill(
    frame: EncodedFrame,
    controller: TransformStreamDefaultController<EncodedFrame>,
    native: NativeFrame
  ) {
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

  /** The transform on the stand-in's encoded output. */
  onEncoded(
    frame: EncodedFrame,
    controller: TransformStreamDefaultController<EncodedFrame>
  ): void | Promise<void> {
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
      this.stats.keyHolds += 1;
      this.host.requestKeyFrame();
      return new Promise<void>((resolve) => {
        this.held = { frame, controller, resolve };
        setTimeout(() => {
          if (this.held?.frame !== frame) return;
          const fallback = this.host.lastKey();
          if (fallback) {
            this.stats.keyStale += 1;
            this.release(fallback);
            // An old IDR in the slot is only a picture to start from: the
            // helper's next frames reference frames in between that this viewer
            // never got, so nothing more goes out until a fresh IDR does.
            this.needKey = true;
            this.host.requestKeyFrame();
          } else {
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
