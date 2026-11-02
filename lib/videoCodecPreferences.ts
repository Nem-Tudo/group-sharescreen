// Which codec a share goes out in, and what the encoder is told about it.
//
// In a mesh there is one encode per viewer, and one decode per tile on everybody
// else's machine, so this is decided by what those cost far more than by what a
// codec can do on a good day: H264 in the encoder's camera mode, for everything.
//
// What that was measured against, on real captures of a browser tab at 1920x1024 and
// 30 fps, software encoders, with exact reference frames. Frames per second with six
// viewers on four cores (video / scrolling text), then cores per viewer (same), PSNR
// at 4 Mbps (video / scrolling text / a dragged window), and what one tile costs
// whoever is watching:
//
//                   6 viewers, 4 cores   cores      PSNR                viewer
//   H264 camera     28.3 / 28.8          .53 / .37  39.5 / 35.6 / 42.8  .06
//   VP8 screen      14.9 / 16.0, ~620p   .61 / .48  42.6 / 34.9 / 45.4  .25
//   H264 screen     19.2 / 12.9          .54 / .94  41.4 / 33.4 / 39.5  .05
//   VP9 screen       6.0 / 11.6         1.34 / .79  44.2 / 36.3 / 46.3  .27
//
//   - VP9 in screen mode is what most shares used to run on. It holds 18-21 fps
//     whatever the bitrate, and after a pause it sends 2 fps through a scroll, which
//     is the "frozen picture on a good connection" people complained about and which
//     no freeze counter sees. Its PSNR is high because it sends so few frames. VP9 and
//     AV1 outside that mode are fine, at more than twice the CPU.
//   - OpenH264's screen mode is heavy on a scroll and collapses on anything noisy
//     (1.8 fps). Its camera mode is the cheapest thing there is, at both ends, and
//     when the screen stops it goes on refining: 48 dB against VP8's 41.
//   - VP8 is the better picture of video when bits are short (35.2 dB against 30.7 at
//     1.5 Mbps), and the worse one of text (25.3 against 29.1). Nobody was short of
//     bits as often as they were short of CPU.
//
// A hardware H264 encoder has the same two modes coming out the same, and it may
// fall back to OpenH264 in the middle of a share, where camera mode is the one that
// keeps up. VP8 stays second for a peer without H264.

import type { DegradationMode } from "./peerQualityController";
import { isClassicSend } from "./classicSend";

export type VideoCodecOrder = "h264" | "vp9";

// Exported because a codec preference is the one part of a profile that cannot be
// changed on a connection that is already negotiated, so a mid-share profile switch
// has to know whether the switch actually changed which codec goes first before it
// decides to renegotiate anything (see useRoomMedia). Only sq-classic-send's does.
export function videoCodecOrder(mode: DegradationMode): VideoCodecOrder {
  if (isClassicSend()) return mode === "motion" ? "h264" : "vp9";
  return "h264";
}

const CODEC_ORDER = ["video/H264", "video/VP8", "video/VP9", "video/AV1"];
// Experiment sq-classic-send only.
const CLASSIC_ORDER: Record<VideoCodecOrder, string[]> = {
  h264: ["video/H264", "video/AV1", "video/VP9", "video/VP8"],
  vp9: ["video/VP9", "video/AV1", "video/H264", "video/VP8"],
};

export function applyVideoCodecPreferences(transceiver: RTCRtpTransceiver, mode: DegradationMode) {
  if (typeof RTCRtpSender.getCapabilities !== "function") return;
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (!capabilities?.codecs) return;
  const order = isClassicSend() ? CLASSIC_ORDER[videoCodecOrder(mode)] : CODEC_ORDER;
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

// A still screen delivers about a frame a second, and for a hardware encoder that is
// not free. WebRTC tells the encoder the rate it is getting, and AMD's refuses a
// target of around 4 Mbit per frame ("Couldn't set mean bitrate", 0x80070057): the
// connection falls to software the first time the screen stops with the estimate up
// at 4 Mbps, and stays there. Held to a few frames a second the encoder never sees
// that, and in the lab it stayed in hardware in every run where it had fallen in
// every run before. A repeated frame of a still screen costs next to nothing to
// encode. getDisplayMedia cannot take a minimum, so this goes in with applyConstraints
// once it is running.
const STILL_SCREEN_FPS = 5;
const MAX_KBITS_PER_STILL_FRAME = 3000;

/** The minimum frame rate to hold a running screen capture to; null when there is none. */
export function stillScreenFloor(maxKbps: number): { min: number } | null {
  if (isClassicSend()) return null;
  return { min: Math.max(STILL_SCREEN_FPS, Math.ceil(maxKbps / MAX_KBITS_PER_STILL_FRAME)) };
}

// Experiment sq-classic-send only.
const CLASSIC_HINT: Record<DegradationMode, "text" | "detail" | "motion"> = {
  text: "text",
  balanced: "detail",
  motion: "motion",
};

/**
 * The contentHint for a real screen share, which decides which mode the encoder runs
 * in (see the table above). What the profiles ask for is what to give up first when
 * something runs short, and that is lib/sendAdaptation's.
 */
export function contentHintForShare(mode: DegradationMode): "text" | "detail" | "motion" {
  return isClassicSend() ? CLASSIC_HINT[mode] : "motion";
}
