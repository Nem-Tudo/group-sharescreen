// What one peer connection's getStats() says about why a stream looks bad.
//
// Everything the quality path already measures (mediaStats, congestionControl,
// topologyPlanner) is measured in order to *act*, and so only ever reads what
// it acts on: the sender's own bitrate, loss and limitation reason. That left
// the app blind to exactly the three things "the stream is bad only with
// certain people" most plausibly comes down to:
//
//   1. the route — whether the pair is talking directly or through our single
//      TURN server, which is a small VPS and saturates quickly;
//   2. the encoder — hardware or software, and whether the CPU is what holds
//      it back (under the default "text" profile a CPU shortage comes out as
//      dropped frames, not blur);
//   3. the receiving machine — frames it drops, freezes, a decoder that cannot
//      keep up. Nothing read inbound-rtp at all.
//
// This module is deliberately pure: it takes the stats records as plain
// objects and returns plain objects, so the rules that decide what a report
// *says* can be tested against synthetic reports (see
// connectionDiagnostics.test.mts) without a browser. Nothing here ever reads
// or keeps an IP address — candidate stats carry them, and none of that leaves
// this file.

export type CandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";

/**
 * How the two ends reach each other.
 *
 * "relay-local" means *our* side is going through a TURN server, "relay-remote"
 * the other side's. The distinction matters for what can be done about it:
 * only the side that relays can stop relaying.
 */
export type RouteKind = "direct" | "relay-local" | "relay-remote" | "relay-both" | "unknown";

export interface RouteInfo {
  kind: RouteKind;
  localType: CandidateType;
  remoteType: CandidateType;
  /** Transport between us and the first hop: "udp" or "tcp". */
  protocol: string | null;
  /** How we reach our TURN server, when we use one: "udp", "tcp" or "tls". */
  relayProtocol: string | null;
  /**
   * The TURN server our side relays through, as the browser reports it on the
   * relay candidate ("turn:turn.cloudflare.com:3478?transport=udp") — which of
   * the TURN networks this connection is on (see lib/iceConfig.ts's
   * turnProvider). Null when our side is not relaying, and when the browser
   * does not say (Firefox leaves it out). Optional because a report from an
   * older client does not carry it at all.
   */
  relayUrl?: string | null;
  rttMs: number | null;
  availableOutgoingKbps: number | null;
}

export interface SendVideoStats {
  width: number;
  height: number;
  fps: number;
  kbps: number;
  /** The encoder's instantaneous verdict: "none" | "cpu" | "bandwidth" | "other". */
  limitation: string;
  /** Share of the sampled interval the encoder spent limited by CPU, 0..1. */
  cpuLimitedShare: number;
  /** Share of the sampled interval the encoder spent limited by bandwidth, 0..1. */
  bandwidthLimitedShare: number;
  encoder: string | null;
  /** null when the browser does not say (it withholds this outside a capture context). */
  hardware: boolean | null;
  codec: string | null;
  /** Loss reported back by the receiver, 0..1. */
  remoteLoss: number;
  nackPerSecond: number;
  pliPerSecond: number;
}

export interface RecvVideoStats {
  width: number;
  height: number;
  fps: number;
  kbps: number;
  /** Packets lost over the interval, 0..1. */
  loss: number;
  /** Frames received but dropped before display over the interval, 0..1. */
  dropShare: number;
  /** Freezes that started during the interval. */
  freezes: number;
  /** Seconds spent frozen during the interval. */
  freezeSeconds: number;
  jitterMs: number;
  jitterBufferMs: number;
  decoder: string | null;
  hardware: boolean | null;
  codec: string | null;
}

export interface PcSnapshot {
  at: number;
  /** Seconds covered by the deltas below; 0 on a first sample. */
  intervalSeconds: number;
  route: RouteInfo;
  send: SendVideoStats | null;
  recv: RecvVideoStats | null;
}

/** Cumulative counters kept between two samples of the same pc. */
export interface StatsCounters {
  at: number;
  bytesSent: number;
  framesEncoded: number;
  nackCount: number;
  pliCount: number;
  limitCpu: number;
  limitBandwidth: number;
  limitTotal: number;
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  framesReceived: number;
  framesDropped: number;
  freezeCount: number;
  totalFreezesDuration: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
}

type StatRecord = Record<string, unknown>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function candidateType(value: unknown): CandidateType {
  return value === "host" || value === "srflx" || value === "prflx" || value === "relay"
    ? value
    : "unknown";
}

