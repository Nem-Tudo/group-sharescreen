"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { signalingClient, type PeerInfo } from "./signalingClient";
import { speakingDetector } from "./speakingDetector";
import { hasFeature, type Feature } from "./entitlements";
import { useAuth } from "./AuthContext";
import { trackEvent } from "./analytics";
import { iceConfigFor } from "./iceConfig";
import { ensureIceServers } from "./iceServers";
import { watchTurnRelay } from "./turnRoute";
import {
  captureNoiseSuppressedMic,
  setGraphSuppressionEnabled,
  setGraphInputGain,
  graphSuppressionAvailable,
  clampMicGain,
  DEFAULT_MIC_GAIN,
  type MicNoiseGraph,
} from "./rnnoise";
import {
  getStoredAutoJoin,
  getStoredForceRelayIce,
  setForceRelayAllowed,
  getStoredMicOn,
  getStoredNoiseSuppressionOn,
  getStoredCameraDeviceId,
  getStoredCameraFacing,
  setStoredCameraFacing,
  type CameraFacing,
  getStoredShareResolution,
  setStoredShareResolution,
  getStoredShareFps,
  setStoredShareFps,
  getStoredShareBitrate,
  setStoredShareBitrate,
  getStoredShareProfile,
  setStoredShareProfile,
  getStoredSmartQuality,
  getStoredNativeVideo,
  setStoredNativeVideo,
  getStoredNativeVideoMethod,
  setStoredNativeVideoMethod,
  setStoredSmartQuality,
  getStoredMicDeviceId,
  getStoredMicGain,
  setStoredMicGain,
  getStoredSpeakerDeviceId,
  setStoredAutoJoin,
  setStoredForceRelayIce,
  setStoredMicOn,
  setStoredNoiseSuppressionOn,
  setStoredCameraDeviceId,
  setStoredMicDeviceId,
  setStoredSpeakerDeviceId,
} from "./mediaPreferences";
import {
  BEST_TIER,
  MAX_TIER_FPS,
  WORST_TIER,
  capTier,
  tierForRenderedSize,
  type QualityTier,
} from "./videoQuality";
import {
  localMediaSources,
  LOCAL_MEDIA_SLOTS,
  type LocalMediaSlot,
  type LocalMediaAction,
} from "./localMediaSource";
import {
  androidDualCameraSupport,
  AndroidDualCameraError,
  startAndroidDualCamera,
  type AndroidDualCamera,
} from "./androidDualCamera";
import {
  EXTRA_SCREEN_SLOTS,
  clearDualCameraUnsupported,
  isDualCameraUnsupported,
  markDualCameraUnsupported,
  type ExtraScreenSlot,
} from "./multiScreen";
import {
  PeerQualityRegistry,
  contentHintForDegradation,
  setRelayCapExempt,
  type DegradationMode,
} from "./peerQualityController";
import { qualityNegotiator, type QualityChannel } from "./qualityNegotiation";
import { connectionRegistry } from "./connectionRegistry";
import { connectionDiagLink } from "./connectionDiagLink";
import { startConnectionTelemetry } from "./connectionTelemetry";
import { useMeshCapacity, useMeshTopology, type PeerCapacity } from "./useMeshTopology";
import { RelayManager, RELAY_ENABLED, type RelayChild } from "./relayLink";
import {
  applyVideoCodecPreferences,
  videoCodecOrder,
  type VideoCodecOrder,
} from "./videoCodecPreferences";
import { setPreferredAudioSink } from "./audioContext";
import { startExcludedSystemAudio, prewarmExcludedSystemAudio } from "./desktopSystemAudio";
import {
  captureAndroidScreen,
  isAndroidScreenCaptureAvailable,
  type SystemAudioUnavailableReason,
} from "./androidScreenCapture";
import { useT } from "@/lib/useI18n";
import { translate } from "@/lib/i18n";
import { getDesktopBridge } from "./desktop";
import { trackFeatureEvent, useFeature } from "./features";
import { GPU_SURVEY_FEATURE, noteGpuShareStarted } from "./gpuShareSurvey";
import { setStreamPerfEnabled, STREAM_PERF_EVENTS, STREAM_PERF_FEATURE } from "./streamPerf";
import {
  HIDDEN_WINDOWS_EVENTS,
  HIDDEN_WINDOWS_FEATURE,
  NATIVE_VIDEO_FEATURE,
  setNativeVideoIntent,
  NATIVE_VIDEO_VARIANTS,
  hasNativeVideoBridge,
  nativeVideoPeerConfig,
  nativeVideoSourceFor,
  passThroughSender,
  probeNativeVideo,
  startNativeVideo,
  type NativeVideoMethod,
  type NativeVideoOptions,
} from "./nativeVideoCapture";

// "file1".."file3" are local video or audio files played into the room (see
// lib/localMediaSource.ts). Each is a full sibling of screen and camera — its
// own peer connections, its own tiles, its own start/stop — rather than a mode
// of the screen channel, which is what lets several of them run at once and
// alongside a screen share.
// "screen2".."screen10" are the extra screens/windows of "Várias telas" (see
// lib/multiScreen.ts) — siblings of "screen" for the same reason.
// "camera2" is the phone's other lens, sent alongside "camera" (front and
// rear at once) — see the dual camera below.
type Channel = "screen" | "camera" | "camera2" | "mic" | LocalMediaSlot | ExtraScreenSlot;
// Where the screen channel's picture comes from. "display" is a real screen
// capture; "camera" is the phone fallback (no getDisplayMedia there, so
// "compartilhar tela" opens the camera). A local file is *not* one of these:
// it has a channel of its own (see the `file` channel below), so that playing
// something for the room and showing your screen are two things a person can
// do at the same time rather than a choice between them.
type ShareSource = "display" | "camera";

type SignalData = {
  channel?: Channel;
  role?: "broadcaster" | "viewer";
  // "quality" is a viewer telling us the tier it actually needs, derived
  // from the size it renders our video at (see qualityNegotiation.ts). The
  // signalling server relays `data` opaquely, so this kind needed no backend
  // change to exist.
  // "capacity" is a peer advertising what it could carry if it were asked to
  // relay. Collected continuously so that, on the rare occasion the room
  // stops fitting in a direct mesh, the plan is built from measurements that
  // already exist rather than from a scramble of probes at the worst moment.
  // "relay-assign" is the broadcaster telling us to forward what we are
  // receiving from them on to a list of other viewers (see relayLink.ts).
  // "reconnect-request" is a viewer telling us our sendPC to them is dead on
  // their end, even if it looks fine on ours — see requestReconnect's doc
  // comment.
  // "diag-request" / "diag" carry the sender's half of a connection report to
  // a viewer with the stats panel open (see connectionDiagLink.ts).
  // "route" is a viewer telling us their end of our connection to them is (or
  // no longer is) relayed through a TURN server — see lib/turnRoute.ts. An
  // older broadcaster ignores it, like any kind it does not know.
  kind?:
    | "offer"
    | "answer"
    | "ice"
    | "stop"
    | "resume"
    | "peer-left"
    | "quality"
    | "capacity"
    | "relay-assign"
    | "relay-nack"
    | "reconnect-request"
    | "diag-request"
    | "diag"
    | "route";
  // Present only on "diag". Shape-checked by connectionDiagLink before use.
  diag?: unknown;
  // Present only on "route".
  // Named for when only Cloudflare's relay was capped; now means any TURN relay.
  cloudflare?: boolean;
  sdp?: RTCSessionDescriptionInit;
  // Set on an offer that renegotiates an *existing* connection with fresh ICE
  // credentials rather than opening a new session (see openSendPC's
  // restartSendIce). The receiving side must answer it on the pc it already
  // has: an ICE restart keeps the DTLS association, so replacing the
  // connection on one side only would leave the two ends unable to agree.
  // Absent from every offer an older client sends, which is exactly right —
  // those are all full sessions and get the rebuild they have always got.
  iceRestart?: boolean;
  candidate?: RTCIceCandidateInit;
  tier?: QualityTier;
  uploadKbps?: number;
  encodeMpxs?: number;
  eligibleRelay?: boolean;
  // Whether uploadKbps/encodeMpxs above were observed or assumed — see
  // PlannerNode.measured in topologyPlanner. Absent from an older client's
  // report and read as "assumed", which is both conservative and accurate.
  measured?: boolean;
  // Set on a "stop" that is a change of route rather than the end of a
  // transmission: the sender is handing this viewer to someone else and
  // another offer is already on its way. The viewer keeps the tile as a
  // reconnecting placeholder instead of clearing it, which is the difference
  // between a brief flicker and the stream appearing to have ended.
  reparenting?: boolean;
  // Set on a "resume" that is a repair rather than a request: the viewer's
  // stream never arrived and its watchdog is asking to be served directly (see
  // RESUME_WATCHDOG_MS). The broadcaster answers it the same way either way,
  // and additionally stops routing that viewer through a relay for a while —
  // see relayOptOut, and why a person merely clicking "Retomar transmissão"
  // must *not* trigger that. Absent from an older client's resume and from a
  // deliberate one, both of which are exactly the "not a repair" case.
  recovery?: boolean;
  // Present only on relayed traffic: who originally produced this stream, as
  // opposed to who forwarded it. The receiving side files the stream under
  // this so a relayed viewer still sees the real broadcaster's name on the
  // tile rather than whoever happened to relay it.
  originId?: string;
  children?: RelayChild[];
  // Present only on "relay-assign" — the origin's own content-type pick
  // (see QualityPreset.degradation), so the relay re-encodes with the same
  // codec/degradationPreference choice the origin made instead of always
  // falling back to RelayLink's own "text" default.
  degradation?: DegradationMode;
};

// Mesh P2P means whoever shares their screen uploads one full encode per
// viewer (see AGENTS.md-adjacent discussion in useRoomMedia's callers) — in
// a big room that upload is often the actual bottleneck, so letting the
// broadcaster trade resolution/fps/bitrate down independently is the one
// lever that helps without a server-side media relay.
// The top of each dial is gated — see each SHARE_*_OPTIONS' `feature` key,
// lib/entitlements.ts for what the keys mean, and WatchRoom.tsx, which
// renders a locked option disabled and labelled with the tier that unlocks
// it. Nothing in this file itself checks entitlements: no code path here can
// set a value the picker did not offer, since a disabled <option> cannot be
// chosen. The check that *matters* is the server's — an account's feature
// list is computed there (see the API's entitlements.ts) and this end only
// ever reads it.
export type ShareResolution = "2160p" | "1440p" | "1080p" | "720p" | "576p";
export type ShareFps = 15 | 24 | 30 | 60 | 120 | 240;
// "maximo" is gated — see SHARE_BITRATE_OPTIONS' `feature` key and the doc
// comment above ShareResolution/ShareFps for the same pattern.
export type ShareBitrate = "low" | "medium" | "high" | "ultra" | "maximo" | "extremo";

type QualityPreset = {
  width: number;
  height: number;
  frameRate: number;
  // The bitrate dial, in kbps — a hard per-viewer ceiling, and on the higher
  // settings a lift above what the tier would spend on its own. Handed to
  // every PeerQualityController; see encoderCeilingKbps.
  maxBitrateKbps: number;
  // The best tier any viewer may be served at, from the broadcaster's dials.
  // A viewer asking for more than this is capped; a viewer asking for less
  // gets less. Nobody is served above it, so the dials still mean something.
  ceilingTier: QualityTier;
  // "text" biases the encoder towards a sharp picture and lets frame rate
  // fall; "motion" does the reverse. Getting this backwards is what turns a
  // 60fps share into a slideshow — see degradationPreference in
  // peerQualityController.
  degradation: DegradationMode;
  // When false ("smart quality" off) every viewer is pinned to ceilingTier
  // and their size-based requests are ignored — the broadcaster's pick wins
  // outright, which is what someone presenting to a few fullscreen viewers
  // actually wants.
  honorViewerRequests: boolean;
};

// 576p is the lowest setting offered, matching the floor of the tier ladder
// (see videoQuality's TIERS). Below it a shared screen stops being readable,
// and an unreadable stream is not a saving.
const RESOLUTION_DIMENSIONS: Record<ShareResolution, { width: number; height: number }> = {
  // 3840x2160 rather than DCI's 4096 wide: this is a screen share, and a
  // screen is UHD. Asking for a width no display actually has would make
  // getDisplayMedia scale to something arbitrary.
  "2160p": { width: 3840, height: 2160 },
  "1440p": { width: 2560, height: 1440 },
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "576p": { width: 1024, height: 576 },
};

// What each dial position is worth in kbps — the numbers the picker's own
// labels promise, and now the only thing the bitrate dial controls.
//
// It used to map to a *tier* instead, which quietly made it the master
// quality control: picking "médio" capped everyone at 720p no matter what the
// resolution dial said, and anything below "ultra" capped frame rate at 30 no
// matter what the fps dial said. Someone who asked for 1080p60 and left
// bitrate on its default got 1080p30 and no indication why. The three dials
// are meant to be independent — resolution caps pixels, fps caps frames,
// bitrate caps bits — so each now does exactly the one thing it is named for.
//
// "ultra" and "máximo" also used to be the identical tier, i.e. the same
// setting listed twice under two different promises.
const BITRATE_CEILING_KBPS: Record<ShareBitrate, number> = {
  low: 700,
  medium: 2000,
  high: 4000,
  ultra: 8000,
  maximo: 16000,
  extremo: 32000,
};

// The best tier the resolution + fps dials allow. Reusing the tile-size
// selector is deliberate: "the cheapest tier that still covers this many
// pixels at up to this frame rate" is exactly the question, and asking it in
// one place keeps a dial from ever landing on a tier that does not exist
// (720p at 60fps, say) and silently rounding somewhere surprising.
//
// The fps goes in rounded *up* to a rate the ladder has at every resolution
// (30 and above). Passed in raw, 24 and 15 matched only 576p15 — the one tier
// that low — so picking 24 fps at 1080p served everyone 1024x576 at 15 fps.
// The dial's own rate is still what gets sent: the capture is asked for it
// (see captureConstraints), and an encoder never produces more frames than
// its source hands it.
export function ceilingTierFor(resolution: ShareResolution, fps: number): QualityTier {
  const dims = RESOLUTION_DIMENSIONS[resolution];
  return tierForRenderedSize(dims.width, dims.height, 1, undefined, Math.max(30, fps));
}

// What a capture asks for: the picked resolution and fps, the fps held to the
// highest rate any tier sends (MAX_TIER_FPS). Above that the extra frames
// were captured, copied and scaled, then dropped by every sender.
//
// `bounded` adds a `max` to the frame rate, for getDisplayMedia: with ideal
// alone a screen capture on a high-refresh monitor may run faster than asked,
// and every sender then pays for frames it throws away. Only the rate — the
// dimensions keep ideal alone, so a portrait window or an ultrawide screen is
// scaled exactly as before. Not for cameras at all: a hard ceiling a webcam
// cannot meet is an OverconstrainedError, and a camera that fails to open is
// far worse than one running a little over.
export function captureConstraints(
  resolution: ShareResolution,
  fps: number,
  bounded: boolean
): MediaTrackConstraints {
  const dims = RESOLUTION_DIMENSIONS[resolution];
  const frameRate = Math.min(fps, MAX_TIER_FPS);
  return {
    width: { ideal: dims.width },
    height: { ideal: dims.height },
    frameRate: bounded ? { ideal: frameRate, max: frameRate } : { ideal: frameRate },
  };
}

// The peer-count throttle tables that used to live here are gone on purpose.
// They guessed at cost from a headcount ("4 peers, shed 120 kbps each") while
// knowing nothing about the two things that actually decide it: how big each
// viewer renders the video, and how expensive the content really is. They
// also forced a 1080p share down to the bottom of the ladder at 14+ peers,
// which made the stated goal of 1080p in a large room unreachable by
// construction. Both inputs are now measured — see videoQuality, mediaStats
// and topologyPlanner.

function getPeerCount() {
  return signalingClient.state.peers.length;
}
function getPeerCountServer() {
  return 0;
}
// `feature` names the entitlement an option needs (see lib/entitlements.ts).
// WatchRoom.tsx still lists every option for everybody — the picker is also
// how people find out these exist — but renders a locked one disabled, with
// the tier that unlocks it spelled out beside the label.
//
// It replaced a plain `accountOnly` boolean, which could only express one
// kind of lock. The moment there were two ("conta" and "Premium") a boolean
// would have had to become two booleans, and the option list would have
// become the place where entitlement rules live. Naming the feature instead
// keeps that in one table, and adding a paid option later means writing one
// key here.
export const SHARE_RESOLUTION_OPTIONS: {
  value: ShareResolution;
  label: string;
  feature?: Feature;
}[] = [
  { value: "576p", label: "576p" },
  { value: "720p", label: "720p" },
  { value: "1080p", get label() { return translate("useRoomMedia.fullHd1080p"); } },
  { value: "1440p", label: "2K (1440p)", feature: "quality_2160p" },
  { value: "2160p", label: "4K (2160p)", feature: "quality_2160p" },
];

