"use client";

// Single shared voice-activity detector for every stream on screen.
//
// This replaces one AnalyserNode + one setInterval per participant row (see
// the old body of useSpeaking). In a forty-person call that was eighty Web
// Audio nodes, forty timers and forty independent setStates firing at 6.6Hz
// — on the machine that is simultaneously encoding and decoding video. The
// nodes were the expensive half: each MediaStreamAudioSourceNode pins an
// object on the Web Audio thread for as long as the row is mounted.
//
// One timer, one pass, one notification per stream that actually changed.
//
// The bigger saving is that remote peers need no audio graph at all. Every
// RTP packet already carries the sender's own measured audio level (RFC
// 6464), and getSynchronizationSources() hands it over for the cost of an
// array read — no FFT, no DSP, and it keeps working while the audio element
// is muted. The analyser is kept only as a fallback, for the local
// microphone (which has no receiver) and for browsers that report no level.

import { getSharedAudioContext, ensureSharedAudioContextRunning } from "./audioContext";

// Unchanged from the per-row implementation, so the indicator behaves as it
// did: a short hold keeps pauses between syllables from making it flicker.
const SPEAKING_THRESHOLD = 0.02;
const HOLD_MS = 400;
const TICK_MS = 150;

// The RFC 6464 level is a linear amplitude ratio in the same 0..1 range as
// the analyser's RMS, so the same threshold is the right starting point —
// but it is measured at the *sender*, before its gain and our processing, so
// it is not guaranteed to line up exactly. Kept as its own constant so it
// can be tuned from field behaviour without touching the analyser path.
const RTP_SPEAKING_THRESHOLD = 0.02;

// Bounded per-pass work, the same way MediaStatsPump bounds its own: above
// this many streams we round-robin a window each tick, so the cost per tick
// stays flat. A speaking dot can afford to be a couple of ticks late; the
// hold logic is timestamp-based, so skipping a visit never breaks it.
const MAX_ENTRIES_PER_TICK = 24;

// 128 bins is ample for an RMS gate — the old code used 512 (256 bins) and
// spent twice the loop on precision nothing reads.
const FFT_SIZE = 256;

// Receivers handed over before any row was watching their stream. Bounded
// because nothing guarantees a row ever arrives to claim one.
const MAX_PENDING_RECEIVERS = 64;

type Entry = {
  stream: MediaStream;
  /** How many mounted rows are watching this stream. */
  refs: number;
  listeners: Set<() => void>;
  /** Preferred source, registered by useRoomMedia's ontrack for mic tracks. */
  receiver: RTCRtpReceiver | null;
  /** Set once a receiver has proved it reports no level, so we stop asking. */
  receiverUseless: boolean;
  analyser: AnalyserNode | null;
  source: MediaStreamAudioSourceNode | null;
  lastAboveAt: number;
  speaking: boolean;
};

type LevelReceiver = RTCRtpReceiver & {
  getSynchronizationSources?: () => { audioLevel?: number }[];
};

class SpeakingDetector {
  private entries = new Map<string, Entry>();
  // Receivers registered before any row was watching their stream. Bounded by
  // the number of live mic connections, and cleaned out as they are claimed.
  private pendingReceivers = new Map<string, RTCRtpReceiver>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor = 0;
  private visibilityBound = false;
  // One buffer reused across every entry in a tick, rather than one retained
  // per row for the lifetime of the row.
  private buffer = new Uint8Array(FFT_SIZE / 2);