function isVideo(rec: StatRecord): boolean {
  // `kind` is the current name; `mediaType` is what older Chromium reported.
  return rec.kind === "video" || rec.mediaType === "video";
}

// Encoder/decoder implementation names, when the browser does not hand over
// powerEfficientEncoder/Decoder directly. Chromium reports libvpx/libaom/
// OpenH264/dav1d/FFmpeg for its software paths and names the platform API
// (MediaFoundation, VideoToolbox, VA-API, "ExternalEncoder") for hardware.
// Anything unrecognised stays null rather than being guessed into a verdict.
const SOFTWARE_CODEC_IMPL = /libvpx|libaom|openh264|dav1d|ffmpeg|software/i;
const HARDWARE_CODEC_IMPL = /external|accelerat|mediafoundation|videotoolbox|vaapi|v4l2|nvenc|nvdec|d3d|dxva|hardware|mediacodec/i;

export function isHardwareImplementation(
  implementation: string | null,
  powerEfficient: unknown
): boolean | null {
  if (typeof powerEfficient === "boolean") return powerEfficient;
  if (!implementation) return null;
  // Checked before the hardware pattern: a simulcast adapter wrapping libvpx
  // mentions both, and what actually encodes is the software library.
  if (SOFTWARE_CODEC_IMPL.test(implementation)) return false;
  if (HARDWARE_CODEC_IMPL.test(implementation)) return true;
  return null;
}

/** Share of `part` in `whole`, clamped to 0..1, and 0 when there is no whole. */
function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(1, part / whole));
}

function perSecond(delta: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(0, delta / seconds);
}

export function classifyRoute(localType: CandidateType, remoteType: CandidateType): RouteKind {
  if (localType === "unknown" && remoteType === "unknown") return "unknown";
  const local = localType === "relay";
  const remote = remoteType === "relay";
  if (local && remote) return "relay-both";
  if (local) return "relay-local";
  if (remote) return "relay-remote";
  return "direct";
}

export function isRelayed(kind: RouteKind): boolean {
  return kind === "relay-local" || kind === "relay-remote" || kind === "relay-both";
}

/**
 * Reads one getStats() report into a snapshot.
 *
 * `records` is the report's values (`[...report.values()]`). `prev` is what the
 * previous call for the *same pc and the same consumer* returned as
 * `counters`; every rate and share below is a delta against it, so two
 * consumers polling one pc at different intervals must each keep their own.
 * With no `prev` the rates come out as 0 and `intervalSeconds` as 0 — a first
 * sample describes the route and the encoder, not what happened recently.
 */