export const SHARE_FPS_OPTIONS: { value: ShareFps; label: string; feature?: Feature }[] = [
  { value: 15, label: "15 fps" },
  { value: 24, label: "24 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
  { value: 120, label: "120 fps", feature: "fps_120" },
  // Gated by the same key as 120 rather than a new one, matching what the
  // resolution list above already does with quality_2160p for both 1440p and
  // 2160p: these keys name a *rung on the ladder*, not a literal ceiling, and
  // both of these are the same rung — anyone who may send 120 may send 240.
  // A separate fps_240 would buy nothing today and would need a second line
  // on /pro saying almost the same thing. It is worth adding the day a plan
  // wants one without the other.
  { value: 240, label: "240 fps", feature: "fps_120" },
];

// Beside the other three because it is the same kind of thing and now has
// the same two consumers: the picker in WatchRoom, and the "is this a value
// we still offer?" check that guards a setting restored from a previous
// session. Kept inline in the component, those two would have drifted.
export const SHARE_PROFILE_OPTIONS: {
  value: DegradationMode;
  label: string;
  hint: string;
}[] = [
  { value: "text", get label() { return translate("useRoomMedia.textCode"); }, hint: "prioriza nitidez" },
  { value: "balanced", get label() { return translate("useRoomMedia.balanced"); }, hint: "nitidez e fluidez" },
  { value: "motion", get label() { return translate("useRoomMedia.videoGame"); }, hint: "prioriza fluidez" },
];

export const SHARE_BITRATE_OPTIONS: { value: ShareBitrate; label: string; feature?: Feature }[] = [
  { value: "low", get label() { return translate("useRoomMedia.lowBitrate700Kbps"); } },
  { value: "medium", get label() { return translate("useRoomMedia.mediumBitrate2Mbps"); } },
  { value: "high", get label() { return translate("useRoomMedia.highBitrate4Mbps"); } },
  { value: "ultra", get label() { return translate("useRoomMedia.ultraBitrate8Mbps"); } },
  { value: "maximo", get label() { return translate("useRoomMedia.maximumBitrate16Mbps"); }, feature: "bitrate_maximo" },
  // Same key as "máximo" above, for the same reason 240 fps shares fps_120:
  // both are the paid rung, and anyone allowed 16 Mbps is allowed 32. Kept as
  // a separate step rather than raising "máximo" because 32 Mbps is a lot of
  // upload to spend by accident — somebody should have to reach for it.
  { value: "extremo", get label() { return translate("useRoomMedia.extremeBitrate32Mbps"); }, feature: "bitrate_maximo" },
];

/**
 * A dial's value restored from a previous session, or the default.
 *
 * The stored value is checked against the options actually on offer rather
 * than trusted: localStorage outlives the code that wrote it, so it can hold
 * a setting from a build where the ladder had different rungs, or whatever
 * somebody typed into devtools. An unrecognised value is not a smaller
 * problem than no value — it is the one that ends up in a MediaTrackConstraint
 * or a tier lookup — so both take the same path back to the default.
 */
function restoredSetting<T extends string | number>(
  stored: string | number | null,
  options: readonly { value: T }[],
  fallback: T
): T {
  const match = options.find((opt) => opt.value === stored);
  return match ? match.value : fallback;
}

// How far apart (in ms) openSendPCsStaggered spaces out opening sendPCs to
// many peers at once. 150ms means a 50-person room's burst spreads across
// ~7.5s instead of landing in a single instant, so it no longer clusters
// entirely inside one wsSignalLimiter window (server/rateLimiter.ts) or
// spikes the encoder with every peer's addTrack/createOffer at the same
// moment.
const STAGGER_MS = 150;

// How long onRoomJoined below waits before treating a peer missing from a
// fresh room-state as genuinely gone. When the signaling server itself
// restarts, every connection in every room drops at once and each client
// reconnects on its own independent backoff — so the very first room-state
// a client gets back can legitimately be missing peers who simply haven't
// finished reconnecting yet, not peers who actually left. Without this grace
// period, that snapshot pruned their (still perfectly healthy, TURN-relayed)
// connection immediately — tearing down and rebuilding it a second later,
// which visibly froze every tile in the room and, for whoever had one
// fullscreened, silently kicked the browser out of fullscreen (removing the
// fullscreened element from the DOM auto-exits it). Long enough to outlast a
// same-restart reconnect elsewhere; short enough that a peer who genuinely
// left while this client was disconnected still disappears promptly.
const PEER_PRUNE_GRACE_MS = 5000;

// If a sendPC hasn't reached "connected" within this long, treat it as dead
// and retry — see openSendPC's doc comment on why this exists *in addition
// to* the connectionState === "failed" handler below it: a silently-dropped
// offer/ICE candidate (see the wsSignalLimiter doc comment on the server)
// never makes the connection transition to "failed" at all, since ICE never
// even started on the other end — it just sits at "new"/"connecting"
// forever. Generous enough to cover the stagger delay above (up to ~7.5s
// for the last peer in a 50-person burst) plus normal ICE/TURN negotiation
// time on a slow link.
const CONNECT_TIMEOUT_MS = 15_000;

// Backoff for retrying a sendPC that failed or never connected — see
// scheduleSendRetry. The first retry is as prompt as it always was, so an
// ordinary blip still recovers in a couple of seconds; repeated failures for
// the same peer back off toward the ceiling instead of hammering forever.
const RETRY_BASE_DELAY_MS = 2000;
const RETRY_MAX_DELAY_MS = 30_000;

// How long a broadcaster waits for an ICE restart to actually take before
// giving up on it and rebuilding the connection outright (see restartSendIce).
// Deliberately shorter than CONNECT_TIMEOUT_MS: that budget has to cover the
// staggered opening burst of a whole room, whereas a restart is one already
// established peer re-gathering candidates.
const ICE_RESTART_TIMEOUT_MS = 6000;

// How long a viewer keeps a dead recvPC around after asking the broadcaster to
// fix it, before concluding no restart is coming and forcing a clean rebuild.
//
// Must stay comfortably above ICE_RESTART_TIMEOUT_MS. The two are a pair: the
// broadcaster is the side that decides between restarting and rebuilding, and
// it can only restart if our pc is still here to accept the offer — but it has
// to be given long enough to make that decision and act on it first. Falling
// back sooner than they do would guarantee we tear ours down mid-restart,
// which is the one outcome neither side can recover from cheaply.
const RECV_RECOVERY_TIMEOUT_MS = 9000;

// How long a peer may sit in `resumingPeers` before this side stops waiting.
//
// Every route into that set is a promise that something is on its way — a
// resume we just asked for, or a handover whose new parent is mid-offer — and
// every one of them was made with nothing behind it. "Retomando..." has no
// timeout, no retry and no button (see ResumingPeerTile), so any lost message
// anywhere along the way left that tile dead for the rest of the room's life,
// with the person watching it unable to do a single thing about it. The
// signalling socket drops outright while reconnecting (see signalingClient's
// rawSend), the server drops over its rate limit and when a target's pending
// queue overflows, and a relay's offer that never arrives leaves a pc that
// never even starts ICE and so never reaches "failed" — there are a lot of
// ways for the promise not to be kept.
//
// Generous enough to cover a slow ICE/TURN negotiation on a bad link (the
// same budget CONNECT_TIMEOUT_MS gives the direct path) so a connection that
// is merely taking its time is never given up on.
const RESUME_WATCHDOG_MS = 15_000;

// How long a viewer stays pinned to a direct connection after the cascade
// visibly failed them — see relayOptOut.
//
// Long relative to REPLAN_COOLDOWN_MS (6s) on purpose: the point is to
// outlast several planning passes. The plan is deliberately sticky (see
// planTopology's currentParents), so without this a viewer we had just
// rescued was handed straight back to the relay that failed them on the very
// next pass, and flapped between the two every six seconds indefinitely.
const RELAY_OPT_OUT_MS = 45_000;

// Shared connection-management for a single media channel (screen share or
// mic), broadcast from this client to every peer in the room. Each channel
// gets its own set of peer connections and its own signaling namespace so
// screen-share and mic negotiation never interfere with each other.
// One local-file slot. A thin wrapper so the three of them below read as three
// of the same thing rather than as three copies of an eight-argument call.
function useLocalFileChannel(
  slot: LocalMediaSlot,
  room: string,
  forceRelayIce: boolean,
  autoJoin: boolean,
  quality: QualityPreset,
  fpsRef: { current: number }
) {
  const t = useT();
  return useBroadcastChannel(
    slot,
    room,
    // Nothing to request from the OS and no permission prompt: the file is
    // already decoding in an element this page owns, because the picker filled
    // this slot's queue before this ran. The resolution dials don't apply
    // either — the stream is whatever the file is, and the per-viewer tiers
    // still downscale it on the way out like any other channel.
    () => localMediaSources[slot].captureStream(fpsRef.current),
    // Whether the element can actually be captured is checked inside
    // captureStream, which is the only place that knows.
    () => true,
    t("useRoomMedia.thisBrowserDoesNotAllowPlaying"),
    t("useRoomMedia.couldNotPlayThatFileTo"),
    forceRelayIce,
    autoJoin,
    // Motion, always — see the contentHint block in start().
    quality,
    // Stops this slot's playback when the channel carrying it ends.
    () => localMediaSources[slot].release()
  );
}

// One extra screen or window of "Várias telas" (see lib/multiScreen.ts). A
// plain browser capture and nothing else: no system audio (the first screen
// already carries it, and two loopbacks would play the room everything
// twice), no GPU helper, no phone fallback. Same resolution and fps dials as
// the first screen, read at start like the first screen does.
function useExtraScreenChannel(
  slot: ExtraScreenSlot,
  room: string,
  forceRelayIce: boolean,
  autoJoin: boolean,
  quality: QualityPreset,
  resolutionRef: { current: ShareResolution },
  fpsRef: { current: number }
) {
  const t = useT();
  return useBroadcastChannel(
    slot,
    room,
    async () => {
      try {
        return await navigator.mediaDevices.getDisplayMedia({
          video: captureConstraints(resolutionRef.current, fpsRef.current, true),
          audio: false,
        });
      } catch (err) {
        if (isVideoSourceFailure(err)) throw windowCaptureBlocked();
        throw err;
      }
    },
    () => hasDisplayCapture(),
    t("useRoomMedia.yourBrowserSupportsNeitherScreenSharing"),
    t("useRoomMedia.couldNotStartSharingCheckThe"),
    forceRelayIce,
    autoJoin,
    quality
  );
}

// The capture's own hint to the encoder about what it is looking at. Unlike
// the codec ordering it is a plain property of the track, so it can be
// corrected on a live share — which is the whole reason it lives here instead
// of inline in start(): the mid-share profile switch has to be able to
// recompute it, and the two must not be able to disagree about what a given
// profile means.
//
// The previous code hardcoded "detail" for every screen share. That is
// correct for code and documents, but for a 60fps game or video it is
// actively harmful: combined with maintain-resolution it tells the encoder to
// protect sharpness and throw away frames, so a share advertised as 60fps
// degrades into a slideshow under any load. Worse, "detail" is reported to
// interact badly with VP9 specifically (see analise/codec-diagnostico.html,
// which measures this on real content).
function contentHintFor(
  channel: Channel,
  source: ShareSource | undefined,
  mode: DegradationMode
): "motion" | "detail" | "text" {
  // Camera is always motion. The "screen" channel is not always a screen: on
  // a phone, which has no getDisplayMedia, "compartilhar tela" captures the
  // camera instead (see getScreenShareMode). Hinting "text" at a webcam tells
  // the encoder to protect sharpness and throw frames away, which is exactly
  // backwards for a moving picture — so the source, not the channel name,
  // decides.
  // A file is moving pictures too, whatever the "compartilhar tela" dial is
  // set to — same reasoning — and so is everything else that is not a real
  // screen share.
  if (!channel.startsWith("screen") || source === "camera") return "motion";
  // On a real screen share the profile chooses the hint. The table lives in
  // peerQualityController next to DEGRADATION_PREFERENCE, because a relay
  // needs exactly the same answer for the track it re-encodes and two copies
  // of it would drift. The VP9-vs-"detail" caveat above does not reach
  // balanced — it encodes with H264 (see videoCodecPreferences), where
  // "detail" behaves.
  return contentHintForDegradation(mode);
}

// ---------------------------------------------------------------------------
// Screen share statistics, for the GPU capture experiment
//
// Reported with trackFeatureEvent, so each one is counted per group of every
// live feature aimed at this person — native-video-capture among them — and
// the admin panel can put the ordinary share and the helper's side by side.
// Every share reports them, native or not: the comparison is the point.
//
//   screen_share_start           a share started (value: 1)
//   screen_share_error           a share failed to start (not a cancel)
//   screen_share_lost            ended without the person pressing stop
//   screen_share_restart         started within a minute of the last one ending
//   screen_share_seconds         on stop; value = how long it ran
//   screen_share_fps             on stop; value = average frames sent per second
//   screen_share_low_fps         on stop, below 60% of the frame rate asked for
//   screen_share_cpu_limited     on stop, when the encoder spent over a fifth
//                                of the share limited by the CPU
//   screen_share_peer_failures   on stop; value = viewer connections that failed
//   screen_share_quality_change  on stop; value = dials moved mid-share
//   native_video_start           the helper took over
//   native_video_fallback        the helper was wanted and could not start
//   native_video_no_frames       ...because its encoder never produced a frame
//   native_video_opt_in / _out   the quality panel switch was turned on / off
//   native_video_method_dupl     the capture method was set to Desktop Duplication
//   native_video_method_wgc      ...or to Windows Graphics Capture
//   screen_share_apply_restart   "Reiniciar transmissão" pressed to apply settings
//
// Averages are the value total over the event count, per group.
export const SCREEN_SHARE_STATS = {
  start: "screen_share_start",
  error: "screen_share_error",
  lost: "screen_share_lost",
  restart: "screen_share_restart",
  seconds: "screen_share_seconds",
  fps: "screen_share_fps",
  lowFps: "screen_share_low_fps",
  cpuLimited: "screen_share_cpu_limited",
  peerFailures: "screen_share_peer_failures",
  qualityChange: "screen_share_quality_change",
  nativeStart: "native_video_start",
  nativeFallback: "native_video_fallback",
  nativeNoFrames: "native_video_no_frames",
  nativeOptIn: "native_video_opt_in",
  nativeOptOut: "native_video_opt_out",
  nativeMethodDuplication: "native_video_method_dupl",
  nativeMethodWgc: "native_video_method_wgc",
  manualRestart: "screen_share_apply_restart",
} as const;

const RESTART_WINDOW_MS = 60_000;
const SHARE_SAMPLE_MS = 5_000;
let lastScreenShareEndedAt = 0;

interface ScreenStartConfig {
  native: boolean;
  method: NativeVideoMethod;
  /** Whether the helper actually took over. */
  usedNative: boolean;
  resolution: ShareResolution;
  fps: ShareFps;
}

interface ShareStats {
  startedAt: number;
  targetFps: number;
  quality: QualityPreset | null;
  qualityChanges: number;
  peerFailures: number;
  lost: boolean;
  /** Frames sent, summed over samples, and the seconds they covered. */
  frames: number;
  seconds: number;
  samples: number;
  cpuSamples: number;
  sampling: boolean;
  timer: ReturnType<typeof setInterval>;
  last: { framesSent: number; at: number } | null;
}

function startShareStats(quality: QualityPreset | null): ShareStats {
  const now = Date.now();
  trackFeatureEvent(SCREEN_SHARE_STATS.start, { value: 1 });
  if (lastScreenShareEndedAt && now - lastScreenShareEndedAt < RESTART_WINDOW_MS) {
    trackFeatureEvent(SCREEN_SHARE_STATS.restart);
  }
  const stats: ShareStats = {
    startedAt: now,
    targetFps: quality?.frameRate ?? 30,
    quality,
    qualityChanges: 0,
    peerFailures: 0,
    lost: false,
    frames: 0,
    seconds: 0,
    samples: 0,
    cpuSamples: 0,
    last: null,
    sampling: false,
    timer: setInterval(() => {
      // One sample at a time; see MediaStatsPump for what overlapping reads
      // of the same counters do to the differences taken between them.
      if (stats.sampling) return;
      stats.sampling = true;
      void sampleShare(stats).finally(() => {
        stats.sampling = false;
      });
    }, SHARE_SAMPLE_MS),
  };
  return stats;
}

// One viewer connection is enough: the encoder is shared (and the helper's
// stream is one stream), so what one sender sends is what the share makes.
async function sampleShare(stats: ShareStats) {
  // Our own share only: a relay's forwarding connections are registered as
  // sends too, carrying somebody else's stream.
  const video = connectionRegistry.list().find(
    (entry) => entry.channel === "screen" && entry.direction === "send" && entry.originId === null
  );
  if (!video) {
    stats.last = null;
    return;
  }
  try {
    const report = await video.pc.getStats();
    let framesSent: number | null = null;
    let limitation: string | null = null;
    report.forEach((entry) => {
      if (entry.type !== "outbound-rtp" || (entry as RTCOutboundRtpStreamStats).kind !== "video") return;
      const outbound = entry as RTCOutboundRtpStreamStats & { qualityLimitationReason?: string };
      framesSent = outbound.framesSent ?? null;
      limitation = outbound.qualityLimitationReason ?? null;
    });
    if (framesSent === null) return;
    const at = performance.now();
    const previous = stats.last;
    stats.last = { framesSent, at };
    // A different connection than last time, or the first sample: nothing
    // to take a difference from yet.
    if (!previous || framesSent < previous.framesSent) return;
    stats.frames += framesSent - previous.framesSent;
    stats.seconds += (at - previous.at) / 1000;
    stats.samples += 1;
    if (limitation === "cpu") stats.cpuSamples += 1;
  } catch {
    stats.last = null;
  }
}

function reportShareEnd(stats: ShareStats) {
  clearInterval(stats.timer);
  lastScreenShareEndedAt = Date.now();
  const seconds = Math.round((lastScreenShareEndedAt - stats.startedAt) / 1000);
  trackFeatureEvent(SCREEN_SHARE_STATS.seconds, { value: seconds });
  if (stats.lost) trackFeatureEvent(SCREEN_SHARE_STATS.lost);
  if (stats.peerFailures > 0) trackFeatureEvent(SCREEN_SHARE_STATS.peerFailures, { value: stats.peerFailures });
  if (stats.qualityChanges > 0) {
    trackFeatureEvent(SCREEN_SHARE_STATS.qualityChange, { value: stats.qualityChanges });
  }
  // Only a share that was watched long enough to say something.
  if (stats.seconds >= 15) {
    const fps = stats.frames / stats.seconds;
    trackFeatureEvent(SCREEN_SHARE_STATS.fps, { value: Math.round(fps) });
    if (fps < stats.targetFps * 0.6) trackFeatureEvent(SCREEN_SHARE_STATS.lowFps, { value: Math.round(fps) });
    if (stats.cpuSamples / stats.samples > 0.2) trackFeatureEvent(SCREEN_SHARE_STATS.cpuLimited);
  }
}

function useBroadcastChannel(
  channel: Channel,
  room: string,
  capture: (source?: ShareSource) => Promise<MediaStream>,
  isSupported: () => boolean,
  notSupportedMessage: string,
  failureMessage: string,
  // "Impedir conexões diretas" — see iceConfig.ts's iceConfigFor. Applies to
  // every peer connection this channel opens, sending or receiving.
  forceRelayIce: boolean,
  // "Entrar em transmissões automaticamente" — when false, a peer's very
  // first offer for a fresh share (never one we've already decided about)
  // is declined instead of answered: we tell them to stop (see
  // stopWatchingPeer) without ever opening a recvPC, and the tile shows a
  // "click to watch" placeholder instead of connecting on its own. Always
  // true for mic — this is about screen/camera video, not audio.
  autoJoin: boolean,
  // Only meaningful for the screen channel — mic never passes this. When it
  // changes while a share is already active, the live track and every
  // current sender get updated in place instead of requiring a restart.
  videoQuality?: QualityPreset,
  // Runs synchronously at the end of stop(), for teardown this hook cannot
  // know about — the mic's RNNoise graph, which owns a raw capture and a
  // worklet that outlive the track this hook stops (see rnnoise.ts).
  //
  // Synchronous, rather than the caller watching `active` go false, because
  // switching input device is stop() immediately followed by start(): an
  // effect-driven teardown races the new capture being assigned and can
  // release the graph that just replaced the one it meant to release.
  onStopped?: () => void
) {
  const eventPrefix = channel === "mic" ? "mic" : `${channel}_share`;
  // What the screen share did, for the GPU capture experiment (see
  // SCREEN_SHARE_STATS). Per share; reset by start().
  const shareStatsRef = useRef<ShareStats | null>(null);
  // Held in a ref so a caller passing an inline arrow does not change stop()'s
  // identity — stop() is a dependency of the unmount effect below, and an
  // unstable one would make that effect's cleanup fire on every render.
  const onStoppedRef = useRef(onStopped);
  useEffect(() => {
    onStoppedRef.current = onStopped;
  }, [onStopped]);
  const [active, setActive] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  // Read off the render path by the resume watchdog, which has to answer
  // "did anything actually arrive for this origin?" from inside a timer.
  const remoteStreamsRef = useRef(remoteStreams);
  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
  }, [remoteStreams]);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<ShareSource | undefined>(undefined);
  // Peers whose stream WE (as a viewer) deliberately stopped receiving, via
  // stopWatchingPeer below — kept separate from remoteStreams (which loses
  // the entry the moment the recvPC closes) so the UI can still render a
  // "you left this stream" placeholder in that peer's tile slot instead of
  // the tile just disappearing.
  const [stoppedPeers, setStoppedPeers] = useState<Set<string>>(new Set());
  const stoppedPeersRef = useRef(stoppedPeers);
  useEffect(() => {
    stoppedPeersRef.current = stoppedPeers;
  }, [stoppedPeers]);
  // Peers between resumeWatchingPeer() and their fresh stream actually
  // arriving — without tracking this separately the tile has nothing to show
  // for that stretch (not stopped anymore, but remoteStreams has nothing
  // yet), which used to just make it vanish instead of reading "Retomando...".
  const [resumingPeers, setResumingPeers] = useState<Set<string>>(new Set());
  const resumingPeersRef = useRef(resumingPeers);
  useEffect(() => {
    resumingPeersRef.current = resumingPeers;
  }, [resumingPeers]);
  // Live RTCPeerConnection.connectionState for each peer we're receiving
  // from — keyed by origin, same as remoteStreams, so a relayed stream's
  // entry survives under the real broadcaster's id. Absent entirely before
  // the first recvPC opens for that peer. This is what lets the UI tell
  // "never connected yet" / "connecting" apart from "was connected, now
  // isn't" (see WatchRoom's participant list and its "Conectando..." banner).
  const [recvConnectionStates, setRecvConnectionStates] = useState<
    Record<string, RTCPeerConnectionState>
  >({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const sendPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recvPCs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const activeRef = useRef(false);
  const pendingSendCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingRecvCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  // Peers who (as viewers of OUR stream) asked us to stop sending — mirrors
  // stoppedPeers but for the opposite direction. Consulted by the
  // peer-list-driven reconnect loop below so it doesn't just re-open a sendPC
  // that was deliberately paused the moment anyone else joins/leaves the room.
  const viewerPausedPeers = useRef<Set<string>>(new Set());
  // The peer array the reconnect loop below last looked at, so it can tell a
  // peer-list change from the far more common signaling messages that leave
  // the list alone. Holds the array by identity only — never read for its
  // contents, and never a reason to keep a stale one alive.
  const lastScannedPeers = useRef<PeerInfo[] | null>(null);
  // Peers missing from a fresh room-state, waiting out PEER_PRUNE_GRACE_MS
  // before onRoomJoined below actually tears down their connection — see its
  // own comment for why an immediate prune is wrong right after a signaling
  // server restart.
  const pendingPruneTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Mirrors the forceRelayIce prop for callbacks below that must read the
  // live value without becoming a dependency of every connection-opening
  // useCallback — same pattern as videoQualityRef.
  const forceRelayIceRef = useRef(forceRelayIce);
  const autoJoinRef = useRef(autoJoin);
  useEffect(() => {
    autoJoinRef.current = autoJoin;
  }, [autoJoin]);
  // Peers whose first offer for a fresh share we've already decided about
  // (declined via the autoJoin gate, or let through normally) — stops that
  // gate from re-firing on every retry/renegotiation offer from the same
  // share, which would otherwise decline it forever instead of just once.
  // Cleared when the peer's share actually ends (closeRecvPCFully) so the
  // *next* share they start is judged fresh.
  const autoJoinDecidedRef = useRef<Set<string>>(new Set());
  // Owns one PeerQualityController per sendPC: assigned tier plus learned
  // congestion state. Replaces the old map of per-peer setInterval monitors —
  // telemetry now comes from the single shared mediaStats pump instead of one
  // timer and one getStats() pass per peer, which in a 30-person room was 29
  // uncoordinated polls competing with the encoding those same 29 peers need.
  const qualityRegistry = useRef(new PeerQualityRegistry(`channel:${channel}`));
  // Tier each viewer has asked us for, from the size they render us at (see
  // qualityNegotiation). Kept outside the controllers because a request can
  // arrive before that peer's sendPC exists, and must survive a reconnect.
  const requestedTiers = useRef<Map<string, QualityTier>>(new Map());
  // What each peer says it could carry if promoted to relay. Only ever read
  // when a direct mesh stops fitting — see useMeshTopology.
  const peerCapacities = useRef<Map<string, PeerCapacity>>(new Map());
  // Which peer's stream arrived over which connection. Equal to the sender
  // for everything except relayed traffic — see openRecvPC.
  const recvOrigins = useRef<Map<string, string>>(new Map());
  // Source material for anything we are relaying: the pc it arrives on (so a
  // stall can be detected) and the stream itself (so it can be forwarded).
  const relaySources = useRef<Map<string, { pc: RTCPeerConnection; stream: MediaStream }>>(new Map());
  const relays = useRef(new RelayManager());
  // Peers that a relay is serving on our behalf. We must NOT also open a
  // direct sendPC to them: doing so would double-encode and double-send the
  // very stream the cascade exists to avoid sending twice.
  const relayedAway = useRef<Set<string>>(new Set());
  // Relays we told to serve somebody on the last planning pass.
  //
  // A relay that drops out of the plan entirely does not appear in the new
  // assignment map at all, so nothing in applyRelayPlan used to say a word to
  // it — and nothing else ever would. It went on re-encoding and sending to
  // children the root had already taken back and was serving directly: the
  // same stream reaching the same viewer twice, out of two machines, for as
  // long as that relay stayed in the room. Remembering who we last spoke to is
  // what lets applyRelayPlan tell them it is over.
  const activeRelays = useRef<Set<string>>(new Set());
  // The assignment each of those relays was last given, kept so it can be
  // re-sent without a fresh planning pass — see resendRelayProfile.
  const servingRelayChildren = useRef<Map<string, RelayChild[]>>(new Map());
  // Viewers to keep serving directly for a while, whatever the plan says —
  // see RELAY_OPT_OUT_MS. Written when the cascade visibly fails somebody: a
  // relay-nack, or a "resume" from a viewer's own stuck-tile watchdog.
  const relayOptOut = useRef<Map<string, number>>(new Map());
  const optOutOfRelaying = useCallback((peerId: string) => {
    relayOptOut.current.set(peerId, Date.now() + RELAY_OPT_OUT_MS);
  }, []);
  const isRelayOptedOut = useCallback((peerId: string) => {
    const until = relayOptOut.current.get(peerId);
    if (until === undefined) return false;
    if (Date.now() < until) return true;
    relayOptOut.current.delete(peerId);
    return false;
  }, []);

  // Stable getter identities so consumers' effects don't re-run every render.
  // useCallback rather than a ref holding a closure: reading .current during
  // render is exactly what the react-hooks/refs rule forbids, and these are
  // handed out from the render path. (getRequestedTiers is defined below,
  // next to the tierForPeer it depends on.)
  const getPeerCapacities = useCallback(() => peerCapacities.current, []);
  // Pending timers scheduled by openSendPCsStaggered — cleared in stop() so
  // a share that already ended never opens a late connection.
  const staggerTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Peers with a staggered open already scheduled but not yet attempted —
  // stops the peer-list-driven reconnect subscription below (which re-scans
  // on *every* signaling state change, not just peer-list changes) from
  // queuing the same still-waiting peer again and again.
  const pendingStaggeredPeers = useRef<Set<string>>(new Set());
  // Per-peer "never finished connecting" timers — see CONNECT_TIMEOUT_MS's
  // doc comment. Cleared in closeSendPC (covers the retry/failure paths) and
  // in stop() (covers a deliberate stop before one ever fires).
  const connectTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Consecutive failed attempts per peer, driving scheduleSendRetry's backoff.
  // Reset the moment a connection actually comes up, so a peer that has one bad
  // minute and then recovers is not punished with a 30s delay on its next blip.
  const sendRetryAttempts = useRef<Map<string, number>>(new Map());
  // Pending retry timers, so a deliberate stop() cannot leave one to fire into
  // a share that has already ended.
  const sendRetryTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Per-peer "I asked for a reconnect and am holding this pc open for the
  // answer" timers — see recoverRecvPC.
  const recvRecoveryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Per-peer handle onto the ICE restart of their live sendPC (see
  // openSendPC's restartSendIce, which owns the connection this closes over).
  // Exposed here so the "reconnect-request" handler can reach it too: that is
  // the asymmetric failure — their end is dead, ours still reports
  // "connected" — and renegotiating the candidate pair is the whole fix for
  // it. Returns false when a restart is not available or was already spent on
  // this failure, and the caller rebuilds instead.
  const sendIceRestarters = useRef<Map<string, () => boolean>>(new Map());


  const clearStopped = useCallback((peerId: string) => {
    setStoppedPeers((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }, []);
  // The timers that stop "Retomando..." from being forever — one per peer in
  // resumingPeers, keyed by origin exactly as that set is. See
  // RESUME_WATCHDOG_MS.
  const resumeWatchdogs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const clearResumeWatchdog = useCallback((peerId: string) => {
    const timer = resumeWatchdogs.current.get(peerId);
    if (timer) clearTimeout(timer);
    resumeWatchdogs.current.delete(peerId);
  }, []);
  // Lets the watchdog re-arm itself for its second attempt without the
  // callback having to close over its own binding.
  const armResumeWatchdogRef = useRef<(peerId: string, attempt: number) => void>(() => {});
  const armResumeWatchdog = useCallback(
    (peerId: string, attempt: number) => {
      const previous = resumeWatchdogs.current.get(peerId);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => {
        resumeWatchdogs.current.delete(peerId);
        // Resolved the ordinary way while we waited — the stream arrived (see
        // openRecvPC's ontrack), or something took this peer out of the set.
        if (!resumingPeersRef.current.has(peerId)) return;
        // Or it was already here and the placeholder is merely stale: a lost
        // "stop" can leave a second connection delivering this origin while a
        // handover marks it resuming, and asking for a repair to something
        // that is playing would tear down a working stream to rebuild it.
        if (remoteStreamsRef.current[peerId]) {
          setResumingPeers((prev) => {
            if (!prev.has(peerId)) return prev;
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
          return;
        }
        if (attempt === 0) {
          // Ask once, as loudly as the protocol allows, before giving up.
          // "resume" is the strongest thing a viewer can say and it repairs
          // every way this can be stuck at once: the broadcaster's handler
          // forgets any relay arrangement for us and force-rebuilds a direct
          // connection regardless of what its own side believes is true.
          //
          // Sent to the *origin* deliberately. A relay that never managed to
          // open our connection is not the party who can fix it, and after a
          // handover there may be no relay in the picture at all.
          signalingClient.sendSignal(peerId, {
            channel,
            role: "viewer",
            kind: "resume",
            // Distinguishes this from a person clicking "Retomar
            // transmissão" — see SignalData.recovery.
            recovery: true,
          });
          armResumeWatchdogRef.current(peerId, 1);
          return;
        }
        // Nothing came of that either. Stop claiming something is on its way:
        // a placeholder that is lying is a permanently dead tile, where a
        // stopped one is one click from trying the whole thing again.
        setResumingPeers((prev) => {
          if (!prev.has(peerId)) return prev;
          const next = new Set(prev);
          next.delete(peerId);
          return next;
        });
        setStoppedPeers((prev) => {
          if (prev.has(peerId)) return prev;
          const next = new Set(prev);
          next.add(peerId);
          return next;
        });
        trackEvent(`${eventPrefix}_resume_timeout`);
      }, RESUME_WATCHDOG_MS);
      resumeWatchdogs.current.set(peerId, timer);
    },
    [channel, eventPrefix]
  );
  useEffect(() => {
    armResumeWatchdogRef.current = armResumeWatchdog;
  }, [armResumeWatchdog]);

  const clearResuming = useCallback(
    (peerId: string) => {
      clearResumeWatchdog(peerId);
      setResumingPeers((prev) => {
        if (!prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.delete(peerId);
        return next;
      });
    },
    [clearResumeWatchdog]
  );
  const markResuming = useCallback((peerId: string) => {
    // The mirror of stopWatchingPeer's clearResuming, and it was missing.
    // The two sets are read as alternatives everywhere, and a peer in both
    // renders two tiles under one id — WatchRoom keys both placeholders by
    // tileId(kind, peer.id). Only one direction enforced it, so a reparenting
    // "stop" for someone we had already stopped watching produced exactly the
    // duplicate the other direction exists to prevent.
    clearStopped(peerId);
    armResumeWatchdog(peerId, 0);
    setResumingPeers((prev) => {
      if (prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.add(peerId);
      return next;
    });
  }, [clearStopped, armResumeWatchdog]);
  const videoQualityRef = useRef(videoQuality);
  // What was last actually asked of the capture, so the mid-share effect
  // below can tell a resolution/fps change from a change to some other part
  // of the preset. Null while nothing is being captured.
  const appliedConstraints = useRef<{ width: number; height: number; frameRate: number } | null>(
    null
  );
  // Which of the two codec orderings the currently-open senders were
  // negotiated with, and the source this share is capturing — both read by
  // that same effect, which runs outside start()'s closure. Null while
  // inactive.
  const codecOrderRef = useRef<VideoCodecOrder | null>(null);
  // The profile the senders and relays below were last told about. Seeded
  // from the preset so that the effect's first run, which happens before
  // anything is being shared, is not mistaken for a switch.
  const lastDegradationRef = useRef<DegradationMode>(videoQuality?.degradation ?? "text");
  const sourceRef = useRef<ShareSource | undefined>(undefined);
  const qualityCeilingRef = useRef<QualityTier>(videoQuality?.ceilingTier ?? BEST_TIER);
  const degradationModeRef = useRef<DegradationMode>(videoQuality?.degradation ?? "text");
  const honorRequestsRef = useRef<boolean>(videoQuality?.honorViewerRequests ?? true);
  useEffect(() => {
    videoQualityRef.current = videoQuality;
    qualityCeilingRef.current = videoQuality?.ceilingTier ?? BEST_TIER;
    degradationModeRef.current = videoQuality?.degradation ?? "text";
    honorRequestsRef.current = videoQuality?.honorViewerRequests ?? true;
  }, [videoQuality]);

  // The tier one peer should actually be served at: their size-based request
  // capped by our ceiling, or the ceiling flat out when the broadcaster has
  // turned per-viewer sizing off.
  //
  // Then capped once more by the topology planner's tier for them, when it
  // has one (see applyDirectCaps): the planner is the part that knows the
  // whole room does not fit our uplink or our encoder.
  //
  // The planner itself is fed wantedTierForPeer, without its own cap: fed
  // the capped tiers, it would see a room that now fits, lift the caps, see
  // it overflow again, and flap every planning pass.
  const directTierCaps = useRef<Map<string, QualityTier>>(new Map());
  const wantedTierForPeer = useCallback((peerId: string): QualityTier => {
    const ceiling = qualityCeilingRef.current;
    if (!honorRequestsRef.current) return ceiling;
    const requested = requestedTiers.current.get(peerId);
    return requested ? capTier(requested, ceiling) : ceiling;
  }, []);
  const tierForPeer = useCallback(
    (peerId: string): QualityTier => {
      const tier = wantedTierForPeer(peerId);
      const planned = directTierCaps.current.get(peerId);
      return planned ? capTier(tier, planned) : tier;
    },
    [wantedTierForPeer]
  );

  // The planner's tiers for the viewers we serve ourselves (experiment
  // "stream-perf", see lib/streamPerf). An empty map lifts every cap — which
  // is also what happens whenever the room fits and there is no plan at all.
  // Re-tiers only the controllers whose answer actually moved; setTier is a
  // no-op for the rest.
  const applyDirectCaps = useCallback(
    (caps: Map<string, QualityTier>) => {
      const previous = directTierCaps.current;
      if (caps.size === 0 && previous.size === 0) return;
      directTierCaps.current = caps;
      for (const peerId of sendPCs.current.keys()) {
        if (previous.get(peerId) === caps.get(peerId)) continue;
        qualityRegistry.current.get(peerId)?.setTier(tierForPeer(peerId));
      }
    },
    [tierForPeer]
  );

  // Who this share actually has to serve, and at what tier — each one's
  // request already capped by our ceiling, and every peer who is watching,
  // not only the ones who have reported a size yet.
  //
  // Both consumers need it in that form. The topology planner budgets the
  // room against these numbers, and budgeting against the raw request means
  // reserving link and CPU for quality the ceiling forbids anyone from ever
  // receiving — capacity that is reserved but unusable is exactly what tips a
  // room into a global downgrade it did not need. The encode-load estimate
  // has the same problem in the same direction.
  //
  // Which is the same argument that says a viewer who has asked us to stop
  // does not belong here at all, and they used to. Nothing is encoded or sent
  // for them, so every kbps and megapixel budgeted on their behalf is
  // reserved against a stream that will never exist — and the sum is not
  // small: a paused viewer has no tile, so they never report a size, so
  // tierForPeer falls all the way back to the ceiling. Every person in the
  // room with "entrar em transmissões automaticamente" off, and *everyone
  // else* the moment somebody uses hyperfocus, was charged up to a full
  // 1080p60 each. Ten of them is 50 Mbps and 1240 Mpx/s of demand that does
  // not exist, which is enough on its own to push a room into a cascade and a
  // global downgrade it had no need of.
  //
  // Leaving them out also takes them out of the planner's pool of candidate
  // relays, which is right for the same reason: forwarding a stream requires
  // receiving it, and they are not.
  const getRequestedTiers = useCallback(() => {
    const served = new Map<string, QualityTier>();
    for (const peer of signalingClient.state.peers) {
      if (peer.role === "moderator") continue;
      if (viewerPausedPeers.current.has(peer.id)) continue;
      served.set(peer.id, wantedTierForPeer(peer.id));
    }
    return served;
  }, [wantedTierForPeer]);

  // The same people at what is actually encoded for them — the planner's caps
  // applied. For the encode-load estimate, which calibrates the encode budget
  // against observed CPU pressure: charged the uncapped demand, a capped share
  // running comfortably would read as "this much load, no pressure", inflate
  // the budget, and talk the planner out of the very caps that made it fit.
  const getServedTiers = useCallback(() => {
    const served = new Map<string, QualityTier>();
    for (const peer of signalingClient.state.peers) {
      if (peer.role === "moderator") continue;
      if (viewerPausedPeers.current.has(peer.id)) continue;
      served.set(peer.id, tierForPeer(peer.id));
    }
    return served;
  }, [tierForPeer]);

  const removeRemoteStream = useCallback((peerId: string) => {
    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const closeSendPC = useCallback((peerId: string) => {
    const pc = sendPCs.current.get(peerId);
    if (pc) {
      pc.close();
      sendPCs.current.delete(peerId);
      if (channel !== "mic") connectionRegistry.unregister(pc);
    }
    // Drops this peer's controller and unregisters it from the stats pump.
    // The requested tier deliberately survives in requestedTiers: a reconnect
    // should resume at the size that viewer actually renders us at, not snap
    // back to full quality and have to re-learn it.
    qualityRegistry.current.remove(peerId);
    sendIceRestarters.current.delete(peerId);
    pendingSendCandidates.current.delete(peerId);
    const connectTimeout = connectTimeouts.current.get(peerId);
    if (connectTimeout) clearTimeout(connectTimeout);
    connectTimeouts.current.delete(peerId);
  }, [channel]);


  const closeRecvPC = useCallback(
    // `reparenting` says this connection is being replaced rather than ending
    // — the same distinction the "stop" signal carries, and it matters here
    // for one reason: if we are relaying this stream onward, our whole subtree
    // has to be told which of the two just happened to us. Defaulted to the
    // ending case, which is what every other caller means.
    (peerId: string, reparenting = false) => {
      const pc = recvPCs.current.get(peerId);
      if (pc) {
        pc.close();
        recvPCs.current.delete(peerId);
        if (channel !== "mic") connectionRegistry.unregister(pc);
      }
      pendingRecvCandidates.current.delete(peerId);
      const recovery = recvRecoveryTimers.current.get(peerId);
      if (recovery) clearTimeout(recovery);
      recvRecoveryTimers.current.delete(peerId);
      // The tile is filed under the origin, not the sender, so a relayed
      // stream must be removed by origin or it would linger forever.
      const origin = recvOrigins.current.get(peerId) ?? peerId;
      recvOrigins.current.delete(peerId);
      // Our children were being served this stream by us. Releasing the link
      // tells them, and until now it always told them the stream had *ended* —
      // even when we were merely being handed a new parent for it a second
      // later. Every reparenting of a mid-tree relay therefore blanked every
      // tile in the subtree below it, rather than leaving them a placeholder
      // for the moment the next relay-assign rebuilds them.
      //
      // Unconditional even when another connection still delivers this origin
      // (below): a relay whose source pc has closed cannot forward anything,
      // and the next relay-assign rebuilds it from whichever source survived.
      relays.current.release(origin, reparenting ? "reparent" : "ended");
      // Everything the *tile* is keyed by, on the other hand, is only ours to
      // tear down if nothing else is still feeding it. Connections are keyed
      // by sender and tiles by origin, so a handover legitimately has two
      // connections for one origin for a moment — and a lost "stop" can leave
      // the old one lingering well past that. Whichever of the two closes
      // first used to wipe the entry the other had just filled, which blanks
      // a tile whose stream is arriving perfectly well and leaves nothing to
      // ever fill it again: ontrack has already fired and will not fire twice.
      const stillDelivered = [...recvOrigins.current.values()].some((id) => id === origin);
      if (stillDelivered) return;
      relaySources.current.delete(origin);
      removeRemoteStream(origin);
      setRecvConnectionStates((prev) => {
        if (!(origin in prev)) return prev;
        const next = { ...prev };
        delete next[origin];
        return next;
      });
    },
    [channel, removeRemoteStream]
  );

  // Called when a peer is genuinely gone (left the room, or stopped sharing
  // altogether) rather than just paused by us — the placeholder tile has
  // nothing left to "come back" to, so drop the stopped-by-us marker too.
  const closeRecvPCFully = useCallback(
    (peerId: string) => {
      closeRecvPC(peerId);
      clearStopped(peerId);
      clearResuming(peerId);
      // This peer is genuinely gone, so drop the size we were tracking for
      // their tile — otherwise the periodic re-announce keeps sending quality
      // requests to someone who left, for as long as the room stays open.
      if (channel !== "mic") qualityNegotiator.forget(channel as QualityChannel, peerId);
      // Their share actually ended — the next one they start should be
      // judged fresh by the autoJoin gate, not treated as a continuation.
      autoJoinDecidedRef.current.delete(peerId);
    },
    [closeRecvPC, clearStopped, clearResuming, channel]
  );

  // Asks a broadcaster to rebuild their sendPC to us from scratch. Exists
  // because recv-side failure recovery used to be entirely passive: a viewer
  // whose recvPC died (ICE "failed", or "disconnected" that never came back)
  // had no way to do anything about it — it just waited for the broadcaster's
  // OWN sendPC to independently notice the same link is bad and retry (see
  // openSendPC's scheduleSendRetry/CONNECT_TIMEOUT_MS). ICE connection state
  // is computed independently on each side, so the two do not always reach
  // "failed" together; when only our side notices, the broadcaster's sendPC
  // can sit at "connected" indefinitely, believing everything is fine, while
  // our tile is permanently gone. This turns that into an active request
  // instead of a hope: the broadcaster force-recreates its sendPC (see the
  // "reconnect-request" handler below) regardless of what its own pc thinks
  // its state is.
  const requestReconnect = useCallback(
    (peerId: string) => {
      signalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "reconnect-request" });
    },
    [channel]
  );

  // Maps a tile back to the connection carrying it.
  //
  // Everything the UI holds is keyed by *origin* — the person whose screen this
  // is — because that is what the tile shows and what survives the stream being
  // rerouted. Connections are keyed by *sender*, which for a relayed stream is
  // somebody else entirely. The two are the same for a direct connection, which
  // is why this went unnoticed: stopping a relayed stream looked up a recvPC
  // under the origin's id, found nothing, closed nothing, and sent the request
  // to a broadcaster with no connection to us. The tile said "you left this
  // transmission" while the relay went on sending it, and hyperfocus — whose
  // entire purpose is to free bandwidth in exactly the large rooms where relays
  // exist — freed none of it.
  const senderForOrigin = useCallback((originOrPeerId: string): string => {
    if (recvPCs.current.has(originOrPeerId)) return originOrPeerId;
    for (const [sender, origin] of recvOrigins.current) {
      if (origin === originOrPeerId) return sender;
    }
    return originOrPeerId;
  }, []);

  // Lets a viewer stop receiving one specific peer's stream without touching
  // anyone else's — closes our recvPC for it (freeing decode/network
  // resources on our end) and tells that peer to close their matching sendPC
  // (freeing their upload resources too), instead of just hiding the tile
  // locally while the connection keeps running in the background.
  const stopWatchingPeer = useCallback(
    (peerId: string) => {
      const senderId = senderForOrigin(peerId);
      closeRecvPC(senderId);
      signalingClient.sendSignal(senderId, { channel, role: "viewer", kind: "stop" });
      // Stopping someone we were part-way through resuming (hyperfocus does
      // exactly this to everyone else in the room) has to take them out of
      // `resumingPeers` too — the recvPC that resume was waiting on is the one
      // just closed above, so nothing was ever going to arrive and clear it.
      // The two sets are read as alternatives everywhere (see WatchRoom's
      // tiles), and a peer in both is one peer with two contradictory tiles.
      clearResuming(peerId);
      // Stop telling them what size to serve us, too. closeRecvPCFully has
      // always done this for a peer who left; this path — the one hyperfocus
      // and the auto-join gate take — never did, and it is the one that runs
      // on almost everybody at once. After a hyperfocus in a room of eighty,
      // seventy-nine entries went on re-announcing every twenty seconds for
      // the life of the room, roughly four messages a second describing tiles
      // nobody is rendering. Worse than the traffic: each one refreshes that
      // broadcaster's record of what we want, so we were actively keeping
      // alive the phantom demand getRequestedTiers now declines to budget.
      if (channel !== "mic") qualityNegotiator.forget(channel as QualityChannel, peerId);
      setStoppedPeers((prev) => {
        if (prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
    },
    [channel, closeRecvPC, clearResuming, senderForOrigin]
  );

  const resumeWatchingPeer = useCallback(
    (peerId: string) => {
      // markResuming rather than the same three lines inline: it is the one
      // place that keeps the two placeholder sets exclusive and arms the
      // watchdog, and this used to be the route into `resumingPeers` that had
      // neither. A single "resume" over a socket that silently drops what it
      // cannot send (see signalingClient's rawSend) was the entire recovery
      // story for a tile with no other way back.
      markResuming(peerId);
      signalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "resume" });
    },
    [channel, markResuming]
  );

  const openSendPCRef = useRef<(peerId: string) => void>(() => {});

  const scheduleSendRetry = useCallback((peerId: string) => {
    // A P2P link can die from a transient network blip (wifi/cell handoff,
    // brief packet loss, TURN hiccup) without the peer actually leaving the
    // room. Nothing else would ever re-offer, so without this retry the
    // tile just stays dead forever.
    //
    // Backed off rather than a flat 2s, because the case this loop actually
    // spends most of its life in is not a blip: it is a peer there is no path
    // to at all (UDP blocked with no TCP/TLS TURN to fall back on, symmetric
    // NAT). At a flat 2s that peer cost a fresh RTCPeerConnection, a full ICE
    // gather and a signalling burst every ~17s forever — and every one of
    // those addTrack calls forces a keyframe out of the encoder that is
    // shared with everyone else in the room, so one unreachable participant
    // was quietly degrading the picture for all the reachable ones. The delay
    // grows to RETRY_MAX_DELAY_MS and stays there: still recovering on its
    // own if the network comes back, just not at everyone else's expense.
    const attempt = sendRetryAttempts.current.get(peerId) ?? 0;
    sendRetryAttempts.current.set(peerId, attempt + 1);
    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
    const timer = setTimeout(() => {
      sendRetryTimers.current.delete(timer);
      if (activeRef.current && signalingClient.state.peers.some((p) => p.id === peerId)) {
        openSendPCRef.current(peerId);
      }
    }, delay);
    sendRetryTimers.current.add(timer);
  }, []);

  const openSendPC = useCallback(
    (peerId: string) => {
      if (sendPCs.current.has(peerId) || !localStreamRef.current) return;
      const stream = localStreamRef.current;
      // A share encoded by the desktop app's helper travels in place of a
      // stand-in track, which needs the connection built for it (see
      // lib/nativeVideoCapture.ts).
      const nativeVideo = nativeVideoSourceFor(stream.getVideoTracks()[0]);
      const iceConfig = iceConfigFor(forceRelayIceRef.current);
      const pc = new RTCPeerConnection(nativeVideo ? nativeVideoPeerConfig(iceConfig) : iceConfig);
      sendPCs.current.set(peerId, pc);
      if (channel !== "mic") {
        connectionRegistry.register({
          channel,
          direction: "send",
          peerId,
          originId: null,
          viaRelay: false,
          pc,
        });
      }
      stream.getTracks().forEach((track) => {
        if (nativeVideo && track === nativeVideo.track) {
          // One stream for every viewer, paced by the helper rather than by a
          // per-viewer controller; see NativeVideoSource.
          nativeVideo.attach(pc, stream);
          return;
        }
        const sender = pc.addTrack(track, stream);
        if (nativeVideo) {
          passThroughSender(sender);
          return;
        }
        if (track.kind === "video") {
          const transceivers = pc.getTransceivers();
          const transceiver = transceivers.find((t) => t.sender === sender);
          const mode = degradationModeRef.current;
          if (transceiver) applyVideoCodecPreferences(transceiver, mode, true);

          // Serve this peer at the lower of what they asked for and the
          // ceiling we picked. Before their first request arrives we assume
          // they need the ceiling — erring towards too much quality for a
          // second or two is far less noticeable than starting everyone at
          // thumbnail resolution and visibly ramping up.
          const tier = tierForPeer(peerId);
          const captureHeight =
            track.getSettings().height ?? videoQualityRef.current?.height ?? 1080;
          qualityRegistry.current.setDegradation(mode);
          const ceilingKbps = videoQualityRef.current?.maxBitrateKbps;
          if (ceilingKbps) qualityRegistry.current.setBitrateCeiling(ceilingKbps);
          qualityRegistry.current.add(peerId, pc, sender, tier, captureHeight);
        }
      });
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingClient.sendSignal(peerId, {
            channel,
            role: "broadcaster",
            kind: "ice",
            candidate: e.candidate.toJSON(),
          });
        }
      };
      // Arms the "this never came up" backstop. Used both for the initial
      // offer (see CONNECT_TIMEOUT_MS's doc comment — a silently-dropped offer
      // never makes connectionState reach "failed" at all, so nothing else
      // would ever retry it) and after an ICE restart, which can equally well
      // go nowhere and must not be waited on forever.
      const armConnectTimeout = (ms: number) => {
        const previous = connectTimeouts.current.get(peerId);
        if (previous) clearTimeout(previous);
        connectTimeouts.current.set(
          peerId,
          setTimeout(() => {
            connectTimeouts.current.delete(peerId);
            if (sendPCs.current.get(peerId) === pc && pc.connectionState !== "connected") {
              closeSendPC(peerId);
              scheduleSendRetry(peerId);
            }
          }, ms)
        );
      };

      // Renegotiates this same connection with fresh ICE credentials instead
      // of throwing it away and building another.
      //
      // Worth the extra code because a rebuild is far from free. It discards
      // this viewer's PeerQualityController along with the congestion ratio it
      // spent minutes learning about their link (see peerQualityController's
      // header), and every replacement addTrack forces a keyframe out of an
      // encoder shared with the whole room — so recovering one viewer visibly
      // costs all the others. An ICE restart keeps the sender, the encoder,
      // the learned state and the DTLS association; only the candidate pair is
      // renegotiated, which is exactly what changed when someone's wifi handed
      // over to cellular or their NAT binding moved.
      //
      // Returns false when this pc is in no state to be restarted, in which
      // case the caller falls back to the rebuild.
      const restartSendIce = () => {
        // An ICE restart is a fresh offer/answer, so it needs the signalling
        // state to be idle. "closed" is terminal and restarts nothing.
        if (pc.connectionState === "closed" || pc.signalingState !== "stable") return false;
        // restartIce() is the modern spelling; the createOffer option is what
        // older implementations actually honour. Doing both is harmless and
        // leaves the intent explicit in the SDP that goes out.
        try {
          pc.restartIce?.();
        } catch {
          return false;
        }
        pc.createOffer({ iceRestart: true })
          .then(async (offer) => {
            if (sendPCs.current.get(peerId) !== pc) return;
            await pc.setLocalDescription(offer);
            if (sendPCs.current.get(peerId) !== pc) return;
            signalingClient.sendSignal(peerId, {
              channel,
              role: "broadcaster",
              kind: "offer",
              sdp: pc.localDescription,
              // Without this the viewer cannot tell an ICE restart from a
              // brand-new session, and its offer handler would answer by
              // tearing its own pc down and building another. That is not
              // merely wasteful: the two sides have to keep or replace their
              // connections together, or the surviving side is left holding a
              // DTLS association the other end has already forgotten.
              iceRestart: true,
            });
            armConnectTimeout(ICE_RESTART_TIMEOUT_MS);
          })
          .catch(() => {
            if (sendPCs.current.get(peerId) !== pc) return;
            closeSendPC(peerId);
            scheduleSendRetry(peerId);
          });
        return true;
      };

      // One restart per failure episode, reset once the link is healthy again
      // (below). So a connection that drops twice in a session gets the cheap
      // recovery both times, while a single drop the restart cannot fix still
      // falls through to a rebuild instead of restarting in a loop.
      let iceRestartTried = false;
      sendIceRestarters.current.set(peerId, () => {
        if (iceRestartTried) return false;
        iceRestartTried = true;
        return restartSendIce();
      });
      const recover = () => {
        if (sendPCs.current.get(peerId) !== pc) return;
        if (shareStatsRef.current) shareStatsRef.current.peerFailures += 1;
        if (!iceRestartTried) {
          iceRestartTried = true;
          if (restartSendIce()) return;
        }
        closeSendPC(peerId);
        scheduleSendRetry(peerId);
      };

      pc.onconnectionstatechange = () => {
        // Ignore events from a pc that's already been superseded (e.g. a
        // retry already replaced it) — otherwise this stale callback could
        // tear down the new connection instead of the dead one.
        if (sendPCs.current.get(peerId) !== pc) return;
        if (pc.connectionState === "failed") {
          recover();
        } else if (pc.connectionState === "disconnected") {
          // Some browsers (notably mobile Safari) can sit in "disconnected"
          // for a long time instead of ever declaring "failed", even though
          // the link is actually dead — which left the tile frozen
          // indefinitely instead of retrying. Give it a few seconds to
          // recover on its own from a brief blip first.
          setTimeout(() => {
            if (sendPCs.current.get(peerId) === pc && pc.connectionState === "disconnected") {
              recover();
            }
          }, 4000);
        } else if (pc.connectionState === "closed") {
          closeSendPC(peerId);
        } else if (pc.connectionState === "connected") {
          const connectTimeout = connectTimeouts.current.get(peerId);
          if (connectTimeout) clearTimeout(connectTimeout);
          connectTimeouts.current.delete(peerId);
          // This peer is demonstrably reachable, so the next failure is a
          // fresh blip and deserves the fast first retry again.
          sendRetryAttempts.current.delete(peerId);
          iceRestartTried = false;
        }
      };
      armConnectTimeout(CONNECT_TIMEOUT_MS);
      pc.createOffer()
        .then(async (offer) => {
          if (sendPCs.current.get(peerId) !== pc) return;
          await pc.setLocalDescription(offer);
          if (sendPCs.current.get(peerId) !== pc) return;
          signalingClient.sendSignal(peerId, {
            channel,
            role: "broadcaster",
            kind: "offer",
            sdp: pc.localDescription,
          });
        })
        .catch(() => {
          // Offer creation/negotiation can fail outright (not just go
          // "failed" after connecting) — e.g. a dropped signaling message.
          // Without a retry here the peer's "sharing" indicator stays on
          // forever with no video ever arriving, since nothing else re-runs
          // openSendPC until the peer list itself changes.
          if (sendPCs.current.get(peerId) !== pc) return;
          closeSendPC(peerId);
          scheduleSendRetry(peerId);
        });
    },
    [channel, closeSendPC, scheduleSendRetry, tierForPeer]
  );

  useEffect(() => {
    openSendPCRef.current = openSendPC;
  }, [openSendPC]);

  // Opens sendPCs to many peers spread out over time (see STAGGER_MS's doc
  // comment) instead of all in the same instant — used for the initial
  // "start sharing into an already-full room" burst and for the peer-list-
  // driven reconnect loop below, the two places that could otherwise hand
  // openSendPC a whole room's worth of peers at once. A single peer joining
  // normally (the common case) just gets one immediately-firing timer, so
  // this changes nothing about how fast that feels.
  const openSendPCsStaggered = useCallback(
    (peerIds: string[]) => {
      const toSchedule = peerIds.filter(
        (id) => !sendPCs.current.has(id) && !pendingStaggeredPeers.current.has(id)
      );
      toSchedule.forEach((peerId, index) => {
        pendingStaggeredPeers.current.add(peerId);
        const timer = setTimeout(() => {
          staggerTimers.current.delete(timer);
          pendingStaggeredPeers.current.delete(peerId);
          if (activeRef.current) openSendPC(peerId);
        }, index * STAGGER_MS);
        staggerTimers.current.add(timer);
      });
    },
    [openSendPC]
  );

  // Pushes a topology plan out to the room: tells each relay who to serve,
  // and stops serving those people directly ourselves.
  //
  // Idempotent by design — it runs on every planning pass, and the common
  // outcome is an empty relay list, in which case it must cost nothing and
  // change nothing.
  const applyRelayPlan = useCallback(
    (relayAssignments: Map<string, RelayChild[]>) => {
      if (!RELAY_ENABLED) return;
      // Anyone the cascade has already failed is dropped from the plan here
      // rather than in the planner: the planner reasons about capacity, and
      // "this route was tried and did not work" is not a capacity fact. They
      // stay out of both the children list their relay is told about and
      // nowRelayed, so the peer-list loop goes on serving them directly.
      const serving = new Map<string, RelayChild[]>();
      for (const [relayId, children] of relayAssignments) {
        const kept = children.filter((child) => !isRelayOptedOut(child.id));
        if (kept.length > 0) serving.set(relayId, kept);
      }
      const nowRelayed = new Set<string>();
      for (const children of serving.values()) {
        for (const child of children) nowRelayed.add(child.id);
      }

      for (const [relayId, children] of serving) {
        signalingClient.sendSignal(relayId, {
          channel,
          role: "broadcaster",
          kind: "relay-assign",
          originId: signalingClient.state.selfId ?? undefined,
          children,
          // Without this the relay had no way to know whether it was
          // re-encoding a game or a slide deck, and defaulted to "text"
          // regardless — see RelayLink.setChildren.
          degradation: degradationModeRef.current,
        });
      }
      // Relays this plan no longer uses. They have to be told in so many
      // words — see activeRelays for what silence cost. An empty list is a
      // complete instruction: setChildren releases every child still held.
      for (const relayId of activeRelays.current) {
        if (serving.has(relayId)) continue;
        signalingClient.sendSignal(relayId, {
          channel,
          role: "broadcaster",
          kind: "relay-assign",
          originId: signalingClient.state.selfId ?? undefined,
          children: [],
          degradation: degradationModeRef.current,
        });
      }
      activeRelays.current = new Set(serving.keys());
      servingRelayChildren.current = serving;

      // Someone a relay has taken over: drop our direct connection to them.
      // Telling them first is what stops the handover looking like a failure:
      // a connection that simply dies leaves them to discover it through ICE,
      // conclude we broke, and send a reconnect-request for a link we
      // deliberately closed.
      for (const peerId of nowRelayed) {
        if (!relayedAway.current.has(peerId) && sendPCs.current.has(peerId)) {
          signalingClient.sendSignal(peerId, {
            channel,
            role: "broadcaster",
            kind: "stop",
            reparenting: true,
          });
          closeSendPC(peerId);
        }
      }
      // Someone a relay used to serve but no longer does: we own them again.
      for (const peerId of relayedAway.current) {
        if (!nowRelayed.has(peerId) && activeRef.current) openSendPCRef.current(peerId);
      }
      // Nothing about the cascade is visible from outside the browser it
      // happens in, which is why every question about it so far has had to be
      // answered by reading code. A transition either way is rare and worth
      // one event.
      if (nowRelayed.size > 0 && relayedAway.current.size === 0) {
        trackEvent("cascade_engage");
      } else if (nowRelayed.size === 0 && relayedAway.current.size > 0) {
        trackEvent("cascade_release");
      }
      relayedAway.current = nowRelayed;
    },
    [channel, closeSendPC, isRelayOptedOut]
  );

  // Tells every relay currently serving for us what content this is, without
  // changing who they serve. A relay-assign is a relay's only source for that
  // (see RelayLink.setChildren), and it is only ever sent by a planning pass
  // — so switching profile mid-share left every viewer behind a relay on
  // whatever profile happened to be current when the topology was last
  // computed, which in a settled room is indefinitely.
  //
  // The last plan is a cache, and the topology also moves *outside* a
  // planning pass: a relay-nack takes children back immediately and opts them
  // out of being relayed again for a while. Re-sending the cache verbatim
  // would hand a relay back the very child it just said it could not serve,
  // which is the flap relayOptOut exists to prevent — so every child is
  // re-checked against the live routing on the way out, and the cache is
  // narrowed to what survived. That is also why a relay left with nothing is
  // skipped rather than sent an empty list: an empty list is a complete
  // instruction to release everybody (see applyRelayPlan), and this function
  // is not entitled to make that decision.
  const resendRelayProfile = useCallback(() => {
    if (!RELAY_ENABLED) return;
    const stillServing = new Map<string, RelayChild[]>();
    for (const [relayId, children] of servingRelayChildren.current) {
      const live = children.filter(
        (child) => relayedAway.current.has(child.id) && !isRelayOptedOut(child.id)
      );
      if (live.length === 0) continue;
      stillServing.set(relayId, live);
      signalingClient.sendSignal(relayId, {
        channel,
        role: "broadcaster",
        kind: "relay-assign",
        originId: signalingClient.state.selfId ?? undefined,
        children: live,
        degradation: degradationModeRef.current,
      });
    }
    servingRelayChildren.current = stillServing;
  }, [channel, isRelayOptedOut]);

  // Lets the broadcaster change resolution/fps/bitrate mid-share to react to
  // a room bogging down, instead of having to stop and restart the whole
  // capture. Skipped while inactive — a change picked before starting is
  // simply read fresh by `capture` (via videoQualityRef-equivalent state in
  // the caller) the next time start() runs.
  useEffect(() => {
    if (!videoQuality || !activeRef.current || !localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];

    // A dial moved mid-share — usually because the share looked wrong.
    const stats = shareStatsRef.current;
    if (stats && stats.quality !== videoQuality) {
      stats.quality = videoQuality;
      stats.qualityChanges += 1;
    }

    // Only when the capture's own dimensions actually moved. This used to run
    // on any change to the preset object at all, and the preset also carries
    // the content profile — so picking "Vídeo / jogo" mid-share reconfigured
    // a perfectly good capture with the identical width, height and frame
    // rate it already had. That is not free: applyConstraints asks the OS
    // capturer to reconfigure a live surface, and the rejection is swallowed
    // here, so a capture left wedged by one reported nothing at all. What the
    // room saw was a share that simply stopped arriving.
    const wanted = {
      width: videoQuality.width,
      height: videoQuality.height,
      // Held to what any tier sends, as at start (see captureConstraints).
      frameRate: Math.min(videoQuality.frameRate, MAX_TIER_FPS),
    };
    const applied = appliedConstraints.current;
    const dimensionsChanged =
      !applied ||
      applied.width !== wanted.width ||
      applied.height !== wanted.height ||
      applied.frameRate !== wanted.frameRate;
    if (track && dimensionsChanged) {
      appliedConstraints.current = wanted;
      track
        .applyConstraints({
          width: { ideal: wanted.width },
          height: { ideal: wanted.height },
          frameRate: { ideal: wanted.frameRate },
        })
        .catch(() => {
          // Nothing was applied, so the record above cannot stand: left as
          // it is, the comparison matches on every later run and the retry
          // never happens. Cleared rather than restored to the previous
          // value, because after two quick changes that previous value may
          // be another failed attempt rather than what the capture is
          // actually running at — and null, meaning "unknown", is the one
          // answer that is never wrong here: it costs one redundant
          // applyConstraints on the next change and buys back the guarantee
          // that a failure is always retried. The identity check is what
          // keeps a late failure from clearing a later attempt's record, or
          // writing anything at all over a share that has since stopped.
          if (appliedConstraints.current === wanted) appliedConstraints.current = null;
        });
    }

    // The hint is a plain property of the track, so — unlike the codec
    // ordering below — switching profile can correct it in place, and it has
    // to: it is half of what a profile means to the encoder. Frozen at
    // whatever start() picked, a share switched to "Vídeo / jogo" went on
    // telling the encoder to protect sharpness and drop frames, which is the
    // one thing that profile exists to stop it doing.
    if (track) {
      const hint = contentHintFor(channel, sourceRef.current, videoQuality.degradation);
      if (track.contentHint !== hint) track.contentHint = hint;
    }

    const captureHeight = track?.getSettings().height ?? videoQuality.height;
    qualityRegistry.current.setCaptureHeight(captureHeight);
    qualityRegistry.current.setDegradation(videoQuality.degradation);
    qualityRegistry.current.setBitrateCeiling(videoQuality.maxBitrateKbps);
    nativeVideoSourceFor(track)?.setCeiling(videoQuality.maxBitrateKbps);

    // Re-cap every peer against the new ceiling. Crucially this only moves
    // the *assigned tier*: each controller keeps the congestion ratio it has
    // learned for that viewer's link. The previous implementation rebuilt
    // every monitor from scratch here, and since this effect also ran on
    // every peer-count change, a viewer on a weak link was reset to full
    // bitrate every time anyone joined or left the room and never converged.
    for (const peerId of sendPCs.current.keys()) {
      const controller = qualityRegistry.current.get(peerId);
      if (!controller) continue;
      controller.setTier(tierForPeer(peerId));
    }

    // Viewers we do not serve directly are behind a relay, and a relay only
    // learns what it is re-encoding from an assignment message.
    if (lastDegradationRef.current !== videoQuality.degradation) {
      lastDegradationRef.current = videoQuality.degradation;
      resendRelayProfile();
    }

    // The codec ordering is the one part of a profile that cannot be changed
    // on a connection that already exists: setCodecPreferences applies to a
    // transceiver at negotiation time, so every sender opened before the
    // switch keeps the ordering the *old* profile asked for. That is not
    // cosmetic. "text" puts VP9 first, which on ordinary hardware means a
    // software encode; leaving a 60fps game on it is exactly the stutter the
    // person switched profile to get rid of, and it is a large part of why
    // switching appeared to do nothing until the whole share was stopped and
    // started again.
    //
    // So renegotiate — but only when the switch actually crossed between the
    // two orderings (text ↔ everything else, see videoCodecOrder), so that
    // moving a dial the codec does not care about, or going balanced →
    // motion, costs nothing. Closing and reopening is a path this hook
    // already runs on every relay handover, and the viewer side handles the
    // fresh offer by rebuilding its recvPC (see the offer branch in
    // onSignal). Staggered like any other burst of connections. It is the
    // same rebuild the person was doing by hand, minus a second capture
    // prompt and without losing the capture.
    //
    // A relay's own children are deliberately not rebuilt: the same codec
    // caveat applies to them, spelled out on RelayLink.setChildren, and
    // tearing down a whole subtree from here would cost far more than it
    // buys.
    const codecOrder = videoCodecOrder(videoQuality.degradation);
    if (codecOrderRef.current !== null && codecOrderRef.current !== codecOrder) {
      const peerIds = [...sendPCs.current.keys()];
      for (const peerId of peerIds) closeSendPC(peerId);
      openSendPCsStaggered(peerIds);
      trackEvent(`${eventPrefix}_profile_renegotiate`);
    }
    codecOrderRef.current = codecOrder;
  }, [
    videoQuality,
    tierForPeer,
    channel,
    eventPrefix,
    closeSendPC,
    openSendPCsStaggered,
    resendRelayProfile,
  ]);

  // The captured height is read once, when a sendPC opens, and is what every
  // scaleResolutionDownBy in this channel is computed from (see
  // videoQuality.scaleFactorFor). It is not a constant for the life of a share:
  // the person can switch which window they are sharing, resize it, or drag it
  // to a monitor of a different resolution, and getDisplayMedia follows the
  // surface. When it moved, every sender kept dividing by the old number — so
  // viewers were served visibly too small or too large for the tier they had
  // asked for, with nothing to correct it short of restarting the share.
  //
  // Cheap enough to just re-read: getSettings() is a synchronous property read,
  // and setCaptureHeight is a no-op when the value has not changed.
  useEffect(() => {
    if (!active) return;
    const sync = () => {
      const height = localStreamRef.current?.getVideoTracks()[0]?.getSettings().height;
      if (height) qualityRegistry.current.setCaptureHeight(height);
    };
    const timer = setInterval(sync, 3000);
    return () => clearInterval(timer);
  }, [active]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    if (shareStatsRef.current) {
      reportShareEnd(shareStatsRef.current);
      shareStatsRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    appliedConstraints.current = null;
    codecOrderRef.current = null;
    sourceRef.current = undefined;
    setSource(undefined);
    qualityRegistry.current.clear();
    requestedTiers.current.clear();
    // Nothing still pending from openSendPCsStaggered should open once this
    // share has already ended.
    for (const timer of staggerTimers.current) clearTimeout(timer);
    staggerTimers.current.clear();
    pendingStaggeredPeers.current.clear();
    for (const timeout of connectTimeouts.current.values()) clearTimeout(timeout);
    connectTimeouts.current.clear();
    for (const timer of sendRetryTimers.current) clearTimeout(timer);
    sendRetryTimers.current.clear();
    sendRetryAttempts.current.clear();
    for (const [peerId, pc] of sendPCs.current) {
      signalingClient.sendSignal(peerId, { channel, role: "broadcaster", kind: "stop" });
      pc.close();
      if (channel !== "mic") connectionRegistry.unregister(pc);
    }
    sendPCs.current.clear();
    // A brand-new share later starts clean — mirrors the viewer side, which
    // has its "stopped watching" marker cleared the moment this "stop"
    // signal makes closeRecvPCFully run for them (see the onSignal handler
    // below), since there's no longer a stream to have stopped watching.
    viewerPausedPeers.current.clear();
    // The cascade's bookkeeping belongs to the share that built it. Left
    // behind, `relayedAway` would make the *next* share silently skip every
    // viewer this one had routed through a relay — openSendPCsStaggered
    // filters on it — for as long as it took a fresh plan to say otherwise.
    // The relays themselves need no message: the "stop" just sent above
    // reaches them as ordinary viewers, and their own closeRecvPCFully tears
    // down the subtree beneath them.
    relayedAway.current.clear();
    activeRelays.current.clear();
    servingRelayChildren.current = new Map();
    relayOptOut.current.clear();
    // Each channel only ever reports its *own* half: `setSharing` merges the
    // pair (see signalingClient.setSharing). Before that merge existed this
    // branch read `channel === "screen" ? setSharing(false) : setMic(false)`,
    // which meant stopping a *camera* share announced the mic as off — the
    // mic channel never re-announced itself, so the indicator stayed wrong
    // for everyone else while the audio kept flowing.
    if (channel === "mic") signalingClient.setMic(false);
    else signalingClient.setSharing({ [channel]: false });
    onStoppedRef.current?.();
    trackEvent(`${eventPrefix}_stop`);
  }, [channel, eventPrefix]);

  const start = useCallback(async (requestedSource?: ShareSource) => {
    if (activeRef.current) return;
    setError(null);
    if (!isSupported()) {
      setError(notSupportedMessage);
      return;
    }
    try {
      const stream = await capture(requestedSource);
      // contentHint steers the encoder's whole strategy, and the right value
      // depends entirely on what is being shared — which is why this is a
      // user-facing choice rather than a constant. See contentHintFor, which
      // the mid-share profile switch shares with this.
      const hint = contentHintFor(channel, requestedSource, degradationModeRef.current);
      stream.getVideoTracks().forEach((track) => {
        track.contentHint = hint;
      });
      localStreamRef.current = stream;
      activeRef.current = true;
      // Everything the mid-share quality effect needs to know about what this
      // capture was built with, so that it can tell what a later change to
      // the preset actually changed. `capture` was just handed exactly these
      // constraints, so recording them here is what stops that effect from
      // re-applying them to a live capture for no reason.
      const preset = videoQualityRef.current;
      appliedConstraints.current = preset
        ? { width: preset.width, height: preset.height, frameRate: preset.frameRate }
        : null;
      codecOrderRef.current = videoCodecOrder(degradationModeRef.current);
      lastDegradationRef.current = degradationModeRef.current;
      sourceRef.current = requestedSource;
      setLocalStream(stream);
      setActive(true);
      setSource(requestedSource);
      if (channel === "mic") signalingClient.setMic(true);
      else signalingClient.setSharing({ [channel]: true });
      trackEvent(`${eventPrefix}_start`);
      if (channel === "screen" && requestedSource !== "camera") {
        shareStatsRef.current = startShareStats(videoQualityRef.current ?? null);
      }
      stream.getTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          // The capture went away without the person pressing stop: the
          // window closed, the helper died, the OS took the surface back.
          if (shareStatsRef.current) shareStatsRef.current.lost = true;
          stop();
        })
      );
      // Staggered (see STAGGER_MS's doc comment) — starting a share into an
      // already-large room is exactly the burst that used to overwhelm the
      // signaling rate limit and leave some viewers' connections stuck.
      openSendPCsStaggered(signalingClient.state.peers.map((peer) => peer.id));
    } catch (err) {
      // A failure the capture already worked out the reason for carries the
      // message that fits it — `failureMessage` is a per-channel fallback for
      // everything else, and "verifique as permissões" is the wrong thing to
      // say when permissions were never involved.
      // Which error it was goes along with the event. "_error" on its own had
      // no way to tell a blocked window from a missing permission from a
      // driver fault, so a bug reported by a handful of people could not be
      // told apart from any other in the numbers.
      const errorInfo =
        err instanceof DOMException || err instanceof Error
          ? { name: err.name, message: err.message.slice(0, 120) }
          : undefined;
      if (err instanceof ShareStartError) {
        setError(err.message);
        trackEvent(`${eventPrefix}_error`, errorInfo);
        if (channel === "screen") trackFeatureEvent(SCREEN_SHARE_STATS.error);
        return;
      }
      // Clicking "share" and then Cancel on the browser's own picker throws
      // the same NotAllowedError a real OS/browser permission denial does —
      // there is no reliable way to tell them apart from here. Treating it
      // as silent is the better trade: a cancel is the overwhelmingly common
      // case, and surfacing "verifique as permissões" every time someone
      // just changes their mind was the actual complaint. AbortError covers
      // the same gesture on browsers that use that name instead.
      const cancelled = isCancelLikeError(err);
      if (cancelled) {
        trackEvent(`${eventPrefix}_cancelled`);
      } else {
        setError(failureMessage);
        trackEvent(`${eventPrefix}_error`, errorInfo);
        if (channel === "screen") trackFeatureEvent(SCREEN_SHARE_STATS.error);
      }
    }
  }, [
    capture,
    isSupported,
    notSupportedMessage,
    failureMessage,
    channel,
    eventPrefix,
    openSendPCsStaggered,
    stop,
  ]);

  // Whether a swap is already in flight. Two flips in quick succession — a
  // double tap on the button is all it takes — would otherwise open two
  // cameras and race to decide which one the room ends up watching.
  const swapping = useRef(false);

  /**
   * Points this channel at a freshly captured source without the viewers
   * noticing anything beyond a moment's freeze.
   *
   * The thing it replaces is `stop()` followed by `start()`, which is what
   * switching cameras used to do. That works, and it is brutal: stopping a
   * channel sends every viewer a "stop", which tears their recvPC down, drops
   * their tile, takes anyone watching fullscreen back out to the grid, and
   * loses the per-viewer state that went with it — their chosen tier, their
   * volume, their PeerQualityController's learned congestion ratio. Starting
   * again then rebuilt all of it from nothing. For the person flipping from
   * the front camera to the rear one, that is a whole room interrupted to
   * answer a question about their own phone.
   *
   * replaceTrack asks none of it. The sender, the transceiver, the encoder's
   * parameters and the DTLS association all stay exactly as they are; only
   * the media feeding the sender changes, and because the new track is the
   * same kind as the old one it needs no renegotiation — the viewer's
   * recvPC never learns anything happened. The one visible cost is the
   * keyframe the new encoder has to emit, which viewers see as a brief hitch.
   *
   * Returns false when the swap could not be done, in which case the caller
   * should fall back to the restart. Crucially, a *capture* that fails costs
   * nothing at all: the old one is still running and still being sent, so a
   * flip to a camera the phone will not open leaves the room watching what it
   * was already watching rather than watching nothing.
   */
  const swapCapture = useCallback(
    async (requestedSource?: ShareSource): Promise<boolean> => {
      if (!activeRef.current || swapping.current) return false;
      const previous = localStreamRef.current;
      const previousVideo = previous?.getVideoTracks()[0];
      // Nothing to replace: a channel mid-teardown, or one whose stream has
      // no video at all. The caller's restart is the right answer there.
      if (!previous || !previousVideo) return false;

      swapping.current = true;
      let next: MediaStream;
      try {
        next = await capture(requestedSource);
      } catch {
        // Deliberately swallowed rather than surfaced through setError: the
        // share the person is running is untouched and still fine, and
        // painting a red banner over a working transmission because the
        // *other* camera would not open says the wrong thing. The caller
        // sees false and can decide.
        swapping.current = false;
        return false;
      }

      const nextVideo = next.getVideoTracks()[0];
      // The share may have been stopped while getUserMedia was open, in which
      // case this capture is already orphaned and must not be left running.
      if (!activeRef.current || !nextVideo || localStreamRef.current !== previous) {
        next.getTracks().forEach((t) => t.stop());
        swapping.current = false;
        return false;
      }

      nextVideo.contentHint = contentHintFor(
        channel,
        requestedSource,
        degradationModeRef.current
      );

      try {
        // Every sender at once. A relay is an ordinary viewer of ours as far
        // as this map is concerned, so its subtree follows from the one
        // replacement here without any message of its own.
        await Promise.all(
          [...sendPCs.current.values()].flatMap((pc) =>
            pc
              .getSenders()
              .filter((sender) => sender.track?.kind === "video")
              .map((sender) => sender.replaceTrack(nextVideo))
          )
        );
      } catch {
        // replaceTrack refuses when the new track cannot be encoded by the
        // parameters already negotiated. Rare, and recoverable only by
        // renegotiating — which is exactly the restart the caller falls back
        // to, so this capture is discarded and the old one left in place.
        next.getTracks().forEach((t) => t.stop());
        swapping.current = false;
        return false;
      }

      // The MediaStream object itself is kept and its tracks swapped inside
      // it, rather than a new one being put into state. Every local consumer
      // holds this exact object as a <video> srcObject; handing them a new
      // one would remount the element and make the local preview flash for
      // the one person who did not need telling that their camera changed.
      //
      // Added before the old one is removed, so the stream is never briefly
      // without a video track at all: an attached <video> whose stream loses
      // its last video track can go black and stay black even once another
      // is added, and the order here costs nothing to avoid it.
      previous.addTrack(nextVideo);
      previous.removeTrack(previousVideo);
      // Moved over before the old track is stopped: stop() fires no event,
      // but `ended` on a track already being watched would reach the listener
      // start() installed and take the whole share down with it.
      previousVideo.stop();
      // The new track needs the same backstop the original got — a camera
      // that disappears mid-share (unplugged, or taken by another app) should
      // still end the transmission rather than leave a frozen tile.
      nextVideo.addEventListener("ended", () => stop());

      // What the sender's scaleResolutionDownBy is computed from. The
      // periodic sync would pick this up within three seconds anyway; doing
      // it here means the first frames out of the new camera are already
      // scaled for the tier each viewer asked for, instead of arriving
      // visibly wrong and being corrected.
      const height = nextVideo.getSettings().height;
      if (height) qualityRegistry.current.setCaptureHeight(height);

      const preset = videoQualityRef.current;
      appliedConstraints.current = preset
        ? { width: preset.width, height: preset.height, frameRate: preset.frameRate }
        : null;
      sourceRef.current = requestedSource;
      setSource(requestedSource);

      swapping.current = false;
      trackEvent(`${eventPrefix}_swap`);
      return true;
    },
    [capture, channel, eventPrefix, stop]
  );

  const openRecvPC = useCallback(
    // peerId is who is sending to us; originId is who actually produced
    // the stream. They differ only for relayed traffic. Keeping the recvPC
    // keyed by sender while filing the stream under the origin is what lets a
    // relayed viewer still see the real broadcaster on the tile.
    (peerId: string, originId: string = peerId) => {
      const pc = new RTCPeerConnection(iceConfigFor(forceRelayIceRef.current));
      recvPCs.current.set(peerId, pc);
      recvOrigins.current.set(peerId, originId);
      if (channel !== "mic") {
        connectionRegistry.register({
          channel,
          direction: "recv",
          peerId,
          originId,
          viaRelay: originId !== peerId,
          pc,
        });
        // Our end relaying through TURN is invisible to whoever sends to
        // us, and they are the one who decides what is encoded — so say so.
        // To the peer sending (a relay, for relayed traffic), not the origin.
        // No cleanup needed: see watchTurnRelay.
        watchTurnRelay(pc, (via) => {
          signalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "route", cloudflare: via });
        });
      }
      setRecvConnectionStates((prev) => ({ ...prev, [originId]: pc.connectionState }));
      pc.ontrack = (e) => {
        // Smooth out network jitter for viewers with fluctuating or high-latency
        // connections (absorbs micro-bursts without causing frame freezes).
        if (e.receiver && "playoutDelayHint" in e.receiver) {
          try {
            (e.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint = 0.1;
          } catch {
            // Ignored on unsupported browsers
          }
        }
        const origin = recvOrigins.current.get(peerId) ?? peerId;
        // Every RTP packet already carries the sender's own measured audio
        // level, so handing the receiver over lets the speaking indicator
        // read it instead of building an analyser per participant to measure
        // the same thing again here. Only the mic channel: the others carry
        // audio nobody draws a speaking ring for.
        if (channel === "mic" && e.streams[0]) {
          speakingDetector.attachReceiver(e.streams[0].id, e.receiver);
        }
        setRemoteStreams((prev) => ({ ...prev, [origin]: e.streams[0] }));
        clearResuming(origin);
        // A stream is arriving from them, so neither placeholder is true any
        // more — including the stopped one, which only clearResuming's twin
        // used to retire. That mattered once the resume watchdog started
        // moving a peer into stoppedPeers after giving up on them: the
        // broadcaster's own retry loop can perfectly well succeed afterwards,
        // and the marker it left behind would then sit there being wrong,
        // waiting to caption the next gap as "you left this transmission".
        clearStopped(origin);
        // Only a relay needs to hold on to the pc and stream: it is the source
        // it will forward, and the thing it must watch for stalls.
        if (RELAY_ENABLED && channel === "screen") {
          relaySources.current.set(origin, { pc, stream: e.streams[0] });
        }
        // A fresh track means a brand new sender on their side, which has
        // never heard what size we render them at — so it is currently
        // encoding at its own ceiling for us. Re-announce immediately rather
        // than waiting for the next resize or the periodic refresh.
        if (channel !== "mic") {
          qualityNegotiator.announce(channel as QualityChannel, peerId);
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signalingClient.sendSignal(peerId, {
            channel,
            role: "viewer",
            kind: "ice",
            candidate: e.candidate.toJSON(),
          });
        }
      };
      // Asks the broadcaster to repair this link, and — crucially — keeps our
      // connection alive while they do.
      //
      // Closing it immediately, which is what this used to do, quietly ruled
      // out the cheap repair entirely: an ICE restart renegotiates the pc both
      // sides already have, so if ours is gone by the time their offer lands
      // there is nothing left to restart and they are forced into a full
      // rebuild. Holding it open for RECV_RECOVERY_TIMEOUT_MS gives them the
      // chance to take that path, and costs nothing when they do not — a
      // rebuild arrives as an ordinary offer, and the handler below replaces
      // this pc for that case exactly as it always has.
      const recoverRecvPC = () => {
        if (recvPCs.current.get(peerId) !== pc) return;
        if (recvRecoveryTimers.current.has(peerId)) return;
        // See requestReconnect's doc comment: ICE state is computed
        // independently on each side, so the broadcaster may still believe
        // this link is perfectly healthy and would otherwise never act.
        requestReconnect(peerId);
        const timer = setTimeout(() => {
          recvRecoveryTimers.current.delete(peerId);
          if (recvPCs.current.get(peerId) !== pc) return;
          if (pc.connectionState === "connected") return;
          // No restart came, or it did not take. Start over from scratch.
          closeRecvPC(peerId);
          requestReconnect(peerId);
        }, RECV_RECOVERY_TIMEOUT_MS);
        recvRecoveryTimers.current.set(peerId, timer);
      };

      pc.onconnectionstatechange = () => {
        if (recvPCs.current.get(peerId) !== pc) return;
        setRecvConnectionStates((prev) => ({ ...prev, [originId]: pc.connectionState }));
        if (pc.connectionState === "closed") {
          closeRecvPC(peerId);
          requestReconnect(peerId);
        } else if (pc.connectionState === "failed") {
          recoverRecvPC();
        } else if (pc.connectionState === "disconnected") {
          // Don't tear down a viewer's tile over a brief blip — give it a
          // few seconds to recover on its own first.
          setTimeout(() => {
            if (recvPCs.current.get(peerId) === pc && pc.connectionState === "disconnected") {
              recoverRecvPC();
            }
          }, 4000);
        } else if (pc.connectionState === "connected") {
          // Recovered, by whichever route. Drop the fallback so it cannot
          // later tear down a connection that is working again.
          const recovery = recvRecoveryTimers.current.get(peerId);
          if (recovery) clearTimeout(recovery);
          recvRecoveryTimers.current.delete(peerId);
        }
      };
      return pc;
    },
    [channel, closeRecvPC, clearResuming, clearStopped, requestReconnect]
  );

  useEffect(() => {
    const unsubscribeSignal = signalingClient.onSignal((from, rawData) => {
      const data = rawData as SignalData;
      if (data.kind === "peer-left") {
        closeSendPC(from);
        closeRecvPCFully(from);
        viewerPausedPeers.current.delete(from);
        // Not cleared in closeSendPC: that runs on the failure path itself,
        // immediately before scheduling the next retry, and resetting it there
        // would flatten the backoff back to a constant interval.
        sendRetryAttempts.current.delete(from);
        // Their capacity report describes a link that is gone. Nothing else
        // ever deleted from this map, so a long share in a busy room held one
        // entry for everyone who had ever passed through.
        peerCapacities.current.delete(from);
        return;
      }
      if (data.channel !== channel) return;
      if (data.role === "broadcaster") {
        if (data.kind === "offer" && data.sdp) {
          // "Entrar em transmissões automaticamente" off: decline this
          // peer's first offer for a fresh share instead of answering it —
          // no recvPC ever opens, so no bandwidth is spent on a tile nobody
          // asked to see yet. stopWatchingPeer both tells them to stop
          // retrying (mirrors what it does for a deliberate mid-call stop)
          // and marks the tile "stopped" so the grid shows a resume prompt.
          // Marked decided *before* calling it so the "stop" signal this
          // sends doesn't loop back through this same gate.
          if (
            channel !== "mic" &&
            !autoJoinRef.current &&
            !autoJoinDecidedRef.current.has(from)
          ) {
            autoJoinDecidedRef.current.add(from);
            stopWatchingPeer(from);
            return;
          }
          // There are two kinds of offer, and telling them apart is the whole
          // job here.
          //
          // An offer with no `iceRestart` flag is a brand-new session from a
          // brand-new RTCPeerConnection on the sender's side. If we still have
          // a pc for this peer it belongs to a superseded one, and reusing it
          // would feed unrelated SDP into it instead of cleanly replacing the
          // connection — which can leave two live tracks feeding the same
          // rendered stream (duplicated, echoing audio) rather than one. So
          // that case still closes and rebuilds, exactly as before.
          //
          // An offer that *is* flagged is the same session asking to
          // renegotiate its candidate pair (see openSendPC's restartSendIce).
          // Answering it on the pc we already have is the entire point: the
          // stream, the decoder and the tile all survive, where a rebuild
          // blanks the tile and costs the sender a keyframe out of an encoder
          // the rest of the room is sharing. It only works while our side is
          // genuinely still there and idle enough to take an offer, so
          // anything else falls back to the rebuild.
          const existingPc = recvPCs.current.get(from);
          const restartInPlace =
            data.iceRestart === true &&
            existingPc !== undefined &&
            existingPc.connectionState !== "closed" &&
            existingPc.signalingState === "stable";
          if (existingPc && !restartInPlace) closeRecvPC(from);
          const thisPc =
            restartInPlace && existingPc ? existingPc : openRecvPC(from, data.originId ?? from);
          thisPc
            .setRemoteDescription(data.sdp)
            .then(async () => {
              if (recvPCs.current.get(from) !== thisPc) return null;
              const queued = pendingRecvCandidates.current.get(from);
              if (queued) {
                pendingRecvCandidates.current.delete(from);
                for (const candidate of queued) {
                  await thisPc.addIceCandidate(candidate).catch(() => {});
                }
              }
              return thisPc.createAnswer();
            })
            .then((answer) => {
              if (!answer || recvPCs.current.get(from) !== thisPc) return;
              return thisPc.setLocalDescription(answer);
            })
            .then(() => {
              if (recvPCs.current.get(from) !== thisPc) return;
              signalingClient.sendSignal(from, {
                channel,
                role: "viewer",
                kind: "answer",
                sdp: thisPc.localDescription,
              });
            })
            .catch(() => {
              if (recvPCs.current.get(from) === thisPc) closeRecvPC(from);
            });
        } else if (data.kind === "ice" && data.candidate) {
          const pc = recvPCs.current.get(from);
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(data.candidate).catch(() => {});
          } else {
            const queue = pendingRecvCandidates.current.get(from) ?? [];
            queue.push(data.candidate);
            pendingRecvCandidates.current.set(from, queue);
          }
        } else if (data.kind === "stop") {
          if (data.reparenting) {
            // Same stream, different route. Closing the connection is right —
            // it is genuinely going away — but clearing the tile is not: an
            // offer from the new parent is already in flight, and treating the
            // handover as "they stopped sharing" is what turned every
            // reparenting into a tile that vanished and then reappeared.
            // Marking it resuming keeps a placeholder on screen for the second
            // or two in between, and openRecvPC's ontrack clears it.
            //
            // The origin has to be read *before* closeRecvPC, which deletes the
            // sender→origin mapping on its way out. Reading it afterwards meant
            // the `?? from` fallback always won, and on the one path where
            // sender and origin differ — a relay handing a child on — that put
            // the *relay* into resumingPeers instead of the broadcaster. Two
            // things followed, both permanent: the broadcaster's tile went
            // blank with no placeholder at all, and a participant transmitting
            // nothing acquired a "Retomando..." tile that nothing could ever
            // clear, since ontrack clears by origin. Direct traffic hid it
            // completely — there the two ids are the same.
            const origin = recvOrigins.current.get(from) ?? from;
            closeRecvPC(from, true);
            markResuming(origin);
            return;
          }
          // The broadcaster stopped sharing entirely — nothing to "come
          // back" to, so this fully clears the tile rather than leaving a
          // stopped-by-us placeholder behind.
          closeRecvPCFully(from);
        } else if (data.kind === "diag") {
          if (channel !== "mic") connectionDiagLink.accept(channel, from, data.originId, data.diag);
        }
      } else if (data.role === "viewer") {
        if (data.kind === "diag-request") {
          // Answered by whoever holds the sending end — us as the broadcaster,
          // or us as a relay for one of our children; connectionDiagLink finds
          // the connection either way and ignores anyone we do not send to.
          if (channel === "mic") return;
          connectionDiagLink.respond(channel, from, data.originId, () => {
            const preset = videoQualityRef.current;
            return {
              tier: tierForPeer(from),
              profile: degradationModeRef.current,
              height: preset?.height,
              frameRate: preset?.frameRate,
              maxBitrateKbps: preset?.maxBitrateKbps,
            };
          });
          return;
        }
        if (data.kind === "relay-assign") {
          // The broadcaster has asked us to forward their stream onward. We
          // can only do that if we are actually receiving it — if the source
          // has not arrived yet the assignment is dropped rather than queued,
          // because by the time it did arrive the plan would likely be stale.
          if (!RELAY_ENABLED || channel !== "screen") return;
          const origin = data.originId ?? from;
          if (!data.children) return;
          // An assignment naming nobody is the root saying this relay is no
          // longer part of the plan (see applyRelayPlan). Answered before the
          // source check below, because it has to work in exactly the case
          // that check rejects: our source being gone is precisely when a link
          // still holding children would otherwise go on re-encoding for
          // people the root has already taken back.
          if (data.children.length === 0) {
            relays.current.get(origin)?.releaseAllChildren();
            return;
          }
          const source = relaySources.current.get(origin);
          if (!source) {
            // We are not receiving this stream, so we cannot forward it. That
            // is an ordinary situation — we may have stopped watching them, be
            // hyperfocused elsewhere, or have auto-join switched off — and it
            // used to be handled by silently dropping the assignment. Silence
            // was the wrong answer: the broadcaster had already closed its
            // direct connection to every viewer in this list on the assumption
            // we would take them, so each of them lost their stream outright
            // and stayed black until some later plan happened to route around
            // us. Saying so puts them back within one signalling round trip.
            signalingClient.sendSignal(origin, {
              channel: "screen",
              role: "viewer",
              kind: "relay-nack",
              originId: origin,
              children: data.children,
            });
            return;
          }
          // Read as a set rather than "motion or else text": with three
          // profiles that shape is no longer a default, it is a
          // misclassification. A broadcaster sharing a game on "balanced"
          // would have had their relayed viewers served under
          // maintain-resolution — the one setting they did not choose, and
          // the one that turns their share into a slideshow.
          //
          // A sender that names no profile at all predates this field (an
          // older tab still open through a deploy). That falls to the app's
          // default, same as RelayLink's own — "nobody said" and "nobody
          // opened the menu" are the same statement and deserve the same
          // answer.
          const degradation: DegradationMode =
            data.degradation === "motion" || data.degradation === "balanced"
              ? data.degradation
              : "text";
          const link = relays.current.ensure(origin, source.stream, source.pc, forceRelayIceRef.current, () => {
            // Our own source died. Tell the broadcaster so it can re-plan
            // rather than keep routing people through a dead branch.
            signalingClient.sendSignal(origin, {
              channel: "screen",
              role: "viewer",
              kind: "capacity",
              uploadKbps: 0,
              encodeMpxs: 0,
              eligibleRelay: false,
              measured: true,
            });
          });
          const wasIdle = !link.hasChildren();
          link.setChildren(data.children, degradation);
          if (wasIdle && link.hasChildren()) trackEvent("relay_promoted");
          return;
        }
        if (data.kind === "relay-nack") {
          // A relay we assigned children to cannot serve them. Take them back
          // immediately rather than waiting for the next planning pass, and
          // drop them from relayedAway so the peer-list-driven loop stops
          // skipping them too.
          if (!activeRef.current) return;
          for (const child of data.children ?? []) {
            relayedAway.current.delete(child.id);
            // And keep them here. Taking them back for one pass and handing
            // them to the same relay six seconds later is not a recovery, it
            // is a flap — see relayOptOut.
            optOutOfRelaying(child.id);
            if (!viewerPausedPeers.current.has(child.id)) openSendPC(child.id);
          }
          trackEvent("relay_nack");
          return;
        }
        if (data.kind === "capacity") {
          const existing = peerCapacities.current.get(from);
          const now = Date.now();
          peerCapacities.current.set(from, {
            peerId: from,
            uploadKbps: data.uploadKbps ?? 0,
            encodeMpxs: data.encodeMpxs ?? 0,
            eligibleRelay: data.eligibleRelay === true,
            measured: data.measured === true,
            // firstSeenAt is preserved across updates on purpose: it is how
            // "has been here a while" is measured, and that is the tiebreak
            // that stops the planner promoting someone who just walked in and
            // may walk straight back out.
            firstSeenAt: existing?.firstSeenAt ?? now,
            updatedAt: now,
          });
        } else if (data.kind === "quality" && data.tier) {
          // This viewer told us how large they actually render our video.
          // Recorded even when no sendPC exists yet (a request can beat the
          // connection, and must survive a reconnect), then applied to the
          // live controller if there is one.
          requestedTiers.current.set(from, data.tier);
          qualityRegistry.current.get(from)?.setTier(tierForPeer(from));
        } else if (data.kind === "route") {
          // This viewer's end of our connection to them is relayed through
          // a TURN server (or stopped being). Caps only what is encoded
          // for them — see lib/turnRoute.ts. Either registry: they are our
          // own viewer, or a child of a relay we are running.
          const via = data.cloudflare === true;
          qualityRegistry.current.setRemoteRelayRoute(from, via);
          relays.current.findByChild(from)?.setRemoteRelayRoute(from, via);
        } else if (data.kind === "stop") {
          // This peer (as a viewer of OUR stream) asked us to stop sending —
          // free the upload-side connection and remember not to reopen it on
          // our own until they explicitly ask to resume.
          viewerPausedPeers.current.add(from);
          closeSendPC(from);
          // They may be a relay child rather than one of our own viewers, and
          // that connection lives somewhere else entirely (see relayLink). It
          // is also the expensive one — a whole re-encode — so it is the one
          // most worth releasing when someone says they are not watching.
          relays.current.findByChild(from)?.releaseChild(from);
        } else if (data.kind === "resume") {
          viewerPausedPeers.current.delete(from);
          // If a relay was serving them, that arrangement ended when they
          // asked to stop. Forgetting it here keeps the direct connection we
          // are about to open from being immediately closed again as a
          // duplicate, and lets the next planning pass decide afresh whether
          // they should go back to a relay.
          relayedAway.current.delete(from);
          // A resume flagged as a repair is a viewer whose relayed stream
          // never arrived at all, asking to be served by us instead (see
          // RESUME_WATCHDOG_MS). Letting the next planning pass hand them
          // straight back to the route that just failed them would undo the
          // rescue six seconds after it worked, so that route is closed to
          // them for a while. A person clicking "Retomar transmissão" is not
          // this and does not set the flag — nothing was broken there, and
          // pinning every manual resume to a direct connection would put load
          // back on a broadcaster the cascade exists to take it off.
          if (data.recovery) optOutOfRelaying(from);
          // Closed first, deliberately. openSendPC is a no-op when a pc for
          // this peer already exists, and one can perfectly well still be
          // sitting there: the "stop" that should have torn it down is sent
          // over the signalling socket, which drops messages outright while it
          // is reconnecting (see signalingClient.rawSend). When that happened
          // the resume did nothing at all and the viewer sat on "Retomando..."
          // forever, with nothing anywhere to ever try again.
          if (activeRef.current) {
            closeSendPC(from);
            openSendPC(from);
          }
        } else if (data.kind === "reconnect-request") {
          // This viewer's recvPC died on their end, even though ours may
          // still report "connected" — ICE state is computed independently
          // on each side, so ours has no reason to have noticed anything is
          // wrong on its own. Force a fresh sendPC regardless of what ours
          // currently thinks, unless they deliberately paused us.
          if (viewerPausedPeers.current.has(from)) return;
          // A relay is serving them on our behalf. Reopening a direct
          // connection here would not repair anything — it would double-encode
          // and double-send the very stream the cascade exists to send once.
          // Their relay is the one that can help, and they will reach it (see
          // the relay branch below, which runs on that machine).
          if (relayedAway.current.has(from)) return;
          // We may not be the broadcaster at all: if we are relaying someone
          // else's stream to this viewer, the dead connection is the relay
          // child, and we are the only party who can rebuild it. Without this
          // the request fell straight through the `!activeRef.current` guard
          // below — a relay is not sharing anything of its own — so a relayed
          // viewer whose link dropped had no recovery path in the system at
          // all, and simply kept a frozen tile until the topology happened to
          // be replanned.
          const relayForPeer = relays.current.findByChild(from);
          if (relayForPeer) {
            relayForPeer.reopenChild(from);
            return;
          }
          if (!activeRef.current) return;
          // Renegotiate in place if we still can. Their pc is being held open
          // for exactly this (see recoverRecvPC), so the cheap repair is on
          // the table right up until their own fallback fires.
          if (sendIceRestarters.current.get(from)?.() === true) return;
          closeSendPC(from);
          openSendPC(from);
        } else if (data.kind === "answer" && data.sdp) {
          // A relay child answers us, not the original broadcaster, so route
          // it to the RelayLink before falling through to our own senders.
          const relayLink = relays.current.findByChild(from);
          if (relayLink) {
            relayLink.acceptAnswer(from, data.sdp);
            return;
          }
          const pc = sendPCs.current.get(from);
          pc?.setRemoteDescription(data.sdp)
            .then(async () => {
              const queued = pendingSendCandidates.current.get(from);
              if (queued) {
                pendingSendCandidates.current.delete(from);
                for (const candidate of queued) {
                  await pc.addIceCandidate(candidate).catch(() => {});
                }
              }
            })
            .catch(() => {});
        } else if (data.kind === "ice" && data.candidate) {
          const relayLink = relays.current.findByChild(from);
          if (relayLink) {
            relayLink.acceptCandidate(from, data.candidate);
            return;
          }
          const pc = sendPCs.current.get(from);
          if (pc && pc.remoteDescription) {
            pc.addIceCandidate(data.candidate).catch(() => {});
          } else {
            const queue = pendingSendCandidates.current.get(from) ?? [];
            queue.push(data.candidate);
            pendingSendCandidates.current.set(from, queue);
          }
        }
      }
    });

    const unsubscribeState = signalingClient.subscribe(() => {
      // Staggered (see STAGGER_MS's doc comment). This fires on *every*
      // signaling state change (chat, typing, presence, mic toggles), but
      // only a change to the peer list can change the answer — and setState
      // leaves `peers` at the same identity unless it actually replaced it,
      // so comparing the reference skips the ~95% of messages that have
      // nothing to do with peers. That matters more than it looks: this hook
      // is instantiated once per broadcast channel (screen, camera, mic and
      // three file slots), so the scan used to run six times per message.
      //
      // A peer property changing (someone toggling their mic) does replace
      // the array and still gets through, which is correct and cheap —
      // openSendPCsStaggered's own pendingStaggeredPeers dedup absorbs the
      // repeat for peers already waiting on a first attempt.
      if (!activeRef.current) return;
      const peers = signalingClient.state.peers;
      if (peers === lastScannedPeers.current) return;
      lastScannedPeers.current = peers;
      const readyPeerIds: string[] = [];
      for (const peer of peers) {
        if (viewerPausedPeers.current.has(peer.id)) continue;
        if (relayedAway.current.has(peer.id)) continue;
        readyPeerIds.push(peer.id);
      }
      openSendPCsStaggered(readyPeerIds);
    });

    // Actually tears a peer down — the five cleanups onRoomJoined below used
    // to run immediately off a single snapshot. Pulled out so both the
    // grace-period timeout and (if the peer never even reappears) the
    // eventual real prune share one implementation.
    function pruneMissingPeer(peerId: string) {
      if (sendPCs.current.has(peerId)) closeSendPC(peerId);
      if (recvPCs.current.has(peerId)) closeRecvPCFully(peerId);
      if (stoppedPeersRef.current.has(peerId)) clearStopped(peerId);
      if (resumingPeersRef.current.has(peerId)) clearResuming(peerId);
      viewerPausedPeers.current.delete(peerId);
      sendRetryAttempts.current.delete(peerId);
      peerCapacities.current.delete(peerId);
      relayedAway.current.delete(peerId);
      activeRelays.current.delete(peerId);
      // Someone who has left the room and comes back is a fresh viewer, not
      // one still carrying the verdict of a handover that failed minutes ago.
      relayOptOut.current.delete(peerId);
    }

    const unsubscribeRoomJoined = signalingClient.onRoomJoined(() => {
      // Our own signaling socket reconnecting replaces the whole peer list
      // at once instead of emitting individual peer-left events — so if
      // someone actually left the room while we were briefly disconnected,
      // nothing else would ever tell us. Without this, their connection and
      // video/audio tile would linger as a permanent ghost. Stable
      // client ids (see signalingClient) mean everyone who's still around
      // keeps the same id, so this only prunes genuinely departed peers —
      // eventually: see PEER_PRUNE_GRACE_MS for why this doesn't prune the
      // instant a peer is missing from one snapshot. A peer reappearing
      // cancels its pending prune below; one that's still missing once the
      // grace period elapses gets pruned for real, re-checked against
      // whatever the room looks like *then*, not this stale snapshot.
      const currentIds = new Set(signalingClient.state.peers.map((p) => p.id));
      const tracked = new Set([
        ...sendPCs.current.keys(),
        ...recvPCs.current.keys(),
        ...stoppedPeersRef.current,
        ...resumingPeersRef.current,
        ...viewerPausedPeers.current,
      ]);
      for (const peerId of tracked) {
        if (currentIds.has(peerId)) {
          const timer = pendingPruneTimers.current.get(peerId);
          if (timer) {
            clearTimeout(timer);
            pendingPruneTimers.current.delete(peerId);
          }
          continue;
        }
        if (pendingPruneTimers.current.has(peerId)) continue;
        const timer = setTimeout(() => {
          pendingPruneTimers.current.delete(peerId);
          const stillMissing = !signalingClient.state.peers.some((p) => p.id === peerId);
          if (stillMissing) pruneMissingPeer(peerId);
        }, PEER_PRUNE_GRACE_MS);
        pendingPruneTimers.current.set(peerId, timer);
      }

      // The server has a fresh entry with sharing/mic reset to false —
      // re-announce our actual state so other peers' indicators don't go
      // stale.
      if (!activeRef.current) return;
      if (channel === "mic") signalingClient.setMic(true);
      else signalingClient.setSharing({ [channel]: true });
    });

    // Captured now (not read as pendingPruneTimers.current inside the
    // cleanup below) so the cleanup always clears the exact Map this effect
    // instance scheduled into, regardless of ref-timing nuances.
    const pendingPruneTimersAtSetup = pendingPruneTimers.current;
    return () => {
      unsubscribeSignal();
      unsubscribeState();
      unsubscribeRoomJoined();
      for (const timer of pendingPruneTimersAtSetup.values()) clearTimeout(timer);
      pendingPruneTimersAtSetup.clear();
    };
  }, [
    channel,
    openRecvPC,
    openSendPC,
    openSendPCsStaggered,
    closeSendPC,
    closeRecvPC,
    stopWatchingPeer,
    closeRecvPCFully,
    clearStopped,
    clearResuming,
    markResuming,
    optOutOfRelaying,
    tierForPeer,
  ]);

  // Existing connections were built under whatever ICE policy was in effect
  // at the time — RTCPeerConnection.iceTransportPolicy can't be changed in
  // place, only chosen at construction — so toggling "Impedir conexões
  // diretas" mid-call must rebuild every live connection for it to actually
  // take effect on them, not just on the next one opened. sendPCs rebuild
  // themselves directly; recvPCs ask the other side to send us a fresh offer
  // (see requestReconnect) since we don't initiate those ourselves. Skipped
  // on mount (nothing to rebuild yet) via the ref-vs-prop comparison.
  useEffect(() => {
    const changed = forceRelayIceRef.current !== forceRelayIce;
    forceRelayIceRef.current = forceRelayIce;
    if (!changed) return;
    for (const peerId of [...sendPCs.current.keys()]) {
      closeSendPC(peerId);
      if (activeRef.current) openSendPC(peerId);
    }
    for (const peerId of [...recvPCs.current.keys()]) {
      closeRecvPC(peerId);
      requestReconnect(peerId);
    }
  }, [forceRelayIce, closeSendPC, openSendPC, closeRecvPC, requestReconnect]);

  useEffect(() => {
    const pcs = recvPCs.current;
    const pausedPeers = viewerPausedPeers.current;
    const recoveryTimers = recvRecoveryTimers.current;
    const watchdogs = resumeWatchdogs.current;
    const relayLinks = relays.current;
    return () => {
      stop();
      // The recvPCs below are closed directly, bypassing closeRecvPC — which
      // is the only place a relay we were running for someone got released.
      // So leaving the room left every RelayLink standing: its children's
      // sendPCs open and re-encoding, their controllers still registered with
      // the stats pump, and its 1 s stall timer ticking, all for a room we
      // were no longer in.
      relayLinks.clear();
      // Closing the pcs directly rather than through closeRecvPC means these
      // are not cleared along the way. They are harmless if they do fire (each
      // checks that its pc is still the current one, which it will not be), but
      // there is no reason to leave a room-change trailing timers that go on to
      // ask a room we have left for a reconnect.
      for (const timer of recoveryTimers.values()) clearTimeout(timer);
      recoveryTimers.clear();
      // Same reasoning, and these are not harmless if left: the resumingPeers
      // set is emptied below, so every one of them would fire against a room
      // that no longer exists and send a "resume" into it.
      for (const timer of watchdogs.values()) clearTimeout(timer);
      watchdogs.clear();
      for (const pc of pcs.values()) {
        pc.close();
        if (channel !== "mic") connectionRegistry.unregister(pc);
      }
      pcs.clear();
      setRemoteStreams({});
      setStoppedPeers(new Set());
      setResumingPeers(new Set());
      pausedPeers.clear();
    };
  }, [room, stop, channel]);

  return {
    active,
    start,
    stop,
    swapCapture,
    localStream,
    remoteStreams,
    error,
    source,
    stoppedPeers,
    resumingPeers,
    recvConnectionStates,
    stopWatchingPeer,
    resumeWatchingPeer,
    // Getters, not values: both maps are written on the signalling hot path,
    // and surfacing them as state would re-render every tile in the room each
    // time a single viewer resized its window.
    getRequestedTiers,
    getServedTiers,
    getPeerCapacities,
    applyRelayPlan,
    applyDirectCaps,
  };
}

// A start failure this code already worked out the reason for. Anything else
// falls back to the channel's generic message — see start()'s catch.
class ShareStartError extends Error {}

// The picked screen or window could not be captured at all — Chromium's
// "Could not start video source". Told apart from the audio failing, which
// arrives under the same NotReadableError and is worth a video-only retry;
// this is not.
function isVideoSourceFailure(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    err.name === "NotReadableError" &&
    /video source/i.test(err.message)
  );
}

