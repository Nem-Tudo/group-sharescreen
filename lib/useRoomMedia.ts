"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { signalingClient } from "./signalingClient";
import { trackEvent } from "./analytics";
import { iceConfigFor } from "./iceConfig";
import { captureNoiseSuppressedMic, setGraphSuppressionEnabled, type MicNoiseGraph } from "./rnnoise";
import {
  getStoredAutoJoin,
  getStoredForceRelayIce,
  getStoredMicOn,
  getStoredNoiseSuppressionOn,
  getStoredCameraDeviceId,
  getStoredMicDeviceId,
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
import { PeerQualityRegistry, type DegradationMode } from "./peerQualityController";
import { qualityNegotiator, type QualityChannel } from "./qualityNegotiation";
import { useMeshCapacity, useMeshTopology, type PeerCapacity } from "./useMeshTopology";
import { RelayManager, RELAY_ENABLED, type RelayChild } from "./relayLink";
import { applyVideoCodecPreferences } from "./videoCodecPreferences";
import { setPreferredAudioSink } from "./audioContext";
import { startExcludedSystemAudio, prewarmExcludedSystemAudio } from "./desktopSystemAudio";

// "file1".."file3" are local video or audio files played into the room (see
// lib/localMediaSource.ts). Each is a full sibling of screen and camera — its
// own peer connections, its own tiles, its own start/stop — rather than a mode
// of the screen channel, which is what lets several of them run at once and
// alongside a screen share.
type Channel = "screen" | "camera" | "mic" | LocalMediaSlot;
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
    | "reconnect-request";
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
// "1440p" (2K), 120fps, and (below) the "ultra" bitrate are account-only —
// see the relevant SHARE_*_OPTIONS' `accountOnly` flag and WatchRoom.tsx,
// which lists them for a guest as disabled options ("conta necessária")
// rather than letting one be selected. Nothing in this file itself checks
// account status: a guest simply never has a code path that could set any
// of these values, since a disabled <option> can't be chosen.
export type ShareResolution = "1440p" | "1080p" | "720p" | "576p";
export type ShareFps = 15 | 24 | 30 | 60 | 120;
// "ultra" is account-only — see SHARE_BITRATE_OPTIONS' `accountOnly` flag
// and its doc comment above ShareResolution/ShareFps for the same pattern.
export type ShareBitrate = "low" | "medium" | "high" | "ultra" | "maximo";

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
};

