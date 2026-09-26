"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signalingClient, type PeerInfo } from "./signalingClient";
import { speakingDetector } from "./speakingDetector";
import { trackEvent } from "./analytics";
import { iceConfigFor } from "./iceConfig";
import { watchTurnRelay } from "./turnRoute";
import { BEST_TIER, MAX_TIER_FPS, capTier, type QualityTier } from "./videoQuality";
import { PeerQualityRegistry, contentHintForDegradation, type DegradationMode } from "./peerQualityController";
import { qualityNegotiator, type QualityChannel } from "./qualityNegotiation";
import { connectionRegistry } from "./connectionRegistry";
import { connectionDiagLink } from "./connectionDiagLink";
import { type PeerCapacity } from "./useMeshTopology";
import { RelayManager, RELAY_ENABLED, type RelayChild } from "./relayLink";
import { applyVideoCodecPreferences, videoCodecOrder, type VideoCodecOrder } from "./videoCodecPreferences";
import { trackFeatureEvent } from "./features";
import { nativeVideoPeerConfig, nativeVideoSourceFor, passThroughSender } from "./nativeVideoCapture";
import type { LocalMediaSlot } from "./localMediaSource";
import type { ExtraScreenSlot } from "./multiScreen";
import { manageSendPeerConnection, manageRecvPeerConnection, createSendRetryScheduler } from "./peerConnectionManager";

// own peer connections, its own tiles, its own start/stop — rather than a mode
// of the screen channel, which is what lets several of them run at once and
// alongside a screen share.
// "screen2".."screen10" are the extra screens/windows of "Várias telas" (see
// lib/multiScreen.ts) — siblings of "screen" for the same reason.
// "camera2" is the phone's other lens, sent alongside "camera" (front and
// rear at once) — see the dual camera below.
export type Channel = "screen" | "camera" | "camera2" | "mic" | LocalMediaSlot | ExtraScreenSlot;
// Where the screen channel's picture comes from. "display" is a real screen
// capture; "camera" is the phone fallback (no getDisplayMedia there, so
// "compartilhar tela" opens the camera). A local file is *not* one of these:
// it has a channel of its own (see the `file` channel below), so that playing
// something for the room and showing your screen are two things a person can
// do at the same time rather than a choice between them.
export type ShareSource = "display" | "camera";

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

export type QualityPreset = {
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
export function resetShareRestartWindow() { lastScreenShareEndedAt = 0; }

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

export function useBroadcastChannel(
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
  const sendManagers = useRef<Map<string, ReturnType<typeof manageSendPeerConnection>>>(new Map());
  // Per-peer "I asked for a reconnect and am holding this pc open for the
  // answer" timers — see recoverRecvPC.
  const recvManagers = useRef<Map<string, ReturnType<typeof manageRecvPeerConnection>>>(new Map());
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
    sendManagers.current.get(peerId)?.dispose();
    sendManagers.current.delete(peerId);
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

  }, [channel]);


  const closeRecvPC = useCallback(
    // `reparenting` says this connection is being replaced rather than ending
    // — the same distinction the "stop" signal carries, and it matters here
    // for one reason: if we are relaying this stream onward, our whole subtree
    // has to be told which of the two just happened to us. Defaulted to the
    // ending case, which is what every other caller means.
    (peerId: string, reparenting = false) => {
      const pc = recvPCs.current.get(peerId);
      recvManagers.current.get(peerId)?.dispose();
      recvManagers.current.delete(peerId);
      if (pc) {
        pc.close();
        recvPCs.current.delete(peerId);
        if (channel !== "mic") connectionRegistry.unregister(pc);
      }
      pendingRecvCandidates.current.delete(peerId);

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
  const sendRetries = useRef<ReturnType<typeof createSendRetryScheduler> | null>(null);
  useEffect(() => {
    const scheduler = createSendRetryScheduler(
      (peerId) => activeRef.current && signalingClient.state.peers.some((p) => p.id === peerId),
      (peerId) => openSendPCRef.current(peerId),
      RETRY_BASE_DELAY_MS,
      RETRY_MAX_DELAY_MS
    );
    sendRetries.current = scheduler;
    return () => { scheduler.clearAll(); sendRetries.current = null; };
  }, []);
  const scheduleSendRetry = useCallback((peerId: string) => {
    sendRetries.current?.schedule(peerId);
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
      // The manager owns recovery timers, a single ICE restart per failure,
      // and cleanup. This channel still owns its tracks, quality and signals.
      const sendOffer = async (offer: RTCSessionDescriptionInit, iceRestart: boolean) => {
        if (sendPCs.current.get(peerId) !== pc) return;
        await pc.setLocalDescription(offer);
        if (sendPCs.current.get(peerId) !== pc) return;
        signalingClient.sendSignal(peerId, {
          channel, role: "broadcaster", kind: "offer", sdp: pc.localDescription,
          ...(iceRestart ? { iceRestart: true } : {}),
        });
      };
      const manager = manageSendPeerConnection({
        pc,
        isCurrent: () => sendPCs.current.get(peerId) === pc,
        sendOffer,
        onFailure: () => { closeSendPC(peerId); scheduleSendRetry(peerId); },
        onClosed: () => closeSendPC(peerId),
        onConnected: () => sendRetries.current?.reset(peerId),
        onPeerFailure: () => {
          if (shareStatsRef.current) shareStatsRef.current.peerFailures += 1;
        },
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
        restartTimeoutMs: ICE_RESTART_TIMEOUT_MS,
      });
      sendManagers.current.set(peerId, manager);
      sendIceRestarters.current.set(peerId, manager.tryRestart);
      pc.createOffer()
        .then((offer) => sendOffer(offer, false))
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
    for (const manager of sendManagers.current.values()) manager.dispose();
    sendManagers.current.clear();
    sendRetries.current?.clearAll();
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
      const manager = manageRecvPeerConnection({
        pc,
        isCurrent: () => recvPCs.current.get(peerId) === pc,
        onState: (state) => setRecvConnectionStates((prev) => ({ ...prev, [originId]: state })),
        onClosed: () => { closeRecvPC(peerId); requestReconnect(peerId); },
        requestReconnect: () => requestReconnect(peerId),
        rebuild: () => { closeRecvPC(peerId); requestReconnect(peerId); },
        recoveryTimeoutMs: RECV_RECOVERY_TIMEOUT_MS,
      });
      recvManagers.current.set(peerId, manager);
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
        sendRetries.current?.reset(from);
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
      sendRetries.current?.reset(peerId);
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
    const recoveryManagers = recvManagers.current;
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
      for (const manager of recoveryManagers.values()) manager.dispose();
      recoveryManagers.clear();
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
export class ShareStartError extends Error {}
// "The user dismissed the picker" and "this call no longer has a user gesture
// behind it" arrive as the same DOMException name, which is why the caller
// has to bring its own evidence (see activationLost in the display capture).
export function isCancelLikeError(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")
  );
}