// What that failure almost always is, in practice, and what to do about it.
// Reported as "only GoLive's own window can be shared; every other one fails"
// — which is the Windows privacy switch for screen capture (Settings →
// Privacy & security → Screenshots and screen recording), switched off for
// desktop apps: it blocks Windows Graphics Capture, the API Chromium shares
// windows with, for other programs' windows. The other known cause is the
// window belonging to a program running as administrator. The miniatures in
// the picker still work either way, because they are taken another way,
// which is what makes this look like our bug rather than the OS's.
function windowCaptureBlocked(): ShareStartError {
  return new ShareStartError(translate("useRoomMedia.windowCaptureBlocked"));
}

// "The user dismissed the picker" and "this call no longer has a user gesture
// behind it" arrive as the same DOMException name, which is why the caller
// has to bring its own evidence (see activationLost in the display capture).
function isCancelLikeError(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")
  );
}

// The shapes a refusal for a missing/expired user gesture arrives in.
// NotAllowedError is what Chromium actually raises (and is indistinguishable
// by name from a dismissed picker, hence the activation check alongside it);
// InvalidStateError is what the spec calls for, so it is matched too rather
// than being left to surface as a wrong generic message on some future build.
function isActivationRefusal(err: unknown): boolean {
  return (
    isCancelLikeError(err) || (err instanceof DOMException && err.name === "InvalidStateError")
  );
}

