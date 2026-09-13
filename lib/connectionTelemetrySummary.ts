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
  codec: string | null;
  implementation: string | null;
  hardware: boolean | null;
  fps: number[];
  heightSum: number;
  heightCount: number;
  kbpsSum: number;
  kbpsCount: number;
  rttSum: number;
  rttCount: number;
  maxLoss: number;
  cpuLimitedSeconds: number;
  bandwidthLimitedSeconds: number;
  freezes: number;
  freezeSeconds: number;
  dropWeighted: number;
  causeCounts: Partial<Record<CauseId, number>>;
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
    codec: null,
    implementation: null,
    hardware: null,
    fps: [],
    heightSum: 0,
    heightCount: 0,
    kbpsSum: 0,
    kbpsCount: 0,
    rttSum: 0,
    rttCount: 0,
    maxLoss: 0,
    cpuLimitedSeconds: 0,
    bandwidthLimitedSeconds: 0,
    freezes: 0,
    freezeSeconds: 0,
    dropWeighted: 0,
    causeCounts: {},
  };
}

/** Adds one snapshot. Mutates and returns `acc`. */
export function addSnapshot(acc: SessionAccumulator, snapshot: PcSnapshot): SessionAccumulator {
  const { route, send, recv, intervalSeconds } = snapshot;
  if (route.kind !== "unknown") {
    if (!acc.routeKinds.includes(route.kind)) acc.routeKinds.push(route.kind);
    acc.localType = route.localType;
    acc.remoteType = route.remoteType;
    acc.protocol = route.protocol;
    acc.relayProtocol = route.relayProtocol ?? acc.relayProtocol;
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
      acc.cpuLimitedSeconds += send.cpuLimitedShare * intervalSeconds;
      acc.bandwidthLimitedSeconds += send.bandwidthLimitedShare * intervalSeconds;
      acc.maxLoss = Math.max(acc.maxLoss, send.remoteLoss);
    }
    if (recv) {
      acc.freezes += recv.freezes;
      acc.freezeSeconds += recv.freezeSeconds;
      acc.dropWeighted += recv.dropShare * intervalSeconds;
      acc.maxLoss = Math.max(acc.maxLoss, recv.loss);
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
  rttAvgMs: number | null;
  lossMax: number;
  cpuLimitedShare: number | null;
  bandwidthLimitedShare: number | null;
  freezes: number | null;
  freezeSeconds: number | null;
  dropShare: number | null;
  /** Causes present in at least CAUSE_PRESENCE of the measured samples. */
  causes: CauseId[];
  bad: boolean;
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
const BAD_DROP_SHARE = 0.1;
const SLIDESHOW_FPS = 10;
const SLIDESHOW_MIN_KBPS = 300;

const HIGH_CAUSES: ReadonlySet<CauseId> = new Set([
  "turn-tcp",
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
  direction: "send" | "recv"
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
  const bad =
    causes.some((id) => HIGH_CAUSES.has(id)) ||
    (causes.includes("network-loss") && acc.maxLoss >= 0.08) ||
    (direction === "recv" && (freezeShare >= BAD_FREEZE_SHARE || dropShare >= BAD_DROP_SHARE || slideshow));

  const routeKind: RouteKind = acc.routeKinds.length ? acc.routeKinds[acc.routeKinds.length - 1] : "unknown";

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
    rttAvgMs: acc.rttCount ? Math.round(acc.rttSum / acc.rttCount) : null,
    lossMax: round(acc.maxLoss, 2),
    cpuLimitedShare: direction === "send" && seconds > 0 ? round(acc.cpuLimitedSeconds / seconds, 2) : null,
    bandwidthLimitedShare:
      direction === "send" && seconds > 0 ? round(acc.bandwidthLimitedSeconds / seconds, 2) : null,
    freezes: direction === "recv" ? acc.freezes : null,
    freezeSeconds: direction === "recv" ? round(acc.freezeSeconds, 1) : null,
    dropShare: direction === "recv" && seconds > 0 ? round(dropShare, 2) : null,
    causes,
    bad,
  };
}
