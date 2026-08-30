// Single shared getStats() pump for every outbound peer connection.
//
// This replaces the previous design of one setInterval per sendPC (see the
// old startPeerAdaptiveBitrateMonitor): in a 30-person room that was 29
// independent timers each doing its own getStats() pass, all landing at
// unrelated moments. getStats() is not free — it walks the whole stats graph
// and allocates a report map per call — so 29 uncoordinated calls per tick
// is real main-thread work on the machine that is simultaneously trying to
// encode 29 video streams.
//
// One timer, one pass, results fanned out to subscribers. Everything that
// needs sender telemetry (per-peer congestion control, capacity estimation,
// the content-cost multiplier) reads from this one sample.

import {
  measureContentMultiplier,
  type QualityTier,
} from "./videoQuality";

export interface SenderSample {
  /**
   * The key this sender was registered under — see PeerQualityRegistry, which
   * namespaces it per channel/relay rather than using the bare peer id, since
   * this pump is one map shared by every registry in the process.
   */
  peerId: string;
  /** Loss fraction reported by the *remote* end (0..1). */
  fractionLost: number;
  /** Round-trip time in seconds, as reported by the remote end. */
  rtt: number;
  /** Bitrate actually produced by the encoder for this peer, kbps. */
  outgoingKbps: number;
  framesPerSecond: number;
  /** "cpu" here is the encoder telling us it cannot keep up. */
  qualityLimitationReason: string;
  frameWidth: number;
  frameHeight: number;
}

export interface CapacitySample {
  /** Bandwidth estimate from ICE, in kbps. 0 when not yet known. */
  availableOutgoingKbps: number;
  /** Sum of what we are currently sending across all peers, kbps. */
  usedOutgoingKbps: number;
  /** Fraction of active senders currently reporting a CPU limitation (0..1). */
  cpuPressure: number;
  /** Best available estimate of the content's cost relative to motion video. */
  contentMultiplier: number;
  sampledAt: number;
}

type SenderEntry = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  tier: QualityTier;
  prev?: { bytes: number; frames: number; at: number };
};

const POLL_INTERVAL_MS = 2000;

// Bounded per-pass work: with a very large room, polling every sender every
// tick would cost more than the information is worth. Above this many
// senders we round-robin through a window each tick, so the cost per tick
// stays flat and every sender is still visited regularly (just less often).
const MAX_SENDERS_PER_PASS = 12;

class MediaStatsPump {
  private senders = new Map<string, SenderEntry>();
  private senderListeners = new Set<(s: SenderSample) => void>();
  private capacityListeners = new Set<(c: CapacitySample) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursor = 0;
  private lastCapacity: CapacitySample = {
    availableOutgoingKbps: 0,
    usedOutgoingKbps: 0,
    cpuPressure: 0,
    contentMultiplier: 1,
    sampledAt: 0,
  };
  // Smoothed across passes: a single tick's bandwidth estimate is noisy
  // enough that feeding it straight into topology decisions would make the
  // planner rebuild the tree on nothing but measurement jitter.
  private smoothedAvailable = 0;
  private smoothedMultiplier = 1;

  register(peerId: string, pc: RTCPeerConnection, sender: RTCRtpSender, tier: QualityTier) {
    this.senders.set(peerId, { pc, sender, tier });
    this.ensureRunning();
  }

  /** Updates the tier a peer is being served at, without resetting its history. */
  setTier(peerId: string, tier: QualityTier) {
    const entry = this.senders.get(peerId);
    if (entry) entry.tier = tier;
  }

  unregister(peerId: string) {
    this.senders.delete(peerId);
    if (this.senders.size === 0) this.stop();
  }

  clear() {
    this.senders.clear();
    this.stop();
  }

  onSender(fn: (s: SenderSample) => void): () => void {
    this.senderListeners.add(fn);
    return () => this.senderListeners.delete(fn);
  }

  onCapacity(fn: (c: CapacitySample) => void): () => void {
    this.capacityListeners.add(fn);
    return () => this.capacityListeners.delete(fn);
  }