// Whether this call still counts as "in response to a click". Absent in
// browsers without the User Activation API — reported as still-active there,
// so a missing API never invents a failure that isn't there.
function hasUserActivation(): boolean {
  const activation = typeof navigator !== "undefined" ? navigator.userActivation : undefined;
  return activation ? activation.isActive : true;
}

function hasDisplayCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}
function hasCameraCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

// Which physical camera to open. `exact` rather than `ideal` on purpose: an
// ignored deviceId would leave someone broadcasting a camera other than the
// one their picker shows as selected, and on a phone it would also defeat
// picking the rear lens.
//
// With nothing picked by hand, the *facing* preference decides (see
// mediaPreferences' CameraFacing) — which is what the phone's flip button
// sets. `ideal` there, not `exact`: a laptop with one webcam has no
// environment-facing camera at all, and an exact constraint would fail the
// capture outright rather than opening the only camera there is.
function cameraSourceConstraints(
  deviceId: string | null,
  facing: CameraFacing
): MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } };
}

// A picked camera can simply be gone by the time it is opened — unplugged,
// or a deviceId stored in a previous session on a machine that no longer
// has it. Browsers report that as OverconstrainedError/NotFoundError, which
// start()'s catch would turn into "verifique as permissões do navegador" —
// a message about something that was never the problem. Retrying on the
// default camera keeps the transmission working; the choice itself is kept,
// so the next start tries it again once the device is back.
function isMissingDeviceError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