export function readPcStats(
  records: Iterable<StatRecord>,
  prev: StatsCounters | null,
  now: number
): { snapshot: PcSnapshot; counters: StatsCounters } {
  const byId = new Map<string, StatRecord>();
  const all: StatRecord[] = [];
  for (const rec of records) {
    all.push(rec);
    const id = str(rec.id);
    if (id) byId.set(id, rec);
  }

  // The selected pair. `transport.selectedCandidatePairId` is the spec's
  // pointer; Firefox marks the pair itself with `selected`; failing both, the
  // nominated pair that succeeded is the one carrying media.
  let pair: StatRecord | undefined;
  for (const rec of all) {
    if (rec.type !== "transport") continue;
    const selected = str(rec.selectedCandidatePairId);
    if (selected && byId.has(selected)) {
      pair = byId.get(selected);
      break;
    }
  }
  if (!pair) {
    pair =
      all.find((r) => r.type === "candidate-pair" && r.selected === true) ??
      all.find((r) => r.type === "candidate-pair" && r.nominated === true && r.state === "succeeded");
  }
  const local = pair ? byId.get(str(pair.localCandidateId) ?? "") : undefined;
  const remote = pair ? byId.get(str(pair.remoteCandidateId) ?? "") : undefined;
  const localType = candidateType(local?.candidateType);
  const remoteType = candidateType(remote?.candidateType);
  const pairRtt = num(pair?.currentRoundTripTime);
  const available = num(pair?.availableOutgoingBitrate);
  const route: RouteInfo = {
    kind: classifyRoute(localType, remoteType),
    localType,
    remoteType,
    protocol: str(local?.protocol),
    relayProtocol: localType === "relay" ? str(local?.relayProtocol) : null,
    relayUrl: localType === "relay" ? str(local?.url) : null,
    rttMs: pairRtt > 0 ? Math.round(pairRtt * 1000) : null,
    availableOutgoingKbps: available > 0 ? Math.round(available / 1000) : null,
  };

  const outbound = all.find((r) => r.type === "outbound-rtp" && isVideo(r));
  const remoteInbound = all.find((r) => r.type === "remote-inbound-rtp" && isVideo(r));
  const inbound = all.find((r) => r.type === "inbound-rtp" && isVideo(r));

  const durations = (outbound?.qualityLimitationDurations ?? {}) as Record<string, unknown>;
  const limitCpu = num(durations.cpu);
  const limitBandwidth = num(durations.bandwidth);
  const limitTotal = limitCpu + limitBandwidth + num(durations.none) + num(durations.other);

  const counters: StatsCounters = {
    at: now,
    bytesSent: num(outbound?.bytesSent),
    framesEncoded: num(outbound?.framesEncoded),
    nackCount: num(outbound?.nackCount),
    pliCount: num(outbound?.pliCount),
    limitCpu,
    limitBandwidth,
    limitTotal,
    bytesReceived: num(inbound?.bytesReceived),
    packetsReceived: num(inbound?.packetsReceived),
    packetsLost: num(inbound?.packetsLost),
    framesReceived: num(inbound?.framesReceived),
    framesDropped: num(inbound?.framesDropped),
    freezeCount: num(inbound?.freezeCount),
    totalFreezesDuration: num(inbound?.totalFreezesDuration),
    jitterBufferDelay: num(inbound?.jitterBufferDelay),
    jitterBufferEmittedCount: num(inbound?.jitterBufferEmittedCount),
  };

  // A counter that went *down* means the pc behind it was replaced (an ICE
  // restart keeps it, a rebuild does not); a delta across that is meaningless,
  // so it is treated like a first sample.
  const usable =
    prev !== null &&
    now > prev.at &&
    counters.bytesSent >= prev.bytesSent &&
    counters.bytesReceived >= prev.bytesReceived;
  const seconds = usable && prev ? (now - prev.at) / 1000 : 0;
  const d = (key: keyof StatsCounters) => (usable && prev ? Math.max(0, counters[key] - prev[key]) : 0);

  let send: SendVideoStats | null = null;
  if (outbound) {
    const encoder = str(outbound.encoderImplementation);
    const limitDelta = d("limitTotal");
    // Over the interval when there is one, since the instantaneous reason
    // flips on every keyframe; over the whole connection's life otherwise.
    const cpuShare = limitDelta > 0 ? share(d("limitCpu"), limitDelta) : share(limitCpu, limitTotal);
    const bwShare =
      limitDelta > 0 ? share(d("limitBandwidth"), limitDelta) : share(limitBandwidth, limitTotal);
    const fps = num(outbound.framesPerSecond) || perSecond(d("framesEncoded"), seconds);
    send = {
      width: num(outbound.frameWidth),
      height: num(outbound.frameHeight),
      fps: Math.round(fps),
      kbps: Math.round(perSecond(d("bytesSent") * 8, seconds) / 1000),
      limitation: str(outbound.qualityLimitationReason) ?? "none",
      cpuLimitedShare: round2(cpuShare),
      bandwidthLimitedShare: round2(bwShare),
      encoder,
      hardware: isHardwareImplementation(encoder, outbound.powerEfficientEncoder),
      codec: codecName(byId.get(str(outbound.codecId) ?? "")),
      remoteLoss: round2(num(remoteInbound?.fractionLost)),
      nackPerSecond: round2(perSecond(d("nackCount"), seconds)),
      pliPerSecond: round2(perSecond(d("pliCount"), seconds)),
    };
    // A sender-side pc usually has no selected-pair RTT in Firefox; the
    // receiver's own report of it is the next best thing.
    if (route.rttMs === null) {
      const rtt = num(remoteInbound?.roundTripTime);
      if (rtt > 0) route.rttMs = Math.round(rtt * 1000);
    }
  }

  let recv: RecvVideoStats | null = null;
  if (inbound) {
    const decoder = str(inbound.decoderImplementation);
    const received = d("packetsReceived");
    const lost = d("packetsLost");
    const emitted = d("jitterBufferEmittedCount");
    recv = {
      width: num(inbound.frameWidth),
      height: num(inbound.frameHeight),
      fps: Math.round(num(inbound.framesPerSecond)),
      kbps: Math.round(perSecond(d("bytesReceived") * 8, seconds) / 1000),
      loss: round2(share(lost, received + lost)),
      dropShare: round2(share(d("framesDropped"), d("framesReceived"))),
      freezes: d("freezeCount"),
      freezeSeconds: round2(d("totalFreezesDuration")),
      jitterMs: Math.round(num(inbound.jitter) * 1000),
      jitterBufferMs: emitted > 0 ? Math.round((d("jitterBufferDelay") / emitted) * 1000) : 0,
      decoder,
      hardware: isHardwareImplementation(decoder, inbound.powerEfficientDecoder),
      codec: codecName(byId.get(str(inbound.codecId) ?? "")),
    };
  }

  return {
    snapshot: { at: now, intervalSeconds: round2(seconds), route, send, recv },
    counters,
  };
}

