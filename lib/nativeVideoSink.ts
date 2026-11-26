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

/**
 * Why a connection needs a keyframe: it has no picture at all yet (just connected, or back
 * from a pause), or it lost the one it had (its viewer asked, or the chain broke).
 */
export type KeyNeed = "fresh" | "lost";

/** What a sink needs from the capture it hangs off. */
export interface SinkHost {
  /** Ask the helper for a fresh IDR. */
  requestKeyFrame(need: KeyNeed): void;
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
  /** IDRs from the helper that went out to this viewer, asked for by them or by anybody else. */
  keys: number;
  /** Milliseconds this viewer's picture waited for one: a slot held, or the chain stopped. */
  keyWaitMs: number;
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
  readonly stats: NativeSinkStats = { keyHolds: 0, keyStale: 0, resyncs: 0, keys: 0, keyWaitMs: 0 };
  closed = false;
  // Since when this viewer's picture has been waiting for an IDR; null when it is not.
  private waitingSince: number | null = null;
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

  /** Whether frames are going out to this viewer: connected, and looking. */
  get taking(): boolean {
    return !this.closed && this.connected && !this.paused;
  }

  setConnected(connected: boolean) {
    if (this.closed || this.connected === connected) return;
    this.connected = connected;
    if (connected) {
      // Frames written before the link was up were thrown away by the
      // encoder; start over from an IDR.
      this.resync("fresh");
    } else {
      this.queue = [];
      this.waitingSince = null;
    }
  }

  setPaused(paused: boolean) {
    if (this.closed || this.paused === paused) return;
    this.paused = paused;
    this.queue = [];
    if (!paused) this.resync("fresh");
    else this.waitingSince = null;
  }

  onNative(frame: NativeFrame) {
    if (this.closed || !this.connected || this.paused) return;
    if (frame.key) this.stats.keys += 1;
    if (this.held) {
      if (!frame.key) return;
      this.release(frame);
      this.endWait();
      return;
    }
    if (this.needKey) {
      if (!frame.key) return;
      this.needKey = false;
      this.endWait();
    }
    this.queue.push(frame);
    this.pump();
  }

  private startWait() {
    this.waitingSince ??= performance.now();
  }

  private endWait() {
    if (this.waitingSince === null) return;
    this.stats.keyWaitMs += performance.now() - this.waitingSince;
    this.waitingSince = null;
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

  private resync(need: KeyNeed = "lost") {
    this.stats.resyncs += 1;
    this.inflight = null;
    this.queue = [];
    this.needKey = true;
    this.startWait();
    this.host.requestKeyFrame(need);
  }

  private pump() {
    if (this.closed || this.inflight || this.held || this.queue.length === 0) return;
    if (!this.connected || this.paused) return;
    // The chain cannot skip frames, so it restarts at the next IDR instead of
    // falling further behind.
    if (this.queue.length > MAX_BACKLOG) {
      this.resync("lost");
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
      if (this.inflight) this.resync("lost");
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
      this.startWait();
      this.host.requestKeyFrame("lost");
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
            this.host.requestKeyFrame("lost");
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
      this.resync("lost");
      return;
    }
    this.fill(frame, controller, native);
    queueMicrotask(() => this.pump());
  }
}

// ---------------------------------------------------------------------------
// Experiment sq-key-pace (see lib/keyPace): when the helper is asked for an IDR.
//
// One encoder serves every viewer, so one viewer's keyframe is everybody's. Outside the
// experiment every request goes straight through, and the page coalesces them to one a
// second (KEY_REQUEST_GAP_MS in lib/nativeVideoCapture), whoever makes them. Inside it, and
// only while two or more viewers are taking frames:
//
//   - a viewer who lost the picture again soon after being served waits longer each time
//     (PACE_BACKOFF_*: 2 s, then 4), since a link that keeps losing it is that viewer's trouble and the
//     IDRs it asks for are everybody's;
//   - the shortest gap between two IDRs grows with the viewers past PACE_FREE_VIEWERS;
//   - a viewer with no picture yet ("fresh") is not held back by its own history;
//   - whatever IDR goes out serves everybody waiting, whoever it was asked for.

const PACE_MIN_GAP_MS = 1000;
const PACE_FREE_VIEWERS = 3;
const PACE_GAP_PER_VIEWER_MS = 250;
const PACE_MAX_GAP_MS = 2500;
const PACE_BACKOFF_FIRST_MS = 2000;
const PACE_BACKOFF_MAX_MS = 4000;
// Asking again this soon after being served is the same trouble coming back.
const PACE_REPEAT_WINDOW_MS = 10_000;
// A request the helper has not answered with an IDR in this long goes again.
const PACE_RESEND_MS = 2000;

/** The clock and timers a KeyPacer runs on, so the rules can be tested without waiting. */
export interface PacerClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: PacerClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class KeyPacer {
  /** Whether this machine is in the experiment. Off: every request goes straight through. */
  enabled = false;
  /** IDRs asked of the helper, for the tests. */
  sent = 0;
  private readonly send: () => void;
  private readonly clock: PacerClock;
  // Who is waiting, and from when they may be served.
  private readonly pending = new Map<number, number>();
  private readonly history = new Map<number, { servedAt: number; backoff: number }>();
  private active = 0;
  private lastSentAt = -Infinity;
  private timer: unknown = null;
  private timerAt = Infinity;

