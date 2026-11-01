// Folds a connection's periodic snapshots into one per-session summary — the
// record quality telemetry sends to the API.
//
// Pure, like connectionDiagnostics, so what counts as a "bad" session can be
// tested without a browser (see connectionTelemetry.test.mts). That rule is
// the one that matters most here: every bad session is sent and only a sample
// of the good ones, so a rule that is too eager floods the collection and one
// that is too shy hides exactly the reports this exists to find.

import {
  diagnose,
  type CauseId,
  type PcSnapshot,
  type RouteKind,
} from "./connectionDiagnostics";

/**
 * Share of *good* sessions that are reported (every bad one always is). Read
 * by the sender and by the admin panel, which has to undo it: see
 * estimateSessions.
 */
export const QUALITY_SAMPLE_RATE = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_QUALITY_TELEMETRY_SAMPLE ?? "0.2");
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.2;
})();

/**
 * How many sessions a bucket of reports stands for.
 *
 * Reports over-represent bad sessions by design, so a bad rate read straight
 * off them is inflated — at a 20% sample, a real 10% bad rate shows up as 36%.
 * Scaling the good ones back up by the sample rate gives the estimate the
 * panel should show. With no sampling information (rate 0) the good sessions
 * cannot be recovered, and the raw count is the only honest answer.
 */
export function estimateSessions(total: number, bad: number, sampleRate = QUALITY_SAMPLE_RATE): number {
  const good = Math.max(0, total - bad);
  if (sampleRate <= 0) return total;
  return bad + good / sampleRate;
}

/** Estimated share of sessions that were bad, 0..1. */
export function estimateBadRate(total: number, bad: number, sampleRate = QUALITY_SAMPLE_RATE): number {
  const sessions = estimateSessions(total, bad, sampleRate);
  return sessions > 0 ? bad / sessions : 0;
}

export interface SessionAccumulator {
  startedAt: number;
  samples: number;
  /** Seconds covered by samples that had a usable interval. */
  seconds: number;
  routeKinds: RouteKind[];
  localType: string;
  remoteType: string;
  protocol: string | null;
  relayProtocol: string | null;
  /** The TURN server our end last relayed through, as the browser names it. */
  relayUrl: string | null;
  codec: string | null;
  implementation: string | null;
  hardware: boolean | null;
  fps: number[];
  heightSum: number;
  heightCount: number;
  kbpsSum: number;
  kbpsCount: number;
  targetKbpsSum: number;
  targetKbpsCount: number;
  availableKbpsSum: number;
  availableKbpsCount: number;
  rttSum: number;
  rttCount: number;
  maxLoss: number;
  cpuLimitedSeconds: number;
  bandwidthLimitedSeconds: number;
  freezes: number;
  freezeSeconds: number;
  dropWeighted: number;
  causeCounts: Partial<Record<CauseId, number>>;
  qpSum: number;
  qpCount: number;
  resolutionChanges: number;
  /** What our quality controller did to this viewer — send only, see SenderControlSample. */
  ratioSum: number;
  ratioCount: number;
  ratioMin: number | null;
  ceilingKbpsSum: number;
  ceilingKbpsCount: number;
  tier: string | null;
  degradationPreference: string | null;
  /** Send only: the capture's frame rate and the encoder's time per frame, see SendVideoStats. */
  sourceFpsSum: number;
  sourceFpsCount: number;
  encodeMsSum: number;
  encodeMsCount: number;
  /**
   * Recv only: seconds of the measured ones during which the tile was on
   * screen in a visible page. Null-counted (visibilityKnownSeconds 0) where
   * nobody said — a relay's re-encode, an older caller.
   */
  visibleSeconds: number;
  visibilityKnownSeconds: number;
  /** Recv only: the most frames the decoder had produced, to tell "never a picture" apart. */
  framesDecodedMax: number;
  /** Recv only: when a sample first saw a decoded frame. */
  firstFrameAt: number | null;
  /** When the pc first reached "connected", or null if it never did. Set by connectionTelemetry. */
  connectedAt: number | null;
}