function codecName(codec: StatRecord | undefined): string | null {
  const mime = str(codec?.mimeType);
  if (!mime) return null;
  return mime.replace(/^video\//i, "");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Causes
// ---------------------------------------------------------------------------

/**
 * A likely reason for a bad picture. Ids, not sentences: the UI translates
 * them (connectionStats.cause.<id>) and telemetry stores them as they are.
 */
export type CauseId =
  | "turn"
  | "turn-tcp"
  | "sender-cpu"
  | "sender-bandwidth"
  | "software-encoder"
  | "network-loss"
  | "high-rtt"
  | "receiver-drops"
  | "freezes";

export type Severity = "high" | "medium";

export interface Cause {
  id: CauseId;
  severity: Severity;
}

export interface DiagnoseInput {
  /** The route as seen from whichever end produced the report. */
  route: RouteInfo | null;
  /** The sender's half — ours when we transmit, relayed to us when we watch. */
  send: SendVideoStats | null;
  /** The receiver's half — ours when we watch, absent when we transmit. */
  recv: RecvVideoStats | null;
}

// The thresholds. Each is the point at which the number becomes worth
// mentioning to someone trying to work out why a picture is bad — not the
// point at which the app would act, which is congestionControl's business.
export const THRESHOLDS = {
  /** Share of the interval spent limited, for the encoder to count as held back. */
  limitedShare: 0.3,
  /** Share of CPU-limited time at which a software encoder becomes the suspect. */
  softwareEncoderCpuShare: 0.1,
  lossMedium: 0.03,
  lossHigh: 0.08,
  rttMs: 250,
  dropShare: 0.1,
} as const;

/** Most severe first, and stable within a severity. */
export function diagnose({ route, send, recv }: DiagnoseInput): Cause[] {
  const causes: Cause[] = [];
  const add = (id: CauseId, severity: Severity) => causes.push({ id, severity });

  if (route && isRelayed(route.kind)) {
    // TURN over TCP/TLS is head-of-line blocking under real-time media: one
    // lost packet stalls everything behind it. It is the relay case that is
    // bad on its own rather than merely suspect.
    if (route.relayProtocol === "tcp" || route.relayProtocol === "tls") add("turn-tcp", "high");
    else add("turn", "medium");
  }

  if (send) {
    const cpu = send.limitation === "cpu" || send.cpuLimitedShare >= THRESHOLDS.limitedShare;
    const bandwidth =
      send.limitation === "bandwidth" || send.bandwidthLimitedShare >= THRESHOLDS.limitedShare;
    if (cpu) add("sender-cpu", "high");
    if (bandwidth) add("sender-bandwidth", "high");
    // Only when the CPU is actually short. Most people encode in software and
    // are fine; naming it on every healthy stream would train everyone to
    // ignore the panel.
    if (send.hardware === false && (cpu || send.cpuLimitedShare >= THRESHOLDS.softwareEncoderCpuShare)) {
      add("software-encoder", "medium");
    }
  }

  const loss = Math.max(recv?.loss ?? 0, send?.remoteLoss ?? 0);
  if (loss >= THRESHOLDS.lossHigh) add("network-loss", "high");
  else if (loss >= THRESHOLDS.lossMedium) add("network-loss", "medium");

  if (route?.rttMs != null && route.rttMs >= THRESHOLDS.rttMs) add("high-rtt", "medium");

  if (recv) {
    if (recv.dropShare >= THRESHOLDS.dropShare) add("receiver-drops", "high");
    if (recv.freezes > 0 || recv.freezeSeconds > 0) add("freezes", "medium");
  }

  return causes.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}