async function captureCamera(
  video: MediaTrackConstraints,
  deviceId: string | null,
  facing: CameraFacing
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...video, ...cameraSourceConstraints(deviceId, facing) },
    });
  } catch (err) {
    if (!deviceId || !isMissingDeviceError(err)) throw err;
    // The picked lens is gone. Falling back to the facing preference rather
    // than to nothing keeps a phone that was on its rear camera on the rear
    // camera, instead of quietly turning itself around.
    return navigator.mediaDevices.getUserMedia({
      video: { ...video, ...cameraSourceConstraints(null, facing) },
    });
  }
}

// Most mobile browsers (all of iOS Safari, most of Android Chrome) don't
// support getDisplayMedia at all, so screen capture from a website simply
// isn't possible there. Falling back to the device camera lets mobile users
// still broadcast something instead of just hitting an unsupported error.
//
// The Android *app* is the one exception: isAndroidScreenCaptureAvailable()
// is true there, and lib/androidScreenCapture.ts captures the screen through
// a native MediaProjection plugin instead of the (nonexistent) browser API —
// see that file's own comment for why the plugin bridge, not getDisplayMedia,
// is what "display" means on this one platform.
type ScreenShareMode = "display" | "camera" | "unsupported";

function getScreenShareMode(): ScreenShareMode {
  if (hasDisplayCapture() || isAndroidScreenCaptureAvailable()) return "display";
  if (hasCameraCapture()) return "camera";
  return "unsupported";
}
function getScreenShareModeServer(): ScreenShareMode {
  return "display";
}
function noopSubscribe() {
  return () => {};
}

