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
//                   ~2.25x fewer pixels to encode per frame — but only once
//                   the share is seen falling behind its capture on the
//                   encoder (see SenderStruggle), so a machine that keeps up
//                   keeps its 1080p.
//
//   sq-motion-hold  A broadcaster on the "motion" profile with Chromium's
//                   software H264 (OpenH264). Under maintain-framerate
//                   WebRTC's quality scaler cuts resolution whenever the
//                   average QP passes 37 and only climbs back at 24 or less —
//                   and these shares sat at QP ~25, stuck at ~540p with 3-4x
//                   their bitrate available. On: 720p sent as such, under
//                   maintain-resolution, so the picture stops collapsing on
//                   its own. Where that leaves the frame rate collapsing
//                   instead (a weak uplink, a slow CPU), the hold lets go for
//                   the rest of the connection. Website only; the desktop app
//                   has sq-h264-qp.
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
//                   tier lower while its decoder drops frames *and* is busy
//                   (drops the network caused are not its to fix), and climbs
//                   back after a clean minute (see qualityNegotiation). Never
//                   while we relay that stream: our children would lose the
//                   resolution with us.
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
  /** A connection fell behind on its encoder — what engages the cap. */
  weakStruggle: "sq_weak_struggle",
  /** "On" only: the cap actually engaged on a connection. */
  weakCap: "sq_weak_cap",
  // sq-motion-hold
  holdSession: "sq_hold_session",
  holdLowFps: "sq_hold_lowfps",
  holdFps: "sq_hold_fps",
  holdHeight: "sq_hold_height",
  /** "On" only: the hold actually engaged on a connection. */
  holdApplied: "sq_hold_applied",
  /** "On" only: the hold let go of a connection whose frame rate collapsed under it. */
  holdRelease: "sq_hold_release",
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

// What "falling behind" means for the two sender experiments: a share that
// has frames to send — the capture delivers at least STRUGGLE_MIN_FPS, and so
// much was asked of the sender — and yet sends under STRUGGLE_FPS, and under
// STRUGGLE_SHARE of that. A still screen fails the first test on its own (the
// capture itself slows down), which keeps a quiet IDE from reading as a weak
// machine.
const STRUGGLE_MIN_FPS = 20;
const STRUGGLE_FPS = 15;
const STRUGGLE_SHARE = 0.6;
// sq-weak-sender also wants the encoder to be the reason: each frame taking
// at least half the time the frame rate allows, or WebRTC saying "cpu"
// outright. libvpx's screenshare mode also sheds frames when the content
// barely changes, and a 720p cap does nothing for that.
const STRUGGLE_ENCODE_SHARE = 0.5;
// For this long, over at least STRUGGLE_SAMPLES samples in a row, none in the
// connection's first STRUGGLE_WARMUP_MS — whose low frame rate is the
// bandwidth estimator ramping up, not the machine.
const STRUGGLE_MS = 20_000;
const STRUGGLE_SAMPLES = 3;
const STRUGGLE_WARMUP_MS = 10_000;

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

/** One stats sample of our own share's sender, as the struggle checks need it. */
export interface SendSample {
  /** Frames sent per second. */
  fps: number;
  /** Frames the capture delivered per second; null where the browser does not say. */
  sourceFps: number | null;
  /** Milliseconds the encoder spent per frame; null where unknown. */
  encodeMs: number | null;
  /** The frame rate this sender was told to send at; 0 when unknown. */
  targetFps: number;
  qualityLimitationReason: string;
}

function expectedFps(sample: SendSample): number {
  if (sample.sourceFps === null) return 0;
  return sample.targetFps > 0 ? Math.min(sample.sourceFps, sample.targetFps) : sample.sourceFps;
}

/** The share has frames to send and sends far fewer (see STRUGGLE_FPS). */
export function fallingBehind(sample: SendSample): boolean {
  const expected = expectedFps(sample);
  if (expected < STRUGGLE_MIN_FPS) return false;
  return sample.fps < STRUGGLE_FPS && sample.fps < expected * STRUGGLE_SHARE;
}

/** Falling behind because of the encoder — what sq-weak-sender's cap can fix. */
export function encoderBound(sample: SendSample): boolean {
  if (!fallingBehind(sample)) return false;
  if (sample.qualityLimitationReason === "cpu") return true;
  if (sample.encodeMs === null) return false;
  return sample.encodeMs >= (1000 / expectedFps(sample)) * STRUGGLE_ENCODE_SHARE;
}

/**
 * A condition that has to hold for a while before it counts: STRUGGLE_MS over
 * STRUGGLE_SAMPLES samples in a row, none of them in the connection's first
 * STRUGGLE_WARMUP_MS. One sample without it starts the count over.
 */
export class SenderStruggle {
  private since: number | null = null;
  private samples = 0;
  private readonly startedAt: number;

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  /** Feeds one sample; true once the condition has held long enough. */
  update(holds: boolean, now: number): boolean {
    if (!holds || now - this.startedAt < STRUGGLE_WARMUP_MS) {
      this.since = null;
      this.samples = 0;
      return false;
    }
    this.since ??= now;
    this.samples += 1;
    return this.samples >= STRUGGLE_SAMPLES && now - this.since >= STRUGGLE_MS;
  }
}

let weakSender = false;
let motionHold = false;
let h264QpApplied = false;
let recvDrops = false;
let nativeKey = false;
// Whether one of our connections fell behind under sq-weak-sender's
// conditions, in either group: the moment its exposure counts (see
// useRoomMedia), since nobody else is touched by it.
let weakStruggleSeen = false;
const listeners = new Set<() => void>();
const struggleListeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever a sender-side "sq" experiment changes. */
export function onStreamQualityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A connection fell behind under sq-weak-sender's conditions (see SenderStruggle). */
export function noteWeakStruggle() {
  if (weakStruggleSeen) return;
  weakStruggleSeen = true;
  for (const listener of struggleListeners) listener();
}

export function hasWeakStruggle(): boolean {
  return weakStruggleSeen;
}

/** For useSyncExternalStore over hasWeakStruggle. */
export function onWeakStruggle(listener: () => void): () => void {
  struggleListeners.add(listener);
  return () => struggleListeners.delete(listener);
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

export function isSqMotionHoldEnabled(): boolean {
  return motionHold;
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

/** What one connection has been through, which the overrides depend on. */
export interface SenderStruggleState {
  /** Fell behind on its encoder (sq-weak-sender's trigger). */
  weakStruggled: boolean;
  /** Fell behind under the hold, which then let go (sq-motion-hold). */
  holdReleased: boolean;
}

export const NO_STRUGGLE: SenderStruggleState = { weakStruggled: false, holdReleased: false };

/**
 * What the "on" side of the sender experiments does to our own share, given
 * its profile, the encoder the browser actually picked (null until known) and
 * what this connection has been through.
 */
export function senderOverride(
  mode: DegradationMode,
  encoder: string | null,
  state: SenderStruggleState
): SenderOverride {
  if (weakSender && state.weakStruggled && weakSenderEligible(mode, encoder)) {
    return { cap: SQ_SENDER_CAP_TIER, preference: null, experiment: "weak" };
  }
  if (motionHold && !state.holdReleased && motionHoldEligible(mode, encoder)) {
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