  getCapacity(): CapacitySample {
    return this.lastCapacity;
  }

  private ensureRunning() {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.pass();
    }, POLL_INTERVAL_MS);
  }

  private stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async pass() {
    const entries = [...this.senders.entries()];
    if (entries.length === 0) return;

    // Round-robin window so a huge room doesn't make each tick unbounded.
    let window = entries;
    if (entries.length > MAX_SENDERS_PER_PASS) {
      window = [];
      for (let i = 0; i < MAX_SENDERS_PER_PASS; i += 1) {
        window.push(entries[(this.cursor + i) % entries.length]);
      }
      this.cursor = (this.cursor + MAX_SENDERS_PER_PASS) % entries.length;
    }

    let totalKbps = 0;
    let cpuLimited = 0;
    let counted = 0;
    let bestAvailable = 0;
    let multiplierAccum = 0;
    let multiplierCount = 0;

    // Sequential rather than Promise.all: these all contend for the same
    // main thread, and firing a dozen getStats() calls simultaneously
    // produces a latency spike on the very thread that is encoding video.
    for (const [peerId, entry] of window) {
      if (entry.pc.connectionState !== "connected") continue;
      let report: RTCStatsReport;
      try {
        // Scoped to this sender's track: a full pc.getStats() also walks
        // every inbound stream and candidate pair we do not need here.
        report = await entry.pc.getStats(entry.sender.track ?? undefined);
      } catch {
        continue;
      }

      let fractionLost = 0;
      let rtt = 0;
      let bytes = 0;
      let frames = 0;
      let fps = 0;
      let reason = "none";
      let frameWidth = 0;
      let frameHeight = 0;

      report.forEach((r) => {
        const rec = r as unknown as Record<string, unknown>;
        if (r.type === "remote-inbound-rtp" && rec.kind === "video") {
          fractionLost = (rec.fractionLost as number) ?? 0;
          rtt = (rec.roundTripTime as number) ?? 0;
        } else if (r.type === "outbound-rtp" && rec.kind === "video") {
          bytes = (rec.bytesSent as number) ?? 0;
          frames = (rec.framesEncoded as number) ?? 0;
          fps = (rec.framesPerSecond as number) ?? 0;
          reason = (rec.qualityLimitationReason as string) ?? "none";
          frameWidth = (rec.frameWidth as number) ?? 0;
          frameHeight = (rec.frameHeight as number) ?? 0;
        } else if (r.type === "candidate-pair" && rec.state === "succeeded") {
          const avail = (rec.availableOutgoingBitrate as number) ?? 0;
          if (avail > bestAvailable) bestAvailable = avail / 1000;
        }
      });

      const now = performance.now();
      let outgoingKbps = 0;
      if (entry.prev && now > entry.prev.at) {
        const dt = (now - entry.prev.at) / 1000;
        outgoingKbps = ((bytes - entry.prev.bytes) * 8) / 1000 / dt;
        if (fps === 0) fps = (frames - entry.prev.frames) / dt;
      }
      entry.prev = { bytes, frames, at: now };

      if (outgoingKbps > 0) {
        totalKbps += outgoingKbps;
        multiplierAccum += measureContentMultiplier(outgoingKbps, entry.tier);
        multiplierCount += 1;
      }
      if (reason === "cpu") cpuLimited += 1;
      counted += 1;

      const sample: SenderSample = {
        peerId,
        fractionLost,
        rtt,
        outgoingKbps,
        framesPerSecond: fps,
        qualityLimitationReason: reason,
        frameWidth,
        frameHeight,
      };
      this.senderListeners.forEach((fn) => {
        try {
          fn(sample);
        } catch {
          // A misbehaving subscriber must not abort the rest of the pass.
        }
      });
    }

    if (counted === 0) return;

    // Exponential smoothing. availableOutgoingBitrate in particular ramps as
    // the bandwidth estimator probes, so an unsmoothed reading taken shortly
    // after a share starts badly understates the real link.
    if (bestAvailable > 0) {
      this.smoothedAvailable =
        this.smoothedAvailable === 0 ? bestAvailable : this.smoothedAvailable * 0.7 + bestAvailable * 0.3;
    }
    if (multiplierCount > 0) {
      const m = multiplierAccum / multiplierCount;
      this.smoothedMultiplier = this.smoothedMultiplier * 0.8 + m * 0.2;
    }

    this.lastCapacity = {
      availableOutgoingKbps: Math.round(this.smoothedAvailable),
      usedOutgoingKbps: Math.round(totalKbps),
      cpuPressure: cpuLimited / counted,
      contentMultiplier: Math.round(this.smoothedMultiplier * 100) / 100,
      sampledAt: Date.now(),
    };
    const snapshot = this.lastCapacity;
    this.capacityListeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        // as above
      }
    });
  }
}

