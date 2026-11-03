// Experiment "screen-codec": which codec and profile a share starts on, for whoever is
// outside sq-new-send (see lib/classicSend) and never touched the profile picker. It is at
// 100% in two halves, so this is part of what sending "the way they did before" means:
//
//   "text"  "text" (VP9 first, maintain-resolution) is the default for whoever never
//           picked a profile. An explicit pick wins.
//   "auto"  profile unchanged, but "text" and "balanced" put H264 first only where the
//           browser says its H264 encode is hardware (MediaCapabilities powerEfficient),
//           and VP9 first otherwise. "motion" keeps H264.
//
// Read by useRoomMedia (which decides it, with useFeature) and by the codec ordering in
// lib/videoCodecPreferences.

import { isClassicSend } from "./classicSend";
import type { DegradationMode } from "./peerQualityController";

export const SCREEN_CODEC_FEATURE = "screen-codec";

let variant: "text" | "auto" | null = null;
// Null until known, and forever null where the browser cannot say; that is "no opinion".
let h264Hardware: boolean | null = null;
let probing = false;

async function probeH264() {
  if (probing || typeof navigator === "undefined" || !navigator.mediaCapabilities?.encodingInfo) return;
  probing = true;
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: "webrtc",
      video: { contentType: "video/H264", width: 1920, height: 1080, bitrate: 4_000_000, framerate: 30 },
    });
    h264Hardware = info.supported ? info.powerEfficient : false;
  } catch {
    // "webrtc" not understood here.
  }
}

export function setScreenCodecVariant(value: string | null) {
  variant = value === "text" || value === "auto" ? value : null;
  if (variant === "auto") void probeH264();
}

/** The codec a variant wants first for a share under `mode`; null for the profile's own. */
export function firstCodecFor(
  value: string | null,
  mode: DegradationMode,
  hardware: boolean | null
): "vp9" | "h264" | null {
  if (value !== "auto" || mode === "motion" || hardware === null) return null;
  return hardware ? "h264" : "vp9";
}

export function plannedFirstCodec(mode: DegradationMode): "vp9" | "h264" | null {
  return firstCodecFor(variant, mode, h264Hardware);
}

/** The default profile for somebody who never picked one, for the reports. */
export function defaultShareProfile(): DegradationMode {
  return isClassicSend() && variant === "text" ? "text" : "balanced";
}

/** What the reports tag a share with; null inside sq-new-send, where this has no say. */
export function screenCodecTag(): string | null {
  return isClassicSend() && variant ? `${SCREEN_CODEC_FEATURE}=${variant}` : null;
}
