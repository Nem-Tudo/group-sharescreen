// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/peerQualityController.test.mts
//
// What one viewer's controller hands the sender.

import assert from "node:assert/strict";
import { PeerQualityRegistry, senderQualityState, setRelayCapExempt } from "./peerQualityController.ts";
import { isClassicSend, setClassicSend } from "./classicSend.ts";
import { setH264Send } from "./h264Send.ts";
import type { SenderSample } from "./mediaStats.ts";
import { mediaStats } from "./mediaStats.ts";

type Encoding = RTCRtpEncodingParameters & { maxBitrate?: number; maxFramerate?: number; codec?: RTCRtpCodec };
type Params = { encodings: Encoding[]; degradationPreference?: RTCDegradationPreference; codecs?: RTCRtpCodec[] };

function fakeSender() {
  const state = { params: { encodings: [{}] } as Params, pushes: 0, reject: false };
  const track = { contentHint: "motion", kind: "video" };
  const sender = {
    getParameters: () => JSON.parse(JSON.stringify(state.params)),
    setParameters: async (params: Params) => {
      if (state.reject) throw new Error("racing");
      state.pushes += 1;
      state.params = params;
    },
    track,
  } as unknown as RTCRtpSender;
  return { sender, state, track };
}

function fakePc() {
  const listeners = new Set<() => void>();
  return {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable",
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    fire: () => listeners.forEach((f) => f()),
  } as unknown as RTCPeerConnection & { fire(): void };
}

