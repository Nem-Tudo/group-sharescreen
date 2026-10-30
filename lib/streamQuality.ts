"use client";

// Experiments "sq-*" ("stream quality"): the fixes that came out of the
// 2026-10-30 read of the connection-quality reports (see
// docs/qualidade-e-cascata.md, "Diagnóstico"). That read found the network
// carrying almost every frame it was given — viewers' fps matched their
// broadcasters' in every group — and the losses at the two ends instead:
//
//   sq-weak-sender  A broadcaster on a software VP9 encoder (libvpx, the
//                   default for the "text" and "balanced" profiles) on a
//                   machine with few cores. 45% of those shares on <=4 cores
//                   ran under 10 fps, 22% on >12. libvpx in screenshare mode
//                   drops frames from its own rate control and never says so
//                   in qualityLimitationReason. On: capped at 720p, which is
//                   ~2.25x fewer pixels to encode per frame.
//
//   sq-motion-hold  A broadcaster on the "motion" profile with Chromium's
//                   software H264 (OpenH264). Under maintain-framerate
//                   WebRTC's quality scaler cuts resolution whenever the
//                   average QP passes 37 and only climbs back at 24 or less —
//                   and these shares sat at QP ~25, stuck at ~540p with 3-4x
//                   their bitrate available. On: 720p sent as such, under
//                   maintain-resolution, so the picture stops collapsing on
//                   its own. Website only; the desktop app has sq-h264-qp.
//
//   sq-h264-qp      The same scaler, attacked at its thresholds — which only
//                   a field trial can move, and only the desktop app can set
//                   one (see electron/webrtcTrials.ts). It applies from the
//                   app's next start, so a report says which side it is on
//                   only when the trial is really running in this process.
//
//   sq-recv-drops   A viewer whose decoder cannot keep up (Safari, phones,
//                   4-core laptops dropped >=10% of frames in up to a fifth of
//                   their sessions). On: the tile asks the broadcaster for one
//                   tier lower while its decoder drops frames, and climbs back
//                   after a clean minute (see qualityNegotiation).
//
//   sq-native-key   The desktop app's GPU capture (native-video-capture),
//                   whose viewers spent 17% of their time frozen against
//                   3-5% for every other encoder. One encoder feeds every
//                   viewer, so every viewer's keyframe request is an IDR for
//                   all of them, and a request inside the 250 ms gap was
//                   simply lost. On: requests are coalesced, never dropped;
//                   a held keyframe slot waits for a real IDR instead of
//                   being filled with a stale one (see nativeVideoCapture).
//
// Module state, like lib/congestionRecover and lib/streamPerf: read deep in
// the send and receive paths, decided once in useRoomMedia with useFeature.

import type { DegradationMode } from "./peerQualityController";
import type { QualityTier } from "./videoQuality";
import { isDesktopApp } from "./desktop";

export const SQ_WEAK_SENDER_FEATURE = "sq-weak-sender";
export const SQ_MOTION_HOLD_FEATURE = "sq-motion-hold";
export const SQ_H264_QP_FEATURE = "sq-h264-qp";
export const SQ_RECV_DROPS_FEATURE = "sq-recv-drops";
export const SQ_NATIVE_KEY_FEATURE = "sq-native-key";

/** Every "sq-*" feature's site events. Sent by both groups unless noted. */
export const SQ_EVENTS = {
  // sq-weak-sender: one set per eligible share session (see connectionTelemetry).
  weakSession: "sq_weak_session",
  weakLowFps: "sq_weak_lowfps",
  weakFps: "sq_weak_fps",
  weakHeight: "sq_weak_height",
  /** "On" only: the cap actually engaged on a connection. */
  weakCap: "sq_weak_cap",
  // sq-motion-hold
  holdSession: "sq_hold_session",
  holdLowFps: "sq_hold_lowfps",
  holdFps: "sq_hold_fps",
  holdHeight: "sq_hold_height",
  /** "On" only: the hold actually engaged on a connection. */
  holdApplied: "sq_hold_applied",
  // sq-h264-qp
  qpSession: "sq_qp_session",
  qpLowRes: "sq_qp_lowres",
  qpFps: "sq_qp_fps",
  qpHeight: "sq_qp_height",
  // sq-recv-drops
  dropSession: "sq_drop_session",
  dropBad: "sq_drop_bad",
  dropFps: "sq_drop_fps",
  /** "On" only: a tile stepped down for its decoder. */
  dropStep: "sq_drop_step",
  // sq-native-key
  keySession: "sq_key_session",
  keyAsked: "sq_key_asked",
  keyForced: "sq_key_forced",
  keyStale: "sq_key_stale",
  keyResync: "sq_key_resync",
} as const;