// The best tier the resolution + fps dials allow. Reusing the tile-size
// selector is deliberate: "the cheapest tier that still covers this many
// pixels at up to this frame rate" is exactly the question, and asking it in
// one place keeps a dial from ever landing on a tier that does not exist
// (720p at 60fps, say) and silently rounding somewhere surprising.
function ceilingTierFor(resolution: ShareResolution, fps: ShareFps): QualityTier {
  const dims = RESOLUTION_DIMENSIONS[resolution];
  return tierForRenderedSize(dims.width, dims.height, 1, undefined, fps);
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
// `accountOnly` — WatchRoom.tsx still lists these for a guest (so the picker
// itself advertises they exist), but renders them as a disabled option
// suffixed "(conta necessária)" instead of a selectable one.
export const SHARE_RESOLUTION_OPTIONS: { value: ShareResolution; label: string; accountOnly?: boolean }[] = [
  { value: "576p", label: "576p" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "Full HD (1080p)" },
  { value: "1440p", label: "2K (1440p)", accountOnly: true },
];

export const SHARE_FPS_OPTIONS: { value: ShareFps; label: string; accountOnly?: boolean }[] = [
  { value: 15, label: "15 fps" },
  { value: 24, label: "24 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
  { value: 120, label: "120 fps", accountOnly: true },
];

export const SHARE_BITRATE_OPTIONS: { value: ShareBitrate; label: string; accountOnly?: boolean }[] = [
  { value: "low", label: "Bitrate baixo (~700 kbps)" },
  { value: "medium", label: "Bitrate médio (~2 Mbps)" },
  { value: "high", label: "Bitrate alto (~4 Mbps)" },
  { value: "ultra", label: "Bitrate ultra (~8 Mbps)" },
  { value: "maximo", label: "Bitrate máximo (~16 Mbps)", accountOnly: true },
];

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
    "Este navegador não permite tocar arquivos locais para a sala.",
    "Não foi possível tocar esse arquivo para a sala.",
    forceRelayIce,
    autoJoin,
    // Motion, always — see the contentHint block in start().
    quality,
    // Stops this slot's playback when the channel carrying it ends.
    () => localMediaSources[slot].release()
  );
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
  const clearResuming = useCallback((peerId: string) => {
    setResumingPeers((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
  }, []);
  const markResuming = useCallback((peerId: string) => {
    setResumingPeers((prev) => {
      if (prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.add(peerId);
      return next;
    });
  }, []);
  const videoQualityRef = useRef(videoQuality);
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
  const tierForPeer = useCallback((peerId: string): QualityTier => {
    const ceiling = qualityCeilingRef.current;
    if (!honorRequestsRef.current) return ceiling;
    const requested = requestedTiers.current.get(peerId);
    return requested ? capTier(requested, ceiling) : ceiling;
  }, []);

  // What every viewer would actually be served right now — each one's request
  // already capped by our ceiling, and every peer present, not only the ones
  // who have reported a size yet.
  //
  // Both consumers need it in that form. The topology planner budgets the
  // room against these numbers, and budgeting against the raw request means
  // reserving link and CPU for quality the ceiling forbids anyone from ever
  // receiving — capacity that is reserved but unusable is exactly what tips a
  // room into a global downgrade it did not need. The encode-load estimate
  // has the same problem in the same direction.
  const getRequestedTiers = useCallback(() => {
    const served = new Map<string, QualityTier>();
    for (const peer of signalingClient.state.peers) {
      if (peer.role === "moderator") continue;
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
  }, []);


  const closeRecvPC = useCallback(
    (peerId: string) => {
      const pc = recvPCs.current.get(peerId);
      if (pc) {
        pc.close();
        recvPCs.current.delete(peerId);
      }
      pendingRecvCandidates.current.delete(peerId);
      const recovery = recvRecoveryTimers.current.get(peerId);
      if (recovery) clearTimeout(recovery);
      recvRecoveryTimers.current.delete(peerId);
      // The tile is filed under the origin, not the sender, so a relayed
      // stream must be removed by origin or it would linger forever.
      const origin = recvOrigins.current.get(peerId) ?? peerId;
      recvOrigins.current.delete(peerId);
      relaySources.current.delete(origin);
      relays.current.release(origin);
      removeRemoteStream(origin);
      setRecvConnectionStates((prev) => {
        if (!(origin in prev)) return prev;
        const next = { ...prev };
        delete next[origin];
        return next;
      });
    },
    [removeRemoteStream]
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
      clearStopped(peerId);
      setResumingPeers((prev) => {
        if (prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
      signalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "resume" });
    },
    [channel, clearStopped]
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
      const pc = new RTCPeerConnection(iceConfigFor(forceRelayIceRef.current));
      sendPCs.current.set(peerId, pc);
      stream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, stream);
        if (track.kind === "video") {
          const transceivers = pc.getTransceivers();
          const transceiver = transceivers.find((t) => t.sender === sender);
          const mode = degradationModeRef.current;
          if (transceiver) applyVideoCodecPreferences(transceiver, mode);

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
      const nowRelayed = new Set<string>();
      for (const children of relayAssignments.values()) {
        for (const child of children) nowRelayed.add(child.id);
      }

      for (const [relayId, children] of relayAssignments) {
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
    [channel, closeSendPC]
  );

  // Lets the broadcaster change resolution/fps/bitrate mid-share to react to
  // a room bogging down, instead of having to stop and restart the whole
  // capture. Skipped while inactive — a change picked before starting is
  // simply read fresh by `capture` (via videoQualityRef-equivalent state in
  // the caller) the next time start() runs.
  useEffect(() => {
    if (!videoQuality || !activeRef.current || !localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    track
      ?.applyConstraints({
        width: { ideal: videoQuality.width },
        height: { ideal: videoQuality.height },
        frameRate: { ideal: videoQuality.frameRate },
      })
      .catch(() => {});

    const captureHeight = track?.getSettings().height ?? videoQuality.height;
    qualityRegistry.current.setCaptureHeight(captureHeight);
    qualityRegistry.current.setDegradation(videoQuality.degradation);
    qualityRegistry.current.setBitrateCeiling(videoQuality.maxBitrateKbps);

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
  }, [videoQuality, tierForPeer]);

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
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
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
    }
    sendPCs.current.clear();
    // A brand-new share later starts clean — mirrors the viewer side, which
    // has its "stopped watching" marker cleared the moment this "stop"
    // signal makes closeRecvPCFully run for them (see the onSignal handler
    // below), since there's no longer a stream to have stopped watching.
    viewerPausedPeers.current.clear();
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
      // user-facing choice rather than a constant.
      //
      // The previous code hardcoded "detail" for every screen share. That is
      // correct for code and documents, but for a 60fps game or video it is
      // actively harmful: combined with maintain-resolution it tells the
      // encoder to protect sharpness and throw away frames, so a share
      // advertised as 60fps degrades into a slideshow under any load. Worse,
      // "detail" is reported to interact badly with VP9 specifically (see
      // analise/codec-diagnostico.html, which measures this on real content).
      // Camera is always motion.
      // The "screen" channel is not always a screen: on a phone, which has no
      // getDisplayMedia, "compartilhar tela" captures the camera instead (see
      // getScreenShareMode). Hinting "text" at a webcam tells the encoder to
      // protect sharpness and throw frames away, which is exactly backwards for
      // a moving picture — so the source, not the channel name, decides.
      const capturingCamera = channel === "camera" || requestedSource === "camera";
      // A file is moving pictures, whatever the "compartilhar tela" dial is
      // set to — same reasoning as the camera above: "text" tells the encoder
      // to protect sharpness and drop frames, which turns a film into a
      // slideshow the moment anything gets tight.
      const capturingMotion = capturingCamera || channel.startsWith("file");
      const hint =
        !capturingMotion && channel === "screen" && degradationModeRef.current === "text"
          ? "text"
          : "motion";
      stream.getVideoTracks().forEach((track) => {
        track.contentHint = hint;
      });
      localStreamRef.current = stream;
      activeRef.current = true;
      setLocalStream(stream);
      setActive(true);
      setSource(requestedSource);
      if (channel === "mic") signalingClient.setMic(true);
      else signalingClient.setSharing({ [channel]: true });
      trackEvent(`${eventPrefix}_start`);
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => stop()));
      // Staggered (see STAGGER_MS's doc comment) — starting a share into an
      // already-large room is exactly the burst that used to overwhelm the
      // signaling rate limit and leave some viewers' connections stuck.
      openSendPCsStaggered(signalingClient.state.peers.map((peer) => peer.id));
    } catch (err) {
      // A failure the capture already worked out the reason for carries the
      // message that fits it — `failureMessage` is a per-channel fallback for
      // everything else, and "verifique as permissões" is the wrong thing to
      // say when permissions were never involved.
      if (err instanceof ShareStartError) {
        setError(err.message);
        trackEvent(`${eventPrefix}_error`);
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
        trackEvent(`${eventPrefix}_error`);
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

  const openRecvPC = useCallback(
    // peerId is who is sending to us; originId is who actually produced
    // the stream. They differ only for relayed traffic. Keeping the recvPC
    // keyed by sender while filing the stream under the origin is what lets a
    // relayed viewer still see the real broadcaster on the tile.
    (peerId: string, originId: string = peerId) => {
      const pc = new RTCPeerConnection(iceConfigFor(forceRelayIceRef.current));
      recvPCs.current.set(peerId, pc);
      recvOrigins.current.set(peerId, originId);
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
        setRemoteStreams((prev) => ({ ...prev, [origin]: e.streams[0] }));
        clearResuming(origin);
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
    [channel, closeRecvPC, clearResuming, requestReconnect]
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
            closeRecvPC(from);
            markResuming(recvOrigins.current.get(from) ?? from);
            return;
          }
          // The broadcaster stopped sharing entirely — nothing to "come
          // back" to, so this fully clears the tile rather than leaving a
          // stopped-by-us placeholder behind.
          closeRecvPCFully(from);
        }
      } else if (data.role === "viewer") {
        if (data.kind === "relay-assign") {
          // The broadcaster has asked us to forward their stream onward. We
          // can only do that if we are actually receiving it — if the source
          // has not arrived yet the assignment is dropped rather than queued,
          // because by the time it did arrive the plan would likely be stale.
          if (!RELAY_ENABLED || channel !== "screen") return;
          const origin = data.originId ?? from;
          const source = relaySources.current.get(origin);
          if (!data.children) return;
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
          // "text" if the sender predates this field (an older tab still
          // open through a deploy) — the same default RelayLink itself
          // starts with, so a missing field changes nothing about today's
          // behavior; it just stops silently overriding a broadcaster who
          // did send one.
          const degradation: DegradationMode = data.degradation === "motion" ? "motion" : "text";
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
      // Staggered (see STAGGER_MS's doc comment) — this fires on *every*
      // signaling state change (chat, mic toggles, etc.), not just peer-list
      // ones, so a big room re-scans this often; openSendPCsStaggered's own
      // pendingStaggeredPeers dedup is what keeps that from re-queuing a
      // peer that's already waiting on its first attempt.
      if (activeRef.current) {
        const readyPeerIds = signalingClient.state.peers
          .filter((peer) => !viewerPausedPeers.current.has(peer.id))
          .filter((peer) => !relayedAway.current.has(peer.id))
          .map((peer) => peer.id);
        openSendPCsStaggered(readyPeerIds);
      }
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
    return () => {
      stop();
      // Closing the pcs directly rather than through closeRecvPC means these
      // are not cleared along the way. They are harmless if they do fire (each
      // checks that its pc is still the current one, which it will not be), but
      // there is no reason to leave a room-change trailing timers that go on to
      // ask a room we have left for a reconnect.
      for (const timer of recoveryTimers.values()) clearTimeout(timer);
      recoveryTimers.clear();
      for (const pc of pcs.values()) pc.close();
      pcs.clear();
      setRemoteStreams({});
      setStoppedPeers(new Set());
      setResumingPeers(new Set());
      pausedPeers.clear();
    };
  }, [room, stop]);

  return {
    active,
    start,
    stop,
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
    getPeerCapacities,
    applyRelayPlan,
  };
}

// A start failure this code already worked out the reason for. Anything else
// falls back to the channel's generic message — see start()'s catch.
class ShareStartError extends Error {}

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
// picking the rear lens. Nothing chosen means "let the browser decide",
// which is the front-facing one.
function cameraSourceConstraints(deviceId: string | null): MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" };
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
  deviceId: string | null
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { ...video, ...cameraSourceConstraints(deviceId) },
    });
  } catch (err) {
    if (!deviceId || !isMissingDeviceError(err)) throw err;
    return navigator.mediaDevices.getUserMedia({
      video: { ...video, ...cameraSourceConstraints(null) },
    });
  }
}

