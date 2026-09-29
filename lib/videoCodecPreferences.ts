// Shared by useRoomMedia.ts (a broadcaster's direct connections) and
// relayLink.ts (a relay's re-encoded connections to its own children) — split
// out into its own module because relayLink.ts is imported *by*
// useRoomMedia.ts, and a plain function living in useRoomMedia.ts would have
// made the relay's import of it circular.
import type { DegradationMode } from "./peerQualityController";
import { shouldAvoidSoftwareVp9, STREAM_PERF_EVENTS } from "./streamPerf";
import { plannedFirstCodec } from "./screenCodec";
import { trackFeatureEvent } from "./features";

// Codec preference. VP9 first for text-heavy screen content (its screen
// content mode is what keeps small text legible at low bitrate). H264 first
// for everything else — "motion" and "balanced" alike, since the moment a
// profile cares about frame rate at all, encode speed is what decides
// whether it gets one — despite AV1 compressing motion better bit-for-bit, that is a
// statement about compression efficiency, not encode speed, and encode speed
// is what motion content actually needs. Almost nobody's hardware has an AV1
// encoder (unlike H264, which is close to universal); everywhere else the
// browser falls back to a software libaom encoder that cannot sustain 1080p
// at 60fps on ordinary hardware. AV1 stays on the list — a device that
// genuinely has a fast encoder for it still benefits — just no longer ahead
// of the one that reliably keeps up.
//
// H264 outranks VP8 in both because it is the one with broad hardware
// encode support, which matters enormously here: a relay or a busy
// broadcaster encoding several streams at once lives or dies on whether the
// GPU can take that work off the main thread.

// Which codec goes first. By profile, "text" gets VP9 and everything else
// H264 — "balanced" shares the motion ordering since it asks to hold quality
// *and* frame rate. For our own share two experiments can overrule that on
// what the machine's encoders actually are: "screen-codec" (see
// lib/screenCodec) and "stream-perf" (see lib/streamPerf). A relay's
// re-encodes keep the profile's ordering.
//
// Exported because a codec preference is the one part of a profile that
// cannot be changed on a connection that is already negotiated, so a
// mid-share profile switch has to know whether the switch actually changed
// which codec goes first before it decides to renegotiate anything (see
// useRoomMedia). Asking this module rather than re-deriving the split is what
// keeps the two from drifting apart.
export type VideoCodecOrder = "vp9" | "h264";

export function videoCodecOrder(mode: DegradationMode, ownShare = false): VideoCodecOrder {
  if (ownShare) {
    const planned = plannedFirstCodec(mode);
    if (planned) return planned;
    if (mode === "text" && shouldAvoidSoftwareVp9()) return "h264";
  }
  return mode === "text" ? "vp9" : "h264";
}

// Counted once per page: the event says "this broadcaster's text profile ran
// on H264 because VP9 was software", not how many connections that took.
let codecFallbackCounted = false;

// `ownShare`: a broadcaster's own connections — see videoCodecOrder.
export function applyVideoCodecPreferences(transceiver: RTCRtpTransceiver, mode: DegradationMode, ownShare = false) {
  if (typeof RTCRtpSender.getCapabilities !== "function") return;
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (!capabilities?.codecs) return;
  const first = videoCodecOrder(mode, ownShare);
  if (ownShare && mode === "text" && first === "h264" && shouldAvoidSoftwareVp9() && !codecFallbackCounted) {
    codecFallbackCounted = true;
    trackFeatureEvent(STREAM_PERF_EVENTS.codecFallback);
  }
  // Moved off VP9 by an experiment, VP9 stays second, ahead of AV1: its
  // screen-content mode is the reason "text" wanted it, and it is the
  // fallback for a peer without H264.
  const order =
    first === "vp9"
      ? ["video/VP9", "video/AV1", "video/H264", "video/VP8"]
      : mode === "text"
        ? ["video/H264", "video/VP9", "video/AV1", "video/VP8"]
        : ["video/H264", "video/AV1", "video/VP9", "video/VP8"];
  const sorted = [...capabilities.codecs].sort((a, b) => {
    const ia = order.indexOf(a.mimeType);
    const ib = order.indexOf(b.mimeType);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  try {
    transceiver.setCodecPreferences(sorted);
  } catch {
    // Ignored - some older browser versions reject the call entirely.
  }
}
