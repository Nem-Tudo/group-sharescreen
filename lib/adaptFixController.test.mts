// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/adaptFixController.test.mts
//
// Experiment sq-adapt-fix through the controller: a viewer back from a pause, and a connection
// that loses the costly codec, each against what happens without it.

import assert from "node:assert/strict";

// The controller reads the clock itself; this one only moves when told to.
let clock = 1_700_000_000_000;
Date.now = () => clock;

const { PeerQualityRegistry, senderQualityState } = await import("./peerQualityController.ts");
const { setClassicSend } = await import("./classicSend.ts");
const { setH264Send } = await import("./h264Send.ts");
const { setAdaptFix } = await import("./adaptFix.ts");
type SenderSample = import("./mediaStats.ts").SenderSample;

type Encoding = RTCRtpEncodingParameters & { maxBitrate?: number; codec?: RTCRtpCodec };
type Params = { encodings: Encoding[]; codecs?: RTCRtpCodec[] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const SECOND = 1000;

function viewer(registry: InstanceType<typeof PeerQualityRegistry>, id: string, choosesCodec: boolean) {
  const state = { params: { encodings: [{}] } as Params };
  const sender = {
    getParameters: () => JSON.parse(JSON.stringify(state.params)),
    setParameters: async (params: Params) => {
      state.params = params;
    },
    track: { contentHint: "motion", kind: "video" },
  } as unknown as RTCRtpSender;
  const listeners = new Set<() => void>();
  const pc = {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable",
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    fire: () => listeners.forEach((f) => f()),
  } as unknown as RTCPeerConnection & { fire(): void };
  const controller = registry.add(id, pc, sender, "1080p30", 1920, 1080, choosesCodec);
  return { controller, state, pc };
}

const sample = (over: Partial<SenderSample> = {}): SenderSample => ({
  peerId: "viewer",
  fractionLost: 0,
  rtt: 0.02,
  outgoingKbps: 1000,
  framesPerSecond: 30,
  qualityLimitationReason: "none",
  frameWidth: 1280,
  frameHeight: 720,
  sourceFps: 30,
  encodeMs: 8,
  qp: 34,
  codec: "H264",
  targetKbps: 1100,
  availableKbps: 1100,
  ...over,
});

setClassicSend(false);
Object.defineProperty(globalThis.navigator, "hardwareConcurrency", { value: 6, configurable: true });

// A link that carries 720p and not 1080p. Held at 720, a minute's pause, and two minutes more
// on the same link: how long it goes out at a height the link cannot carry.
async function resume(fixed: boolean) {
  setAdaptFix(fixed);
  const registry = new PeerQualityRegistry(`resume${fixed}`);
  const v = viewer(registry, "viewer", false);
  const at = () => {
    const height = senderQualityState(v.pc)?.linkCapHeight ?? 1080;
    return height >= 1080
      ? sample({ framesPerSecond: 9, qualityLimitationReason: "bandwidth", qp: 40, frameHeight: 1080, frameWidth: 1920 })
      : sample({ frameHeight: height });
  };
  for (let t = 0; t < 30 * SECOND; t += 2 * SECOND) {
    clock += 2 * SECOND;
    v.controller.onSample(at());
  }
  assert.equal(senderQualityState(v.pc)?.linkCapHeight, 720);
  v.controller.setRequest("1080p30", true);
  clock += 60 * SECOND;
  v.controller.setRequest("1080p30", false);
  let overMs = 0;
  for (let t = 0; t < 120 * SECOND; t += 2 * SECOND) {
    clock += 2 * SECOND;
    if ((senderQualityState(v.pc)?.linkCapHeight ?? 1080) > 720) overMs += 2 * SECOND;
    v.controller.onSample(at());
  }
  const state = senderQualityState(v.pc);
  registry.clear();
  setAdaptFix(false);
  return { overMs, downs: state?.linkDowns ?? 0 };
}
{
  const before = await resume(false);
  const after = await resume(true);
  assert.ok(before.overMs >= 6 * SECOND, `sem o experimento: ${before.overMs / SECOND} s acima do que o link carrega`);
  assert.equal(after.overMs, 0);
  assert.ok(before.downs > after.downs, `e mais degraus para baixo (${before.downs} contra ${after.downs})`);
}

// A moving picture in AV1 at 1080 on 1.5 Mbps, and the costly codec taken away.
const AV1 = { mimeType: "video/AV1", clockRate: 90000 };
const H264 = { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "packetization-mode=1;profile-level-id=42e01f" };
async function leaveSharp(fixed: boolean) {
  setAdaptFix(fixed);
  const registry = new PeerQualityRegistry(`sharp${fixed}`);
  const v = viewer(registry, "a", true);
  v.state.params.codecs = [H264, AV1];
  v.pc.fire();
  await tick();
  assert.equal(v.state.params.encodings[0].codec?.mimeType, "video/AV1");
  for (let t = 0; t < 20 * SECOND; t += 2 * SECOND) {
    clock += 2 * SECOND;
    v.controller.onSample(sample({ codec: "AV1", qp: 150, frameHeight: 1080, frameWidth: 1920, availableKbps: 1500, outgoingKbps: 1300 }));
  }
  setH264Send(true);
  await tick();
  const out = {
    codec: v.state.params.encodings[0].codec?.mimeType,
    scale: v.state.params.encodings[0].scaleResolutionDownBy,
    switches: senderQualityState(v.pc)?.codecSwitches,
  };
  setH264Send(false);
  registry.clear();
  setAdaptFix(false);
  return out;
}
{
  const before = await leaveSharp(false);
  const after = await leaveSharp(true);
  assert.equal(before.codec, "video/H264");
  assert.equal(after.codec, "video/H264");
  assert.equal(before.scale, 1, "sem o experimento: H264 em 1080 num link que não carrega");
  assert.equal(after.scale, 1.5, "com ele: 720 desde o primeiro quadro");
  assert.equal(after.switches, 1);
}

console.log("adaptFixController ok");