/**
 * The sender's quality controller for this connection, read beside each
 * snapshot (see lib/peerQualityController's senderQualityState). Without it a
 * low bitrate cannot be pinned on the viewer's small tile, on our congestion
 * layer or on the encoder not using what it was given.
 */
export interface SenderControlSample {
  tier: string;
  ceilingKbps: number;
  ratio: number;
  degradationPreference: string;
}

// A session at 10-second sampling for three hours is ~1000 samples; the fps
// list is kept only to take a low percentile, so a bounded reservoir of the
// most recent readings is plenty.
const MAX_FPS_SAMPLES = 360;

export function createAccumulator(startedAt: number): SessionAccumulator {
  return {
    startedAt,
    samples: 0,
    seconds: 0,
    routeKinds: [],
    localType: "unknown",
    remoteType: "unknown",
    protocol: null,
    relayProtocol: null,
    relayUrl: null,
    codec: null,
    implementation: null,
    hardware: null,
    fps: [],
    heightSum: 0,
    heightCount: 0,
    kbpsSum: 0,
    kbpsCount: 0,
    targetKbpsSum: 0,
    targetKbpsCount: 0,
    availableKbpsSum: 0,
    availableKbpsCount: 0,
    rttSum: 0,
    rttCount: 0,
    maxLoss: 0,
    cpuLimitedSeconds: 0,
    bandwidthLimitedSeconds: 0,
    freezes: 0,
    freezeSeconds: 0,
    dropWeighted: 0,
    causeCounts: {},
    qpSum: 0,
    qpCount: 0,
    resolutionChanges: 0,
    ratioSum: 0,
    ratioCount: 0,
    ratioMin: null,
    ceilingKbpsSum: 0,
    ceilingKbpsCount: 0,
    tier: null,
    degradationPreference: null,
    sourceFpsSum: 0,
    sourceFpsCount: 0,
    encodeMsSum: 0,
    encodeMsCount: 0,
    visibleSeconds: 0,
    visibilityKnownSeconds: 0,
    framesDecodedMax: 0,
    firstFrameAt: null,
    connectedAt: null,
  };
}