// Most mobile browsers (all of iOS Safari, most of Android Chrome) don't
// support getDisplayMedia at all, so screen capture from a website simply
// isn't possible there. Falling back to the device camera lets mobile users
// still broadcast something instead of just hitting an unsupported error.
type ScreenShareMode = "display" | "camera" | "unsupported";

function getScreenShareMode(): ScreenShareMode {
  if (hasDisplayCapture()) return "display";
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
  // "Impedir conexões diretas": forces every peer connection this client
  // creates — sending or receiving, any channel — through the TURN relay
  // instead of negotiating a direct P2P path. Declared first because
  // useBroadcastChannel (screen/camera/mic below) needs it at construction
  // time. Deliberately unrelated to cascading (see topologyPlanner.ts): that
  // is about avoiding a stranger's browser as a middleman for someone
  // else's stream, this is about hiding your own IP from whoever you
  // connect to, middleman or not. Seeded from localStorage like the other
  // device-local preferences below.
  const [forceRelayIce, setForceRelayIceState] = useState(getStoredForceRelayIce);
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
  const [shareResolution, setShareResolutionState] = useState<ShareResolution>("1080p");
  const [shareFps, setShareFpsState] = useState<ShareFps>(30);
  const [shareBitrate, setShareBitrateState] = useState<ShareBitrate>("high");
  // On by default. It no longer means "step quality down as the headcount
  // rises" — that guessed cost from a number of people while knowing nothing
  // about how large anyone renders the video. It now means "let each viewer
  // be served at the tier their own tile actually needs". Turning it off
  // forces the picked tier on everyone, which is what someone streaming to a
  // handful of fullscreen viewers may genuinely want.
  const [smartQualityEnabled, setSmartQualityEnabledState] = useState(true);
  // What is being shared. This drives contentHint, degradationPreference and
  // codec ordering all at once, and getting it wrong is the difference
  // between crisp text and a 60fps game that stutters into a slideshow.
  const [shareProfile, setShareProfileState] = useState<DegradationMode>("text");
  const shareResolutionRef = useRef(shareResolution);
  const shareFpsRef = useRef(shareFps);
  const shareBitrateRef = useRef(shareBitrate);
  const smartQualityEnabledRef = useRef(smartQualityEnabled);
  const shareProfileRef = useRef(shareProfile);

  const setShareResolution = useCallback((value: ShareResolution) => {
    shareResolutionRef.current = value;
    setShareResolutionState(value);
    trackEvent(`screen_share_resolution_${value}`);
  }, []);
  const setShareFps = useCallback((value: ShareFps) => {
    shareFpsRef.current = value;
    setShareFpsState(value);
    trackEvent(`screen_share_fps_${value}`);
  }, []);
  const setShareBitrate = useCallback((value: ShareBitrate) => {
    shareBitrateRef.current = value;
    setShareBitrateState(value);
    trackEvent(`screen_share_bitrate_${value}`);
  }, []);
  const setSmartQualityEnabled = useCallback((value: boolean) => {
    smartQualityEnabledRef.current = value;
    setSmartQualityEnabledState(value);
    trackEvent(value ? "smart_quality_on" : "smart_quality_off");
  }, []);
  const setShareProfile = useCallback((value: DegradationMode) => {
    shareProfileRef.current = value;
    setShareProfileState(value);
    // 60fps only makes sense with the motion profile; picking "game" while
    // the encoder is told to protect resolution is exactly the combination
    // that produces a stuttering share, so nudge fps down with it.
    if (value === "text" && shareFpsRef.current > 30) {
      shareFpsRef.current = 30;
      setShareFpsState(30);
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

  const screen = useBroadcastChannel(
    "screen",
    room,
    async (source) => {
      // Capture at the full picked resolution regardless of room size. The
      // per-viewer tiers downscale each *sender* independently (see
      // peerQualityController), so capturing small would only put a hard
      // ceiling on the one or two people actually watching fullscreen while
      // saving nothing for the many watching in a grid.
      const dims = RESOLUTION_DIMENSIONS[shareResolutionRef.current];
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: dims.width },
        height: { ideal: dims.height },
        frameRate: { ideal: shareFpsRef.current },
      };
      if (source === "camera") {
        return captureCamera(videoConstraints, cameraDeviceIdRef.current);
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
          video: videoConstraints,
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
          if (err instanceof DOMException && err.name === "NotReadableError") {
            return navigator.mediaDevices.getDisplayMedia({
              video: videoConstraints,
              audio: false,
            });
          }
          if (activationLost && isActivationRefusal(err)) {
            throw new ShareStartError(
              "A preparação do áudio do sistema demorou demais. Clique em compartilhar de novo."
            );
          }
          throw err;
        });

      if (!excluded) return capture;

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
      return stream;
    },
    () => hasDisplayCapture() || hasCameraCapture(),
    "Seu navegador não suporta compartilhamento de tela nem câmera.",
    "Não foi possível iniciar o compartilhamento. Verifique as permissões do navegador.",
    forceRelayIce,
    autoJoin,
    screenQualityPreset
  );

  const camera = useBroadcastChannel(
    "camera",
    room,
    () => {
      // Capture at the full picked resolution regardless of room size. The
      // per-viewer tiers downscale each *sender* independently (see
      // peerQualityController), so capturing small would only put a hard
      // ceiling on the one or two people actually watching fullscreen while
      // saving nothing for the many watching in a grid.
      const dims = RESOLUTION_DIMENSIONS[shareResolutionRef.current];
      return captureCamera(
        {
          width: { ideal: dims.width },
          height: { ideal: dims.height },
          frameRate: { ideal: shareFpsRef.current },
        },
        cameraDeviceIdRef.current
      );
    },
    () => hasCameraCapture(),
    "Seu navegador não suporta câmera.",
    "Não foi possível iniciar a câmera. Verifique as permissões do navegador.",
    forceRelayIce,
    autoJoin,
    cameraQualityPreset
  );

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
  // Switches which camera is captured. A live camera share is restarted
  // (stop, then start) so the new device actually goes out — the same brief
  // drop the mic picker accepts below, which beats silently continuing to
  // broadcast the old one. The screen channel is restarted too, but only
  // when it is itself running off the camera (the mobile fallback);
  // switching cameras must not interrupt an actual screen share.
  const setCameraDevice = useCallback(
    (deviceId: string | null) => {
      cameraDeviceIdRef.current = deviceId;
      setCameraDeviceIdState(deviceId);
      setStoredCameraDeviceId(deviceId);
      if (camera.active) {
        camera.stop();
        camera.start();
      }
      if (screen.active && screen.source === "camera") {
        screen.stop();
        screen.start("camera");
      }
    },
    [camera, screen]
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
      screen: screen.active,
      camera: camera.active,
      files: JSON.parse(announcedFilesKey) as typeof announcedFiles,
    });
  }, [screen.active, camera.active, announcedFilesKey]);

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
  const sharingAnything = screen.active || camera.active || anyFileActive;

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
  const getScreenTiers = screen.getRequestedTiers;
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
    screenActive,
    cameraActive,
    fileActive,
  ]);

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
  useEffect(() => {
    if (!RELAY_ENABLED) return;
    const assignments = new Map<string, RelayChild[]>();
    const selfId = signalingClient.state.selfId;
    for (const edge of topology.plan?.edges ?? []) {
      if (edge.depth <= 1 || edge.from === selfId) continue;
      const list = assignments.get(edge.from) ?? [];
      list.push({ id: edge.to, tier: edge.tier });
      assignments.set(edge.from, list);
    }
    applyRelayPlan(assignments);
  }, [topology.plan, applyRelayPlan]);

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
        micDeviceIdRef.current
      );
      micGraphRef.current = graph;
      setNoiseSuppressionAvailable(graph !== null);
      return stream;
    },
    () => Boolean(navigator.mediaDevices?.getUserMedia),
    "Seu navegador não suporta microfone.",
    "Não foi possível ativar o microfone. Verifique a permissão do navegador.",
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
    // The local-file slots (see useLocalFileChannel). A record rather than a
    // flat set of fields, because there are three of them and every consumer
    // wants to walk them.
    fileChannels,
    // Each slot's playback state, for the tile that renders its transport.
    localMediaSnapshots: mediaSnapshots,
    anyFileActive,
    isCameraSharing: camera.active,
    startCameraShare: camera.start,
    stopCameraShare: camera.stop,
    localCameraStream: camera.localStream,
    remoteCameraStreams: camera.remoteStreams,
    cameraShareError: camera.error,
    cameraDeviceId,
    setCameraDevice,
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
    shareProfile,
    setShareProfile,
    // Live telemetry, for the share panel: measured uplink, measured content
    // cost, and whether the room currently needs anyone to relay.
    meshCapacity: capacity,
    meshTopology: topology,

    forceRelayIce,
    toggleForceRelayIce,
    autoJoin,
    toggleAutoJoin,

    isMicOn: mic.active,
    toggleMic,
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
    speakerDeviceId,
    setSpeakerDevice,

    noiseSuppressionOn,
    // Only meaningful once the mic has actually started — before that it's
    // just the pending preference for the next start.
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
  };
}
