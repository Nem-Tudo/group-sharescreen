// Which codec a share goes out in, and what the encoder is told about it.
//
// In a mesh there is one encode per viewer and one decode per tile on everybody else's
// machine, so what a codec does with its bits has to be weighed against what it costs at
// both ends. No codec wins both, so a share does not pick one: each connection goes out
// in AV1 for as long as the machine can afford it (see chooseSharp in lib/sendAdaptation),
// and otherwise in H264 in its camera mode. AV1 goes in the encoder's screen mode, or in
// its camera mode once what is on the screen turns out to be a moving picture (see
// PictureWatch, same place). "motion" stays in H264 unless the link is short: nobody is
// reading, and a game needs that CPU.
//
// A running connection moves between all of these with nothing renegotiated: one keyframe
// and no frozen picture, in Chrome and in the desktop app. The encoder's mode is a property
// of the track, so each connection has its own copy of the capture (see useRoomMedia).
//
// What that was measured against, on real captures of a browser tab at 1920x1024 and 30
// fps, software encoders, nothing adapting, exact reference frames. Frames per second and
// PSNR of video, PSNR of a white page of small text that scrolls now and then, and the
// cores a moving picture takes at the sender and for one tile at the viewer:
//
//                 video                          page           cores
//                 free      3 Mbps    1.5 Mbps   3 Mbps  1.5    send  watch
//   AV1 screen    30 44.4   30 41.0   30 37.9    43.7    42.1   1.65  .36
//   AV1 camera    30 45.8   30 43.2   30 39.6    31.4    25.6   1.32  .38
//   VP9 screen    21 45.0   21 42.7   18 38.8    34.8    26.5   1.44  .28
//   VP9 camera    30 44.2   30 41.3   30 36.7    26.8    24.6   1.52  .41
//   VP8 screen    30 44.2   30 39.7   10 35.6    32.0    29.4    .69  .29
//   H264 camera   30 42.5   30 35.2   14 32.9    28.4    27.3    .59  .07
//
//   - AV1 in screen mode is the only one that keeps small text sharp on a short link,
//     and it does that on a fraction of the bits: that page goes out at 430 kbps, where
//     H264 is at its limit and smeared. In camera mode it spends all it is given on a page
//     that is not moving, overruns the link, and comes out worse than H264.
//   - AV1 in camera mode is the best picture of video there is, at every bitrate, for the
//     same CPU. It also holds 30 fps at 800 kbps, where everything else has started to
//     drop frames.
//   - VP9 in screen mode is what most shares used to run on. It holds 18-21 fps whatever
//     the bitrate, and after a pause it sends 2 fps through a scroll, which is the "frozen
//     picture on a good connection" people complained about and which no freeze counter
//     sees. Its PSNR is high because it sends so few frames.
//   - H264 in camera mode is the cheapest thing there is, at both ends, hardware or not:
//     six viewers on four cores go 28 fps where VP9 goes 6. It is what a machine falls back
//     on, and it is close behind with bits to spare. Short of bits, it is not close.
//   - OpenH264's screen mode is heavy on a scroll and collapses on anything noisy (1.8
//     fps), so H264 goes in camera mode, and a hardware encoder may fall back to OpenH264
//     in the middle of a share.
//
// VP8 stays for a viewer without H264.

import type { DegradationMode } from "./peerQualityController";
import { isClassicSend } from "./classicSend";

export type VideoCodecOrder = "h264" | "vp9";

// Exported because a codec preference is the one part of a profile that cannot be
// changed on a connection that is already negotiated, so a mid-share profile switch
// has to know whether the switch actually changed which codec goes first before it
// decides to renegotiate anything (see useRoomMedia). Only sq-classic-send's does:
// everybody else's first is H264 for good, and what goes out is chosen after that.
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

// The costly codec, in the encoder's screen mode, and what a connection is on otherwise,
// in its camera mode. Second and third for a viewer without H264.
export const SHARP_CODEC = "video/AV1";
const PLAIN_CODECS = ["video/H264", "video/VP8", "video/VP9"];
// For a connection past what the graphics card's encoder holds: H264 is what goes to the card.
const OFF_CARD_CODECS = ["video/VP8", "video/VP9", "video/H264"];

/**
 * Whether a share in this browser chooses its codec connection by connection. Chromium
 * on a computer: it is what changes a running connection's codec without renegotiating,
 * and what reports the CPU trouble that takes the costly one away. Firefox takes the
 * change too, with half a second of frozen picture, and says nothing about its CPU.
 */
export function choosesCodecPerConnection(): boolean {
  if (isClassicSend() || typeof navigator === "undefined" || typeof RTCRtpSender === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (!nav.userAgentData || nav.userAgentData.mobile) return false;
  return RTCRtpSender.getCapabilities?.("video")?.codecs?.some((c) => c.mimeType === SHARP_CODEC) ?? false;
}

function negotiatedCodec(negotiated: RTCRtpCodec[], mimeType: string): RTCRtpCodec | null {
  const codec = negotiated.find(
    (c) =>
      c.mimeType.toLowerCase() === mimeType.toLowerCase() &&
      // Without it a frame has to fit in one packet.
      (mimeType !== "video/H264" || /packetization-mode=1/.test(c.sdpFmtpLine ?? ""))
  );
  if (!codec) return null;
  return {
    mimeType: codec.mimeType,
    clockRate: codec.clockRate,
    ...(codec.sdpFmtpLine ? { sdpFmtpLine: codec.sdpFmtpLine } : {}),
  };
}

/** The codec for encodings[0], out of those negotiated with this viewer; null for none of them. */
export function sendCodecFrom(negotiated: RTCRtpCodec[], sharp: boolean, offCard = false): RTCRtpCodec | null {
  for (const mimeType of sharp ? [SHARP_CODEC] : offCard ? OFF_CARD_CODECS : PLAIN_CODECS) {
    const codec = negotiatedCodec(negotiated, mimeType);
    if (codec) return codec;
  }
  return null;
}

/**
 * The contentHint that goes with that codec: the encoder's mode is half of the choice.
 * The costly one has both modes in it, depending on what is on the screen (see PictureWatch
 * in lib/sendAdaptation).
 */
export function sendHintFor(sharp: boolean, movingPicture: boolean): "detail" | "motion" {
  return sharp && !movingPicture ? "detail" : "motion";
}

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
 * in (see the table above), where it is the same for every connection. On a share that
 * chooses per connection this is what its local preview carries, and every copy goes
 * by sendHintFor. What the profiles ask for is what to give up first when something
 * runs short, and that is lib/sendAdaptation's.
 */
export function contentHintForShare(mode: DegradationMode): "text" | "detail" | "motion" {
  return isClassicSend() ? CLASSIC_HINT[mode] : "motion";
}
