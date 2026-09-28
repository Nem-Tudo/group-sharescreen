"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { signalingClient } from "./signalingClient";
import { useBroadcastChannel, SCREEN_SHARE_STATS, ShareStartError, isCancelLikeError, resetShareRestartWindow, type QualityPreset } from "./broadcastChannel";
export { SCREEN_SHARE_STATS } from "./broadcastChannel";
import { hasFeature, type Feature } from "./entitlements";
import { useAuth } from "./AuthContext";
import { trackEvent } from "./analytics";
import { ensureIceServers } from "./iceServers";
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
  MAX_TIER_FPS,
  WORST_TIER,
  tierForRenderedSize,
  type QualityTier,
} from "./videoQuality";
import {
  localMediaSources,
  LOCAL_MEDIA_SLOTS,
  setLocalAudioTracksEnabled,
  type LocalMediaSlot,
  type LocalMediaAction,
} from "./localMediaSource";
import { FILE_AUDIO_TRACKS_FEATURE, startFileAudioTracks } from "./fileAudioTracks";
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
  setRelayCapExempt,
  type DegradationMode,
} from "./peerQualityController";
import { startConnectionTelemetry } from "./connectionTelemetry";
import { useMeshCapacity, useMeshTopology } from "./useMeshTopology";
import { RELAY_ENABLED, type RelayChild } from "./relayLink";
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
  probeNativeVideo,
  startNativeVideo,
  type NativeVideoMethod,
  type NativeVideoOptions,
} from "./nativeVideoCapture";

// "file1".."file3" are local video or audio files played into the room (see
// lib/localMediaSource.ts). Each is a full sibling of screen and camera — its
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
  // The resolution dial caps the picture drawn for the room (see
  // LocalMediaSource.setMaxSize), live, like it caps a screen share.
  useEffect(() => {
    localMediaSources[slot].setMaxSize(quality.width, quality.height);
  }, [slot, quality.width, quality.height]);
  return useBroadcastChannel(
    slot,
    room,
    // Nothing to request from the OS and no permission prompt: the file is
    // already decoding in an element this page owns, because the picker filled
    // this slot's queue before this ran. The picture is the file's own size,
    // held to the resolution dial (see the effect above).
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

interface ScreenStartConfig {
  native: boolean;
  method: NativeVideoMethod;
  /** Whether the helper actually took over. */
  usedNative: boolean;
  resolution: ShareResolution;
  fps: ShareFps;
}



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
    resetShareRestartWindow();
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

  // Experiment "file-audio-tracks": every audio track of a local file, each
  // viewer picking theirs (see lib/fileAudioTracks). An exposure once a file
  // is actually being played. The signal handling runs for everyone — a
  // viewer outside the experiment still gets to pick on a broadcaster inside.
  const fileAudioTracks = useFeature(FILE_AUDIO_TRACKS_FEATURE, { track: anyFileActive });
  useEffect(() => {
    setLocalAudioTracksEnabled(fileAudioTracks.enabled);
  }, [fileAudioTracks.enabled]);
  useEffect(() => {
    startFileAudioTracks();
  }, []);

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
