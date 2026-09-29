"use client";

// Experiment "screen-codec": which codec and profile a screen share starts
// on, for the people who never touched the profile picker.
//
// Why it exists: on 2026-09-16 the default profile moved from "text" (VP9
// first) to "balanced" (H264 first). On most Windows machines that H264 is
// Chromium's software OpenH264, and the connection-quality reports since then
// show it spending ~60% of the time "limited by bandwidth" — its QP-driven
// quality scaler cutting frames and resolution — and 39% of moving shares
// below 10 fps, against 16% for the VP9 encode it replaced. A share with a
// hardware H264 encoder is the best of the three. So the codec should follow
// the machine, not the profile. Variants:
//
//   control  — as today: "balanced" by default, codec by profile.
//   "text"   — "text" (VP9 first, maintain-resolution) is the default again
//              for whoever never picked a profile. An explicit pick wins.
//   "auto"   — profile unchanged, but "text" and "balanced" put H264 first
//              only where the browser says its H264 encode is hardware
//              (MediaCapabilities powerEfficient), and VP9 first otherwise.
//              "motion" keeps H264: frame rate is its whole point, and a
//              software VP9 at 60 fps is the slower of the two.
//
// Read by useRoomMedia (which decides it, with useFeature) and by the codec
// ordering deep in the send path — module state for the same reason as
// lib/streamPerf: one person, one room, one answer.

import type { DegradationMode } from "./peerQualityController";

export const SCREEN_CODEC_FEATURE = "screen-codec";

export type ScreenCodecVariant = "text" | "auto";

// Beyond the share statistics every screen share already reports (see
// SCREEN_SHARE_STATS in useRoomMedia), which this experiment is compared on.
//   screen_codec_vp9 / _h264 / _other  which codec a share actually ran on
//   screen_codec_hw_encoder            ...and the encoder was hardware
export const SCREEN_CODEC_EVENTS = {
  vp9: "screen_codec_vp9",
  h264: "screen_codec_h264",
  other: "screen_codec_other",
  hardware: "screen_codec_hw_encoder",
} as const;

let variant: ScreenCodecVariant | null = null;

export function setScreenCodecVariant(value: string | null) {
  variant = value === "text" || value === "auto" ? value : null;
  if (variant === "auto") void probeEncoders();
}

export function getScreenCodecVariant(): ScreenCodecVariant | null {
  return variant;
}

// ---------------------------------------------------------------------------
// Whether each codec encodes in hardware here.
//
// Null until known, and forever null where the browser cannot say (no
// MediaCapabilities for "webrtc"); every reader treats null as "no opinion"
// and falls back to the profile's own ordering. Shared with lib/streamPerf.

let h264Hardware: boolean | null = null;
let vp9Hardware: boolean | null = null;
let probe: Promise<void> | null = null;

async function powerEfficient(contentType: string): Promise<boolean | null> {
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: "webrtc",
      video: { contentType, width: 1920, height: 1080, bitrate: 4_000_000, framerate: 30 },
    });
    return info.supported ? info.powerEfficient : false;
  } catch {
    // "webrtc" not understood here.
    return null;
  }
}

/** Starts the one-time encoder probe. Idempotent. */
export function probeEncoders(): Promise<void> {
  if (probe) return probe;
  if (typeof navigator === "undefined" || !navigator.mediaCapabilities?.encodingInfo) {
    probe = Promise.resolve();
    return probe;
  }
  probe = (async () => {
    const [h264, vp9] = await Promise.all([powerEfficient("video/H264"), powerEfficient("video/VP9")]);
    h264Hardware = h264;
    vp9Hardware = vp9;
  })();
  return probe;
}

export function isH264Hardware(): boolean | null {
  return h264Hardware;
}

export function isVp9Hardware(): boolean | null {
  return vp9Hardware;
}

/**
 * The codec this experiment wants first for our own share under `mode`, or
 * null for "no opinion" (control, "text", "motion", or the probe has not
 * answered yet), in which case the profile's own ordering stands.
 */
export function plannedFirstCodec(mode: DegradationMode): "vp9" | "h264" | null {
  if (variant !== "auto" || mode === "motion") return null;
  if (h264Hardware === true) return "h264";
  if (h264Hardware === false) return "vp9";
  return null;
}

/**
 * The default profile for somebody who never picked one — the stored pick,
 * when there is one, always wins over this.
 */
export function defaultShareProfile(): DegradationMode {
  return variant === "text" ? "text" : "balanced";
}
