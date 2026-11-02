// Single shared getStats() pump for every outbound peer connection.
//
// One timer, one pass, results fanned out to subscribers: getStats() walks the
// whole stats graph and allocates a report map per call, and this runs on the
// machine that is simultaneously trying to encode for everybody in the room.
// Everything that needs sender telemetry reads from this one sample.

export interface SenderSample {
  /**
   * The key this sender was registered under — see PeerQualityRegistry, which
   * namespaces it per channel rather than using the bare peer id, since this
   * pump is one map shared by every registry in the process.
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
  /** The encoder the browser picked ("libvpx", "OpenH264", …), or null where it does not say. */
  encoderImplementation?: string | null;
  /** Whether the browser calls that encoder power efficient; absent where it does not say. */
  powerEfficient?: boolean;
  /**
   * Frames the capture delivered per second (the track's media-source), or
   * null where the browser does not say. Set against framesPerSecond, it
   * tells a sender that cannot keep up from content that is simply still.
   */
  sourceFps?: number | null;
  /**
   * The size of what the capture actually delivers, before any scaling; null where
   * the browser does not say. Unlike the track's settings it is true of a window or
   * a tab, whose frames are not necessarily the size the track claims.
   */
  sourceWidth?: number | null;
  sourceHeight?: number | null;
  /** Milliseconds the encoder spent per frame since the last visit; null on the first. */
  encodeMs?: number | null;
  /** Average QP of what was encoded since the last visit; null when nothing was. */
  qp?: number | null;
  /** "VP9", "H264", …, or null where the browser does not say. QP scales differ per codec. */
  codec?: string | null;
  /** What the bandwidth estimator lets this encoder spend, kbps; 0 when unknown. */
  targetKbps?: number;
  /** The estimate for this connection's path, kbps; 0 when unknown. */
  availableKbps?: number;
}

export interface CapacitySample {
  /** Bandwidth estimate from ICE, in kbps. 0 when not yet known. */
  availableOutgoingKbps: number;
  /** Sum of what we are currently sending across all peers, kbps. */
  usedOutgoingKbps: number;
  /** Fraction of active senders currently reporting a CPU limitation (0..1). */
  cpuPressure: number;
  sampledAt: number;
}