/** Adds one snapshot. Mutates and returns `acc`. */
export function addSnapshot(
  acc: SessionAccumulator,
  snapshot: PcSnapshot,
  control: SenderControlSample | null = null,
  /** Recv only: whether the tile was on screen in a visible page; null when unknown. */
  visible: boolean | null = null
): SessionAccumulator {
  const { route, send, recv, intervalSeconds } = snapshot;
  // A picture arrived: frames decoded, or a frame rate where a browser does
  // not report the counter.
  if (recv && ((recv.framesDecodedTotal ?? 0) > 0 || recv.fps > 0)) {
    acc.framesDecodedMax = Math.max(acc.framesDecodedMax, recv.framesDecodedTotal || 1);
    acc.firstFrameAt ??= snapshot.at;
  }
  if (control) {
    acc.tier = control.tier;
    acc.degradationPreference = control.degradationPreference;
  }
  if (route.kind !== "unknown") {
    if (!acc.routeKinds.includes(route.kind)) acc.routeKinds.push(route.kind);
    acc.localType = route.localType;
    acc.remoteType = route.remoteType;
    acc.protocol = route.protocol;
    acc.relayProtocol = route.relayProtocol ?? acc.relayProtocol;
    acc.relayUrl = route.relayUrl ?? acc.relayUrl;
  }
  if (route.rttMs != null) {
    acc.rttSum += route.rttMs;
    acc.rttCount += 1;
  }
  const video = send ?? recv;
  if (video) {
    acc.codec = video.codec ?? acc.codec;
    const implementation = send ? send.encoder : recv?.decoder ?? null;
    acc.implementation = implementation ?? acc.implementation;
    acc.hardware = video.hardware ?? acc.hardware;
  }
  // Rates only mean something over an interval; a first sample has none.
  if (intervalSeconds > 0) {
    acc.seconds += intervalSeconds;
    if (video) {
      acc.fps.push(video.fps);
      if (acc.fps.length > MAX_FPS_SAMPLES) acc.fps.shift();
      if (video.height > 0) {
        acc.heightSum += video.height;
        acc.heightCount += 1;
      }
      acc.kbpsSum += video.kbps;
      acc.kbpsCount += 1;
    }
    if (send) {
      if (send.targetKbps != null && send.targetKbps > 0) {
        acc.targetKbpsSum += send.targetKbps;
        acc.targetKbpsCount += 1;
      }
      if (route.availableOutgoingKbps != null && route.availableOutgoingKbps > 0) {
        acc.availableKbpsSum += route.availableOutgoingKbps;
        acc.availableKbpsCount += 1;
      }
      acc.cpuLimitedSeconds += send.cpuLimitedShare * intervalSeconds;
      acc.bandwidthLimitedSeconds += send.bandwidthLimitedShare * intervalSeconds;
      acc.maxLoss = Math.max(acc.maxLoss, send.remoteLoss);
      if (send.qp != null && send.qp > 0) {
        acc.qpSum += send.qp;
        acc.qpCount += 1;
      }
      acc.resolutionChanges += send.resolutionChanges ?? 0;
      if (send.sourceFps != null) {
        acc.sourceFpsSum += send.sourceFps;
        acc.sourceFpsCount += 1;
      }
      if (send.encodeMs != null) {
        acc.encodeMsSum += send.encodeMs;
        acc.encodeMsCount += 1;
      }
      if (control) {
        acc.ratioSum += control.ratio;
        acc.ratioCount += 1;
        acc.ratioMin = acc.ratioMin === null ? control.ratio : Math.min(acc.ratioMin, control.ratio);
        acc.ceilingKbpsSum += control.ceilingKbps;
        acc.ceilingKbpsCount += 1;
      }
    }
    if (recv) {
      acc.freezes += recv.freezes;
      acc.freezeSeconds += recv.freezeSeconds;
      acc.dropWeighted += recv.dropShare * intervalSeconds;
      acc.maxLoss = Math.max(acc.maxLoss, recv.loss);
      if (visible !== null) {
        acc.visibilityKnownSeconds += intervalSeconds;
        if (visible) acc.visibleSeconds += intervalSeconds;
      }
    }
    for (const cause of diagnose({ route, send, recv })) {
      acc.causeCounts[cause.id] = (acc.causeCounts[cause.id] ?? 0) + 1;
    }
  }
  acc.samples += 1;
  return acc;
}

