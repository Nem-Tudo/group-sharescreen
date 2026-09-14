// node --experimental-strip-types lib/connectionDiagnostics.test.mts
//
// Pins what the connection-stats panel and the quality telemetry *say*. Both
// exist to tell apart "the route goes through TURN", "the broadcaster's machine
// cannot keep up" and "this viewer's machine cannot keep up" — so a rule that
// silently names the wrong one is worse than no panel at all.

import assert from "node:assert/strict";
import {
  classifyRoute,
  diagnose,
  isHardwareImplementation,
  readPcStats,
  type RecvVideoStats,
  type RouteInfo,
  type SendVideoStats,
} from "./connectionDiagnostics";

type Rec = Record<string, unknown>;

function pairRecords(local: string, remote: string, extra: Rec = {}, localExtra: Rec = {}): Rec[] {
  return [
    { id: "T1", type: "transport", selectedCandidatePairId: "CP1" },
    {
      id: "CP1",
      type: "candidate-pair",
      localCandidateId: "L1",
      remoteCandidateId: "R1",
      state: "succeeded",
      nominated: true,
      currentRoundTripTime: 0.04,
      availableOutgoingBitrate: 6_000_000,
      ...extra,
    },
    { id: "L1", type: "local-candidate", candidateType: local, protocol: "udp", address: "10.0.0.2", ...localExtra },
    { id: "R1", type: "remote-candidate", candidateType: remote, protocol: "udp", address: "203.0.113.9" },
  ];
}

function outbound(over: Rec = {}): Rec[] {
  return [
    {
      id: "OT1",
      type: "outbound-rtp",
      kind: "video",
      bytesSent: 1_000_000,
      framesEncoded: 900,
      framesPerSecond: 30,
      frameWidth: 1920,
      frameHeight: 1080,
      qualityLimitationReason: "none",
      qualityLimitationDurations: { none: 30, cpu: 0, bandwidth: 0, other: 0 },
      encoderImplementation: "libvpx",
      codecId: "C1",
      nackCount: 0,
      pliCount: 0,
      ...over,
    },
    { id: "C1", type: "codec", mimeType: "video/VP9" },
    { id: "RI1", type: "remote-inbound-rtp", kind: "video", fractionLost: 0, roundTripTime: 0.04 },
  ];
}

function inbound(over: Rec = {}): Rec[] {
  return [
    {
      id: "IT1",
      type: "inbound-rtp",
      kind: "video",
      bytesReceived: 1_000_000,
      packetsReceived: 1000,
      packetsLost: 0,
      framesReceived: 900,
      framesDropped: 0,
      framesPerSecond: 30,
      frameWidth: 1920,
      frameHeight: 1080,
      freezeCount: 0,
      totalFreezesDuration: 0,
      jitter: 0.004,
      jitterBufferDelay: 9,
      jitterBufferEmittedCount: 900,
      decoderImplementation: "ExternalDecoder",
      codecId: "C2",
      ...over,
    },
    { id: "C2", type: "codec", mimeType: "video/VP9" },
  ];
}

// --- Route --------------------------------------------------------------------

assert.equal(classifyRoute("host", "srflx"), "direct");
assert.equal(classifyRoute("prflx", "host"), "direct");
assert.equal(classifyRoute("relay", "srflx"), "relay-local");
assert.equal(classifyRoute("srflx", "relay"), "relay-remote");
assert.equal(classifyRoute("relay", "relay"), "relay-both");
assert.equal(classifyRoute("unknown", "unknown"), "unknown");

{
  const { snapshot } = readPcStats(pairRecords("srflx", "host"), null, 1000);
  assert.equal(snapshot.route.kind, "direct");
  assert.equal(snapshot.route.rttMs, 40);
  assert.equal(snapshot.route.availableOutgoingKbps, 6000);
  assert.equal(snapshot.route.relayProtocol, null);
  // Nothing about a candidate's address may reach the snapshot.
  assert.ok(!JSON.stringify(snapshot).includes("10.0.0.2"));
  assert.ok(!JSON.stringify(snapshot).includes("203.0.113.9"));
}

{
  // Our side relays over TCP.
  const { snapshot } = readPcStats(pairRecords("relay", "srflx", {}, { relayProtocol: "tcp" }), null, 1000);
  assert.equal(snapshot.route.kind, "relay-local");
  assert.equal(snapshot.route.relayProtocol, "tcp");
  // The browser left the server out (Firefox): nothing to report.
  assert.equal(snapshot.route.relayUrl, null);
}

{
  // Which TURN server our relay candidate came from — what tells Cloudflare
  // apart from the VPS in the stats panel. A server URL, never our address.
  const url = "turn:turn.cloudflare.com:3478?transport=udp";
  const { snapshot } = readPcStats(pairRecords("relay", "host", {}, { relayProtocol: "udp", url }), null, 1000);
  assert.equal(snapshot.route.relayUrl, url);
  // A direct connection carries none, whatever else was gathered.
  const direct = readPcStats(pairRecords("host", "host", {}, { url }), null, 1000).snapshot;
  assert.equal(direct.route.relayUrl, null);
}

{
  // No transport pointer (Firefox): falls back to the pair flagged selected.
  const records = pairRecords("host", "relay").filter((r) => r.type !== "transport");
  records[0].selected = true;
  const { snapshot } = readPcStats(records, null, 1000);
  assert.equal(snapshot.route.kind, "relay-remote");
}

{
  // An empty report (a pc that has not connected) is "unknown", not "direct".
  const { snapshot } = readPcStats([], null, 1000);
  assert.equal(snapshot.route.kind, "unknown");
  assert.equal(snapshot.send, null);
  assert.equal(snapshot.recv, null);
}

// --- Deltas -------------------------------------------------------------------

