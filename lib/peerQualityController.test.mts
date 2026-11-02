// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/peerQualityController.test.mts
//
// What one viewer's controller hands the sender.

import assert from "node:assert/strict";
import { PeerQualityRegistry, senderQualityState, setRelayCapExempt } from "./peerQualityController.ts";
import { setClassicSend } from "./classicSend.ts";
import type { SenderSample } from "./mediaStats.ts";
import { mediaStats } from "./mediaStats.ts";

type Encoding = RTCRtpEncodingParameters & { maxBitrate?: number; maxFramerate?: number };
type Params = { encodings: Encoding[]; degradationPreference?: RTCDegradationPreference };

function fakeSender() {
  const state = { params: { encodings: [{}] } as Params, pushes: 0, reject: false };
  const sender = {
    getParameters: () => JSON.parse(JSON.stringify(state.params)),
    setParameters: async (params: Params) => {
      if (state.reject) throw new Error("racing");
      state.pushes += 1;
      state.params = params;
    },
    track: null,
  } as unknown as RTCRtpSender;
  return { sender, state };
}

function fakePc() {
  const listeners = new Set<() => void>();
  return {
    connectionState: "new",
    iceConnectionState: "new",
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  } as unknown as RTCPeerConnection;
}

function setup(tier: Parameters<PeerQualityRegistry["add"]>[3] = "1080p30", capture = 1080, width = (capture * 16) / 9) {
  const registry = new PeerQualityRegistry(`test${Math.random()}`);
  const { sender, state } = fakeSender();
  const pc = fakePc();
  const controller = registry.add("viewer", pc, sender, tier, width, capture);
  return { registry, controller, state, pc };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const sample = (over: Partial<SenderSample> = {}): SenderSample => ({
  peerId: "viewer",
  fractionLost: 0,
  rtt: 0.02,
  outgoingKbps: 3000,
  framesPerSecond: 30,
  qualityLimitationReason: "none",
  frameWidth: 1920,
  frameHeight: 1080,
  sourceFps: 30,
  encodeMs: 8,
  qp: 30,
  codec: "VP8",
  targetKbps: 4000,
  availableKbps: 6000,
  ...over,
});

// maintain-resolution whatever the profile: it is what keeps WebRTC's quality
// scaler out of it, and that scaler is what held a 1080p share at 270 lines
// with 4 Mbps to spare.
{
  const { registry, controller, state } = setup();
  await tick();
  assert.equal(state.params.degradationPreference, "maintain-resolution");
  controller.setDegradation("motion");
  await tick();
  assert.equal(state.params.degradationPreference, "maintain-resolution");
  controller.setDegradation("text");
  await tick();
  assert.equal(state.params.degradationPreference, "maintain-resolution");
  registry.clear();
}

// A tier becomes a scale and a frame rate; a steady one costs no reconfiguration.
{
  const { registry, controller, state } = setup("1080p30");
  await tick();
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1);
  assert.equal(state.params.encodings[0].maxFramerate, 30);
  assert.equal(state.params.encodings[0].active, true);
  const pushes = state.pushes;
  controller.setRequest("1080p30", false);
  controller.setBitrateCeiling(6000);
  controller.apply();
  await tick();
  assert.equal(state.pushes, pushes, "nada mudou, nada empurrado");
  controller.setRequest("576p30", false);
  await tick();
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1.875);
  registry.clear();
}

// What the frames measure outranks what the track says: a window's frames are not
// always the size the track claims, and an odd picture costs a hardware encoder.
{
  const { registry, controller, state } = setup("576p30", 1080, 1920);
  await tick();
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1.875);
  controller.onSample(sample({ sourceWidth: 1920, sourceHeight: 1024 }));
  await tick();
  const scale = state.params.encodings[0].scaleResolutionDownBy ?? 0;
  assert.equal(Math.round(1920 / scale) % 2, 0);
  assert.equal(Math.round(1024 / scale) % 2, 0);
  assert.ok(Math.round(1024 / scale) <= 576);
  // The track's word no longer moves it.
  const pushes = state.pushes;
  controller.setCaptureSize(1920, 1080);
  await tick();
  assert.equal(state.pushes, pushes);
  registry.clear();
}

// A viewer who is not looking costs no encoder, and coming back is one
// reconfiguration even though the tier moves with it.
{
  const { registry, controller, state, pc } = setup("1080p30");
  await tick();
  controller.setRequest("576p15", true);
  await tick();
  assert.equal(state.params.encodings[0].active, false);
  assert.equal(senderQualityState(pc)?.paused, true);
  const pushes = state.pushes;
  controller.setRequest("1080p30", false);
  await tick();
  assert.equal(state.pushes, pushes + 1, "uma configuração só");
  assert.equal(state.params.encodings[0].active, true);
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1);
  registry.clear();
}

