// node --experimental-strip-types lib/streamQuality.test.mts
//
// Pins who each "sq" sender experiment is about, and what its "on" side does.

import assert from "node:assert/strict";
import {
  NO_SENDER_OVERRIDE,
  senderOverride,
  setSqMotionHoldEnabled,
  setSqWeakSenderEnabled,
  setSqH264QpApplied,
  setSqNativeKeyEnabled,
  setSqRecvDropsEnabled,
  SQ_SENDER_CAP_TIER,
  streamQualityTagParts,
  weakSenderEligible,
  motionHoldEligible,
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

// Off, nobody is touched; on, only the eligible are.
withCores(4, () => {
  assert.deepEqual(senderOverride("text", "libvpx"), NO_SENDER_OVERRIDE);
  setSqWeakSenderEnabled(true);
  assert.deepEqual(senderOverride("text", "libvpx"), { cap: SQ_SENDER_CAP_TIER, preference: null, experiment: "weak" });
  assert.deepEqual(senderOverride("text", "OpenH264"), NO_SENDER_OVERRIDE);
  setSqWeakSenderEnabled(false);
});
assert.deepEqual(senderOverride("motion", "OpenH264"), NO_SENDER_OVERRIDE);
setSqMotionHoldEnabled(true);
assert.deepEqual(senderOverride("motion", "OpenH264"), {
  cap: SQ_SENDER_CAP_TIER,
  preference: "maintain-resolution",
  experiment: "hold",
});
setSqMotionHoldEnabled(false);

// The reports' tag carries only the "on" sides.
assert.deepEqual(streamQualityTagParts(), []);
setSqRecvDropsEnabled(true);
setSqNativeKeyEnabled(true);
setSqH264QpApplied(true);
assert.deepEqual(streamQualityTagParts(), ["sq-h264-qp=on", "sq-recv-drops=on", "sq-native-key=on"]);

console.log("streamQuality: ok");