// The tier both sender caps stop at. 720p keeps a screen of text legible —
// the floor of the "text" profile's promise — while a 1080p encode costs
// 2.25x the pixels.
export const SQ_SENDER_CAP_TIER: QualityTier = "720p60";

// "Few cores" for sq-weak-sender. The reports' slideshow share fell from 45%
// (<=4) and 32% (5-8) to ~22% at 9 and above, and flattened there.
const WEAK_MAX_CORES = 8;

// How the modules deep in the media path count events. They cannot import
// lib/features themselves — it brings React and the auth context along, which
// their unit tests cannot load — so useRoomMedia hands trackFeatureEvent in.
type Tracker = (name: string, targets: { feature: string; value?: number }) => void;
let tracker: Tracker = () => {};

export function setSqTracker(fn: Tracker) {
  tracker = fn;
}

/** Counts one of SQ_EVENTS for `feature` (see setSqTracker). */
export function sqTrack(name: string, feature: string, value?: number) {
  tracker(name, value === undefined ? { feature } : { feature, value });
}

let weakSender = false;
let motionHold = false;
let h264QpApplied = false;
let recvDrops = false;
let nativeKey = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever a sender-side "sq" experiment changes. */
export function onStreamQualityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSqWeakSenderEnabled(value: boolean) {
  if (weakSender === value) return;
  weakSender = value;
  notify();
}

export function setSqMotionHoldEnabled(value: boolean) {
  if (motionHold === value) return;
  motionHold = value;
  notify();
}

/** Whether the desktop app started with the sq-h264-qp field trial (see electron/webrtcTrials.ts). */
export function setSqH264QpApplied(value: boolean) {
  h264QpApplied = value;
}

export function setSqRecvDropsEnabled(value: boolean) {
  recvDrops = value;
}

export function setSqNativeKeyEnabled(value: boolean) {
  nativeKey = value;
}

export function isSqRecvDropsEnabled(): boolean {
  return recvDrops;
}

export function isSqNativeKeyEnabled(): boolean {
  return nativeKey;
}

/** This machine counts as weak for sq-weak-sender. */
export function isWeakMachine(): boolean {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
  return cores > 0 && cores <= WEAK_MAX_CORES;
}

export function isSoftwareVp9(encoder: string | null): boolean {
  return !!encoder && /libvpx/i.test(encoder);
}

export function isOpenH264(encoder: string | null): boolean {
  return !!encoder && /openh264/i.test(encoder);
}

/** Who sq-weak-sender is about: a software VP9 share, outside "motion", on a weak machine. */
export function weakSenderEligible(mode: string | null, encoder: string | null): boolean {
  return mode !== "motion" && isSoftwareVp9(encoder) && isWeakMachine();
}

/** Who sq-motion-hold is about: a "motion" share on OpenH264, on the website. */
export function motionHoldEligible(mode: string | null, encoder: string | null): boolean {
  return mode === "motion" && isOpenH264(encoder) && !isDesktopApp();
}

export interface SenderOverride {
  /** A tier our own share may not exceed, or null. */
  cap: QualityTier | null;
  /** A degradation preference to use instead of the profile's, or null. */
  preference: RTCDegradationPreference | null;
  /** Which experiment this is, for its "applied" event. */
  experiment: "weak" | "hold" | null;
}

export const NO_SENDER_OVERRIDE: SenderOverride = { cap: null, preference: null, experiment: null };

/**
 * What the "on" side of the sender experiments does to our own share, given
 * its profile and the encoder the browser actually picked (null until known).
 */
export function senderOverride(mode: DegradationMode, encoder: string | null): SenderOverride {
  if (weakSender && weakSenderEligible(mode, encoder)) {
    return { cap: SQ_SENDER_CAP_TIER, preference: null, experiment: "weak" };
  }
  if (motionHold && motionHoldEligible(mode, encoder)) {
    return { cap: SQ_SENDER_CAP_TIER, preference: "maintain-resolution", experiment: "hold" };
  }
  return NO_SENDER_OVERRIDE;
}

/** The "on" sides of the sq experiments, for the reports' experiments tag. */
export function streamQualityTagParts(): string[] {
  const parts: string[] = [];
  if (weakSender) parts.push(`${SQ_WEAK_SENDER_FEATURE}=on`);
  if (motionHold) parts.push(`${SQ_MOTION_HOLD_FEATURE}=on`);
  if (h264QpApplied) parts.push(`${SQ_H264_QP_FEATURE}=on`);
  if (recvDrops) parts.push(`${SQ_RECV_DROPS_FEATURE}=on`);
  if (nativeKey) parts.push(`${SQ_NATIVE_KEY_FEATURE}=on`);
  return parts;
}