  constructor(send: () => void, clock: PacerClock = realClock) {
    this.send = send;
    this.clock = clock;
  }

  /** `sink` needs an IDR; `active` is how many viewers are taking frames right now. */
  request(sink: number, need: KeyNeed, active: number) {
    this.active = active;
    if (!this.enabled || active < 2) {
      this.sent += 1;
      this.send();
      return;
    }
    const now = this.clock.now();
    const past = this.history.get(sink);
    const at = need === "lost" && past && now - past.servedAt < PACE_REPEAT_WINDOW_MS ? past.servedAt + past.backoff : now;
    const before = this.pending.get(sink);
    this.pending.set(sink, before === undefined ? at : Math.min(before, at));
    this.schedule();
  }

  /** An IDR from the helper went out: whoever was waiting has it. */
  keyArrived() {
    if (this.pending.size === 0) return;
    const now = this.clock.now();
    for (const sink of this.pending.keys()) {
      const past = this.history.get(sink);
      const again = past !== undefined && now - past.servedAt < PACE_REPEAT_WINDOW_MS;
      this.history.set(sink, {
        servedAt: now,
        backoff: again ? Math.min(past.backoff * 2, PACE_BACKOFF_MAX_MS) : PACE_BACKOFF_FIRST_MS,
      });
    }
    this.pending.clear();
    this.cancel();
  }

  /** This viewer is gone. */
  forget(sink: number) {
    this.pending.delete(sink);
    this.history.delete(sink);
    if (this.pending.size === 0) this.cancel();
  }

  /** The experiment turned off: whoever is waiting goes now. */
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled || this.pending.size === 0) return;
    this.pending.clear();
    this.cancel();
    this.sent += 1;
    this.send();
  }

  private gap(): number {
    const extra = Math.max(0, this.active - PACE_FREE_VIEWERS);
    return Math.min(PACE_MAX_GAP_MS, PACE_MIN_GAP_MS + extra * PACE_GAP_PER_VIEWER_MS);
  }

  private cancel() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = Infinity;
  }

  private schedule() {
    if (this.pending.size === 0) return;
    const at = Math.max(Math.min(...this.pending.values()), this.lastSentAt + this.gap());
    if (this.timer !== null && this.timerAt <= at) return;
    this.cancel();
    this.timerAt = at;
    this.timer = this.clock.setTimeout(() => this.fire(), Math.max(0, at - this.clock.now()));
  }

  private fire() {
    this.timer = null;
    this.timerAt = Infinity;
    if (this.pending.size === 0) return;
    const now = this.clock.now();
    const due = Math.min(...this.pending.values());
    if (due > now || now < this.lastSentAt + this.gap()) {
      this.schedule();
      return;
    }
    this.lastSentAt = now;
    this.sent += 1;
    this.send();
    // Answered by keyArrived, normally within a frame or two.
    this.timerAt = now + PACE_RESEND_MS;
    this.timer = this.clock.setTimeout(() => this.fire(), PACE_RESEND_MS);
  }
}
