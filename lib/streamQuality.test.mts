// node --experimental-strip-types lib/streamQuality.test.mts
//
// Pins who each "sq" sender experiment is about, what its "on" side does, and
// what it takes for the two reactive ones to act.

import assert from "node:assert/strict";
import {
  encoderBound,
  fallingBehind,
  NO_SENDER_OVERRIDE,
  NO_STRUGGLE,
  senderOverride,
  SenderStruggle,
  setSqMotionHoldEnabled,
  setSqWeakSenderEnabled,
  setSqH264QpApplied,
  setSqNativeKeyEnabled,
  setSqRecvDropsEnabled,
  SQ_SENDER_CAP_TIER,
  streamQualityTagParts,
  weakSenderEligible,
  motionHoldEligible,
  type SendSample,
} from "./streamQuality";

function withCores(cores: number, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: cores }, configurable: true });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

// sq-weak-sender: software VP9, outside "motion", on <= 8 cores.
withCores(4, () => {
  assert.equal(weakSenderEligible("text", "libvpx"), true);
  assert.equal(weakSenderEligible("balanced", "libvpx"), true);
  assert.equal(weakSenderEligible("motion", "libvpx"), false);
  assert.equal(weakSenderEligible("text", "MediaFoundationVideoEncodeAccelerator"), false);
  assert.equal(weakSenderEligible("text", null), false);
});
withCores(16, () => assert.equal(weakSenderEligible("text", "libvpx"), false));

// sq-motion-hold: "motion" on OpenH264, on the website.
assert.equal(motionHoldEligible("motion", "OpenH264"), true);
assert.equal(motionHoldEligible("balanced", "OpenH264"), false);
assert.equal(motionHoldEligible("motion", "libvpx"), false);

// --- falling behind -------------------------------------------------------

const sample = (over: Partial<SendSample>): SendSample => ({
  fps: 30,
  sourceFps: 30,
  encodeMs: 5,
  targetFps: 30,
  qualityLimitationReason: "none",
  ...over,
});

assert.equal(fallingBehind(sample({})), false, "keeping up");
assert.equal(fallingBehind(sample({ fps: 8 })), true, "30 captured, 8 sent");
assert.equal(fallingBehind(sample({ fps: 8, sourceFps: 8 })), false, "a still screen: the capture slowed down too");
assert.equal(fallingBehind(sample({ fps: 8, sourceFps: null })), false, "no capture rate, no verdict");
assert.equal(fallingBehind(sample({ fps: 12, sourceFps: 60, targetFps: 15 })), false, "asked for 15, sending 12");
assert.equal(fallingBehind(sample({ fps: 14, sourceFps: 20, targetFps: 30 })), false, "14 of 20 is not far behind");

// The cap is for the encoder: slow frames, or WebRTC saying "cpu".
assert.equal(encoderBound(sample({ fps: 8, encodeMs: 25 })), true, "25 ms a frame at 30 fps");
assert.equal(encoderBound(sample({ fps: 8, encodeMs: 4 })), false, "cheap frames: libvpx shedding a quiet screen");
assert.equal(encoderBound(sample({ fps: 8, encodeMs: null, qualityLimitationReason: "cpu" })), true);
assert.equal(encoderBound(sample({ fps: 8, encodeMs: null })), false);
assert.equal(encoderBound(sample({ encodeMs: 40 })), false, "slow but keeping up");

// Only a sustained condition counts, never during the connection's warm-up.
{
  const watch = new SenderStruggle(0);
  assert.equal(watch.update(true, 2_000), false, "warm-up");
  assert.equal(watch.update(true, 10_000), false);
  assert.equal(watch.update(true, 20_000), false);
  assert.equal(watch.update(false, 22_000), false, "one good sample starts over");
  assert.equal(watch.update(true, 24_000), false);
  assert.equal(watch.update(true, 34_000), false);
  assert.equal(watch.update(true, 44_000), true, "20 s over three samples");
}
{
  const sparse = new SenderStruggle(0);
  assert.equal(sparse.update(true, 15_000), false);
  assert.equal(sparse.update(true, 45_000), false, "long enough, but only two samples");
  assert.equal(sparse.update(true, 47_000), true);
}

// --- overrides ------------------------------------------------------------

// Off, nobody is touched; on, only the eligible — and sq-weak-sender only a
// connection that fell behind.
const struggled = { weakStruggled: true, holdReleased: false };
withCores(4, () => {
  assert.deepEqual(senderOverride("text", "libvpx", struggled), NO_SENDER_OVERRIDE);
  setSqWeakSenderEnabled(true);
  assert.deepEqual(senderOverride("text", "libvpx", NO_STRUGGLE), NO_SENDER_OVERRIDE, "keeping up keeps 1080p");
  assert.deepEqual(senderOverride("text", "libvpx", struggled), {
    cap: SQ_SENDER_CAP_TIER,
    preference: null,
    experiment: "weak",
  });
  assert.deepEqual(senderOverride("text", "OpenH264", struggled), NO_SENDER_OVERRIDE);
  setSqWeakSenderEnabled(false);
});
assert.deepEqual(senderOverride("motion", "OpenH264", NO_STRUGGLE), NO_SENDER_OVERRIDE);
setSqMotionHoldEnabled(true);
assert.deepEqual(senderOverride("motion", "OpenH264", NO_STRUGGLE), {
  cap: SQ_SENDER_CAP_TIER,
  preference: "maintain-resolution",
  experiment: "hold",
});
assert.deepEqual(
  senderOverride("motion", "OpenH264", { weakStruggled: false, holdReleased: true }),
  NO_SENDER_OVERRIDE,
  "a released hold is gone for the connection"
);
setSqMotionHoldEnabled(false);

// The reports' tag carries only the "on" sides.
assert.deepEqual(streamQualityTagParts(), []);
setSqRecvDropsEnabled(true);
setSqNativeKeyEnabled(true);
setSqH264QpApplied(true);
assert.deepEqual(streamQualityTagParts(), ["sq-h264-qp=on", "sq-recv-drops=on", "sq-native-key=on"]);

console.log("streamQuality: ok");
