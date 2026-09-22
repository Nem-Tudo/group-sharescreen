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
// - the "text" profile stops putting VP9 first when the browser says its VP9
//   encoder is not hardware-backed (see videoCodecPreferences), since one
//   software VP9 encode per viewer is the single most common way a shared
//   screen turns into a slideshow.

export const STREAM_PERF_FEATURE = "stream-perf";

export const STREAM_PERF_EVENTS = {
  directDowngrade: "stream_perf_direct_downgrade",
  codecFallback: "stream_perf_codec_fallback",
} as const;

let enabled = false;

export function setStreamPerfEnabled(value: boolean) {
  enabled = value;
  if (value) void probeVp9();
}

export function isStreamPerfEnabled(): boolean {
  return enabled;
}

// Whether VP9 encodes in hardware here: null until known, and forever null
// where the browser cannot say (no MediaCapabilities for "webrtc"), in which
// case nothing changes.
let vp9PowerEfficient: boolean | null = null;
let probing = false;

async function probeVp9() {
  if (probing || vp9PowerEfficient !== null) return;
  if (typeof navigator === "undefined" || !navigator.mediaCapabilities?.encodingInfo) return;
  probing = true;
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: "webrtc",
      video: { contentType: "video/VP9", width: 1920, height: 1080, bitrate: 4_000_000, framerate: 30 },
    });
    vp9PowerEfficient = info.supported ? info.powerEfficient : false;
  } catch {
    // "webrtc" not understood here: leave it unknown.
  } finally {
    probing = false;
  }
}

/** True when the experiment is on and VP9 is known to be a software encode. */
export function shouldAvoidSoftwareVp9(): boolean {
  return enabled && vp9PowerEfficient === false;
}