export interface SessionSummary {
  durationS: number;
  samples: number;
  routeKind: RouteKind;
  routeChanged: boolean;
  localType: string;
  remoteType: string;
  protocol: string | null;
  relayProtocol: string | null;
  codec: string | null;
  implementation: string | null;
  hardware: boolean | null;
  fpsAvg: number | null;
  fpsP10: number | null;
  heightAvg: number | null;
  kbpsAvg: number | null;
  /** Send only: what the encoder was asked for, on average (see SendVideoStats.targetKbps). */
  targetKbpsAvg: number | null;
  /** Send only: the browser's estimate of what the path carries, on average. */
  availableKbpsAvg: number | null;
  rttAvgMs: number | null;
  lossMax: number;
  cpuLimitedShare: number | null;
  bandwidthLimitedShare: number | null;
  freezes: number | null;
  freezeSeconds: number | null;
  dropShare: number | null;
  /** Send only: average QP of what was encoded (codec-specific scale, see SendVideoStats.qp). */
  qpAvg: number | null;
  /** Send only: resolution changes the encoder made for quality reasons. */
  resolutionChanges: number | null;
  /** Send only: the tier actually sent, last seen. */
  tier: string | null;
  /** Send only: the ceiling our controller handed the encoder before the congestion ratio, average kbps. */
  ceilingKbpsAvg: number | null;
  /** Send only: our congestion ratio, average and lowest (see lib/congestionControl). */
  congestionRatioAvg: number | null;
  congestionRatioMin: number | null;
  /** Send only: the degradation preference the encoder ran under, last seen. */
  degradationPreference: string | null;
  /** Send only: the capture's average frame rate (see SendVideoStats.sourceFps). */
  sourceFpsAvg: number | null;
  /** Send only: the encoder's average milliseconds per frame. */
  encodeMsAvg: number | null;
  /** Recv only: share of the measured time the tile was on screen in a visible page, 0..1; null when unknown. */
  visibleShare: number | null;
  /**
   * Recv only: seconds from the connection opening to its first decoded
   * frame, at the sampler's 10 s grain; null when it never got one.
   */
  firstFrameS: number | null;
  /**
   * Causes present in at least CAUSE_PRESENCE of the measured samples, plus
   * the session-level "low-source-fps".
   */
  causes: CauseId[];
  bad: boolean;
  /**
   * Which end a bad session is most likely down to; null for a good one.
   * "unknown" is mostly a screen share's freezes, which a still screen also
   * produces (see BAD_FREEZE_SHARE_SCREEN).
   */
  blame: Blame | null;
}

export type Blame = "sender" | "network" | "receiver" | "unknown";

const NETWORK_CAUSES: ReadonlySet<CauseId> = new Set(["network-loss", "high-rtt", "turn", "turn-tcp"]);

// Loss under which a slideshow cannot be the network's doing: below the point
// where diagnose itself starts mentioning loss (THRESHOLDS.lossMedium).
const SOURCE_FPS_MAX_LOSS = 0.03;

/** See SessionSummary.blame. Pure on the causes, so it can be pinned in tests. */
export function blameFor(direction: "send" | "recv", causes: readonly CauseId[], bad: boolean): Blame | null {
  if (!bad) return null;
  const network = causes.some((id) => NETWORK_CAUSES.has(id));
  if (direction === "send") {
    if (causes.includes("sender-cpu") || causes.includes("software-encoder")) return "sender";
    // An encoder held back with loss or a queue on the path is the link; held
    // back on a clean one, it is the encoder's own adaptation (its QP).
    if (causes.includes("sender-bandwidth")) return network ? "network" : "sender";
    if (causes.includes("low-source-fps")) return network ? "network" : "sender";
    return network ? "network" : "unknown";
  }
  if (causes.includes("receiver-drops")) return "receiver";
  if (network) return "network";
  if (causes.includes("low-source-fps")) return "sender";
  return "unknown";
}

// A cause has to be present for a real stretch of the session to be named in
// its summary: one bad sample in a two-hour session is not what went wrong.
export const CAUSE_PRESENCE = 0.25;

// What makes a session "bad" beyond a persistent cause. Freezing for more
// than 2% of the time is a stutter somebody notices every minute or so; a
// picture averaging under 10 fps while still carrying real bitrate is a
// slideshow of something that is moving (a still screen also shows low fps,
// but carries almost no bits).
const BAD_FREEZE_SHARE = 0.02;
// A screen share freezes by nature. The capture stops producing frames the
// moment nothing on screen changes, and the first gap after motion stops is
// counted by the browser as a freeze — so a perfectly healthy screen share
// logs one every few seconds of reading. The reports showed it: screen
// sessions on direct links with no loss at all averaged ~100 freezes, and at
// 2% the rule called 92% of all sessions bad, which made it useless. For a
// screen only freezing a tenth of the time is worth a flag; the slideshow and
// drop rules below are what catch a screen that is actually struggling.
const BAD_FREEZE_SHARE_SCREEN = 0.1;
const BAD_DROP_SHARE = 0.1;
const SLIDESHOW_FPS = 10;
const SLIDESHOW_MIN_KBPS = 300;
// A received picture only counts against the stream while somebody can see
// it. A tile scrolled away or a page in the background asks the broadcaster
// for the worst tier on purpose (576p15, see qualityNegotiation), and the
// browser may stop rendering it — its slideshow and freezes are what was
// asked for, not a fault.
const MIN_VISIBLE_SHARE = 0.5;
// Measured seconds a connected receiver needs before "never a frame" is a
// verdict and not a sampler that has not looked yet.
const NO_VIDEO_MIN_MEASURED_S = 15;