{
  const first = readPcStats([...pairRecords("host", "host"), ...outbound()], null, 1000);
  assert.equal(first.snapshot.intervalSeconds, 0);
  assert.equal(first.snapshot.send?.kbps, 0, "a first sample has no rate");
  assert.equal(first.snapshot.send?.codec, "VP9");
  assert.equal(first.snapshot.send?.hardware, false, "libvpx is software");

  const second = readPcStats(
    [
      ...pairRecords("host", "host"),
      ...outbound({
        bytesSent: 1_500_000, // 500 kB in 2 s = 2 Mbps
        qualityLimitationDurations: { none: 30.5, cpu: 1.5, bandwidth: 0, other: 0 },
        nackCount: 4,
      }),
    ],
    first.counters,
    3000
  );
  assert.equal(second.snapshot.intervalSeconds, 2);
  assert.equal(second.snapshot.send?.kbps, 2000);
  // 1.5 of the 2 seconds limited by CPU.
  assert.equal(second.snapshot.send?.cpuLimitedShare, 0.75);
  assert.equal(second.snapshot.send?.nackPerSecond, 2);
}

{
  // Counters going backwards means a rebuilt pc: treated as a first sample
  // instead of producing a negative or enormous rate.
  const first = readPcStats(outbound({ bytesSent: 5_000_000 }), null, 1000);
  const second = readPcStats(outbound({ bytesSent: 10_000 }), first.counters, 3000);
  assert.equal(second.snapshot.intervalSeconds, 0);
  assert.equal(second.snapshot.send?.kbps, 0);
}

{
  const first = readPcStats(inbound(), null, 1000);
  const second = readPcStats(
    inbound({
      bytesReceived: 1_500_000,
      packetsReceived: 1900,
      packetsLost: 100,
      framesReceived: 960,
      framesDropped: 12,
      freezeCount: 1,
      totalFreezesDuration: 0.4,
      jitterBufferDelay: 12,
      jitterBufferEmittedCount: 960,
    }),
    first.counters,
    3000
  );
  const recv = second.snapshot.recv!;
  assert.equal(recv.kbps, 2000);
  assert.equal(recv.loss, 0.1, "100 lost of 1000 sent in the interval");
  assert.equal(recv.dropShare, 0.2, "12 of 60 frames");
  assert.equal(recv.freezes, 1);
  assert.equal(recv.freezeSeconds, 0.4);
  assert.equal(recv.jitterBufferMs, 50, "3 s of delay over 60 frames");
  assert.equal(recv.hardware, true, "ExternalDecoder is the platform decoder");
}

// --- Hardware detection --------------------------------------------------------

assert.equal(isHardwareImplementation("libvpx", true), true, "the browser's own flag wins");
assert.equal(isHardwareImplementation("MediaFoundationVideoEncodeAccelerator", undefined), true);
assert.equal(isHardwareImplementation("OpenH264", undefined), false);
assert.equal(isHardwareImplementation("SimulcastEncoderAdapter (libvpx, ExternalEncoder)", undefined), false);
assert.equal(isHardwareImplementation("SomethingNew", undefined), null, "unknown stays unknown");
assert.equal(isHardwareImplementation(null, undefined), null);

// --- Causes -------------------------------------------------------------------

function route(over: Partial<RouteInfo> = {}): RouteInfo {
  return {
    kind: "direct",
    localType: "host",
    remoteType: "host",
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

const ids = (input: Parameters<typeof diagnose>[0]) => diagnose(input).map((c) => c.id);

// A healthy stream says nothing — including about a software encoder, which
// is what most people have and is not a problem on its own.
assert.deepEqual(ids({ route: route(), send: send(), recv: recv() }), []);

assert.deepEqual(ids({ route: route({ kind: "relay-remote" }), send: null, recv: recv() }), ["turn"]);
assert.deepEqual(
  ids({ route: route({ kind: "relay-local", relayProtocol: "tls" }), send: null, recv: null }),
  ["turn-tcp"]
);

// The broadcaster's CPU: named, with the software encoder as the follow-up.
assert.deepEqual(ids({ route: route(), send: send({ cpuLimitedShare: 0.6 }), recv: recv() }), [
  "sender-cpu",
  "software-encoder",
]);
// Same shortage on a hardware encoder: only the CPU.
assert.deepEqual(ids({ route: route(), send: send({ limitation: "cpu", hardware: true }), recv: null }), [
  "sender-cpu",
]);

assert.deepEqual(ids({ route: route(), send: send({ bandwidthLimitedShare: 0.5 }), recv: null }), [
  "sender-bandwidth",
]);

// Loss from either end's report, graded.
assert.deepEqual(diagnose({ route: route(), send: null, recv: recv({ loss: 0.04 }) }), [
  { id: "network-loss", severity: "medium" },
]);
assert.deepEqual(diagnose({ route: route(), send: send({ remoteLoss: 0.1 }), recv: null }), [
  { id: "network-loss", severity: "high" },
]);

assert.deepEqual(ids({ route: route({ rttMs: 300 }), send: null, recv: null }), ["high-rtt"]);

// The viewer's own machine.
assert.deepEqual(ids({ route: route(), send: null, recv: recv({ dropShare: 0.25, freezes: 2 }) }), [
  "receiver-drops",
  "freezes",
]);

// Highs sort ahead of mediums whatever order the rules ran in.
{
  const causes = diagnose({
    route: route({ kind: "relay-both" }),
    send: send({ bandwidthLimitedShare: 0.4 }),
    recv: recv({ freezes: 1 }),
  });
  assert.deepEqual(
    causes.map((c) => c.severity),
    ["high", "medium", "medium"]
  );
  assert.equal(causes[0].id, "sender-bandwidth");
}

console.log("connectionDiagnostics: ok");