// A stopped encoder has nothing to say about the link.
{
  const { registry, controller, state } = setup("1080p30");
  await tick();
  controller.setRequest("576p15", true);
  await tick();
  const before = state.pushes;
  for (let i = 0; i < 20; i += 1) controller.onSample(sample({ framesPerSecond: 0 }));
  await tick();
  assert.equal(state.pushes, before);
  registry.clear();
}

// The bitrate stays at what the tier is worth while a link holds the height
// down: the estimator can only learn the link recovered by being allowed to
// use it.
{
  const { registry, controller, state, pc } = setup("1080p30");
  await tick();
  const ceiling = state.params.encodings[0].maxBitrate;
  const now = Date.now;
  const start = now();
  try {
    let t = start + 8000;
    Date.now = () => t;
    for (let i = 0; i < 4; i += 1) {
      controller.onSample(sample({ framesPerSecond: 15, targetKbps: 800, availableKbps: 800 }));
      t += 2000;
    }
    await tick();
    assert.equal(senderQualityState(pc)?.linkCapHeight, 720);
    assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1.5);
    assert.equal(state.params.encodings[0].maxBitrate, ceiling);
  } finally {
    Date.now = now;
  }
  registry.clear();
}

// The machine running short holds everyone down, bits included, and gives it all
// back: it is the one that decides the encoders' CPU, and bits are CPU too.
{
  const { registry, controller, state, pc } = setup("1080p30");
  await tick();
  const ceiling = state.params.encodings[0].maxBitrate ?? 0;
  const now = Date.now;
  const publish = () =>
    (mediaStats as unknown as { publish(s: unknown): void }).publish({
      availableOutgoingKbps: 0,
      usedOutgoingKbps: 0,
      cpuPressure: 0,
      sampledAt: 0,
    });
  try {
    let t = now() + 9000;
    Date.now = () => t;
    const pass = (s: Partial<SenderSample>) => {
      controller.onSample(sample(s));
      publish();
      t += 2000;
    };
    for (let i = 0; i < 6; i += 1) pass({ framesPerSecond: 12, encodeMs: 40 });
    await tick();
    const held = senderQualityState(pc);
    assert.ok((held?.machineLevel ?? 0) >= 2, "a máquina segurou");
    assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1.5);
    assert.ok((state.params.encodings[0].maxBitrate ?? 0) < ceiling * 0.6, "os bits caem junto");
    for (let i = 0; i < 40; i += 1) pass({});
    await tick();
    assert.equal(senderQualityState(pc)?.machineLevel, 0);
    assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1);
    assert.equal(state.params.encodings[0].maxBitrate, ceiling);
  } finally {
    Date.now = now;
  }
  registry.clear();
}

// A relayed connection is capped, unless the account is exempt.
{
  const { registry, controller, state } = setup("2160p60", 2160);
  await tick();
  controller.setRelayRoute("remote", true);
  await tick();
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 2);
  assert.ok((state.params.encodings[0].maxBitrate ?? 0) <= 4_000_000);
  setRelayCapExempt(true);
  await tick();
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1);
  setRelayCapExempt(false);
  registry.clear();
}

// A refused setParameters is undone and tried again: otherwise the guard would
// swallow everything after it, with the sender on the old values for good.
{
  const { registry, controller, state } = setup("1080p30");
  await tick();
  state.reject = true;
  controller.setRequest("720p30", false);
  await tick();
  state.reject = false;
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(state.params.encodings[0].scaleResolutionDownBy, 1.5);
  registry.clear();
}

// Experiment sq-classic-send: how it was. The profile's own preference, nothing
// stopped, nothing adapted by us.
{
  setClassicSend(true);
  const { registry, controller, state, pc } = setup("1080p30");
  await tick();
  controller.setDegradation("motion");
  await tick();
  assert.equal(state.params.degradationPreference, "maintain-framerate");
  controller.setDegradation("balanced");
  await tick();
  assert.equal(state.params.degradationPreference, "balanced");
  controller.setDegradation("text");
  await tick();
  assert.equal(state.params.degradationPreference, "maintain-resolution");
  controller.setRequest("576p15", true);
  await tick();
  assert.equal(state.params.encodings[0].active, true, "continua codificando");
  assert.equal(senderQualityState(pc)?.linkCapHeight, null);
  // Turning it off moves a running share back on the new path.
  setClassicSend(false);
  await tick();
  assert.equal(state.params.encodings[0].active, false);
  registry.clear();
}

mediaStats.getCapacity();
console.log("peerQualityController: ok");