export function useScreenShareMode() {
  return useSyncExternalStore(noopSubscribe, getScreenShareMode, getScreenShareModeServer);
}

export function useRoomMedia(room: string) {
  const t = useT();
  // Per-session connection-quality reports (see connectionTelemetry.ts).
  // Process-wide and idempotent, so mounting a second room is harmless.
  useEffect(() => {
    startConnectionTelemetry();
    // Cloudflare's TURN servers (see lib/iceServers.ts). Same shape: once per
    // tab, and a room is the first place a peer connection can be opened.
    ensureIceServers();
  }, []);
  // "Impedir conexões diretas": forces every peer connection this client
  // creates — sending or receiving, any channel — through the TURN relay
  // instead of negotiating a direct P2P path. Declared first because
  // useBroadcastChannel (screen/camera/mic below) needs it at construction
  // time. Deliberately unrelated to cascading (see topologyPlanner.ts): that
  // is about avoiding a stranger's browser as a middleman for someone
  // else's stream, this is about hiding your own IP from whoever you
  // connect to, middleman or not. Seeded from localStorage like the other
  // device-local preferences below.
  //
  // Pro Max only (feature "force_relay"). The stored switch is kept as it is,
  // but only counts while the account has the feature — so somebody whose plan
  // lapsed with it on stops relaying, and gets it back if they resubscribe.
  // While the account is still resolving, the stored switch is trusted: the
  // alternative is a paying subscriber opening their first connections
  // directly, leaking the IP this exists to hide, and a wrong "yes" only costs
  // one reconnect when the answer arrives (see the forceRelayIce effect).
  const { account, loading: resolvingAccount } = useAuth();
  const forceRelayAllowed = resolvingAccount || hasFeature("force_relay", account?.features ?? []);
  const [storedForceRelayIce, setForceRelayIceState] = useState(getStoredForceRelayIce);
  const forceRelayIce = storedForceRelayIce && forceRelayAllowed;
  useEffect(() => {
    setForceRelayAllowed(forceRelayAllowed);
  }, [forceRelayAllowed]);
  // Pro Ultra: connections relayed through TURN are not capped (see
  // lib/turnRoute.ts). Unlike force_relay, a resolving account is not trusted
  // here — the cap is the safe default.
  const relayCapExempt = hasFeature("uncapped_relay", account?.features ?? []);
  useEffect(() => {
    setRelayCapExempt(relayCapExempt);
  }, [relayCapExempt]);
  const toggleForceRelayIce = useCallback(() => {
    setForceRelayIceState((prev: boolean) => {
      const next = !prev;
      setStoredForceRelayIce(next);
      trackEvent(next ? "force_relay_ice_on" : "force_relay_ice_off");
      return next;
    });
  }, []);

  // "Entrar em transmissões automaticamente" — see mediaPreferences.ts and
  // useBroadcastChannel's autoJoin gate. Screen/camera only; mic always
  // auto-connects regardless of this.
  const [autoJoin, setAutoJoinState] = useState(getStoredAutoJoin);
  const toggleAutoJoin = useCallback(() => {
    setAutoJoinState((prev: boolean) => {
      const next = !prev;
      setStoredAutoJoin(next);
      trackEvent(next ? "auto_join_on" : "auto_join_off");
      return next;
    });
  }, []);

  // Each of the three dials is independent so the person can e.g. keep
  // 720p but drop bitrate, or keep quality but drop fps. Refs mirror the
  // state (same pattern as noiseSuppressionOnRef below) because capture()
  // only runs once per share start and would otherwise close over a stale
  // value from whatever render happened to create it.
  // Seeded from the last session (see lib/mediaPreferences). Lazy
  // initialisers rather than an effect: an effect would render the defaults
  // first and then correct them, which is a visible flicker in the picker and
  // — worse — a window in which a share started from the wrong preset.
  const [shareResolution, setShareResolutionState] = useState<ShareResolution>(() =>
    restoredSetting(getStoredShareResolution(), SHARE_RESOLUTION_OPTIONS, "1080p")
  );
  const [shareFps, setShareFpsState] = useState<ShareFps>(() =>
    restoredSetting(getStoredShareFps(), SHARE_FPS_OPTIONS, 30)
  );
  const [shareBitrate, setShareBitrateState] = useState<ShareBitrate>(() =>
    restoredSetting(getStoredShareBitrate(), SHARE_BITRATE_OPTIONS, "high")
  );
  // On by default. It no longer means "step quality down as the headcount
  // rises" — that guessed cost from a number of people while knowing nothing
  // about how large anyone renders the video. It now means "let each viewer
  // be served at the tier their own tile actually needs". Turning it off
  // forces the picked tier on everyone, which is what someone streaming to a
  // handful of fullscreen viewers may genuinely want.
  const [smartQualityEnabled, setSmartQualityEnabledState] = useState(getStoredSmartQuality);
  // What is being shared. This drives contentHint, degradationPreference and
  // codec ordering all at once, and getting it wrong is the difference
  // between crisp text and a 60fps game that stutters into a slideshow.
  //
  // "balanced" is the default: most shares are neither pure text nor pure
  // motion, and "text"'s maintain-resolution plus VP9-first encode (see
  // peerQualityController and videoCodecPreferences) is a software-encode-heavy
  // combination that, picked by default for people who never open the picker,
  // was exactly what made a plain screen share compete hard with a running
  // game for CPU. "Balanced" lets the encoder trade off frame rate and detail
  // continuously instead of pinning one axis, and it's not clamped to 30fps
  // the way "text" is. Anyone who actually wants sharp, static text still has
  // "Texto/código" one click away in the same picker.
  const [shareProfile, setShareProfileState] = useState<DegradationMode>(() =>
    restoredSetting(getStoredShareProfile(), SHARE_PROFILE_OPTIONS, "balanced")
  );
  const shareResolutionRef = useRef(shareResolution);
  const shareFpsRef = useRef(shareFps);
  // Whether the *next* share should carry system audio. A ref and not state,
  // and deliberately not stored: unlike every other dial here this one is
  // answered fresh each time, always starting unticked (see
  // MobileQualitySheet). Sharing what the phone is playing is a decision
  // about this moment — a setting that remembered "yes" would eventually
  // broadcast something nobody meant to share.
  //
  // Only the Android app reads it; every other platform gets its system
  // audio from getDisplayMedia or from the desktop helper instead.
  const shareSystemAudioRef = useRef(false);
  // Set when that was asked for and could not be delivered — an old Android,
  // a refused microphone permission, a device with no capture path. The
  // share itself is fine and running, so this is a notice rather than an
  // error, and it is what stops a ticked box from silently doing nothing.
  // Null while there is nothing to say; otherwise why, so the notice can
  // point somebody whose permission is blocked at the settings screen.
  const [systemAudioUnavailable, setSystemAudioUnavailable] = useState<SystemAudioUnavailableReason | null>(null);
  const shareBitrateRef = useRef(shareBitrate);
  const smartQualityEnabledRef = useRef(smartQualityEnabled);
  const shareProfileRef = useRef(shareProfile);

  const setShareResolution = useCallback((value: ShareResolution) => {
    shareResolutionRef.current = value;
    setShareResolutionState(value);
    setStoredShareResolution(value);
    trackEvent(`screen_share_resolution_${value}`);
  }, []);
  const setShareFps = useCallback((value: ShareFps) => {
    shareFpsRef.current = value;
    setShareFpsState(value);
    setStoredShareFps(value);
    trackEvent(`screen_share_fps_${value}`);
  }, []);
  const setShareSystemAudio = useCallback((value: boolean) => {
    shareSystemAudioRef.current = value;
    trackEvent(value ? "screen_share_system_audio_on" : "screen_share_system_audio_off");
  }, []);
  const setShareBitrate = useCallback((value: ShareBitrate) => {
    shareBitrateRef.current = value;
    setShareBitrateState(value);
    setStoredShareBitrate(value);
    trackEvent(`screen_share_bitrate_${value}`);
  }, []);
  const setSmartQualityEnabled = useCallback((value: boolean) => {
    smartQualityEnabledRef.current = value;
    setSmartQualityEnabledState(value);
    setStoredSmartQuality(value);
    trackEvent(value ? "smart_quality_on" : "smart_quality_off");
  }, []);
  const setShareProfile = useCallback((value: DegradationMode) => {
    shareProfileRef.current = value;
    setShareProfileState(value);
    setStoredShareProfile(value);
    // Above 30fps only makes sense once the encoder is allowed to give frame
    // rate some weight, which "text" alone does not — picking it while asking
    // for 60fps is exactly the combination that produces a stuttering share,
    // so nudge fps down with it. Deliberately not applied to "balanced":
    // holding a high frame rate is half of what that profile is for.
    if (value === "text" && shareFpsRef.current > 30) {
      shareFpsRef.current = 30;
      setShareFpsState(30);
      // Persisted as well: this path sets the state directly instead of going
      // through setShareFps, and without this the next visit would restore
      // the 60 that was just overruled while the picker showed 30.
      setStoredShareFps(30);
    }
    trackEvent(`screen_share_profile_${value}`);
  }, []);

  // Other peers in the room. Still surfaced (the UI shows it, and the
  // topology hook needs it) but deliberately no longer an input to quality:
  // headcount is a bad proxy for cost, and using it is what previously
  // forced a 1080p share down to the bottom of the ladder at 14 peers
  // regardless of whether anyone's link or CPU was actually under strain.
  const peerCount = useSyncExternalStore(signalingClient.subscribe, getPeerCount, getPeerCountServer);
  const peerCountRef = useRef(peerCount);
  useEffect(() => {
    peerCountRef.current = peerCount;
  }, [peerCount]);

  // The capture constraints plus the ceiling nobody is served above. Note
  // what is NOT here any more: peerCount. This object changing is what makes
  // useBroadcastChannel re-cap every sender, so keeping headcount out of it
  // means a person joining or leaving no longer perturbs anyone's quality at
  // all — the per-viewer requests handle that, and they only move the one
  // viewer whose tile actually changed.
  const screenQualityPreset = useMemo<QualityPreset>(() => {
    const dims = RESOLUTION_DIMENSIONS[shareResolution];
    return {
      width: dims.width,
      height: dims.height,
      frameRate: shareFps,
      maxBitrateKbps: BITRATE_CEILING_KBPS[shareBitrate],
      ceilingTier: ceilingTierFor(shareResolution, shareFps),
      degradation: shareProfile,
      honorViewerRequests: smartQualityEnabled,
    };
  }, [shareResolution, shareFps, shareBitrate, smartQualityEnabled, shareProfile]);

  // The camera runs the screen's resolution/fps/bitrate dials — those are what
  // the picker offers — but never its content profile. A camera is motion, and
  // saying otherwise is not a small mismatch: "text" hands the sender
  // degradationPreference "maintain-resolution" and puts VP9 ahead of H264 (see
  // peerQualityController and videoCodecPreferences), i.e. protect sharpness,
  // drop frames, and do it in software. The capture's own contentHint has
  // always been "motion" here, so the encoder was being told two opposite
  // things at once, and the one that won turned a webcam into a slideshow the
  // moment anything got tight.
  const cameraQualityPreset = useMemo<QualityPreset>(
    () => ({ ...screenQualityPreset, degradation: "motion" }),
    [screenQualityPreset]
  );

  // The camera the two camera-capturing paths below open: the camera
  // channel, and the screen channel's mobile fallback (a phone has no
  // getDisplayMedia, so "compartilhar tela" captures the camera there).
  // Same "ref mirrors state, for the capture closure" pattern as the mic's
  // device below — useBroadcastChannel calls capture once per start, so a
  // captured `const` would go stale the moment someone switches camera.
  const cameraDeviceIdRef = useRef<string | null>(getStoredCameraDeviceId());
  const [cameraDeviceId, setCameraDeviceIdState] = useState<string | null>(() =>
    getStoredCameraDeviceId()
  );
  // Which way the camera points when no specific lens is picked — the phone's
  // flip button (see setCameraFacing below). Same ref-mirrors-state pattern
  // and for the same reason: the capture closure runs once per start and
  // would otherwise hold whichever value was current when it was created.
  const cameraFacingRef = useRef<CameraFacing>(getStoredCameraFacing());
  const [cameraFacing, setCameraFacingState] = useState<CameraFacing>(() =>
    getStoredCameraFacing()
  );

  // The GPU capture experiment (see lib/nativeVideoCapture.ts): the desktop
  // app's helper takes over from Chromium's capture once the picker has been
  // answered. Only where the helper shipped, so nobody else is counted in the
  // experiment; the probe runs early so the share does not wait on it.
  //
  // Three sides besides control (see NATIVE_VIDEO_VARIANTS): always on, and a
  // switch in the quality panel that starts off or on. A variant with any
  // other name counts as "always on".
  const nativeVideoBridge = useMemo(() => hasNativeVideoBridge(), []);
  const nativeVideoFeature = useFeature(NATIVE_VIDEO_FEATURE, { track: nativeVideoBridge });
  const nativeVideoVariant = nativeVideoBridge ? nativeVideoFeature.variant : null;
  const nativeVideoHasOption =
    nativeVideoVariant === NATIVE_VIDEO_VARIANTS.optIn || nativeVideoVariant === NATIVE_VIDEO_VARIANTS.optOut;
  const [storedNativeVideo, setStoredNativeVideoState] = useState(getStoredNativeVideo);
  /** The switch's state, or null where this person is not offered one. */
  const nativeVideoOption = nativeVideoHasOption
    ? storedNativeVideo ?? nativeVideoVariant === NATIVE_VIDEO_VARIANTS.optOut
    : null;
  const nativeVideoWanted =
    nativeVideoVariant !== null && (nativeVideoHasOption ? nativeVideoOption === true : true);
  const setNativeVideoOption = useCallback((value: boolean) => {
    setStoredNativeVideoState(value);
    setStoredNativeVideo(value);
    trackFeatureEvent(value ? SCREEN_SHARE_STATS.nativeOptIn : SCREEN_SHARE_STATS.nativeOptOut);
  }, []);
  // How a whole screen is captured, chosen in the same card. Offered to
  // everyone on a side of the experiment, the switch or not; null elsewhere.
  const [storedNativeVideoMethod, setStoredNativeVideoMethodState] = useState(getStoredNativeVideoMethod);
  const nativeVideoMethod: NativeVideoMethod | null = nativeVideoVariant !== null ? storedNativeVideoMethod : null;
  const nativeVideoMethodRef = useRef(storedNativeVideoMethod);
  const setNativeVideoMethod = useCallback((value: NativeVideoMethod) => {
    nativeVideoMethodRef.current = value;
    setStoredNativeVideoMethodState(value);
    setStoredNativeVideoMethod(value);
    trackFeatureEvent(value === "wgc" ? SCREEN_SHARE_STATS.nativeMethodWgc : SCREEN_SHARE_STATS.nativeMethodDuplication);
  }, []);
  // Keeping chosen applications out of the picture of a share — the picker's
  // "não mostrar estas janelas" panel. Its own rollout, tracked where the
  // control can actually appear: the panel is drawn by the desktop app's
  // picker, and only when the helper is going to capture the share, so
  // counting anybody else as exposed to it would be counting people who were
  // never shown anything.
  const hiddenWindowsFeature = useFeature(HIDDEN_WINDOWS_FEATURE, {
    track: nativeVideoBridge && nativeVideoWanted,
  });
  const hiddenWindowsOn = nativeVideoBridge && nativeVideoWanted && hiddenWindowsFeature.enabled;

  // "A transmissão por GPU ficou melhor?", asked once after a long one (see
  // lib/gpuShareSurvey.ts). Tracked where it can actually be shown — only
  // somebody capturing on the GPU is ever asked — so the exposure count is
  // the people who could see it rather than everybody in a room.
  const gpuSurveyFeature = useFeature(GPU_SURVEY_FEATURE, {
    track: nativeVideoBridge && nativeVideoWanted,
  });
  const gpuSurveyOn = nativeVideoBridge && gpuSurveyFeature.enabled;

  const nativeVideoWantedRef = useRef(false);
  useEffect(() => {
    nativeVideoWantedRef.current = nativeVideoWanted;
    if (nativeVideoWanted) void probeNativeVideo();
  }, [nativeVideoWanted]);
  // The shell decides what the picker offers, and it has to know before the
  // picker opens — which is before any of this has been asked for.
  useEffect(() => {
    setNativeVideoIntent(hiddenWindowsOn);
  }, [hiddenWindowsOn]);

  // Swaps Chromium's video track for the helper's when the experiment is on
  // and the helper starts; the share is otherwise returned as it was, so
  // every failure here is a share that works the ordinary way.
  //
  // What the running share was started with, as far as settings that only a
  // restart applies are concerned — compared below to offer one.
  const [screenStartConfig, setScreenStartConfig] = useState<ScreenStartConfig | null>(null);
  const withNativeVideo = useCallback(async (stream: MediaStream): Promise<MediaStream> => {
    const config: ScreenStartConfig = {
      native: nativeVideoWantedRef.current,
      method: nativeVideoMethodRef.current,
      usedNative: false,
      resolution: shareResolutionRef.current,
      fps: shareFpsRef.current,
    };
    if (nativeVideoBridge) setScreenStartConfig(config);
    if (!nativeVideoWantedRef.current) return stream;
    const dims = RESOLUTION_DIMENSIONS[shareResolutionRef.current];
    const options: NativeVideoOptions = {
      maxWidth: dims.width,
      maxHeight: dims.height,
      // Held to what any tier sends, like every other capture (see
      // captureConstraints): the helper encodes every frame it captures.
      fps: Math.min(shareFpsRef.current, MAX_TIER_FPS),
      bitrateKbps: BITRATE_CEILING_KBPS[shareBitrateRef.current],
      captureMethod: nativeVideoMethodRef.current,
    };
    const { source: native, failure, hidden } = await startNativeVideo(options);
    if (!native) {
      // Null failure: not tried at all (turned off for this session after an
      // earlier failure), which is not a new fallback to count.
      if (failure !== null) {
        trackFeatureEvent(SCREEN_SHARE_STATS.nativeFallback);
        if (failure === "no-frames") trackFeatureEvent(SCREEN_SHARE_STATS.nativeNoFrames);
      }
      return stream;
    }
    for (const track of stream.getVideoTracks()) {
      stream.removeTrack(track);
      track.stop();
    }
    stream.addTrack(native.track);
    setScreenStartConfig({ ...config, usedNative: true });
    // Armed here rather than in the survey module's own timer: this is the
    // one place that knows the share is on the GPU *and* what it was set to,
    // which is the context the answers are read next to.
    noteGpuShareStarted(gpuSurveyOn, {
      encoder: native.encoder,
      method: nativeVideoMethodRef.current,
      resolution: `${dims.width}x${dims.height}`,
      fps: shareFpsRef.current,
    });
    // The picker collected these in the shell, which has no way to reach the
    // statistics; they come back with the start result instead. "Opened the
    // panel" and "went through with it" are counted apart on purpose — the
    // gap between them is the difference between a feature nobody wants and
    // one nobody can find.
    if (hidden?.panelOpened) trackFeatureEvent(HIDDEN_WINDOWS_EVENTS.open);
    if (hidden && hidden.count > 0) {
      trackFeatureEvent(HIDDEN_WINDOWS_EVENTS.share, { value: hidden.count });
    }
    trackFeatureEvent(SCREEN_SHARE_STATS.nativeStart);
    trackEvent("screen_share_native_video", { encoder: native.encoder.slice(0, 60) });
    return stream;
  }, [nativeVideoBridge, gpuSurveyOn]);

  const screen = useBroadcastChannel(
    "screen",
    room,
    async (source) => {
      // Capture at the full picked resolution regardless of room size. The
      // per-viewer tiers downscale each *sender* independently (see
      // peerQualityController), so capturing small would only put a hard
      // ceiling on the one or two people actually watching fullscreen while
      // saving nothing for the many watching in a grid.
      const videoConstraints = captureConstraints(shareResolutionRef.current, shareFpsRef.current, false);
      const displayConstraints = captureConstraints(shareResolutionRef.current, shareFpsRef.current, true);
      if (source === "camera") {
        return captureCamera(videoConstraints, cameraDeviceIdRef.current, cameraFacingRef.current);
      }
      // The Android app: a real screen capture, just not through
      // getDisplayMedia (which does not exist there — see
      // lib/androidScreenCapture.ts). No system-audio exclusion, no retry
      // path below — the native capture is video-only from the start, the
      // same degraded shape a browser without loopback audio already hands
      // back here.
      if (isAndroidScreenCaptureAvailable()) {
        // Cleared per attempt rather than on stop: the notice belongs to one
        // share, and leaving the previous one's up while a new share starts
        // would be saying something untrue about the share in front of you.
        setSystemAudioUnavailable(null);
        const dims = RESOLUTION_DIMENSIONS[shareResolutionRef.current];
        return captureAndroidScreen({
          width: dims.width,
          height: dims.height,
          fps: shareFpsRef.current,
          systemAudio: shareSystemAudioRef.current,
          onSystemAudioUnavailable: setSystemAudioUnavailable,
        });
      }
      // No fallback to the camera here — on browsers without getDisplayMedia
      // (most mobile ones) this throws synchronously, which start() below
      // turns into a visible error instead of silently switching sources.
      // Explicit false on the mic-oriented processing constraints: left
      // unset, Chrome runs tab/system audio through the same APM pipeline
      // as a microphone (echo cancellation, noise suppression, AGC), which
      // mangles music/game audio into something that sounds noise-gated.
      // Screen/tab audio isn't a voice call, so it should pass through
      // unprocessed — stereo, uncompressed dynamic range.
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      // In the desktop app on Windows 11, the system audio comes from
      // somewhere else entirely: a native helper capturing the mix with
      // GoLive's own process tree excluded, so the share does not carry the
      // room's voices — or the audio of a share being watched — back to the
      // room. See lib/desktopSystemAudio.ts.
      //
      // Started before getDisplayMedia and not after, because a capture
      // already running is how the shell knows to withhold its own loopback
      // track from this request. Null everywhere else (every browser, macOS,
      // Linux, Windows 10), and the line below then asks for system audio
      // the way it always did.
      const excluded = await startExcludedSystemAudio();
      // Everything above ran between the click and this call, and
      // getDisplayMedia needs that click's transient activation to still be
      // valid. When it isn't, Chromium rejects with NotAllowedError — the
      // same name it uses for "the user dismissed the picker", which start()
      // below deliberately swallows. Checking here is what tells the two
      // apart, so a share that failed for this reason says so instead of
      // looking like nothing happened at all.
      const activationLost = !hasUserActivation();
      const capture = navigator.mediaDevices
        .getDisplayMedia({
          video: displayConstraints,
          audio: excluded ? false : audioConstraints,
        })
        .catch((err) => {
          // Requesting system audio can fail for reasons that have nothing
          // to do with the user's choice in the picker: no default loopback
          // device, a driver/backend conflict, an OS that doesn't expose
          // one at all. Chrome/Edge surface that as NotReadableError for
          // the whole call — video capture would have worked fine on its
          // own, but getDisplayMedia doesn't offer a partial result, so
          // without this retry the entire share fails with a message that
          // tells the user to "check browser permissions" when permissions
          // were never the problem. Retrying video-only turns that into a
          // share that still works, just without system audio — same
          // outcome as Firefox, which silently drops the audio track
          // instead of erroring (bugzilla.mozilla.org/show_bug.cgi?id=1541425).
          // NotAllowedError/AbortError (the user cancelling the picker
          // outright) are deliberately not retried here — start()'s catch
          // treats those as a silent cancel, and retrying would just pop
          // the picker again right after they dismissed it.
          //
          // Only when it is the *audio* that failed, though. The same error
          // name also covers the video not starting ("Could not start video
          // source"), and there a video-only retry is the identical request
          // failing the identical way — after putting the picker on screen a
          // second time, since every getDisplayMedia is a new pick.
          if (isVideoSourceFailure(err)) throw windowCaptureBlocked();
          if (err instanceof DOMException && err.name === "NotReadableError") {
            return (async () => {
              // In the desktop app the retry would otherwise open the picker
              // again, for a choice the person made a second ago. The shell
              // saved that choice on the way out (see its display-media
              // handler), so this reuses it without asking.
              await getDesktopBridge()?.useSavedShareSource?.();
              try {
                return await navigator.mediaDevices.getDisplayMedia({
                  video: displayConstraints,
                  audio: false,
                });
              } catch (retryErr) {
                if (isVideoSourceFailure(retryErr)) throw windowCaptureBlocked();
                throw retryErr;
              }
            })();
          }
          if (activationLost && isActivationRefusal(err)) {
            throw new ShareStartError(
              t("useRoomMedia.preparingTheSystemAudioTookToo")
            );
          }
          throw err;
        });

      if (!excluded) return withNativeVideo(await capture);

      // The picker is still open at this point, and it is the one place the
      // share can still be called off. A cancelled picker rejects here, and
      // the helper started above would otherwise keep an OS audio capture
      // running with nothing at the other end of it.
      let stream: MediaStream;
      try {
        stream = await capture;
      } catch (err) {
        excluded.stop();
        throw err;
      }
      // From here on the track is an ordinary member of the stream: the
      // share's teardown stops every track it finds without caring where
      // they came from, and this one's stop() takes the helper with it (see
      // desktopSystemAudio.ts).
      stream.addTrack(excluded.track);
      return withNativeVideo(stream);
    },
    () => hasDisplayCapture() || isAndroidScreenCaptureAvailable() || hasCameraCapture(),
    t("useRoomMedia.yourBrowserSupportsNeitherScreenSharing"),
    t("useRoomMedia.couldNotStartSharingCheckThe"),
    forceRelayIce,
    autoJoin,
    screenQualityPreset
  );

  // Settings changed since the screen share started that only take effect on
  // a new one: the GPU capture switch and its method, and — for a share the
  // helper is capturing, which reads them once at start — resolution and fps.
  const screenRestartNeeded =
    screen.active &&
    screen.source !== "camera" &&
    screenStartConfig !== null &&
    (screenStartConfig.native !== nativeVideoWanted ||
      (screenStartConfig.native && screenStartConfig.method !== storedNativeVideoMethod) ||
      (screenStartConfig.usedNative &&
        (screenStartConfig.resolution !== shareResolution || screenStartConfig.fps !== shareFps)));

  // Stops the screen share and starts it again on the same surface, without
  // the picker (the shell remembers what was chosen). Has to run from a click:
  // getDisplayMedia still needs the gesture.
  const restartScreenShare = useCallback(async () => {
    if (!screen.active) return;
    const source = screen.source;
    screen.stop();
    // Counted as what it is (manualRestart), not as a share restarted out of
    // dissatisfaction (screen_share_restart).
    lastScreenShareEndedAt = 0;
    await getDesktopBridge()?.useSavedShareSource?.();
    trackFeatureEvent(SCREEN_SHARE_STATS.manualRestart);
    screen.start(source);
  }, [screen]);

  // Front and rear at once in the Android app (see lib/androidDualCamera.ts):
  // while set, *both* camera channels are fed by the native plugin, because
  // the WebView cannot hold one lens while the plugin opens the other. Null
  // the rest of the time — one camera is always the WebView's.
  const nativeDualRef = useRef<AndroidDualCamera | null>(null);

  const camera = useBroadcastChannel(
    "camera",
    room,
    async () => {
      const native = nativeDualRef.current;
      if (native) {
        const main = cameraFacingRef.current === "environment" ? native.back : native.front;
        return new MediaStream(main.getVideoTracks());
      }
      // Capture at the full picked resolution regardless of room size. The
      // per-viewer tiers downscale each *sender* independently (see
      // peerQualityController), so capturing small would only put a hard
      // ceiling on the one or two people actually watching fullscreen while
      // saving nothing for the many watching in a grid.
      return captureCamera(
        captureConstraints(shareResolutionRef.current, shareFpsRef.current, false),
        cameraDeviceIdRef.current,
        cameraFacingRef.current
      );
    },
    () => hasCameraCapture(),
    t("useRoomMedia.yourBrowserDoesNotSupportA"),
    t("useRoomMedia.couldNotStartTheCameraCheck"),
    forceRelayIce,
    autoJoin,
    cameraQualityPreset
  );

  // Front and rear at once: "camera2" opens the lens facing the other way from
  // the one "camera" is on. Whether a phone allows two cameras open at the
  // same time is up to the phone — many (every iPhone, plenty of Androids)
  // pause or end the first one the moment the second opens, without an error.
  // So after opening it we watch the first camera for a moment, and if it went
  // quiet we close the second and say so, instead of leaving a frozen tile.
  // False once this device has shown it cannot do it (see the capture below).
  const [dualCameraSupported, setDualCameraSupported] = useState(() => !isDualCameraUnsupported());
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraStartRef = useRef<() => void>(() => {});
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraStreamRef.current = camera.localStream;
    cameraStartRef.current = () => void camera.start();
    cameraRef.current = camera;
  });
  // Where the app can do it natively, and whether it can: null off the
  // Android app (the browser path applies), otherwise the plugin's answer. A
  // phone that says no never sees the button.
  const [nativeDualSupported, setNativeDualSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void androidDualCameraSupport().then((support) => {
      if (cancelled || !support) return;
      setNativeDualSupported(support.supported);
      // A "no" remembered from the browser path (NotReadableError) is about
      // the WebView, not the phone — the plugin's yes overrides it.
      if (support.supported) {
        clearDualCameraUnsupported();
        setDualCameraSupported(true);
      }
      if (!support.supported) {
        trackEvent("dual_camera_error", { reason: `native: ${support.reason ?? "unsupported"}` });
        markDualCameraUnsupported();
        setDualCameraSupported(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [nativeDualError, setNativeDualError] = useState<string | null>(null);
  // Runs whenever the second camera stops (its onStopped). With the plugin
  // feeding both, the plugin is closed and the main camera, if still on,
  // starts again on the WebView — a moment's blip for the room, the price of
  // the WebView not being able to share a lens with the plugin.
  const revertNativeDualRef = useRef<() => void>(() => {});
  useEffect(() => {
    revertNativeDualRef.current = () => {
      const native = nativeDualRef.current;
      if (!native) return;
      nativeDualRef.current = null;
      const main = cameraRef.current;
      const wasOn = main.active;
      if (wasOn) main.stop();
      native.stop();
      if (wasOn) void main.start();
    };
  });
  const camera2 = useBroadcastChannel(
    "camera2",
    room,
    async () => {
      const native = nativeDualRef.current;
      if (native) {
        const other = cameraFacingRef.current === "environment" ? native.front : native.back;
        return new MediaStream(other.getVideoTracks());
      }
      const mainTrack = cameraStreamRef.current?.getVideoTracks()[0];
      if (!mainTrack) throw new ShareStartError(t("useRoomMedia.dualCameraNeedsCamera"));
      const mainFacing = mainTrack.getSettings().facingMode ?? cameraFacingRef.current;
      const other: CameraFacing = mainFacing === "environment" ? "user" : "environment";
      const video = captureConstraints(shareResolutionRef.current, shareFpsRef.current, false);
      // What went wrong, as the browser said it, so the message tells a real
      // limit apart from something fixable — and so the numbers do too.
      // Every path into this is the device itself saying no (a permission
      // refusal or a cancelled prompt is rethrown before it), so it is not
      // offered on this device again.
      const fail = (reason: string): never => {
        trackEvent("dual_camera_error", { reason: reason.slice(0, 120) });
        markDualCameraUnsupported();
        setDualCameraSupported(false);
        throw new ShareStartError(`${t("useRoomMedia.dualCameraUnsupported")} (${reason})`);
      };
      const describe = (err: unknown) =>
        err instanceof DOMException || err instanceof Error
          ? `${err.name}${err.message ? `: ${err.message}` : ""}`
          : String(err);
      let stream: MediaStream | null = null;
      let firstError: unknown = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...video, facingMode: { exact: other } },
        });
      } catch (err) {
        firstError = err;
      }
      // A phone that does not say which way its lenses face refuses the
      // `exact` facing outright (OverconstrainedError). Any other lens, picked
      // by id, is the same thing asked differently.
      if (!stream) {
        const mainDeviceId = mainTrack.getSettings().deviceId;
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const others = devices.filter((d) => d.kind === "videoinput" && d.deviceId && d.deviceId !== mainDeviceId);
        for (const device of others) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { ...video, deviceId: { exact: device.deviceId } },
            });
            break;
          } catch (err) {
            firstError ??= err;
          }
        }
        if (!stream) {
          // Permission refused or prompt dismissed: the person's answer, not
          // the device's, so it is not remembered as "unsupported".
          if (firstError && isCancelLikeError(firstError)) throw firstError;
          fail(others.length === 0 && !firstError ? "no second camera found" : describe(firstError));
        }
      }
      const opened = stream as MediaStream;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (mainTrack.readyState === "ended" || mainTrack.muted) {
        const ended = mainTrack.readyState === "ended";
        opened.getTracks().forEach((track) => track.stop());
        // The phone took the first camera away to open this one: give it back.
        if (ended) cameraStartRef.current();
        fail(ended ? "the first camera was closed by the system" : "the first camera was paused by the system");
      }
      return opened;
    },
    () => hasCameraCapture(),
    t("useRoomMedia.yourBrowserDoesNotSupportA"),
    t("useRoomMedia.couldNotStartTheCameraCheck"),
    forceRelayIce,
    autoJoin,
    cameraQualityPreset,
    // Back to one camera: if both were on the plugin, the main one returns to
    // the WebView (see revertNativeDual).
    () => revertNativeDualRef.current()
  );
  const camera2Ref = useRef(camera2);
  useEffect(() => {
    camera2Ref.current = camera2;
  }, [camera2]);
  // The dual-camera button. In the Android app on a phone that can, both
  // lenses move to the plugin: the WebView's camera is released first (the
  // plugin cannot open a lens the WebView holds), then both channels start on
  // the plugin's streams. Everywhere else, the browser path above.
  const startDualCamera = useCallback(async () => {
    if (camera2.active || !camera.active) return;
    setNativeDualError(null);
    if (!nativeDualSupported) {
      await camera2.start();
      return;
    }
    const dims = RESOLUTION_DIMENSIONS[shareResolutionRef.current];
    camera.stop();
    let native: AndroidDualCamera;
    try {
      native = await startAndroidDualCamera({
        width: dims.width,
        height: dims.height,
        fps: shareFpsRef.current,
        // Android took the cameras away (app in the background, another app):
        // down to one camera, on the WebView.
        onStopped: (reason) => {
          trackEvent("dual_camera_error", { reason: `native stopped: ${reason}`.slice(0, 120) });
          camera2Ref.current.stop();
        },
      });
    } catch (err) {
      const reason = err instanceof AndroidDualCameraError ? `${err.code}: ${err.message}` : String(err);
      trackEvent("dual_camera_error", { reason: `native: ${reason}`.slice(0, 120) });
      if (err instanceof AndroidDualCameraError && err.code === "unsupported") {
        markDualCameraUnsupported();
        setDualCameraSupported(false);
      }
      setNativeDualError(`${t("useRoomMedia.dualCameraUnsupported")} (${reason})`);
      // The camera that was on before goes back on.
      await camera.start();
      return;
    }
    nativeDualRef.current = native;
    await camera.start();
    await camera2.start();
  }, [camera, camera2, nativeDualSupported, t]);

  // The second lens only makes sense next to the first.
  const cameraIsActive = camera.active;
  const camera2Stop = camera2.stop;
  useEffect(() => {
    if (!cameraIsActive) camera2Stop();
  }, [cameraIsActive, camera2Stop]);

  // A local video or audio file played into the room (see
  // lib/localMediaSource.ts). Its own channel, and that is the whole point:
  // the file used to ride the screen channel, which meant putting a film on
  // for the room and showing your screen were the same slot — starting one
  // ended the other. They are different things people want at the same time,
  // so they get different channels, the same way the camera does.
  //
  // Everything else about it is the ordinary broadcast path: its own peer
  // connections, its own per-viewer quality tiers, its own tiles. The server
  // needs to know nothing about it beyond the sharing flags — the signalling
  // relay forwards a channel's payloads opaquely (see the "signal" case in
  // server/signaling.ts).
  // One hook per slot, spelled out rather than looped: hooks cannot be called
  // in a loop of varying length, and a fixed three is also the honest ceiling
  // (each slot is another canvas capture and another encode on this machine).
  const file1 = useLocalFileChannel("file1", room, forceRelayIce, autoJoin, cameraQualityPreset, shareFpsRef);
  const file2 = useLocalFileChannel("file2", room, forceRelayIce, autoJoin, cameraQualityPreset, shareFpsRef);
  const file3 = useLocalFileChannel("file3", room, forceRelayIce, autoJoin, cameraQualityPreset, shareFpsRef);
  const fileChannels = useMemo(
    () => ({ file1, file2, file3 }) as Record<LocalMediaSlot, ReturnType<typeof useBroadcastChannel>>,
    [file1, file2, file3]
  );

  // "Várias telas" (see lib/multiScreen.ts): the second to tenth screen or
  // window. Spelled out for the same reason as the file slots above. Every
  // client has all nine, sharing or not, because watching them needs the
  // channel as much as sending them does; an idle one costs a signal listener
  // that returns on the channel name.
  const xs = [
    useExtraScreenChannel("screen2", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen3", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen4", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen5", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen6", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen7", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen8", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen9", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
    useExtraScreenChannel("screen10", room, forceRelayIce, autoJoin, screenQualityPreset, shareResolutionRef, shareFpsRef),
  ] as const;
  const extraScreens = useMemo(
    () =>
      Object.fromEntries(EXTRA_SCREEN_SLOTS.map((slot, i) => [slot, xs[i]])) as Record<
        ExtraScreenSlot,
        ReturnType<typeof useBroadcastChannel>
      >,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xs[0], xs[1], xs[2], xs[3], xs[4], xs[5], xs[6], xs[7], xs[8]]
  );
  const extraScreensActive = EXTRA_SCREEN_SLOTS.filter((slot) => extraScreens[slot].active).length;

  // Starts the next free extra screen. The limit is the caller's to check
  // (it depends on the plan, see multiScreenLimit); this only refuses when all
  // nine are taken. Must run from a click: getDisplayMedia needs the gesture.
  const addExtraScreen = useCallback(async (): Promise<boolean> => {
    const slot = EXTRA_SCREEN_SLOTS.find((candidate) => !extraScreens[candidate].active);
    if (!slot) return false;
    await extraScreens[slot].start();
    return true;
  }, [extraScreens]);

  // Re-opens whichever live captures are running off the camera, so a change
  // to which lens that means actually reaches the room.
  //
  // A swap first, and a stop/start only if that could not be done. The
  // difference matters most on exactly the control this exists for: the
  // phone's flip button. Restarting the channel sends every viewer a "stop",
  // which drops their tile, throws anyone watching fullscreen back out to the
  // grid and loses the per-viewer state built up around that stream — a whole
  // room interrupted because one person turned their phone around. swapCapture
  // changes the track under the senders instead and none of that happens; see
  // its own doc comment.
  //
  // The fallback is kept rather than assumed away because swapCapture has real
  // ways to decline (a capture that will not open, a replaceTrack the
  // negotiated parameters refuse), and a camera control that silently did
  // nothing would be worse than one that blinks.
  const reopenCameraCaptures = useCallback(() => {
    // Turning the first camera round would point both at the same side. With
    // the plugin feeding both, stopping the second already restarts the first
    // on the WebView with the new lens, so there is nothing left to reopen.
    if (camera2.active) {
      const wasNative = Boolean(nativeDualRef.current);
      camera2.stop();
      if (wasNative) return;
    }
    if (camera.active) {
      void camera.swapCapture().then((swapped) => {
        if (swapped || !camera.active) return;
        camera.stop();
        camera.start();
      });
    }
    // Only when the screen channel is itself running off the camera (the
    // mobile fallback). Switching cameras must never interrupt a real screen
    // share.
    if (screen.active && screen.source === "camera") {
      void screen.swapCapture("camera").then((swapped) => {
        if (swapped || !screen.active) return;
        screen.stop();
        screen.start("camera");
      });
    }
  }, [camera, camera2, screen]);

  // Flips between the front and rear camera. The phone's version of the
  // picker below, and deliberately not built on it: on Android the lens ids
  // are opaque and their labels only readable after permission, so a flip
  // built on that list would be guessing which entry is the back one — and
  // guessing wrong on the phones that expose three.
  //
  // Clears the picked device id, which is the point rather than a side
  // effect: picking a specific lens and asking for "the other way round" are
  // two different intentions, and an `exact` deviceId left in place would win
  // over the facing constraint and make the button do nothing at all.
  const setCameraFacing = useCallback(
    (facing: CameraFacing) => {
      cameraFacingRef.current = facing;
      setCameraFacingState(facing);
      setStoredCameraFacing(facing);
      cameraDeviceIdRef.current = null;
      setCameraDeviceIdState(null);
      setStoredCameraDeviceId(null);
      reopenCameraCaptures();
    },
    [reopenCameraCaptures]
  );

  const setCameraDevice = useCallback(
    (deviceId: string | null) => {
      cameraDeviceIdRef.current = deviceId;
      setCameraDeviceIdState(deviceId);
      setStoredCameraDeviceId(deviceId);
      reopenCameraCaptures();
    },
    [reopenCameraCaptures]
  );

  // Every slot's playback state, so the announcement below can describe all of
  // them. Three fixed subscriptions for the same reason there are three fixed
  // channels.
  const media1 = useSyncExternalStore(
    localMediaSources.file1.subscribe,
    localMediaSources.file1.getSnapshot,
    localMediaSources.file1.getSnapshot
  );
  const media2 = useSyncExternalStore(
    localMediaSources.file2.subscribe,
    localMediaSources.file2.getSnapshot,
    localMediaSources.file2.getSnapshot
  );
  const media3 = useSyncExternalStore(
    localMediaSources.file3.subscribe,
    localMediaSources.file3.getSnapshot,
    localMediaSources.file3.getSnapshot
  );
  const mediaSnapshots = useMemo(
    () => ({ file1: media1, file2: media2, file3: media3 }),
    [media1, media2, media3]
  );

  // What the room is told about each live file slot. Only the discrete facts:
  // which file, who may drive it, whether it is playing and where it was at
  // `updatedAt`. A playing file's position is a function of time, so everyone
  // else extrapolates it (see lib/localMediaSource's localFilePosition) rather
  // than being sent a stream of positions — the same arithmetic a room video
  // source has always used.
  //
  // Just the filename, never the path: the folders above it are this person's
  // disk layout, not something a tile in someone else's room should show.
  const announcedFiles = LOCAL_MEDIA_SLOTS.flatMap((slot) => {
    if (!fileChannels[slot].active) return [];
    const snap = mediaSnapshots[slot];
    const raw = snap.queue[snap.index]?.name ?? null;
    if (!raw) return [];
    return [
      {
        channel: slot,
        name: raw.split("/").pop() ?? raw,
        mode: snap.mode,
        controlMode: snap.controlMode,
        playing: snap.playing,
        positionSeconds: snap.position,
        duration: snap.duration,
        index: snap.index,
        count: snap.queue.length,
      },
    ];
  });
  // Serialized, and then parsed back: the array above is a fresh literal on
  // every render, so listing it as a dependency would re-announce on every
  // keystroke in the room. The string is what actually changed or didn't, and
  // rebuilding the array from it inside the effect keeps the effect honest
  // about its own dependencies instead of reaching for a ref written during
  // render.
  const announcedFilesKey = JSON.stringify(announcedFiles);

  useEffect(() => {
    signalingClient.setSharing({
      // The extra screens are not announced one by one (the server knows
      // nothing about them); they count as the person sharing a screen.
      screen: screen.active || extraScreensActive > 0,
      camera: camera.active || camera2.active,
      files: JSON.parse(announcedFilesKey) as typeof announcedFiles,
    });
  }, [screen.active, extraScreensActive, camera.active, camera2.active, announcedFilesKey]);

  // Capacity measurement and the cascade decision. Both are driven by the
  // screen channel only: it is the expensive one, and the mic's ~32 kbps is
  // never what runs a room out of headroom. Keeping audio on a plain mesh is
  // also deliberate — routing voice through a relay tree would add a hop of
  // latency to conversation, which is far more noticeable than the same delay
  // on video.
  const anyFileActive = LOCAL_MEDIA_SLOTS.some((slot) => fileChannels[slot].active);

  // "Todos podem controlar", from the other side. A viewer's transport cannot
  // touch this machine's playback, so it asks: the request rides the ordinary
  // signalling relay (which forwards a payload opaquely — see the "signal"
  // case in server/signaling.ts), addressed at the slot it means, and lands
  // here. Whether to honour it is decided by the slot itself, which is where
  // its control mode actually lives.
  //
  // A listener of its own rather than a branch inside useBroadcastChannel:
  // this has nothing to do with negotiating a connection, and every channel's
  // handler would otherwise have to know to ignore it.
  useEffect(() => {
    const unsubscribe = signalingClient.onSignal((from, rawData) => {
      const data = rawData as { kind?: string; channel?: string } & LocalMediaAction;
      if (data?.kind !== "file-control") return;
      const slot = LOCAL_MEDIA_SLOTS.find((candidate) => candidate === data.channel);
      if (!slot) return;
      // Whether the asker runs this room, read at the moment the request
      // arrives rather than remembered: a promotion or a demotion between one
      // track and the next should take effect on the next button they press.
      // Only music files admit it at all (see LocalMediaControlMode).
      const room = signalingClient.getSnapshot();
      const asker = room.peers.find((peer) => peer.id === from);
      const askerId = asker?.userId;
      const fromRoomManager = Boolean(
        askerId &&
          (room.roomOwnerId === askerId || room.roomAdmins.some((a) => a.id === askerId))
      );
      localMediaSources[slot].applyRemote(data, fromRoomManager);
    });
    return () => {
      unsubscribe();
    };
  }, []);
  const sharingAnything =
    screen.active || camera.active || camera2.active || anyFileActive || extraScreensActive > 0;

  const { capacity, self, reportLoad } = useMeshCapacity();
  const selfRef = useRef(self);
  useEffect(() => {
    selfRef.current = self;
  }, [self]);

  const contentMultiplierRef = useRef(1);
  useEffect(() => {
    contentMultiplierRef.current = capacity.contentMultiplier || 1;
  }, [capacity.contentMultiplier]);
  const getContentMultiplier = useCallback(() => contentMultiplierRef.current, []);

  // Keeps the encode-budget estimator honest: it needs to know how much work
  // we are actually asking the encoder to do before it can tell whether a CPU
  // limitation means "this device is weak" or "we simply asked for too much".
  //
  // Depends on the two stable getters, never on the `screen`/`camera` objects
  // themselves: those are fresh object literals on every render, so listing one
  // tore this interval down and rebuilt it faster than its own 4s period ever
  // elapsed in an active room (chat, speaking indicators, tile resizes). It
  // therefore never fired, `loadRef` stayed at 0, and the `currentLoadMpxs > 0`
  // guard in EncodeBudget.observe meant the encode budget could never be
  // revised *down* under CPU pressure — only up, 12% at a time, whenever
  // pressure was low. The planner ended up believing in a machine far stronger
  // than the real one and stopped degrading when it should have.
  const getScreenTiers = screen.getServedTiers;
  const getCameraTiers = camera.getRequestedTiers;
  // Every live slot's tiers, since each is a real encode of its own.
  const getFileTiers = useCallback(
    () =>
      LOCAL_MEDIA_SLOTS.flatMap((slot) =>
        fileChannels[slot].active ? [...fileChannels[slot].getRequestedTiers().values()] : []
      ),
    [fileChannels]
  );
  const screenActive = screen.active;
  const cameraActive = camera.active;
  const fileActive = anyFileActive;
  // The extra screens are real encodes too. Read through a ref so the getter
  // keeps one identity: the channel objects are fresh every render, and an
  // unstable getter would rebuild the interval below before it ever fired
  // (see the comment above getScreenTiers).
  const extraScreensRef = useRef(extraScreens);
  useEffect(() => {
    extraScreensRef.current = extraScreens;
  }, [extraScreens]);
  const getExtraScreenTiers = useCallback(
    () =>
      EXTRA_SCREEN_SLOTS.flatMap((slot) => {
        const channel = extraScreensRef.current[slot];
        return channel.active ? [...channel.getRequestedTiers().values()] : [];
      }),
    []
  );
  useEffect(() => {
    if (!sharingAnything) return;
    const timer = setInterval(() => {
      // Both channels, but only the ones actually running: the encoder is one
      // shared resource, and a camera share alongside a screen share is real
      // work the budget has to know about. The getters answer for every peer in
      // the room rather than for live senders, so counting an idle channel
      // would invent a second encode per person out of nothing.
      const tiers = [
        ...(screenActive ? getScreenTiers().values() : []),
        ...(cameraActive ? getCameraTiers().values() : []),
        ...(fileActive ? getFileTiers() : []),
        ...getExtraScreenTiers(),
        ...(camera2Ref.current.active ? camera2Ref.current.getRequestedTiers().values() : []),
      ];
      reportLoad(tiers);
    }, 4000);
    return () => clearInterval(timer);
  }, [
    sharingAnything,
    reportLoad,
    getScreenTiers,
    getCameraTiers,
    getFileTiers,
    getExtraScreenTiers,
    screenActive,
    cameraActive,
    fileActive,
  ]);

  // Experiment "stream-perf" (see lib/streamPerf). An exposure only once a
  // screen share is running, which is the only time it changes anything.
  const streamPerf = useFeature(STREAM_PERF_FEATURE, { track: screen.active });
  useEffect(() => {
    setStreamPerfEnabled(streamPerf.enabled);
  }, [streamPerf.enabled]);
  // One event per stretch of downgrading, not one per planning pass.
  const directDowngradeCounted = useRef(false);

  const topology = useMeshTopology(
    sharingAnything,
    selfRef,
    screen.getPeerCapacities,
    screen.getRequestedTiers,
    getContentMultiplier
  );

  // Turn the plan into instructions. In the expected case there is no plan at
  // all (the room fits in a direct mesh) and this hands over an empty map,
  // which tears down any relays that were running and returns everyone to
  // being served directly.
  const applyRelayPlan = screen.applyRelayPlan;
  const applyDirectCaps = screen.applyDirectCaps;
  useEffect(() => {
    const selfId = signalingClient.state.selfId;
    // The plan's first hop: the people we serve ourselves, at the tier the
    // planner worked out fits (its globalDowngrade already applied). Only
    // under experiment "stream-perf"; otherwise an empty map, i.e. every
    // direct viewer at their full tier, as before.
    const caps = new Map<string, QualityTier>();
    if (streamPerf.enabled) {
      for (const edge of topology.plan?.edges ?? []) {
        if (edge.depth === 1) caps.set(edge.to, edge.tier);
      }
      // Whoever the plan could not fit even at the bottom rung is still
      // served by us (the peer-list loop does not know about plans) — at the
      // bottom rung, rather than at the full tier that did not fit.
      for (const id of topology.plan?.unserved ?? []) caps.set(id, WORST_TIER);
    }
    applyDirectCaps(caps);
    const downgrade = caps.size > 0 ? (topology.plan?.globalDowngrade ?? 0) : 0;
    if (downgrade > 0 && !directDowngradeCounted.current) {
      directDowngradeCounted.current = true;
      trackFeatureEvent(STREAM_PERF_EVENTS.directDowngrade, { value: downgrade });
    } else if (downgrade === 0) {
      directDowngradeCounted.current = false;
    }

    if (!RELAY_ENABLED) return;
    const assignments = new Map<string, RelayChild[]>();
    for (const edge of topology.plan?.edges ?? []) {
      if (edge.depth <= 1 || edge.from === selfId) continue;
      const list = assignments.get(edge.from) ?? [];
      list.push({ id: edge.to, tier: edge.tier });
      assignments.set(edge.from, list);
    }
    applyRelayPlan(assignments);
  }, [topology.plan, applyRelayPlan, applyDirectCaps, streamPerf.enabled]);

  // "Qualidade reduzida para caber na sua conexão" is only true where the
  // reduction is carried out. Outside the experiment a plain-mesh downgrade
  // is computed and then applied to nobody, so the notice would claim
  // something that is not happening; it is dropped there. A cascade's notice
  // (depth > 1) is about relays, which do happen, and stays.
  const shownTopology = useMemo(
    () =>
      streamPerf.enabled || !topology.plan || topology.plan.depth > 1 || topology.reason === null
        ? topology
        : { ...topology, reason: null },
    [topology, streamPerf.enabled]
  );

  // Mirrors noiseSuppressionOn below without going stale inside the capture
  // closure, which useBroadcastChannel only ever calls once per mic start
  // (long after a later render could have updated a captured `const`).
  // Seeded from localStorage so a returning visitor's last choice carries
  // over instead of resetting to "on" every reload.
  const noiseSuppressionOnRef = useRef(getStoredNoiseSuppressionOn());
  const [noiseSuppressionOn, setNoiseSuppressionOnState] = useState(getStoredNoiseSuppressionOn);
  // Non-null only while the mic is active AND RNNoise actually loaded —
  // used both to reroute the live audio graph on toggle and to tell the UI
  // whether suppression is really in effect right now.
  const micGraphRef = useRef<MicNoiseGraph | null>(null);
  // Lets the capture closure below reach mic.stop(), which is declared after
  // it. Needed because the raw capture can die on its own (device unplugged,
  // permission revoked, another app seizing it) while the RNNoise graph goes
  // right on emitting digital silence into a perfectly healthy set of peer
  // connections — the mic has to actually be turned off for the UI, and the
  // rest of the room, to reflect that.
  const micStopRef = useRef<() => void>(() => {});
  const [noiseSuppressionAvailable, setNoiseSuppressionAvailable] = useState(true);

  // The input-volume dial, 0.01-2. Same "ref mirrors state, for the capture
  // closure" pattern as noiseSuppressionOnRef, and for the same reason: the
  // start callback runs once per mic start, so a captured `const` would hand
  // a stale level to a capture started after the slider moved. Clamped on the
  // way out of storage rather than on the way in — the range belongs to
  // rnnoise.ts, and a value stored by an older build with a wider one should
  // land inside today's rather than be treated as no preference at all.
  const micGainRef = useRef(clampMicGain(getStoredMicGain() ?? DEFAULT_MIC_GAIN));
  const [micGain, setMicGainState] = useState(() => clampMicGain(getStoredMicGain() ?? DEFAULT_MIC_GAIN));
  // False once the mic has started without a graph to hang the gain node on
  // (a suspended/unavailable AudioContext — see captureNoiseSuppressedMic).
  // The capture is broadcast raw in that state, so the dial does nothing and
  // the UI says so instead of pretending.
  const [micGainAvailable, setMicGainAvailable] = useState(true);

  // Same "ref mirrors state, for the capture closure" pattern as
  // noiseSuppressionOnRef above — useBroadcastChannel only calls this start
  // callback once per mic start, so a captured `const` would go stale if the
  // user switches input device without restarting the mic.
  const micDeviceIdRef = useRef<string | null>(getStoredMicDeviceId());
  const [micDeviceId, setMicDeviceIdState] = useState<string | null>(() => getStoredMicDeviceId());
  const [speakerDeviceId, setSpeakerDeviceIdState] = useState<string | null>(() => getStoredSpeakerDeviceId());

  // Idempotent: rnnoise's own teardown is guarded, so calling this from both
  // the stop path and unmount costs nothing.
  const releaseMicGraph = useCallback(() => {
    micGraphRef.current?.stop();
    micGraphRef.current = null;
  }, []);

  const mic = useBroadcastChannel(
    "mic",
    room,
    async () => {
      // Belt and braces for a start that follows a stop too closely to have
      // released the previous graph yet (the device picker does exactly this):
      // opening a second capture of the same input device while the first is
      // still held is how Windows in particular hands back a silent track.
      releaseMicGraph();
      const { stream, graph } = await captureNoiseSuppressedMic(
        noiseSuppressionOnRef.current,
        () => {
          micGraphRef.current = null;
          // Reached only when the graph tore itself down rather than being
          // stopped by us — i.e. the raw capture ended underneath it. Turning
          // the channel off is what stops us broadcasting silence and what
          // makes the button reflect reality.
          micStopRef.current();
        },
        micDeviceIdRef.current,
        micGainRef.current
      );
      micGraphRef.current = graph;
      setNoiseSuppressionAvailable(graphSuppressionAvailable(graph));
      setMicGainAvailable(graph !== null);
      return stream;
    },
    () => Boolean(navigator.mediaDevices?.getUserMedia),
    t("useRoomMedia.yourBrowserDoesNotSupportA2"),
    t("useRoomMedia.couldNotTurnOnTheMicrophone"),
    forceRelayIce,
    true, // autoJoin: mic always auto-connects, this setting is screen/camera only
    undefined, // videoQuality: audio has none
    // The RNNoise graph outlives the track it feeds, because stopping a track
    // is not the same as the track ending: stop() calls
    // MediaStreamTrack.stop(), which by spec never raises "ended", so the
    // graph's own teardown could never have been hung off that. Releasing it
    // here is what actually frees the raw microphone (browser indicator off,
    // device available to the next getUserMedia) and destroys the RNNoise
    // worklet, instead of leaking one running on the shared context per start.
    releaseMicGraph
  );

  const micStop = mic.stop;
  useEffect(() => {
    micStopRef.current = micStop;
  }, [micStop]);

  // Leaving the page mid-call is the same release, for the same reasons — and
  // covers a graph built by a capture whose start never completed.
  useEffect(() => {
    return () => {
      releaseMicGraph();
    };
  }, [releaseMicGraph]);

  const toggleMic = useCallback(() => {
    const next = !mic.active;
    setStoredMicOn(next);
    if (mic.active) mic.stop();
    else mic.start();
  }, [mic]);

  /**
   * Opens or closes the mic explicitly, **without** touching the stored
   * preference.
   *
   * For a mic change that is a consequence rather than a decision — today,
   * deafening yourself, which closes the mic and reopens it when you undeafen
   * (see WatchRoom). Two things follow from that and both are deliberate:
   *
   * Explicit rather than toggleMic, because a consequence has a target state,
   * not a direction. A toggle called from an effect that ran on a value it
   * read one render ago can flip the wrong way; this cannot.
   *
   * And it leaves setStoredMicOn alone, because the stored value is what you
   * chose, and being deafened is not a choice about your microphone. Without
   * that, deafening once would persist "mic off" and you would come back to a
   * closed mic on the next visit having never asked for one.
   */
  const setMicOn = useCallback(
    (on: boolean) => {
      if (mic.active === on) return;
      if (on) mic.start();
      else mic.stop();
    },
    [mic]
  );

  // Switches the input device the mic captures from. If the mic is live
  // right now, restarts the capture (stop, then start) so the new device
  // actually takes effect — same trade-off phone/desktop call apps make,
  // a brief drop beats silently continuing to broadcast the old device.
  const setMicDevice = useCallback(
    (deviceId: string | null) => {
      micDeviceIdRef.current = deviceId;
      setMicDeviceIdState(deviceId);
      setStoredMicDeviceId(deviceId);
      if (mic.active) {
        mic.stop();
        mic.start();
      }
    },
    [mic]
  );

  const setSpeakerDevice = useCallback((deviceId: string | null) => {
    setSpeakerDeviceIdState(deviceId);
    setStoredSpeakerDeviceId(deviceId);
  }, []);

  // Remote audio doesn't come out of the <audio> element while the gain graph
  // has it (see audioGain.ts), so telling only the element about the chosen
  // speaker left it playing on the system default — for anyone whose default
  // is a monitor with no speakers, that reads as "picked my headset and still
  // hear nothing". The shared context has to be pointed at it too, and where
  // it can't be, this is what makes playback fall back to the element so the
  // choice is honoured at all.
  //
  // An effect rather than a line in setSpeakerDevice above, so a device
  // restored from storage on load is applied as well as one just picked.
  useEffect(() => {
    setPreferredAudioSink(speakerDeviceId);
  }, [speakerDeviceId]);

  // Restores a returning visitor's mic-on preference — fires on mount and
  // again after a room switch (the mic itself always stops on a room
  // change, same as screen/camera share, so without this it would silently
  // stay off instead of carrying over like noise suppression/mute do).
  // Only ever reads the persisted value once per room; a manual toggle
  // afterwards is respected instead of being fought on the next render.
  useEffect(() => {
    if (getStoredMicOn()) mic.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Fetches the system-audio worklet up front, in the desktop app on a
  // machine that can use it, so that the first screen share of a session
  // doesn't spend the click's user-activation budget on a network round trip
  // and then get refused by getDisplayMedia. See
  // prewarmExcludedSystemAudio's doc comment — that failure looked exactly
  // like "clicking share does nothing", and only ever on the first try.
  // Fire-and-forget and a no-op everywhere else.
  useEffect(() => {
    prewarmExcludedSystemAudio();
  }, []);

  // Sets how loud this microphone is sent. Applied to the live graph rather
  // than by restarting the capture, so — unlike switching input device —
  // dragging the slider mid-call costs nothing: no gap, no renegotiation,
  // and the person hears the result on the other end as they move it.
  const setMicGain = useCallback((value: number) => {
    const clamped = clampMicGain(value);
    micGainRef.current = clamped;
    setMicGainState(clamped);
    setStoredMicGain(clamped);
    setGraphInputGain(micGraphRef.current, clamped);
  }, []);

  const toggleNoiseSuppression = useCallback(() => {
    const next = !noiseSuppressionOnRef.current;
    noiseSuppressionOnRef.current = next;
    setNoiseSuppressionOnState(next);
    setStoredNoiseSuppressionOn(next);
    setGraphSuppressionEnabled(micGraphRef.current, next);
    trackEvent(next ? "noise_suppression_on" : "noise_suppression_off");
  }, []);

  return {
    isSharing: screen.active || camera.active,
    startShare: screen.start,
    stopShare: screen.stop,
    localStream: screen.localStream,
    remoteStreams: screen.remoteStreams,
    shareError: screen.error,
    shareSource: screen.source,
    // Answered once per share, at the moment it starts — see
    // shareSystemAudioRef for why this one is never remembered.
    setShareSystemAudio,
    shareSystemAudioUnavailable: systemAudioUnavailable,
    // The local-file slots (see useLocalFileChannel). A record rather than a
    // flat set of fields, because there are three of them and every consumer
    // wants to walk them.
    fileChannels,
    // Each slot's playback state, for the tile that renders its transport.
    localMediaSnapshots: mediaSnapshots,
    anyFileActive,
    // "Várias telas" — see lib/multiScreen.ts.
    extraScreens,
    extraScreensActive,
    addExtraScreen,
    // The other lens, at the same time (see camera2 above).
    dualCamera: camera2,
    dualCameraSupported,
    startDualCamera,
    dualCameraError: nativeDualError ?? camera2.error,
    isCameraSharing: camera.active,
    startCameraShare: camera.start,
    stopCameraShare: camera.stop,
    localCameraStream: camera.localStream,
    remoteCameraStreams: camera.remoteStreams,
    cameraShareError: camera.error,
    cameraDeviceId,
    setCameraDevice,
    cameraFacing,
    setCameraFacing,
    stoppedPeers: screen.stoppedPeers,
    resumingPeers: screen.resumingPeers,
    stopWatchingPeer: screen.stopWatchingPeer,
    resumeWatchingPeer: screen.resumeWatchingPeer,
    stoppedCameraPeers: camera.stoppedPeers,
    resumingCameraPeers: camera.resumingPeers,
    stopWatchingCameraPeer: camera.stopWatchingPeer,
    resumeWatchingCameraPeer: camera.resumeWatchingPeer,
    shareResolution,
    setShareResolution,
    shareFps,
    setShareFps,
    shareBitrate,
    setShareBitrate,
    smartQualityEnabled,
    setSmartQualityEnabled,
    nativeVideoOption,
    setNativeVideoOption,
    nativeVideoMethod,
    setNativeVideoMethod,
    screenRestartNeeded,
    restartScreenShare,
    shareProfile,
    setShareProfile,
    // Live telemetry, for the share panel: measured uplink, measured content
    // cost, and whether the room currently needs anyone to relay.
    meshCapacity: capacity,
    meshTopology: shownTopology,

    forceRelayIce,
    forceRelayAllowed,
    toggleForceRelayIce,
    autoJoin,
    toggleAutoJoin,

    isMicOn: mic.active,
    toggleMic,
    setMicOn,
    micError: mic.error,
    localMicStream: mic.localStream,
    remoteMicStreams: mic.remoteStreams,
    // Per-peer audio recvPC state (origin id -> RTCPeerConnectionState) — the
    // room isn't fully "connected" the instant signaling joins; each
    // person's mic audio still needs its own peer connection to come up
    // first. Drives the "Conectando..." banner and the per-participant
    // connection-lost dot in WatchRoom.
    micConnectionStates: mic.recvConnectionStates,
    micDeviceId,
    setMicDevice,
    micGain,
    setMicGain,
    // Like noiseSuppressionAvailable, only meaningful once the mic has
    // actually started.
    micGainAvailable,
    speakerDeviceId,
    setSpeakerDevice,

    noiseSuppressionOn,
    // Only meaningful once the mic has actually started — before that it's
    // just the pending preference for the next start.
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
  };
}