type SenderEntry = {
  pc: RTCPeerConnection;
  sender: RTCRtpSender;
  prev?: { bytes: number; frames: number; encodeTime: number; qpSum: number; at: number };
  // What this sender was last measured producing, kbps. Held across passes
  // so the room total can be summed over every sender rather than only the
  // ones this tick happened to visit.
  lastKbps: number;
  // Nobody is looking at this one, so nothing is being encoded for it and there
  // is nothing to read. In a big room that is most of them.
  paused: boolean;
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
  private passing = false;
  private lastCapacity: CapacitySample = {
    availableOutgoingKbps: 0,
    usedOutgoingKbps: 0,
    cpuPressure: 0,
    sampledAt: 0,
  };
  // Smoothed across passes: availableOutgoingBitrate ramps as the estimator
  // probes, and it is only shown to the person.
  private smoothedAvailable = 0;

  register(peerId: string, pc: RTCPeerConnection, sender: RTCRtpSender) {
    this.senders.set(peerId, { pc, sender, lastKbps: 0, paused: false });
    this.ensureRunning();
  }

  /** Stops or restarts reading a sender. See SenderEntry.paused. */
  setPaused(peerId: string, paused: boolean) {
    const entry = this.senders.get(peerId);
    if (!entry || entry.paused === paused) return;
    entry.paused = paused;
    entry.lastKbps = 0;
    // The counters did not move in between, and a difference across the gap
    // would read as a long stretch of nothing.
    entry.prev = undefined;
  }

  unregister(peerId: string) {
    this.senders.delete(peerId);
    if (this.senders.size === 0) this.stop();
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
      // One pass at a time. A pass is a chain of sequential getStats awaits,
      // and on a machine already short of CPU it can outlast the interval.
      if (this.passing) return;
      this.passing = true;
      void this.pass().finally(() => {
        this.passing = false;
      });
    }, POLL_INTERVAL_MS);
  }

  private stop() {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async pass() {
    const entries = [...this.senders.entries()].filter(([, entry]) => !entry.paused);
    if (entries.length === 0) {
      // Everybody stopped looking: nothing is going out, and the panel should say so.
      if (this.lastCapacity.usedOutgoingKbps > 0) {
        this.publish({ ...this.lastCapacity, usedOutgoingKbps: 0, cpuPressure: 0, sampledAt: Date.now() });
      }
      return;
    }

    // Round-robin window so a huge room doesn't make each tick unbounded.
    let window = entries;
    if (entries.length > MAX_SENDERS_PER_PASS) {
      window = [];
      for (let i = 0; i < MAX_SENDERS_PER_PASS; i += 1) {
        window.push(entries[(this.cursor + i) % entries.length]);
      }
      this.cursor = (this.cursor + MAX_SENDERS_PER_PASS) % entries.length;
    }

    let cpuLimited = 0;
    let counted = 0;
    let bestAvailable = 0;

    // Sequential rather than Promise.all: these all contend for the same
    // main thread.
    for (const [peerId, entry] of window) {
      if (entry.pc.connectionState !== "connected") {
        // Nothing is going out over a connection in this state, and its last
        // reading must not go on counting towards the room total below.
        entry.lastKbps = 0;
        continue;
      }
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
      let encoderImplementation: string | null = null;
      let powerEfficient: boolean | undefined;
      let encodeTime = 0;
      let qpSum = 0;
      let targetBitrate = 0;
      let codecId: string | null = null;
      let mediaSourceId: string | null = null;
      let availableKbps = 0;
      const sourceById = new Map<string, { fps: number | null; width: number | null; height: number | null }>();

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
          encoderImplementation =
            typeof rec.encoderImplementation === "string" && rec.encoderImplementation
              ? rec.encoderImplementation
              : null;
          if (typeof rec.powerEfficientEncoder === "boolean") powerEfficient = rec.powerEfficientEncoder;
          encodeTime = (rec.totalEncodeTime as number) ?? 0;
          qpSum = (rec.qpSum as number) ?? 0;
          targetBitrate = (rec.targetBitrate as number) ?? 0;
          codecId = typeof rec.codecId === "string" ? rec.codecId : null;
          mediaSourceId = typeof rec.mediaSourceId === "string" ? rec.mediaSourceId : null;
        } else if (r.type === "media-source" && rec.kind === "video") {
          const count = (value: unknown) => (typeof value === "number" && value > 0 ? value : null);
          sourceById.set(r.id, {
            fps: typeof rec.framesPerSecond === "number" ? rec.framesPerSecond : null,
            width: count(rec.width),
            height: count(rec.height),
          });
        } else if (r.type === "candidate-pair" && rec.state === "succeeded") {
          const kbps = ((rec.availableOutgoingBitrate as number) ?? 0) / 1000;
          if (kbps > availableKbps) availableKbps = kbps;
        }
      });
      if (availableKbps > bestAvailable) bestAvailable = availableKbps;

      const now = performance.now();
      let outgoingKbps = 0;
      // False only on the very first visit to a sender, where there is no
      // previous byte count to difference against and zero means "not known
      // yet" rather than "not sending".
      let measured = false;
      let encodeMs: number | null = null;
      let qp: number | null = null;
      if (entry.prev && now > entry.prev.at) {
        const dt = (now - entry.prev.at) / 1000;
        outgoingKbps = ((bytes - entry.prev.bytes) * 8) / 1000 / dt;
        const encoded = frames - entry.prev.frames;
        // framesPerSecond is a rolling figure that goes stale on a still
        // screen; the counters are what this interval actually did.
        if (fps === 0 || encoded === 0) fps = encoded / dt;
        const spent = encodeTime - entry.prev.encodeTime;
        if (encoded > 0 && spent > 0) encodeMs = (spent / encoded) * 1000;
        if (encoded > 0 && qpSum > entry.prev.qpSum) qp = (qpSum - entry.prev.qpSum) / encoded;
        measured = true;
      }
      entry.prev = { bytes, frames, encodeTime, qpSum, at: now };
      const source = mediaSourceId !== null ? sourceById.get(mediaSourceId) : undefined;
      const codecStat = codecId ? (report.get(codecId) as { mimeType?: string } | undefined) : undefined;

      // Zero included. A screen share of something still genuinely emits
      // almost nothing, and carrying the last busy reading forward would keep
      // claiming an uplink is carrying traffic it stopped carrying minutes ago.
      if (measured) entry.lastKbps = outgoingKbps;

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
        encoderImplementation,
        powerEfficient,
        sourceFps: source?.fps ?? null,
        sourceWidth: source?.width ?? null,
        sourceHeight: source?.height ?? null,
        encodeMs,
        qp,
        codec: codecStat?.mimeType ? codecStat.mimeType.replace(/^video\//i, "") : null,
        targetKbps: targetBitrate / 1000,
        availableKbps,
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

    // Over every sender, not just the ones this tick visited. Each contributes
    // its most recent reading, which for a steady stream is accurate however
    // long ago the round-robin last reached it.
    let totalKbps = 0;
    for (const entry of this.senders.values()) totalKbps += entry.lastKbps;

    if (bestAvailable > 0) {
      this.smoothedAvailable =
        this.smoothedAvailable === 0 ? bestAvailable : this.smoothedAvailable * 0.7 + bestAvailable * 0.3;
    }

    this.publish({
      availableOutgoingKbps: Math.round(this.smoothedAvailable),
      usedOutgoingKbps: Math.round(totalKbps),
      cpuPressure: cpuLimited / counted,
      sampledAt: Date.now(),
    });
  }

  private publish(sample: CapacitySample) {
    this.lastCapacity = sample;
    this.capacityListeners.forEach((fn) => {
      try {
        fn(sample);
      } catch {
        // as above
      }
    });
  }
}

export const mediaStats = new MediaStatsPump();