  /**
   * Starts watching `stream` and calls `cb` when its speaking state changes.
   *
   * Acquiring and subscribing are one call on purpose: it makes the ref count
   * and the listener set impossible to get out of step, which two separate
   * effects with their own cleanups would not be.
   */
  acquire(stream: MediaStream, cb: () => void): () => void {
    const key = stream.id;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        stream,
        refs: 0,
        listeners: new Set(),
        receiver: this.pendingReceivers.get(key) ?? null,
        receiverUseless: false,
        analyser: null,
        source: null,
        lastAboveAt: 0,
        speaking: false,
      };
      this.pendingReceivers.delete(key);
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    entry.listeners.add(cb);
    this.ensureRunning();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const held = this.entries.get(key);
      if (!held) return;
      held.listeners.delete(cb);
      held.refs -= 1;
      if (held.refs > 0) return;
      this.teardownGraph(held);
      this.entries.delete(key);
      if (this.entries.size === 0) this.stop();
    };
  }

  isSpeaking(key: string | null): boolean {
    if (!key) return false;
    return this.entries.get(key)?.speaking ?? false;
  }

  /**
   * Hands over the receiver carrying this stream's audio, so its level can be
   * read from the RTP header instead of being measured again here.
   *
   * Safe to call before anything is watching the stream: it is remembered and
   * picked up when a row subscribes. Nothing detaches it — a receiver whose
   * connection has closed throws when read, which the tick treats as a reason
   * to fall back, so there is no teardown to keep in step with closeRecvPC.
   */
  attachReceiver(streamId: string, receiver: RTCRtpReceiver | null | undefined) {
    if (!receiver) return;
    const entry = this.entries.get(streamId);
    if (entry) {
      entry.receiver = receiver;
      entry.receiverUseless = false;
      return;
    }
    // Pruned on the way in, because nothing else ever will: an entry here is
    // only claimed if a row turns up for that stream, and one that never does
    // — a peer filtered out of the list, or a stream replaced by a reconnect
    // before anything rendered it — would otherwise sit here holding its
    // receiver (and through it, a closed connection) for the whole session.
    // Every reconnect mints a new stream id, so this grows with churn.
    for (const [id, held] of this.pendingReceivers) {
      if (held.track?.readyState === "ended") this.pendingReceivers.delete(id);
    }
    // A floor under it regardless of what readyState says, oldest first —
    // insertion order is what a Map iterates in.
    while (this.pendingReceivers.size >= MAX_PENDING_RECEIVERS) {
      const oldest = this.pendingReceivers.keys().next();
      if (oldest.done) break;
      this.pendingReceivers.delete(oldest.value);
    }
    this.pendingReceivers.set(streamId, receiver);
  }

  private ensureRunning() {
    this.bindVisibility();
    if (this.timer !== null) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Nobody can see a speaking indicator on a page that is not on screen, so
   * the whole pass stops. This is most of what a minimised desktop window was
   * burning a core on: it runs with backgroundThrottling disabled (see
   * electron/main.ts) precisely so its timers are *not* clamped, which means
   * nothing else was going to stop this one.
   */
  private bindVisibility() {
    if (this.visibilityBound || typeof document === "undefined") return;
    this.visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.stop();
        for (const entry of this.entries.values()) {
          if (!entry.speaking) continue;
          entry.speaking = false;
          entry.listeners.forEach((l) => l());
        }
        return;
      }
      if (this.entries.size > 0) this.ensureRunning();
    });
  }

  private teardownGraph(entry: Entry) {
    entry.source?.disconnect();
    entry.analyser?.disconnect();
    entry.source = null;
    entry.analyser = null;
    // Never closes the context: it is shared, and closing it would silence
    // every other stream on the page.
  }

  /** The level the sender measured, or null when this receiver cannot say. */
  private rtpLevel(entry: Entry): number | null {
    const receiver = entry.receiver;
    if (!receiver || entry.receiverUseless) return null;
    const fn = (receiver as LevelReceiver).getSynchronizationSources;
    if (typeof fn !== "function") {
      entry.receiverUseless = true;
      return null;
    }
    let sources: { audioLevel?: number }[];
    try {
      sources = fn.call(receiver);
    } catch {
      // The connection closed under us. Stop asking this receiver; the entry
      // goes away with its row, and until then the analyser can answer.
      entry.receiver = null;
      return null;
    }
    // No source heard from recently is silence, not "unknown" — this is the
    // normal reading for somebody who is not talking.
    if (sources.length === 0) return 0;
    const level = sources[0]?.audioLevel;
    if (typeof level !== "number") {
      entry.receiverUseless = true;
      return null;
    }
    return level;
  }

  /** The level measured here, building the audio graph on first use. */
  private analyserLevel(entry: Entry): number | null {
    if (!entry.analyser) {
      if (entry.stream.getAudioTracks().length === 0) return null;
      const audioContext = getSharedAudioContext();
      if (!audioContext) return null;
      void ensureSharedAudioContextRunning();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.6;
      const source = audioContext.createMediaStreamSource(entry.stream);
      source.connect(analyser);
      entry.analyser = analyser;
      entry.source = source;
    }
    entry.analyser.getByteTimeDomainData(this.buffer);
    let sumSquares = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const normalized = (this.buffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / this.buffer.length);
  }

  private tick() {
    const keys = [...this.entries.keys()];
    if (keys.length === 0) {
      this.stop();
      return;
    }

    let window = keys;
    if (keys.length > MAX_ENTRIES_PER_TICK) {
      window = [];
      for (let i = 0; i < MAX_ENTRIES_PER_TICK; i += 1) {
        window.push(keys[(this.cursor + i) % keys.length]);
      }
      this.cursor = (this.cursor + MAX_ENTRIES_PER_TICK) % keys.length;
    }

    const now = Date.now();
    for (const key of window) {
      const entry = this.entries.get(key);
      if (!entry) continue;

      if (!entry.receiver) {
        const pending = this.pendingReceivers.get(key);
        if (pending) {
          entry.receiver = pending;
          this.pendingReceivers.delete(key);
        }
      }

      let level = this.rtpLevel(entry);
      let threshold = RTP_SPEAKING_THRESHOLD;
      if (level === null) {
        level = this.analyserLevel(entry);
        threshold = SPEAKING_THRESHOLD;
      } else if (entry.analyser) {
        // A receiver turned up for a stream we had started metering by hand.
        this.teardownGraph(entry);
      }
      if (level === null) continue;

      const wasSpeaking = entry.speaking;
      if (level > threshold) {
        entry.lastAboveAt = now;
        entry.speaking = true;
      } else if (now - entry.lastAboveAt > HOLD_MS) {
        entry.speaking = false;
      }
      // Only the ones that actually changed are told, so a quiet room of
      // forty costs forty array reads and no renders at all.
      if (entry.speaking !== wasSpeaking) entry.listeners.forEach((l) => l());
    }
  }
}

export const speakingDetector = new SpeakingDetector();