// "turn-tcp" is not here although the live panel calls it high: on its own it
// is a route, not a symptom. In the reports it flagged every TCP-relayed
// session bad — ~95% of experiment own-turn's tcp group — while those same
// viewers had the best frame rates of any group. A TCP relay that actually
// hurts shows up as loss, freezes or a slideshow, which are judged below.
const HIGH_CAUSES: ReadonlySet<CauseId> = new Set([
  "sender-cpu",
  "sender-bandwidth",
  "receiver-drops",
]);

function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function summarize(
  acc: SessionAccumulator,
  endedAt: number,
  direction: "send" | "recv",
  /** The media channel; screen shares get their own freeze bar (see BAD_FREEZE_SHARE_SCREEN). */
  channel?: string
): SessionSummary {
  const measured = acc.kbpsCount;
  const causes = (Object.entries(acc.causeCounts) as [CauseId, number][])
    .filter(([, count]) => measured > 0 && count / measured >= CAUSE_PRESENCE)
    .map(([id]) => id)
    .sort();

  const sortedFps = [...acc.fps].sort((a, b) => a - b);
  const fpsAvg = sortedFps.length ? sortedFps.reduce((a, b) => a + b, 0) / sortedFps.length : null;
  const fpsP10 = sortedFps.length ? sortedFps[Math.floor((sortedFps.length - 1) * 0.1)] : null;
  const kbpsAvg = measured ? acc.kbpsSum / measured : null;
  const seconds = acc.seconds;

  const freezeShare = seconds > 0 ? acc.freezeSeconds / seconds : 0;
  const dropShare = seconds > 0 ? acc.dropWeighted / seconds : 0;
  const slideshow =
    fpsAvg !== null && kbpsAvg !== null && fpsAvg < SLIDESHOW_FPS && kbpsAvg >= SLIDESHOW_MIN_KBPS;
  const visibleShare =
    direction === "recv" && acc.visibilityKnownSeconds > 0 ? acc.visibleSeconds / acc.visibilityKnownSeconds : null;
  // Unknown counts as seen, which is how every session was judged before.
  const seen = visibleShare === null || visibleShare >= MIN_VISIBLE_SHARE;
  // A received slideshow on a link that lost almost nothing and a machine that
  // dropped almost nothing: the frames were never sent. The reports had 19% of
  // bad received screens in exactly this state with no cause at all, and their
  // broadcasters, matched up, were sending ~6 fps themselves.
  //
  // The sending end names its own slideshow the same way. Its encoder rarely
  // admits to it — libvpx's frame dropper and screenshare rate limiter never
  // show in qualityLimitationReason — so the reports had VP9 senders at 4%
  // "bad" while 26% of them sent under 10 fps.
  const sourceSlideshow =
    slideshow &&
    (direction === "send" ||
      (seen && acc.maxLoss < SOURCE_FPS_MAX_LOSS && dropShare < BAD_DROP_SHARE));
  if (sourceSlideshow) causes.push("low-source-fps");
  // The tile that spins forever: a received video connection, up for longer
  // than a glance, that never decoded a single frame — or never connected.
  const noVideo =
    direction === "recv" &&
    acc.framesDecodedMax === 0 &&
    (acc.connectedAt === null || seconds >= NO_VIDEO_MIN_MEASURED_S);
  if (noVideo) causes.push("no-video");
  causes.sort();
  const bad =
    noVideo ||
    causes.some((id) => HIGH_CAUSES.has(id)) ||
    (causes.includes("network-loss") && acc.maxLoss >= 0.08) ||
    (direction === "send" && slideshow) ||
    (direction === "recv" &&
      seen &&
      (freezeShare >= (channel?.startsWith("screen") ? BAD_FREEZE_SHARE_SCREEN : BAD_FREEZE_SHARE) ||
        dropShare >= BAD_DROP_SHARE ||
        slideshow));

  const routeKind: RouteKind = acc.routeKinds.length ? acc.routeKinds[acc.routeKinds.length - 1] : "unknown";
  // Never connected is the path's failure; connected and silent is anybody's.
  const blame = noVideo ? (acc.connectedAt === null ? "network" : "unknown") : blameFor(direction, causes, bad);

  return {
    durationS: Math.round((endedAt - acc.startedAt) / 1000),
    samples: acc.samples,
    routeKind,
    routeChanged: acc.routeKinds.length > 1,
    localType: acc.localType,
    remoteType: acc.remoteType,
    protocol: acc.protocol,
    relayProtocol: acc.relayProtocol,
    codec: acc.codec,
    implementation: acc.implementation,
    hardware: acc.hardware,
    fpsAvg: fpsAvg === null ? null : round(fpsAvg, 1),
    fpsP10,
    heightAvg: acc.heightCount ? Math.round(acc.heightSum / acc.heightCount) : null,
    kbpsAvg: kbpsAvg === null ? null : Math.round(kbpsAvg),
    targetKbpsAvg:
      direction === "send" && acc.targetKbpsCount ? Math.round(acc.targetKbpsSum / acc.targetKbpsCount) : null,
    availableKbpsAvg:
      direction === "send" && acc.availableKbpsCount
        ? Math.round(acc.availableKbpsSum / acc.availableKbpsCount)
        : null,
    rttAvgMs: acc.rttCount ? Math.round(acc.rttSum / acc.rttCount) : null,
    lossMax: round(acc.maxLoss, 2),
    cpuLimitedShare: direction === "send" && seconds > 0 ? round(acc.cpuLimitedSeconds / seconds, 2) : null,
    bandwidthLimitedShare:
      direction === "send" && seconds > 0 ? round(acc.bandwidthLimitedSeconds / seconds, 2) : null,
    freezes: direction === "recv" ? acc.freezes : null,
    freezeSeconds: direction === "recv" ? round(acc.freezeSeconds, 1) : null,
    dropShare: direction === "recv" && seconds > 0 ? round(dropShare, 2) : null,
    qpAvg: direction === "send" && acc.qpCount ? Math.round(acc.qpSum / acc.qpCount) : null,
    resolutionChanges: direction === "send" ? acc.resolutionChanges : null,
    tier: direction === "send" ? acc.tier : null,
    ceilingKbpsAvg:
      direction === "send" && acc.ceilingKbpsCount ? Math.round(acc.ceilingKbpsSum / acc.ceilingKbpsCount) : null,
    congestionRatioAvg: direction === "send" && acc.ratioCount ? round(acc.ratioSum / acc.ratioCount, 2) : null,
    congestionRatioMin: direction === "send" && acc.ratioMin !== null ? round(acc.ratioMin, 2) : null,
    degradationPreference: direction === "send" ? acc.degradationPreference : null,
    sourceFpsAvg: direction === "send" && acc.sourceFpsCount ? round(acc.sourceFpsSum / acc.sourceFpsCount, 1) : null,
    encodeMsAvg: direction === "send" && acc.encodeMsCount ? round(acc.encodeMsSum / acc.encodeMsCount, 1) : null,
    visibleShare: visibleShare === null ? null : round(visibleShare, 2),
    firstFrameS:
      direction === "recv" && acc.firstFrameAt !== null
        ? Math.max(0, Math.round((acc.firstFrameAt - acc.startedAt) / 1000))
        : null,
    causes,
    bad,
    blame,
  };
}
