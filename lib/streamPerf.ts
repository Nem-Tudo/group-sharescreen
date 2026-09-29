"use client";

// Experiment "stream-perf": what a broadcaster's machine does when it cannot
// keep up. Read by useRoomMedia (which decides it, with useFeature) and by
// the send path deep inside it, which is why it is module state rather than
// a prop threaded through every channel: one person, one room, one answer.
//
// With it on:
// - the topology planner's downgrade reaches the viewers we serve directly
//   (see useRoomMedia's applyDirectCaps) — before, it was computed for them
//   and then thrown away, so a room that did not fit went on being encoded at
//   full quality for everyone until the encoder or the uplink gave out;
// - the "text" profile stops putting VP9 first when its VP9 encoder is not
//   hardware-backed *and* its H264 one is (see videoCodecPreferences).
//
// That second condition is new, and it is the one that matters. It used to
// swap a software VP9 for H264 without asking what kind of H264 it was, and
// on most machines that is Chromium's software OpenH264 — which the
// connection-quality reports show doing clearly worse on screen content than
// the VP9 it replaced (more time limited, far more shares under 10 fps). A
// software encode for a software encode is no trade at all; a hardware one is.

import { isH264Hardware, isVp9Hardware, probeEncoders } from "./screenCodec";

export const STREAM_PERF_FEATURE = "stream-perf";

export const STREAM_PERF_EVENTS = {
  directDowngrade: "stream_perf_direct_downgrade",
  codecFallback: "stream_perf_codec_fallback",
} as const;

let enabled = false;

export function setStreamPerfEnabled(value: boolean) {
  enabled = value;
  if (value) void probeEncoders();
}

export function isStreamPerfEnabled(): boolean {
  return enabled;
}

/** True when the experiment is on, VP9 is a software encode and H264 a hardware one. */
export function shouldAvoidSoftwareVp9(): boolean {
  return enabled && isVp9Hardware() === false && isH264Hardware() === true;
}
