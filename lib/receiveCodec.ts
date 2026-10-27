"use client";

// Experiment "recv-codec": which codec a viewer on Safari or a phone asks the
// broadcaster to send.
//
// Why it exists: in the connection-quality reports (2026-10-27) viewers on
// Safari dropped frames before display in 14–16% of their sessions and the
// Android app in 8%, against 2–3% for desktop Chrome — and both were being
// sent VP9 and AV1 as well as H264. Those decode in software on most of those
// devices, where H264 has a hardware decoder nearly everywhere. On, the
// eligible viewer reorders the codecs in its answer to H264, VP8, VP9, AV1:
// the broadcaster's browser sends with the first codec of the answer it
// supports, so this steers the stream without removing any fallback.
//
// Only the viewer's end is involved, so the experiment targets viewers, and
// only eligible ones are exposed and counted (see RECEIVE_CODEC_EVENTS).

import { isMobileApp } from "./desktop";
import { trackFeatureEvent } from "./features";

export const RECEIVE_CODEC_FEATURE = "recv-codec";

// One set per received video session of an eligible viewer, both sides of the
// experiment (see connectionTelemetry):
//   recv_codec_session    a received video session
//   recv_codec_fps        ...its average fps (value)
//   recv_codec_drops      ...dropped 10% or more of its frames before display
//   recv_codec_low_fps    ...averaged under 10 fps while carrying real bitrate
//   recv_codec_vp9        ...ran on VP9 or AV1 (what the "on" side avoids)
export const RECEIVE_CODEC_EVENTS = {
  session: "recv_codec_session",
  fps: "recv_codec_fps",
  drops: "recv_codec_drops",
  lowFps: "recv_codec_low_fps",
  vp9: "recv_codec_vp9",
} as const;

const ORDER = ["video/H264", "video/VP8", "video/VP9", "video/AV1"];

let enabled = false;
let eligible: boolean | null = null;

export function setReceiveCodecEnabled(value: boolean) {
  enabled = value;
}

export function isReceiveCodecEnabled(): boolean {
  return enabled;
}

/** Safari (desktop or iOS) or a phone: where VP9/AV1 decode is usually software. */
export function isReceiveCodecEligible(): boolean {
  if (eligible !== null) return eligible;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|OPR|Android)\//.test(ua);
  const phone = /Android|iPhone|iPad|iPod/i.test(ua);
  eligible = safari || phone || isMobileApp();
  return eligible;
}

/**
 * Puts H264 first on every video receiver of `pc`, ahead of its answer. A
 * no-op outside the experiment, for viewers it does not cover, and where the
 * browser cannot set codec preferences.
 */
export function applyReceiveCodecPreferences(pc: RTCPeerConnection) {
  if (!enabled || !isReceiveCodecEligible()) return;
  if (typeof RTCRtpReceiver === "undefined" || typeof RTCRtpReceiver.getCapabilities !== "function") return;
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs;
  if (!codecs || !codecs.some((c) => c.mimeType === "video/H264")) return;
  const rank = (mime: string) => {
    const i = ORDER.indexOf(mime);
    return i === -1 ? 99 : i;
  };
  const sorted = [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.receiver.track?.kind !== "video") continue;
    if (typeof transceiver.setCodecPreferences !== "function") continue;
    try {
      transceiver.setCodecPreferences(sorted);
    } catch {
      // Older browsers reject the call outright; their default order stands.
    }
  }
}

/** Counts one received video session of an eligible viewer (see RECEIVE_CODEC_EVENTS). */
export function countReceiveCodecSession(summary: {
  fpsAvg: number | null;
  kbpsAvg: number | null;
  dropShare: number | null;
  codec: string | null;
}) {
  if (!isReceiveCodecEligible()) return;
  const feature = RECEIVE_CODEC_FEATURE;
  trackFeatureEvent(RECEIVE_CODEC_EVENTS.session, { feature, value: 1 });
  if (summary.fpsAvg !== null) {
    trackFeatureEvent(RECEIVE_CODEC_EVENTS.fps, { feature, value: Math.round(summary.fpsAvg) });
  }
  if ((summary.dropShare ?? 0) >= 0.1) trackFeatureEvent(RECEIVE_CODEC_EVENTS.drops, { feature });
  if (summary.fpsAvg !== null && summary.fpsAvg < 10 && (summary.kbpsAvg ?? 0) >= 300) {
    trackFeatureEvent(RECEIVE_CODEC_EVENTS.lowFps, { feature });
  }
  if (summary.codec === "VP9" || summary.codec === "AV1") trackFeatureEvent(RECEIVE_CODEC_EVENTS.vp9, { feature });
}
