// node --experimental-strip-types lib/connectionTelemetry.test.mts
//
// Pins what a per-session quality report says, above all whether it is "bad":
// every bad session is sent and only a sample of the good ones, so this rule
// decides what the telemetry can ever show.

import assert from "node:assert/strict";
import {
  addSnapshot,
  createAccumulator,
  estimateBadRate,
  estimateSessions,
  summarize,
} from "./connectionTelemetrySummary";
import type { PcSnapshot, RecvVideoStats, RouteInfo, SendVideoStats } from "./connectionDiagnostics";

function route(over: Partial<RouteInfo> = {}): RouteInfo {
  return {
    kind: "direct",
    localType: "host",
    remoteType: "srflx",
    protocol: "udp",
    relayProtocol: null,
    rttMs: 40,
    availableOutgoingKbps: 5000,
    ...over,
  };
}

function send(over: Partial<SendVideoStats> = {}): SendVideoStats {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    kbps: 2500,
    limitation: "none",
    cpuLimitedShare: 0,
    bandwidthLimitedShare: 0,
    encoder: "libvpx",
    hardware: false,
    codec: "VP9",
    remoteLoss: 0,
    nackPerSecond: 0,
    pliPerSecond: 0,
    ...over,
  };
}

function recv(over: Partial<RecvVideoStats> = {}): RecvVideoStats {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    kbps: 2500,
    loss: 0,
    dropShare: 0,
    freezes: 0,
    freezeSeconds: 0,
    jitterMs: 4,
    jitterBufferMs: 30,
    decoder: "ExternalDecoder",
    hardware: true,
    codec: "VP9",
    ...over,
  };
}

function snap(over: Partial<PcSnapshot>, at: number): PcSnapshot {
  return { at, intervalSeconds: 10, route: route(), send: null, recv: null, ...over };
}

/** A session of `count` 10-second samples built by `make(i)`. */
function session(direction: "send" | "recv", count: number, make: (i: number) => Partial<PcSnapshot>) {
  const acc = createAccumulator(0);
  // The first sample never has an interval (see readPcStats).
  addSnapshot(acc, snap({ ...make(0), intervalSeconds: 0 }, 0));
  for (let i = 1; i <= count; i += 1) addSnapshot(acc, snap(make(i), i * 10_000));
  return summarize(acc, (count + 1) * 10_000, direction);
}

// A healthy viewer session: not bad, and averages what it was given.
{
  const s = session("recv", 12, () => ({ recv: recv() }));
  assert.equal(s.bad, false);
  assert.deepEqual(s.causes, []);
  assert.equal(s.fpsAvg, 30);
  assert.equal(s.kbpsAvg, 2500);
  assert.equal(s.heightAvg, 1080);
  assert.equal(s.routeKind, "direct");
  assert.equal(s.routeChanged, false);
  assert.equal(s.samples, 13);
  assert.equal(s.durationS, 130);
  // Send-only fields stay null on a recv report, and vice versa below.
  assert.equal(s.cpuLimitedShare, null);
}

// Through TURN on its own is recorded but is not "bad": it is the variable
// being studied, and flagging it would drown the control group.
{
  const s = session("recv", 12, () => ({ route: route({ kind: "relay-remote", remoteType: "relay" }), recv: recv() }));
  assert.equal(s.bad, false);
  assert.deepEqual(s.causes, ["turn"]);
  assert.equal(s.routeKind, "relay-remote");
}

// A broadcaster held back by CPU for most of the session.
{
  const s = session("send", 12, (i) => ({ send: send({ cpuLimitedShare: i % 4 === 0 ? 0 : 0.7, fps: 12 }) }));
  assert.equal(s.bad, true);
  assert.ok(s.causes.includes("sender-cpu"));
  assert.ok(s.causes.includes("software-encoder"));
  assert.ok(s.cpuLimitedShare !== null && s.cpuLimitedShare > 0.4, String(s.cpuLimitedShare));
  assert.equal(s.freezes, null);
}

// One bad minute in a long session is not what went wrong with it.
{
  const s = session("send", 40, (i) => ({ send: send({ cpuLimitedShare: i < 4 ? 0.9 : 0 }) }));
  assert.equal(s.bad, false);
  assert.deepEqual(s.causes, []);
}

// A viewer freezing for more than 2% of the time is bad even with no single
// persistent cause.
{
  const s = session("recv", 30, (i) => ({ recv: recv(i % 10 === 0 ? { freezes: 1, freezeSeconds: 3 } : {}) }));
  assert.equal(s.freezes, 3);
  assert.equal(s.bad, true);
}

// A slideshow of moving content: low fps while still carrying real bitrate.
{
  const s = session("recv", 12, () => ({ recv: recv({ fps: 6, kbps: 1500 }) }));
  assert.equal(s.bad, true);
}
// ...but a still screen (low fps, almost no bits) is just a still screen.
{
  const s = session("recv", 12, () => ({ recv: recv({ fps: 2, kbps: 40 }) }));
  assert.equal(s.bad, false);
}

// The route switching mid-session is recorded.
{
  const s = session("recv", 12, (i) => ({
    route: i < 6 ? route() : route({ kind: "relay-local", localType: "relay", relayProtocol: "udp" }),
    recv: recv(),
  }));
  assert.equal(s.routeChanged, true);
  assert.equal(s.routeKind, "relay-local");
  assert.equal(s.relayProtocol, "udp");
}

// fps p10 is the low tail, not the mean.
{
  const s = session("recv", 20, (i) => ({ recv: recv({ fps: i <= 3 ? 5 : 30 }) }));
  assert.equal(s.fpsP10, 5);
  assert.ok(s.fpsAvg !== null && s.fpsAvg > 25);
}

// Undoing the sampling. 100 real sessions, 10 bad, good ones sampled at 20%:
// the API receives 10 bad + 18 good = 28 reports, which read raw is a 36% bad
// rate. The estimate has to give the real 10% back.
assert.equal(estimateSessions(28, 10, 0.2), 100);
assert.equal(estimateBadRate(28, 10, 0.2), 0.1);
// Nothing sampled away: raw and estimate agree.
assert.equal(estimateBadRate(50, 5, 1), 0.1);
// No sampling information: the raw count is all there is.
assert.equal(estimateSessions(28, 10, 0), 28);
assert.equal(estimateBadRate(0, 0, 0.2), 0);

console.log("connectionTelemetry: ok");