export const mediaStats = new MediaStatsPump();

// ---------------------------------------------------------------------------
// Local encode budget
// ---------------------------------------------------------------------------

// Starting estimate of how many megapixels/second this device can encode in
// real time, seeded from core count. This is a *prior*, not a measurement:
// hardwareConcurrency says nothing about core quality, thermal headroom, or
// whether a hardware encoder is in play. cpuPressure feedback below corrects
// it downward in the only way that is actually trustworthy — observing the
// encoder fail to keep up.
function seedEncodeBudget(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  // ~124 Mpx/s is one 1080p60 stream. A 4-core machine managing roughly three
  // of those in software is the calibration point these numbers come from.
  return Math.max(120, Math.min(2400, cores * 100));
}

// Fraction of sampled senders that must report a CPU limitation before the
// budget moves, and how many consecutive observations must say so.
//
// qualityLimitationReason is a momentary reading and a sticky one: a single
// keyframe burst, another tab compiling something, one slow pass over a busy
// frame all raise it for a sample or two. Treating any one of those as
// evidence about the machine's ceiling — which the old single-sender, single
// -sample trigger did — meant a transient hiccup cut the estimate 15%, and
// then the next hiccup cut the reduced figure again. Nothing in that loop
// ever needed the device to actually be slow.
const CPU_PRESSURE_BAD = 0.4;
const CPU_BAD_STREAK = 2;
// Never fall below roughly one 1080p60 stream's worth. A budget under that
// makes the planner conclude it cannot serve even a single fullscreen viewer
// at full quality, which is a statement about this estimator rather than
// about any real machine.
const MIN_ENCODE_MPXS = 150;

class EncodeBudget {
  private budget = seedEncodeBudget();
  private lastAdjust = 0;
  private badStreak = 0;

  /** Current estimate, in megapixels/second. */
  get(): number {
    return Math.round(this.budget);
  }

  /**
   * Feed observed CPU pressure back in.
   *
   * Backing off is deliberately slower to trigger than it used to be, and
   * recovery deliberately quicker. Being wrong optimistically costs dropped
   * frames until the next observation four seconds later; being wrong
   * pessimistically costs the whole room a quality tier for as long as the
   * share lasts, because nothing else ever pushes the estimate back up.
   */
  observe(cpuPressure: number, currentLoadMpxs: number) {
    const now = Date.now();
    if (now - this.lastAdjust < 4000) return;
    this.lastAdjust = now;
    if (cpuPressure >= CPU_PRESSURE_BAD && currentLoadMpxs > 0) {
      this.badStreak += 1;
      if (this.badStreak >= CPU_BAD_STREAK) {
        // The load we are already carrying is evidently above what this
        // device sustains, so the real ceiling is below it.
        this.budget = Math.max(
          MIN_ENCODE_MPXS,
          Math.min(this.budget, currentLoadMpxs) * 0.9
        );
      }
    } else {
      this.badStreak = 0;
      if (cpuPressure <= 0.1) {
        this.budget = Math.min(seedEncodeBudget() * 2, this.budget * 1.12);
      }
    }
  }

  reset() {
    this.budget = seedEncodeBudget();
    this.lastAdjust = 0;
    this.badStreak = 0;
  }
}

export const encodeBudget = new EncodeBudget();
