// node --experimental-strip-types lib/connectionTelemetry.test.mts
//
// Pins what a per-session quality report says, above all whether it is "bad":
// every bad session is sent and only a sample of the good ones, so this rule
// decides what the telemetry can ever show.

import assert from "node:assert/strict";
import {
  addSnapshot,
  blameFor,
  createAccumulator,
  estimateBadRate,
  estimateSessions,
  noteIceAttempt,
  summarize,
  type SenderControlSample,
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
function session(
  direction: "send" | "recv",
  count: number,
  make: (i: number) => Partial<PcSnapshot>,
  channel?: string
) {
  const acc = createAccumulator(0);
  // The first sample never has an interval (see readPcStats).
  addSnapshot(acc, snap({ ...make(0), intervalSeconds: 0 }, 0));
  for (let i = 1; i <= count; i += 1) addSnapshot(acc, snap(make(i), i * 10_000));
  return summarize(acc, (count + 1) * 10_000, direction, channel);
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

// A screen share freezes by nature (every stop in motion counts as one), so
// the same 3% of the time frozen is not bad there — and 10% still is.
{
  const s = session(
    "recv",
    30,
    (i) => ({ recv: recv(i % 10 === 0 ? { freezes: 1, freezeSeconds: 3 } : {}) }),
    "screen"
  );
  assert.equal(s.bad, false);
  const worse = session("recv", 30, () => ({ recv: recv({ freezes: 1, freezeSeconds: 1 }) }), "screen");
  assert.equal(worse.bad, true);
}

// A sender's target and available bitrate are averaged; a viewer's are not reported.
{
  const s = session("send", 6, () => ({
    route: route({ availableOutgoingKbps: 5000 }),
    send: send({ targetKbps: 2000 }),
  }));
  assert.equal(s.targetKbpsAvg, 2000);
  assert.equal(s.availableKbpsAvg, 5000);
  assert.equal(session("recv", 6, () => ({ recv: recv() })).targetKbpsAvg, null);
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

// A received slideshow on a clean link is the broadcaster's doing: named
// "low-source-fps" and blamed on the sender.
{
  const s = session("recv", 12, () => ({ recv: recv({ fps: 5, kbps: 1000 }) }), "screen");
  assert.equal(s.bad, true);
  assert.ok(s.causes.includes("low-source-fps"));
  assert.equal(s.blame, "sender");
}
// The same slideshow with real loss is the network's.
{
  const s = session("recv", 12, () => ({ recv: recv({ fps: 5, kbps: 1000, loss: 0.1 }) }), "screen");
  assert.ok(!s.causes.includes("low-source-fps"));
  assert.equal(s.blame, "network");
}
// A good session carries no blame.
assert.equal(session("recv", 12, () => ({ recv: recv() })).blame, null);

// Blame on the send side: held back on a clean link is the encoder; with loss, the link.
assert.equal(blameFor("send", ["sender-bandwidth"], true), "sender");
assert.equal(blameFor("send", ["network-loss", "sender-bandwidth"], true), "network");
assert.equal(blameFor("send", ["sender-cpu", "network-loss"], true), "sender");
assert.equal(blameFor("recv", ["freezes"], true), "unknown");
assert.equal(blameFor("recv", ["freezes", "receiver-drops"], true), "receiver");

// What the encoder and our controller did, averaged over a send session.
{
  const acc = createAccumulator(0);
  const control = (linkCapHeight: number | null, machineLevel = 0): SenderControlSample => ({
    tier: "1080p30",
    ceilingKbps: 4000,
    degradationPreference: "balanced",
    linkCapHeight,
    machineLevel,
    paused: false,
  });
  addSnapshot(acc, snap({ send: send(), intervalSeconds: 0 }, 0), control(null));
  for (let i = 1; i <= 4; i += 1) {
    addSnapshot(acc, snap({ send: send({ qp: 30 + i * 2, resolutionChanges: 1 }) }, i * 10_000), control(i % 2 ? 720 : null, i === 1 ? 1 : 0));
  }
  const s = summarize(acc, 50_000, "send", "screen");
  assert.equal(s.qpAvg, 35);
  assert.equal(s.resolutionChanges, 4);
  assert.equal(s.tier, "1080p30");
  assert.equal(s.ceilingKbpsAvg, 4000);
  assert.equal(s.linkCapShare, 0.5);
  assert.equal(s.machineCapShare, 0.25);
  assert.equal(s.degradationPreference, "balanced");
  // None of it belongs on a recv report.
  const r = session("recv", 4, () => ({ recv: recv() }));
  assert.equal(r.qpAvg, null);
  assert.equal(r.linkCapShare, null);
}

// A connection that never came up says what ICE had to work with, and nothing else:
// no addresses. One that did come up has nothing to say about it.
{
  const acc = createAccumulator(0);
  noteIceAttempt(acc, [
    { type: "local-candidate", candidateType: "host", address: "192.0.2.1" },
    { type: "local-candidate", candidateType: "srflx", address: "198.51.100.7" },
    { type: "remote-candidate", candidateType: "srflx", address: "203.0.113.9" },
    { type: "candidate-pair", responsesReceived: 0, requestsSent: 12 },
    { type: "candidate-pair", responsesReceived: 2, requestsSent: 12 },
    { type: "transport" },
  ]);
  noteIceAttempt(acc, [{ type: "candidate-pair", responsesReceived: 1 }]);
  const s = summarize(acc, 25_000, "recv", "screen");
  assert.equal(s.iceLocal, "host,srflx");
  assert.equal(s.iceRemote, "srflx");
  assert.equal(s.icePairs, 2);
  assert.equal(s.iceResponses, 2);
  assert.ok(!JSON.stringify(s).includes("192.0.2.1"), "nenhum endereço no relatório");
  const empty = summarize(createAccumulator(0), 25_000, "recv", "screen");
  assert.equal(empty.iceRemote, "", "nenhum candidato deles: a sinalização perdeu");
  const connected = createAccumulator(0);
  connected.connectedAt = 100;
  noteIceAttempt(connected, [{ type: "local-candidate", candidateType: "host" }]);
  assert.equal(summarize(connected, 25_000, "recv", "screen").iceLocal, null);
}

// A stretch nobody was looking at says nothing about the stream: a viewer who
// came back after an hour away was not watching an hour of zero frames.
{
  const acc = createAccumulator(0);
  for (let i = 1; i <= 4; i += 1) addSnapshot(acc, snap({ recv: recv({ fps: 30 }) }, i * 10_000), null, true);
  for (let i = 5; i <= 12; i += 1) {
    addSnapshot(acc, snap({ recv: recv({ fps: 0, freezes: 3, freezeSeconds: 9 }) }, i * 10_000), null, false, true);
  }
  const s = summarize(acc, 130_000, "recv", "screen");
  assert.equal(s.fpsAvg, 30);
  assert.equal(s.freezes, 0);
  assert.equal(s.pausedShare, 0.67);
  assert.equal(s.bad, false);
}

// Nor does a sender's: its zeroes are what the viewer asked for.
{
  const acc = createAccumulator(0);
  const paused: SenderControlSample = {
    tier: "576p15",
    ceilingKbps: 900,
    degradationPreference: "maintain-resolution",
    linkCapHeight: null,
    machineLevel: 0,
    paused: true,
  };
  for (let i = 1; i <= 4; i += 1) addSnapshot(acc, snap({ send: send({ fps: 30 }) }, i * 10_000));
  for (let i = 5; i <= 8; i += 1) addSnapshot(acc, snap({ send: send({ fps: 0, kbps: 0 }) }, i * 10_000), paused, null, true);
  const s = summarize(acc, 90_000, "send", "screen");
  assert.equal(s.fpsAvg, 30);
  assert.equal(s.pausedShare, 0.5);
}

// The capture's rate and the encoder's time per frame, averaged on a send report.
{
  const s = session("send", 4, () => ({ send: send({ sourceFps: 24, encodeMs: 12.5 }) }), "screen");
  assert.equal(s.sourceFpsAvg, 24);
  assert.equal(s.encodeMsAvg, 12.5);
  assert.equal(session("recv", 4, () => ({ recv: recv() })).sourceFpsAvg, null);
}

// A sender's own slideshow is bad and the sender's, though its encoder never
// said it was limited — libvpx's frame dropper does not.
{
  const s = session("send", 6, () => ({ send: send({ fps: 6, kbps: 900 }) }), "screen");
  assert.equal(s.bad, true);
  assert.ok(s.causes.includes("low-source-fps"));
  assert.equal(s.blame, "sender");
  // A still screen sends few frames and almost no bits: not a slideshow.
  assert.equal(session("send", 6, () => ({ send: send({ fps: 3, kbps: 80 }) }), "screen").bad, false);
}

// A TCP relay on its own is a route, not a symptom.
{
  const tcp = route({ kind: "relay-local", localType: "relay", relayProtocol: "tcp" });
  const s = session("recv", 6, () => ({ route: tcp, recv: recv() }), "screen");
  assert.ok(s.causes.includes("turn-tcp"));
  assert.equal(s.bad, false);
}

// A received slideshow or freezes while the tile was off screen are what the
// viewer asked for (the worst tier), not a fault; on screen they still count.
{
  const run = (visible: boolean | null) => {
    const acc = createAccumulator(0);
    const r = recv({ fps: 5, kbps: 600 });
    addSnapshot(acc, snap({ recv: r, intervalSeconds: 0 }, 0), null, visible);
    for (let i = 1; i <= 6; i += 1) addSnapshot(acc, snap({ recv: r }, i * 10_000), null, visible);
    return summarize(acc, 70_000, "recv", "screen");
  };
  const hidden = run(false);
  assert.equal(hidden.bad, false);
  assert.equal(hidden.visibleShare, 0);
  assert.ok(!hidden.causes.includes("low-source-fps"));
  assert.equal(run(true).bad, true);
  assert.equal(run(true).visibleShare, 1);
  // Nobody said: judged as before.
  assert.equal(run(null).bad, true);
  assert.equal(run(null).visibleShare, null);
}

// The tile that spins forever: connected, measured, and not one frame.
{
  const acc = createAccumulator(0);
  acc.connectedAt = 1000;
  const empty = recv({ fps: 0, kbps: 0, framesDecodedTotal: 0 });
  addSnapshot(acc, snap({ recv: empty, intervalSeconds: 0 }, 0));
  for (let i = 1; i <= 3; i += 1) addSnapshot(acc, snap({ recv: empty }, i * 10_000));
  const s = summarize(acc, 40_000, "recv", "screen");
  assert.equal(s.bad, true);
  assert.deepEqual(s.causes, ["no-video"]);
  assert.equal(s.blame, "unknown");
  assert.equal(s.firstFrameS, null);
}
// Never connected at all: the path's failure.
{
  const acc = createAccumulator(0);
  const s = summarize(acc, 30_000, "recv", "screen");
  assert.ok(s.causes.includes("no-video"));
  assert.equal(s.blame, "network");
  // A sender has nothing to decode.
  assert.ok(!summarize(createAccumulator(0), 30_000, "send", "screen").causes.includes("no-video"));
}
// Connected but not measured long enough yet: no verdict.
{
  const acc = createAccumulator(0);
  acc.connectedAt = 1000;
  addSnapshot(acc, snap({ recv: recv({ fps: 0, kbps: 0 }), intervalSeconds: 0 }, 0));
  assert.ok(!summarize(acc, 25_000, "recv", "screen").causes.includes("no-video"));
}
// The first frame's time, at the sampler's grain.
{
  const acc = createAccumulator(0);
  acc.connectedAt = 0;
  addSnapshot(acc, snap({ recv: recv({ fps: 0, framesDecodedTotal: 0 }), intervalSeconds: 0 }, 0));
  addSnapshot(acc, snap({ recv: recv({ framesDecodedTotal: 240 }) }, 10_000));
  addSnapshot(acc, snap({ recv: recv({ framesDecodedTotal: 540 }) }, 20_000));
  const s = summarize(acc, 30_000, "recv", "screen");
  assert.equal(s.firstFrameS, 10);
  assert.ok(!s.causes.includes("no-video"));
}

console.log("connectionTelemetry: ok");
