// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/offCardCap.test.mts
//
// Experiment sq-offcard-cap (see lib/offCardCap): a connection past what the graphics card
// holds goes out at 720p30 at most, and nobody else is touched.

import assert from "node:assert/strict";
import { PeerQualityRegistry, senderQualityState } from "./peerQualityController.ts";
import { setClassicSend } from "./classicSend.ts";
import { setOffCardCap } from "./offCardCap.ts";
import type { SenderSample } from "./mediaStats.ts";

type Encoding = RTCRtpEncodingParameters & { maxBitrate?: number; maxFramerate?: number; codec?: RTCRtpCodec };
type Params = { encodings: Encoding[]; degradationPreference?: RTCDegradationPreference; codecs?: RTCRtpCodec[] };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function viewer(registry: PeerQualityRegistry, id: string) {
  const state = { params: { encodings: [{}] } as Params };
  const track = { contentHint: "motion", kind: "video" };
  const sender = {
    getParameters: () => JSON.parse(JSON.stringify(state.params)),
    setParameters: async (params: Params) => {
      state.params = params;
    },
    track,
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
  const controller = registry.add(id, pc, sender, "1080p60", 1920, 1080, true);
  return { controller, state, pc };
}

const H264 = { mimeType: "video/H264", clockRate: 90000, sdpFmtpLine: "packetization-mode=1;profile-level-id=42e01f" };
const VP8 = { mimeType: "video/VP8", clockRate: 90000 };
const onCard: SenderSample = {
  peerId: "x",
  fractionLost: 0,
  rtt: 0.02,
  outgoingKbps: 3000,
  framesPerSecond: 60,
  qualityLimitationReason: "none",
  frameWidth: 1920,
  frameHeight: 1080,
  sourceFps: 60,
  encodeMs: 8,
  qp: 30,
  codec: "H264",
  targetKbps: 4000,
  availableKbps: 6000,
  encoderImplementation: "MediaFoundationVideoEncodeAccelerator",
  powerEfficient: true,
};

setClassicSend(false);
Object.defineProperty(globalThis.navigator, "hardwareConcurrency", { value: 1, configurable: true });

async function sixViewers(capped: boolean) {
  setOffCardCap(capped);
  const registry = new PeerQualityRegistry(`cap${capped}`);
  const views = ["a", "b", "c", "d", "e", "f"].map((id) => viewer(registry, id));
  for (const v of views) {
    v.state.params.codecs = [H264, VP8];
    v.pc.fire();
  }
  await tick();
  views[0].controller.onSample(onCard);
  await tick();
  const out = views.map((v) => ({
    codec: v.state.params.encodings[0].codec?.mimeType,
    scale: v.state.params.encodings[0].scaleResolutionDownBy,
    fps: v.state.params.encodings[0].maxFramerate,
    kbps: (v.state.params.encodings[0].maxBitrate ?? 0) / 1000,
    offCard: senderQualityState(v.pc)?.offCard,
  }));
  registry.clear();
  setOffCardCap(false);
  return out;
}

{
  const without = await sixViewers(false);
  const capped = await sixViewers(true);
  assert.deepEqual(
    capped.map((v) => v.codec),
    ["video/H264", "video/H264", "video/H264", "video/H264", "video/VP8", "video/VP8"]
  );
  assert.deepEqual(capped.map((v) => v.offCard), [false, false, false, false, true, true]);
  // On the card: the same as without the experiment.
  for (let i = 0; i < 4; i += 1) assert.deepEqual(capped[i], without[i], `conexão ${i} na placa`);
  // Off it: 720 lines at 30 fps, and the bits that go with that, where it was 1080p60.
  for (let i = 4; i < 6; i += 1) {
    assert.equal(without[i].scale, 1);
    assert.equal(without[i].fps, 60);
    assert.equal(capped[i].scale, 1.5, "720 linhas de 1080");
    assert.equal(capped[i].fps, 30);
    assert.ok(capped[i].kbps < without[i].kbps * 0.45, `${capped[i].kbps} kbps contra ${without[i].kbps}`);
  }
}

console.log("offCardCap ok");