function setup(tier: Parameters<PeerQualityRegistry["add"]>[3] = "1080p30", capture = 1080, width = (capture * 16) / 9) {
  const registry = new PeerQualityRegistry(`test${Math.random()}`);
  const { sender, state } = fakeSender();
  const pc = fakePc();
  const controller = registry.add("viewer", pc, sender, tier, width, capture);
  return { registry, controller, state, pc };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Nobody is on the new path without being in experiment sq-new-send, which is what the rest of
// this file goes through.
assert.equal(isClassicSend(), true);
setClassicSend(false);

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

// --- which codec ------------------------------------------------------------

const AV1 = { mimeType: "video/AV1", clockRate: 90000 };
const H264 = { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "packetization-mode=1;profile-level-id=42e01f" };
const H264_SINGLE = { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "packetization-mode=0;profile-level-id=42e01f" };
const VP8 = { mimeType: "video/VP8", clockRate: 90000 };

function setCores(cores: number) {
  Object.defineProperty(globalThis.navigator, "hardwareConcurrency", { value: cores, configurable: true });
}

function viewer(registry: PeerQualityRegistry, id: string, tier: Parameters<PeerQualityRegistry["add"]>[3] = "1080p30") {
  const { sender, state, track } = fakeSender();
  const pc = fakePc();
  const controller = registry.add(id, pc, sender, tier, 1920, 1080, true);
  return { controller, state, track, pc };
}

// The answer arriving: until then there is nothing to choose from.
async function negotiate(v: ReturnType<typeof viewer>, codecs: RTCRtpCodec[] = [H264_SINGLE, H264, AV1, VP8]) {
  v.state.params.codecs = codecs;
  v.pc.fire();
  await tick();
}
const sentCodec = (v: ReturnType<typeof viewer>) => v.state.params.encodings[0].codec?.mimeType;

setCores(6);

// The first viewer the machine can afford goes out in it, in the encoder's screen mode.
{
  const registry = new PeerQualityRegistry("codec1");
  const v = viewer(registry, "a");
  await tick();
  assert.equal(sentCodec(v), undefined, "nada negociado ainda");
  assert.equal(v.track.contentHint, "detail");
  await negotiate(v);
  assert.equal(sentCodec(v), "video/AV1");
  assert.equal(senderQualityState(v.pc)?.sharp, true);
  // A steady one costs no reconfiguration.
  const pushes = v.state.pushes;
  v.controller.apply();
  v.pc.fire();
  await tick();
  assert.equal(v.state.pushes, pushes);
  registry.clear();
}

// The next one does not fit, and goes in H264, in its camera mode. The first is not touched.
{
  const registry = new PeerQualityRegistry("codec2");
  const a = viewer(registry, "a");
  const b = viewer(registry, "b");
  await negotiate(a);
  await negotiate(b);
  assert.equal(sentCodec(a), "video/AV1");
  assert.equal(sentCodec(b), "video/H264");
  assert.match(b.state.params.encodings[0].codec?.sdpFmtpLine ?? "", /packetization-mode=1/);
  assert.equal(a.track.contentHint, "detail");
  assert.equal(b.track.contentHint, "motion");
  registry.clear();
}

// More cores, more of them, and a smaller tile takes less.
{
  setCores(12);
  const registry = new PeerQualityRegistry("codec3");
  const views = ["a", "b", "c"].map((id) => viewer(registry, id));
  for (const v of views) await negotiate(v);
  assert.deepEqual(views.map(sentCodec), ["video/AV1", "video/AV1", "video/H264"]);
  registry.clear();
  setCores(6);
}

// A viewer who left it out of the answer gets what they do have, and leaves room for the next.
{
  const registry = new PeerQualityRegistry("codec4");
  const a = viewer(registry, "a");
  await negotiate(a, [H264, VP8]);
  assert.equal(sentCodec(a), "video/H264");
  assert.equal(a.track.contentHint, "motion");
  assert.equal(senderQualityState(a.pc)?.sharp, false);
  const b = viewer(registry, "b");
  await negotiate(b);
  assert.equal(sentCodec(b), "video/AV1");
  // And without H264 either, the next thing there is.
  const c = viewer(registry, "c");
  await negotiate(c, [VP8]);
  assert.equal(sentCodec(c), "video/VP8");
  registry.clear();
}

// The graphics card's encoder holds four streams. Past that, a software one.
{
  setCores(1);
  const onCard = sample({ codec: "H264", encoderImplementation: "MediaFoundationVideoEncodeAccelerator", powerEfficient: true });
  const registry = new PeerQualityRegistry("codec-card");
  const views = ["a", "b", "c", "d", "e", "f"].map((id) => viewer(registry, id));
  for (const v of views) await negotiate(v);
  assert.deepEqual(views.map(sentCodec), Array(6).fill("video/H264"), "até saber que é a placa");
  views[0].controller.onSample(onCard);
  await tick();
  const held = ["video/H264", "video/H264", "video/H264", "video/H264", "video/VP8", "video/VP8"];
  assert.deepEqual(views.map(sentCodec), held);
  for (const v of views.slice(0, 4)) v.controller.onSample(onCard);
  await tick();
  // Going on the software one does not take the place back.
  views[4].controller.onSample(sample({ codec: "VP8", encoderImplementation: "libvpx", powerEfficient: false }));
  await tick();
  assert.deepEqual(views.map(sentCodec), held);
  const pushes = views[0].state.pushes;
  views[0].controller.apply();
  await tick();
  assert.equal(views[0].state.pushes, pushes, "sem reconfigurar quem ficou");
  // Whoever leaves or stops looking hands theirs over, and it is the next one's.
  registry.remove("a");
  await tick();
  assert.deepEqual(views.slice(1).map(sentCodec), ["video/H264", "video/H264", "video/H264", "video/H264", "video/VP8"]);
  views[1].controller.setRequest("576p15", true);
  await tick();
  assert.equal(sentCodec(views[5]), "video/H264");
  registry.clear();
}
// A viewer with nothing else stays where they are.
{
  setCores(1);
  const onCard = sample({ codec: "H264", encoderImplementation: "MediaFoundationVideoEncodeAccelerator", powerEfficient: true });
  const registry = new PeerQualityRegistry("codec-card2");
  const views = ["a", "b", "c", "d", "e"].map((id) => viewer(registry, id));
  for (const v of views) await negotiate(v, [H264]);
  views[0].controller.onSample(onCard);
  await tick();
  assert.deepEqual(views.map(sentCodec), Array(5).fill("video/H264"));
  registry.clear();
}
// On a machine without one there is nothing to hold back.
{
  setCores(1);
  const registry = new PeerQualityRegistry("codec-card3");
  const views = ["a", "b", "c", "d", "e", "f"].map((id) => viewer(registry, id));
  for (const v of views) await negotiate(v);
  for (const v of views) v.controller.onSample(sample({ codec: "H264", encoderImplementation: "OpenH264", powerEfficient: false }));
  await tick();
  assert.deepEqual(views.map(sentCodec), Array(6).fill("video/H264"));
  registry.clear();
  setCores(6);
}

// An encoder started over on the graphics card starts on few bits, and gets the rest moments
// later. Changing codec, coming back from a pause, a new height.
{
  setCores(6);
  const onCard = sample({ codec: "H264", encoderImplementation: "MediaFoundationVideoEncodeAccelerator", powerEfficient: true });
  const startedLow = async (v: ReturnType<typeof viewer>, ceiling: number) => {
    await tick();
    assert.equal(v.state.params.encodings[0].maxBitrate, 1_500_000, "começa com poucos bits");
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal(v.state.params.encodings[0].maxBitrate, ceiling, "e recebe o resto logo depois");
  };
  const registry = new PeerQualityRegistry("codec-start");
  const a = viewer(registry, "a");
  await negotiate(a);
  assert.equal(sentCodec(a), "video/AV1");
  const ceiling = a.state.params.encodings[0].maxBitrate ?? 0;
  assert.ok(ceiling > 1_500_000);
  // The first encoder of a connection is no restart.
  const b = viewer(registry, "b");
  await negotiate(b);
  assert.equal(sentCodec(b), "video/H264");
  assert.equal(b.state.params.encodings[0].maxBitrate, ceiling);
  b.controller.onSample(onCard);
  await tick();
  // And a costly codec has no such trouble.
  registry.remove("a");
  await tick();
  assert.equal(sentCodec(b), "video/AV1");
  assert.equal(b.state.params.encodings[0].maxBitrate, ceiling);
  // Out of the costly codec.
  const c = viewer(registry, "c");
  await negotiate(c);
  c.controller.onSample(onCard);
  await tick();
  assert.equal(sentCodec(c), "video/H264");
  setH264Send(true);
  await tick();
  assert.equal(sentCodec(b), "video/H264");
  await startedLow(b, ceiling);
  // Back from a pause.
  b.controller.setRequest("1080p30", true);
  await tick();
  assert.equal(b.state.params.encodings[0].active, false);
  assert.equal(sentCodec(b), "video/VP8", "e fora da placa, para o encoder voltar novo");
  b.controller.setRequest("1080p30", false);
  await tick();
  assert.equal(b.state.params.encodings[0].active, true);
  assert.equal(sentCodec(b), "video/H264");
  await startedLow(b, ceiling);
  // A new height. Its own ceiling, whatever that comes to, and the same way there.
  const pushes = b.state.pushes;
  b.controller.setRequest("720p30", false);
  await tick();
  assert.equal(b.state.params.encodings[0].maxBitrate, 1_500_000);
  assert.ok(b.state.pushes > pushes);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.ok((b.state.params.encodings[0].maxBitrate ?? 0) > 1_500_000);
  setH264Send(false);
  registry.clear();
  // On a software encoder none of that is needed.
  const software = sample({ codec: "H264", encoderImplementation: "OpenH264", powerEfficient: false });
  const registry2 = new PeerQualityRegistry("codec-start2");
  const d = viewer(registry2, "d");
  const e = viewer(registry2, "e");
  await negotiate(d);
  await negotiate(e);
  e.controller.onSample(software);
  await tick();
  const full = e.state.params.encodings[0].maxBitrate;
  e.controller.setRequest("1080p30", true);
  await tick();
  assert.equal(e.state.params.encodings[0].active, false);
  assert.equal(sentCodec(e), "video/H264");
  e.controller.setRequest("1080p30", false);
  await tick();
  assert.equal(e.state.params.encodings[0].maxBitrate, full);
  registry2.clear();
  // A channel that cannot choose its codec keeps its encoder running on the card, at the idle tier.
  {
    const { registry, controller, state } = setup();
    await tick();
    controller.onSample(sample({ codec: "H264", encoderImplementation: "MediaFoundationVideoEncodeAccelerator", powerEfficient: true }));
    controller.setRequest("576p15", true);
    await tick();
    assert.equal(state.params.encodings[0].active, true);
    assert.equal(state.params.encodings[0].maxFramerate, 15);
    registry.clear();
  }
}

// A viewer leaving, or not looking, hands it to the next one, without a renegotiation.
{
  const registry = new PeerQualityRegistry("codec5");
  const a = viewer(registry, "a");
  const b = viewer(registry, "b");
  await negotiate(a);
  await negotiate(b);
  a.controller.setRequest("576p15", true);
  await tick();
  assert.equal(sentCodec(b), "video/AV1", "quem não olha não custa");
  a.controller.setRequest("1080p30", false);
  await tick();
  assert.equal(sentCodec(a), "video/H264", "e não tira de quem pegou");
  registry.remove("b");
  await tick();
  assert.equal(sentCodec(a), "video/AV1");
  registry.clear();
}

// "motion" goes in H264, and the change takes a running connection with it.
{
  const registry = new PeerQualityRegistry("codec6");
  const a = viewer(registry, "a");
  await negotiate(a);
  assert.equal(sentCodec(a), "video/AV1");
  a.controller.setDegradation("motion");
  await tick();
  assert.equal(sentCodec(a), "video/H264");
  assert.equal(a.track.contentHint, "motion");
  registry.clear();
}

// On a link short of bits for H264, a game takes it too, in camera mode, and the machine
// spares it for less: this one is 8 cores with one 1080p30 to pay for.
{
  setCores(8);
  const registry = new PeerQualityRegistry("codec6b");
  const a = viewer(registry, "a");
  a.controller.setDegradation("motion");
  await negotiate(a);
  assert.equal(sentCodec(a), "video/H264", "até o link dizer que é curto");
  const now = Date.now;
  const capacity = (mediaStats as unknown as { capacityListeners: Set<(s: unknown) => void> }).capacityListeners;
  const report = (availableKbps: number, codec: string) => {
    a.controller.onSample(sample({ availableKbps, targetKbps: 2500, codec }));
    capacity.forEach((f) => f({}));
  };
  try {
    let t = now() + 700_000;
    Date.now = () => t;
    report(3000, "H264");
    await tick();
    assert.equal(sentCodec(a), "video/AV1");
    assert.equal(a.track.contentHint, "motion", "modo câmera");
    t += 30_000;
    report(8000, "AV1");
    await tick();
    assert.equal(sentCodec(a), "video/H264", "e devolve quando o link melhora");
  } finally {
    Date.now = now;
    setCores(6);
  }
  registry.clear();
}

// A moving picture has the encoder try camera mode, with nothing else touched, and stay if
// it comes out better. A page brings it back.
{
  const registry = new PeerQualityRegistry("codec6c");
  const a = viewer(registry, "a");
  await negotiate(a);
  assert.equal(a.track.contentHint, "detail");
  const pushes = a.state.pushes;
  const film = () => sample({ codec: "AV1", qp: 150, targetKbps: 2500, outgoingKbps: 2500, availableKbps: 3000 });
  const now = Date.now;
  try {
    let t = now() + 800_000;
    Date.now = () => t;
    const run = (s: () => SenderSample, ms: number) => {
      for (let left = ms; left > 0; left -= 2000) {
        a.controller.onSample(s());
        t += 2000;
      }
    };
    run(film, 8000);
    assert.equal(a.track.contentHint, "detail", "ainda não");
    run(film, 6000);
    assert.equal(a.track.contentHint, "motion");
    assert.equal(senderQualityState(a.pc)?.movingPicture, false, "por enquanto só tentando");
    await tick();
    assert.equal(a.state.pushes, pushes, "nada além do modo");
    assert.equal(sentCodec(a), "video/AV1");
    run(() => sample({ codec: "AV1", qp: 120, targetKbps: 2500, outgoingKbps: 2500, availableKbps: 3000 }), 8000);
    assert.equal(a.track.contentHint, "motion");
    assert.equal(senderQualityState(a.pc)?.movingPicture, true);
    run(() => sample({ codec: "AV1", qp: 40, framesPerSecond: 5, sourceFps: 5, targetKbps: 2500, outgoingKbps: 50 }), 6000);
    assert.equal(a.track.contentHint, "detail");
    assert.equal(senderQualityState(a.pc)?.movingPicture, false);
    // A switch of profile leaves nothing behind.
    run(film, 14_000);
    assert.equal(a.track.contentHint, "motion");
    a.controller.setDegradation("text");
    await tick();
    assert.equal(a.track.contentHint, "detail");
    // "text" tries too, and a page stays in screen mode.
    run(film, 30_000);
    assert.equal(a.track.contentHint, "detail", "não saiu melhor");
    a.controller.setDegradation("balanced");
    a.controller.setDegradation("text");
    run(film, 14_000);
    assert.equal(a.track.contentHint, "motion");
    run(() => sample({ codec: "AV1", qp: 120, targetKbps: 2500, outgoingKbps: 2500, availableKbps: 3000 }), 8000);
    assert.equal(senderQualityState(a.pc)?.movingPicture, true, "e vídeo fica no modo câmera");
    // "motion" asked for it, with nothing to try.
    a.controller.setDegradation("motion");
    await tick();
    assert.equal(a.track.contentHint, "motion");
    assert.equal(senderQualityState(a.pc)?.movingPicture, false);
  } finally {
    Date.now = now;
  }
  registry.clear();
}

// They all carry the same capture: one tries at a time, and what it finds holds for the others.
{
  setCores(12);
  const registry = new PeerQualityRegistry("codec6d");
  const a = viewer(registry, "a");
  const b = viewer(registry, "b");
  await negotiate(a);
  await negotiate(b);
  assert.equal(sentCodec(a), "video/AV1");
  assert.equal(sentCodec(b), "video/AV1");
  const film = (qp: number) => sample({ codec: "AV1", qp, targetKbps: 2500, outgoingKbps: 2500, availableKbps: 3000 });
  const publish = () =>
    (mediaStats as unknown as { publish(s: unknown): void }).publish({
      availableOutgoingKbps: 0,
      usedOutgoingKbps: 0,
      cpuPressure: 0,
      sampledAt: 0,
    });
  const now = Date.now;
  try {
    let t = now() + 900_000;
    Date.now = () => t;
    const run = (qp: number, ms: number) => {
      for (let left = ms; left > 0; left -= 2000) {
        a.controller.onSample(film(qp));
        b.controller.onSample(film(qp));
        publish();
        t += 2000;
      }
    };
    run(150, 14_000);
    assert.deepEqual([a.track.contentHint, b.track.contentHint].sort(), ["detail", "motion"], "um de cada vez");
    run(120, 8000);
    assert.equal(a.track.contentHint, "motion");
    assert.equal(b.track.contentHint, "motion", "e o outro herda");
  } finally {
    Date.now = now;
    setCores(6);
  }
  registry.clear();
}

// The machine running short takes it from everybody at once, and no pixels with it.
{
  const registry = new PeerQualityRegistry("codec7");
  const a = viewer(registry, "a");
  await negotiate(a);
  const now = Date.now;
  const publish = () =>
    (mediaStats as unknown as { publish(s: unknown): void }).publish({
      availableOutgoingKbps: 0,
      usedOutgoingKbps: 0,
      cpuPressure: 0,
      sampledAt: 0,
    });
  try {
    let t = now() + 600_000;
    Date.now = () => t;
    const pass = (s: Partial<SenderSample>) => {
      a.controller.onSample(sample({ codec: "AV1", ...s }));
      publish();
      t += 2000;
    };
    for (let i = 0; i < 4; i += 1) pass({ framesPerSecond: 12, encodeMs: 40 });
    await tick();
    assert.equal(senderQualityState(a.pc)?.machineLevel, 1);
    assert.equal(sentCodec(a), "video/H264");
    assert.equal(a.state.params.encodings[0].scaleResolutionDownBy, 1);
    for (let i = 0; i < 40; i += 1) pass({});
    await tick();
    assert.equal(senderQualityState(a.pc)?.machineLevel, 0);
    assert.equal(sentCodec(a), "video/AV1", "e volta sozinho");
  } finally {
    Date.now = now;
  }
  registry.clear();
}

// What the link taught it under one codec says nothing about the other.
{
  const registry = new PeerQualityRegistry("codec8");
  const a = viewer(registry, "a");
  const b = viewer(registry, "b");
  await negotiate(a);
  await negotiate(b);
  const now = Date.now;
  try {
    let t = now() + 9000;
    Date.now = () => t;
    for (let i = 0; i < 4; i += 1) {
      b.controller.onSample(sample({ framesPerSecond: 15, targetKbps: 800, availableKbps: 800, codec: "H264" }));
      t += 2000;
    }
    await tick();
    assert.equal(senderQualityState(b.pc)?.linkCapHeight, 720);
    t += 20_000;
    registry.remove("a");
    await tick();
    assert.equal(sentCodec(b), "video/AV1");
    assert.equal(senderQualityState(b.pc)?.linkCapHeight, null);
    assert.equal(b.state.params.encodings[0].scaleResolutionDownBy, 1);
  } finally {
    Date.now = now;
  }
  registry.clear();
}

// Experiment sq-h264-send: no AV1 for anybody, on a running share too.
{
  const registry = new PeerQualityRegistry("codec9");
  const a = viewer(registry, "a");
  await negotiate(a);
  assert.equal(sentCodec(a), "video/AV1");
  setH264Send(true);
  await tick();
  assert.equal(sentCodec(a), "video/H264");
  assert.equal(a.track.contentHint, "motion");
  setH264Send(false);
  registry.clear();
}

// A connection that does not choose is left alone, whatever the machine could afford.
{
  const { registry, state } = setup("1080p30");
  await tick();
  assert.equal(state.params.encodings[0].codec, undefined);
  registry.clear();
}

// Outside experiment sq-new-send: how it was. The profile's own preference, nothing
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
