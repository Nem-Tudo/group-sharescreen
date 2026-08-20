"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { signalingClient } from "./signalingClient";
import { trackEvent } from "./analytics";
import { ICE_CONFIG } from "./iceConfig";
import { captureNoiseSuppressedMic, setGraphSuppressionEnabled, type MicNoiseGraph } from "./rnnoise";
import {
  getStoredMicOn,
  getStoredNoiseSuppressionOn,
  setStoredMicOn,
  setStoredNoiseSuppressionOn,
} from "./mediaPreferences";

type Channel = "screen" | "camera" | "mic";
type ShareSource = "display" | "camera";

type SignalData = {
  channel?: Channel;
  role?: "broadcaster" | "viewer";
  kind?: "offer" | "answer" | "ice" | "stop" | "resume" | "peer-left";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

// Mesh P2P means whoever shares their screen uploads one full encode per
// viewer (see AGENTS.md-adjacent discussion in useRoomMedia's callers) — in
// a big room that upload is often the actual bottleneck, so letting the
// broadcaster trade resolution/fps/bitrate down independently is the one
// lever that helps without a server-side media relay.
export type ShareResolution = "1080p" | "720p" | "480p" | "360p";
export type ShareFps = 15 | 24 | 30 | 60;
export type ShareBitrate = "low" | "medium" | "high";

type QualityPreset = {
  width: number;
  height: number;
  frameRate: number;
  maxBitrateKbps: number;
};

const RESOLUTION_DIMENSIONS: Record<ShareResolution, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "720p": { width: 1280, height: 720 },
  "480p": { width: 854, height: 480 },
  "360p": { width: 640, height: 360 },
};

const BITRATE_KBPS: Record<ShareBitrate, number> = {
  low: 700,
  medium: 2000,
  high: 4000,
};

// Mesh upload cost grows with every extra viewer, so past a few people in
// the room the sender's bitrate is throttled down automatically instead of
// letting the browser keep trying to push the full preset to everyone.
// Presets that are already conservative have little slack to give up, so
// they hold out longer before cutting anything; "high" has the most room to
// spare and starts giving it up first.
const THROTTLE_START_PEERS: Record<ShareBitrate, number> = {
  low: 6,
  medium: 4,
  high: 3,
};
// kbps shed per peer beyond the start threshold.
const THROTTLE_STEP_KBPS: Record<ShareBitrate, number> = {
  low: 40,
  medium: 120,
  high: 250,
};
// Never throttled below this, no matter how crowded the room gets.
const THROTTLE_FLOOR_KBPS: Record<ShareBitrate, number> = {
  low: 350,
  medium: 800,
  high: 1200,
};

function throttledBitrateKbps(preset: ShareBitrate, peerCount: number): number {
  const base = BITRATE_KBPS[preset];
  const startAt = THROTTLE_START_PEERS[preset];
  if (peerCount <= startAt) return base;
  const excessPeers = peerCount - startAt;
  const reduced = base - excessPeers * THROTTLE_STEP_KBPS[preset];
  return Math.max(THROTTLE_FLOOR_KBPS[preset], reduced);
}

const RESOLUTION_ORDER: ShareResolution[] = ["1080p", "720p", "480p", "360p"];

// Same idea as the bitrate throttle, one tier at a time: each peer-count
// threshold in the list drops resolution one more step. A preset that's
// already low starts from a shorter (or empty) list, so it takes more
// people in the room before it has anything left to give up.
const RESOLUTION_STEP_DOWN_PEERS: Record<ShareResolution, number[]> = {
  "1080p": [3, 10, 14],
  "720p": [6, 12],
  "480p": [8],
  "360p": [],
};

function throttledResolution(preset: ShareResolution, peerCount: number): ShareResolution {
  const stepsDown = RESOLUTION_STEP_DOWN_PEERS[preset].filter((threshold) => peerCount >= threshold).length;
  const targetIndex = Math.min(RESOLUTION_ORDER.indexOf(preset) + stepsDown, RESOLUTION_ORDER.length - 1);
  return RESOLUTION_ORDER[targetIndex];
}

function getPeerCount() {
  return signalingClient.state.peers.length;
}
function getPeerCountServer() {
  return 0;
}

export const SHARE_RESOLUTION_OPTIONS: { value: ShareResolution; label: string }[] = [
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
];

export const SHARE_FPS_OPTIONS: { value: ShareFps; label: string }[] = [
  { value: 15, label: "15 fps" },
  { value: 24, label: "24 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
];

export const SHARE_BITRATE_OPTIONS: { value: ShareBitrate; label: string }[] = [
  { value: "low", label: "Bitrate baixo (~700 kbps)" },
  { value: "medium", label: "Bitrate médio (~2 Mbps)" },
  { value: "high", label: "Bitrate alto (~4 Mbps)" },
];

export type ShareAudioMode = "tab" | "system" | "muted";

export const SHARE_AUDIO_MODE_OPTIONS: { value: ShareAudioMode; label: string; description: string }[] = [
  {
    value: "tab",
    label: "Aba / Janela (Sem eco)",
    description: "Transmite o som apenas da aba ou janela selecionada, evitando eco das vozes de quem estiver falando na sala.",
  },
  {
    value: "system",
    label: "Áudio do sistema inteiro",
    description: "Transmite todo o áudio do computador. Pode capturar as vozes dos participantes da sala se não estiver usando fone.",
  },
  {
    value: "muted",
    label: "Sem áudio",
    description: "Transmite apenas o vídeo da tela sem capturar nenhum som.",
  },
];

// Updated sender helper: also controls resolution scale-down and degradation mode.
// For screen sharing, "maintain-resolution" keeps text and UI crisp by preferring
// frame-rate drops over blurry pixels when the encoder is under pressure.
function applySenderBitrateAndScale(
  sender: RTCRtpSender,
  maxBitrateKbps: number | undefined,
  scaleResolutionDownBy: number = 1.0
) {
  if (!maxBitrateKbps) return;
  const params = sender.getParameters();
  const encodings = params.encodings && params.encodings.length > 0 ? params.encodings : [{}];
  encodings[0].maxBitrate = Math.round(maxBitrateKbps * 1000);
  encodings[0].scaleResolutionDownBy = scaleResolutionDownBy;
  // Prefer dropping frame rate over blurring resolution when bandwidth is tight.
  // This keeps screen-share text readable even during congestion.
  params.degradationPreference = "maintain-resolution";
  params.encodings = encodings;
  sender.setParameters(params).catch(() => {});
}

// Prefer VP9 > AV1 > H264 > VP8 for ~30–50% bandwidth savings over VP8 at
// equivalent quality. Falls back gracefully on browsers that don't support
// setCodecPreferences or that lack a given codec entirely.
function applyVideoCodecPreferences(transceiver: RTCRtpTransceiver) {
  if (typeof RTCRtpSender.getCapabilities !== "function") return;
  const capabilities = RTCRtpSender.getCapabilities("video");
  if (!capabilities?.codecs) return;
  const order = ["video/VP9", "video/AV1", "video/H264", "video/VP8"];
  const sorted = [...capabilities.codecs].sort((a, b) => {
    const ia = order.indexOf(a.mimeType);
    const ib = order.indexOf(b.mimeType);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  try {
    transceiver.setCodecPreferences(sorted);
  } catch {
    // Ignored — some older browser versions reject the call entirely.
  }
}

// Stats-driven adaptive bitrate controller for a single sender. Polls
// `remote-inbound-rtp` every 2 s and backs the bitrate off when the peer
// reports congestion (high packet-loss or RTT), then gradually recovers once
// the link is healthy again. Operates per peer-connection so a single slow
// viewer doesn't degrade everyone else's stream.
//
// Returns a cleanup function; call it when the peer connection closes.
function startPeerAdaptiveBitrateMonitor(
  pc: RTCPeerConnection,
  sender: RTCRtpSender,
  baseBitrateKbps: number
): () => void {
  // Per-peer mutable state — deliberately not React state so updates are
  // synchronous inside the interval without triggering re-renders.
  let currentKbps = baseBitrateKbps;
  let scaleDown = 1.0;
  let healthyStreak = 0;

  const id = setInterval(async () => {
    // Don't poke a dead connection — both guards needed because some browsers
    // leave `connectionState` at "disconnected" rather than "failed"/"closed".
    if (pc.connectionState !== "connected") return;
    if (sender.track === null) return;

    let fractionLost = 0;
    let rtt = 0;
    try {
      const stats = await pc.getStats(sender.track);
      stats.forEach((report) => {
        if (report.type === "remote-inbound-rtp" && report.kind === "video") {
          const remoteReport = report as { fractionLost?: number; roundTripTime?: number };
          fractionLost = remoteReport.fractionLost ?? 0;
          rtt = remoteReport.roundTripTime ?? 0;
        }
      });
    } catch {
      return; // getStats can throw if the pc is in a transitional state.
    }

    if (fractionLost > 0.04 || rtt > 0.35) {
      // Congestion detected — back off 25 %, floor at 250 kbps.
      healthyStreak = 0;
      currentKbps = Math.max(250, Math.round(currentKbps * 0.75));
      // If bitrate is already very constrained, also downscale resolution to
      // give the encoder headroom — half-res at low bitrate beats full-res
      // encoded badly (macro-blocking, freezes).
      scaleDown = currentKbps < 500 ? 2.0 : currentKbps < 900 ? 1.5 : 1.0;
      applySenderBitrateAndScale(sender, currentKbps, scaleDown);
    } else if (fractionLost <= 0.01 && rtt < 0.2) {
      // Link is healthy — cautiously ramp back up (15 % per clean streak of 3).
      healthyStreak++;
      if (healthyStreak >= 3 && currentKbps < baseBitrateKbps) {
        currentKbps = Math.min(baseBitrateKbps, Math.round(currentKbps * 1.15));
        scaleDown = currentKbps >= baseBitrateKbps * 0.8 ? 1.0 : 1.25;
        applySenderBitrateAndScale(sender, currentKbps, scaleDown);
        healthyStreak = 0;
      }
    } else {
      // Neutral zone — reset streak so recovery only happens after a clean run.
      healthyStreak = 0;
    }
  }, 2000);

  return () => clearInterval(id);
}

// Shared connection-management for a single media channel (screen share or
// mic), broadcast from this client to every peer in the room. Each channel
// gets its own set of peer connections and its own signaling namespace so
// screen-share and mic negotiation never interfere with each other.
function useBroadcastChannel(
  channel: Channel,
  room: string,
  capture: (source?: ShareSource) => Promise<MediaStream>,
  isSupported: () => boolean,
  notSupportedMessage: string,
  failureMessage: string,
  // Only meaningful for the screen channel — mic never passes this. When it
  // changes while a share is already active, the live track and every
  // current sender get updated in place instead of requiring a restart.
  videoQuality?: QualityPreset
) {
  const eventPrefix = channel === "mic" ? "mic" : `${channel}_share`;
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
  // Cleanup functions for per-peer adaptive bitrate monitors (see
  // startPeerAdaptiveBitrateMonitor). Keyed by peerId; called when the sendPC
  // for that peer closes so the setInterval is always torn down with the PC.
  const sendPCMonitors = useRef<Map<string, () => void>>(new Map());


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
  const videoQualityRef = useRef(videoQuality);
  useEffect(() => {
    videoQualityRef.current = videoQuality;
  }, [videoQuality]);

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
    // Stop the per-peer adaptive bitrate monitor if one is running.
    sendPCMonitors.current.get(peerId)?.();
    sendPCMonitors.current.delete(peerId);
    pendingSendCandidates.current.delete(peerId);
  }, []);


  const closeRecvPC = useCallback(
    (peerId: string) => {
      const pc = recvPCs.current.get(peerId);
      if (pc) {
        pc.close();
        recvPCs.current.delete(peerId);
      }
      pendingRecvCandidates.current.delete(peerId);
      removeRemoteStream(peerId);
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
    },
    [closeRecvPC, clearStopped, clearResuming]
  );

  // Lets a viewer stop receiving one specific peer's stream without touching
  // anyone else's — closes our recvPC for it (freeing decode/network
  // resources on our end) and tells that peer to close their matching sendPC
  // (freeing their upload resources too), instead of just hiding the tile
  // locally while the connection keeps running in the background.
  const stopWatchingPeer = useCallback(
    (peerId: string) => {
      closeRecvPC(peerId);
      signalingClient.sendSignal(peerId, { channel, role: "viewer", kind: "stop" });
      setStoppedPeers((prev) => {
        if (prev.has(peerId)) return prev;
        const next = new Set(prev);
        next.add(peerId);
        return next;
      });
    },
    [channel, closeRecvPC]
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
    setTimeout(() => {
      if (activeRef.current && signalingClient.state.peers.some((p) => p.id === peerId)) {
        openSendPCRef.current(peerId);
      }
    }, 2000);
  }, []);

  const openSendPC = useCallback(
    (peerId: string) => {
      if (sendPCs.current.has(peerId) || !localStreamRef.current) return;
      const stream = localStreamRef.current;
      const pc = new RTCPeerConnection(ICE_CONFIG);
      sendPCs.current.set(peerId, pc);
      stream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, stream);
        if (track.kind === "video") {
          const transceivers = pc.getTransceivers();
          const transceiver = transceivers.find((t) => t.sender === sender);
          if (transceiver) applyVideoCodecPreferences(transceiver);

          const baseBitrate = videoQualityRef.current?.maxBitrateKbps;
          applySenderBitrateAndScale(sender, baseBitrate, 1.0);

          if (baseBitrate) {
            sendPCMonitors.current.get(peerId)?.();
            const cleanup = startPeerAdaptiveBitrateMonitor(pc, sender, baseBitrate);
            sendPCMonitors.current.set(peerId, cleanup);
          }
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
      pc.onconnectionstatechange = () => {
        // Ignore events from a pc that's already been superseded (e.g. a
        // retry already replaced it) — otherwise this stale callback could
        // tear down the new connection instead of the dead one.
        if (sendPCs.current.get(peerId) !== pc) return;
        if (pc.connectionState === "failed") {
          closeSendPC(peerId);
          scheduleSendRetry(peerId);
        } else if (pc.connectionState === "disconnected") {
          // Some browsers (notably mobile Safari) can sit in "disconnected"
          // for a long time instead of ever declaring "failed", even though
          // the link is actually dead — which left the tile frozen
          // indefinitely instead of retrying. Give it a few seconds to
          // recover on its own from a brief blip first.
          setTimeout(() => {
            if (sendPCs.current.get(peerId) === pc && pc.connectionState === "disconnected") {
              closeSendPC(peerId);
              scheduleSendRetry(peerId);
            }
          }, 4000);
        } else if (pc.connectionState === "closed") {
          closeSendPC(peerId);
        }
      };
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
    [channel, closeSendPC, scheduleSendRetry]
  );

  useEffect(() => {
    openSendPCRef.current = openSendPC;
  }, [openSendPC]);

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
    for (const [peerId, pc] of sendPCs.current) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        applySenderBitrateAndScale(sender, videoQuality.maxBitrateKbps, 1.0);
        if (videoQuality.maxBitrateKbps) {
          sendPCMonitors.current.get(peerId)?.();
          const cleanup = startPeerAdaptiveBitrateMonitor(pc, sender, videoQuality.maxBitrateKbps);
          sendPCMonitors.current.set(peerId, cleanup);
        }
      }
    }
  }, [videoQuality]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSource(undefined);
    for (const cleanup of sendPCMonitors.current.values()) cleanup();
    sendPCMonitors.current.clear();
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
    if (channel === "screen") signalingClient.setSharing(false);
    else signalingClient.setMic(false);
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
      // Give the browser encoder a hint: screen shares prioritize sharp detail
      // (text/UI readability), camera shares prioritize smooth motion.
      stream.getVideoTracks().forEach((track) => {
        track.contentHint = channel === "screen" ? "detail" : "motion";
      });
      localStreamRef.current = stream;
      activeRef.current = true;
      setLocalStream(stream);
      setActive(true);
      setSource(requestedSource);
      if (channel === "mic") signalingClient.setMic(true);
      else signalingClient.setSharing(true);
      trackEvent(`${eventPrefix}_start`);
      stream.getTracks().forEach((track) => track.addEventListener("ended", () => stop()));
      for (const peer of signalingClient.state.peers) {
        openSendPC(peer.id);
      }
    } catch {
      setError(failureMessage);
      trackEvent(`${eventPrefix}_error`);
    }
  }, [
    capture,
    isSupported,
    notSupportedMessage,
    failureMessage,
    channel,
    eventPrefix,
    openSendPC,
    stop,
  ]);

  const openRecvPC = useCallback(
    (peerId: string) => {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      recvPCs.current.set(peerId, pc);
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
        setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
        clearResuming(peerId);
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
      pc.onconnectionstatechange = () => {
        if (recvPCs.current.get(peerId) !== pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeRecvPC(peerId);
        } else if (pc.connectionState === "disconnected") {
          // Mirrors the sender-side grace period: don't tear down a viewer's
          // tile over a brief blip, but don't let it sit frozen forever
          // either if the link doesn't recover. The broadcaster's own
          // sendPC (see openSendPC above) mirrors this same link, so once
          // its side also gives up it sends a fresh offer that rebuilds
          // this from scratch.
          setTimeout(() => {
            if (recvPCs.current.get(peerId) === pc && pc.connectionState === "disconnected") {
              closeRecvPC(peerId);
            }
          }, 4000);
        }
      };
      return pc;
    },
    [channel, closeRecvPC, clearResuming]
  );

  useEffect(() => {
    const unsubscribeSignal = signalingClient.onSignal((from, rawData) => {
      const data = rawData as SignalData;
      if (data.kind === "peer-left") {
        closeSendPC(from);
        closeRecvPCFully(from);
        viewerPausedPeers.current.delete(from);
        return;
      }
      if (data.channel !== channel) return;
      if (data.role === "broadcaster") {
        if (data.kind === "offer" && data.sdp) {
          // A fresh offer always comes from a brand-new RTCPeerConnection on
          // the sender's side (this app never renegotiates an existing one
          // in place, including on the failure-triggered retry above) — if
          // we still have a pc for this peer, it belongs to a superseded
          // session. Reusing it here would feed unrelated SDP into it
          // instead of cleanly replacing the connection, which can leave
          // two live tracks feeding the same rendered stream (duplicated,
          // echoing audio) rather than one.
          if (recvPCs.current.has(from)) closeRecvPC(from);
          const thisPc = openRecvPC(from);
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
          // The broadcaster stopped sharing entirely — nothing to "come
          // back" to, so this fully clears the tile rather than leaving a
          // stopped-by-us placeholder behind.
          closeRecvPCFully(from);
        }
      } else if (data.role === "viewer") {
        if (data.kind === "stop") {
          // This peer (as a viewer of OUR stream) asked us to stop sending —
          // free the upload-side connection and remember not to reopen it on
          // our own until they explicitly ask to resume.
          viewerPausedPeers.current.add(from);
          closeSendPC(from);
        } else if (data.kind === "resume") {
          viewerPausedPeers.current.delete(from);
          if (activeRef.current) openSendPC(from);
        } else if (data.kind === "answer" && data.sdp) {
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
      if (activeRef.current) {
        for (const peer of signalingClient.state.peers) {
          if (!sendPCs.current.has(peer.id) && !viewerPausedPeers.current.has(peer.id)) {
            openSendPC(peer.id);
          }
        }
      }
    });

    const unsubscribeRoomJoined = signalingClient.onRoomJoined(() => {
      // Our own signaling socket reconnecting replaces the whole peer list
      // at once instead of emitting individual peer-left events — so if
      // someone actually left the room while we were briefly disconnected,
      // nothing else would ever tell us. Without this, their connection and
      // video/audio tile would linger as a permanent ghost. Stable
      // client ids (see signalingClient) mean everyone who's still around
      // keeps the same id, so this only prunes genuinely departed peers.
      const currentIds = new Set(signalingClient.state.peers.map((p) => p.id));
      for (const peerId of [...sendPCs.current.keys()]) {
        if (!currentIds.has(peerId)) closeSendPC(peerId);
      }
      for (const peerId of [...recvPCs.current.keys()]) {
        if (!currentIds.has(peerId)) closeRecvPCFully(peerId);
      }
      for (const peerId of [...stoppedPeersRef.current]) {
        if (!currentIds.has(peerId)) clearStopped(peerId);
      }
      for (const peerId of [...resumingPeersRef.current]) {
        if (!currentIds.has(peerId)) clearResuming(peerId);
      }
      for (const peerId of [...viewerPausedPeers.current]) {
        if (!currentIds.has(peerId)) viewerPausedPeers.current.delete(peerId);
      }

      // The server has a fresh entry with sharing/mic reset to false —
      // re-announce our actual state so other peers' indicators don't go
      // stale.
      if (!activeRef.current) return;
      if (channel === "mic") signalingClient.setMic(true);
      else signalingClient.setSharing(true);
    });

    return () => {
      unsubscribeSignal();
      unsubscribeState();
      unsubscribeRoomJoined();
    };
  }, [
    channel,
    openRecvPC,
    openSendPC,
    closeSendPC,
    closeRecvPC,
    closeRecvPCFully,
    clearStopped,
    clearResuming,
  ]);

  useEffect(() => {
    const pcs = recvPCs.current;
    const pausedPeers = viewerPausedPeers.current;
    return () => {
      stop();
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
    stopWatchingPeer,
    resumeWatchingPeer,
  };
}

function hasDisplayCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);
}
function hasCameraCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
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
  // Each of the three dials is independent so the person can e.g. keep
  // 720p but drop bitrate, or keep quality but drop fps. Refs mirror the
  // state (same pattern as noiseSuppressionOnRef below) because capture()
  // only runs once per share start and would otherwise close over a stale
  // value from whatever render happened to create it.
  const [shareResolution, setShareResolutionState] = useState<ShareResolution>("1080p");
  const [shareFps, setShareFpsState] = useState<ShareFps>(30);
  const [shareBitrate, setShareBitrateState] = useState<ShareBitrate>("medium");
  const [shareAudioMode, setShareAudioModeState] = useState<ShareAudioMode>("tab");
  // On by default: automatically steps resolution/bitrate down as the room
  // fills up (see throttledResolution/throttledBitrateKbps). Turning it off
  // makes the three dials above absolute again, exactly as picked.
  const [smartQualityEnabled, setSmartQualityEnabledState] = useState(true);
  const shareResolutionRef = useRef(shareResolution);
  const shareFpsRef = useRef(shareFps);
  const shareBitrateRef = useRef(shareBitrate);
  const shareAudioModeRef = useRef(shareAudioMode);
  const smartQualityEnabledRef = useRef(smartQualityEnabled);

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
  const setShareAudioMode = useCallback((value: ShareAudioMode) => {
    shareAudioModeRef.current = value;
    setShareAudioModeState(value);
    trackEvent(`screen_share_audio_${value}`);
  }, []);
  const setSmartQualityEnabled = useCallback((value: boolean) => {
    smartQualityEnabledRef.current = value;
    setSmartQualityEnabledState(value);
    trackEvent(value ? "smart_quality_on" : "smart_quality_off");
  }, []);

  // Other peers in the room (mesh upload targets) — drives the automatic
  // resolution/bitrate throttle below, and needs to be reactive so it kicks
  // in/out as people join or leave mid-share, not just when the dials
  // change. Mirrored into a ref for the same reason as the dials above:
  // capture() below only runs once per share start.
  const peerCount = useSyncExternalStore(signalingClient.subscribe, getPeerCount, getPeerCountServer);
  const peerCountRef = useRef(peerCount);
  useEffect(() => {
    peerCountRef.current = peerCount;
  }, [peerCount]);

  // Recomputed when one of the dials, the smart-quality toggle, or the
  // room's peer count changes, so this stays a stable reference for
  // useBroadcastChannel's live-reapply effect in between.
  const screenQualityPreset = useMemo<QualityPreset>(() => {
    const effectiveResolution = smartQualityEnabled
      ? throttledResolution(shareResolution, peerCount)
      : shareResolution;
    const dims = RESOLUTION_DIMENSIONS[effectiveResolution];
    return {
      width: dims.width,
      height: dims.height,
      frameRate: shareFps,
      maxBitrateKbps: smartQualityEnabled
        ? throttledBitrateKbps(shareBitrate, peerCount)
        : BITRATE_KBPS[shareBitrate],
    };
  }, [shareResolution, shareFps, shareBitrate, smartQualityEnabled, peerCount]);

  const screen = useBroadcastChannel(
    "screen",
    room,
    (source) => {
      const effectiveResolution = smartQualityEnabledRef.current
        ? throttledResolution(shareResolutionRef.current, peerCountRef.current)
        : shareResolutionRef.current;
      const dims = RESOLUTION_DIMENSIONS[effectiveResolution];
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: dims.width },
        height: { ideal: dims.height },
        frameRate: { ideal: shareFpsRef.current },
      };
      if (source === "camera") {
        return navigator.mediaDevices.getUserMedia({
          video: { ...videoConstraints, facingMode: "user" },
        });
      }

      const audioMode = shareAudioModeRef.current;
      let audioConstraints: boolean | MediaTrackConstraints = false;
      const extraDisplayMediaOptions: Record<string, unknown> = {};

      if (audioMode === "tab") {
        audioConstraints = {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        };
        // Excludes the active call tab and nudges browser to share tab/isolated audio rather than system loopback
        extraDisplayMediaOptions.selfBrowserSurface = "exclude";
        extraDisplayMediaOptions.systemAudio = "exclude";
        extraDisplayMediaOptions.surfaceSwitching = "include";
      } else if (audioMode === "system") {
        audioConstraints = {
          echoCancellation: true,
        };
        extraDisplayMediaOptions.systemAudio = "include";
      } else {
        audioConstraints = false;
      }

      // No fallback to the camera here — on browsers without getDisplayMedia
      // (most mobile ones) this throws synchronously, which start() below
      // turns into a visible error instead of silently switching sources.
      return navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: audioConstraints,
        ...extraDisplayMediaOptions,
      });
    },
    () => hasDisplayCapture() || hasCameraCapture(),
    "Seu navegador não suporta compartilhamento de tela nem câmera.",
    "Não foi possível iniciar o compartilhamento. Verifique as permissões do navegador.",
    screenQualityPreset
  );

  const camera = useBroadcastChannel(
    "camera",
    room,
    () => {
      const effectiveResolution = smartQualityEnabledRef.current
        ? throttledResolution(shareResolutionRef.current, peerCountRef.current)
        : shareResolutionRef.current;
      const dims = RESOLUTION_DIMENSIONS[effectiveResolution];
      return navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: dims.width },
          height: { ideal: dims.height },
          frameRate: { ideal: shareFpsRef.current },
          facingMode: "user",
        },
      });
    },
    () => hasCameraCapture(),
    "Seu navegador não suporta câmera.",
    "Não foi possível iniciar a câmera. Verifique as permissões do navegador.",
    screenQualityPreset
  );

  useEffect(() => {
    signalingClient.setSharing(screen.active || camera.active);
  }, [screen.active, camera.active]);

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
  const [noiseSuppressionAvailable, setNoiseSuppressionAvailable] = useState(true);

  const mic = useBroadcastChannel(
    "mic",
    room,
    async () => {
      const { stream, graph } = await captureNoiseSuppressedMic(noiseSuppressionOnRef.current, () => {
        micGraphRef.current = null;
      });
      micGraphRef.current = graph;
      setNoiseSuppressionAvailable(graph !== null);
      return stream;
    },
    () => Boolean(navigator.mediaDevices?.getUserMedia),
    "Seu navegador não suporta microfone.",
    "Não foi possível ativar o microfone. Verifique a permissão do navegador."
  );

  const toggleMic = useCallback(() => {
    const next = !mic.active;
    setStoredMicOn(next);
    if (mic.active) mic.stop();
    else mic.start();
  }, [mic]);

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
    isCameraSharing: camera.active,
    startCameraShare: camera.start,
    stopCameraShare: camera.stop,
    localCameraStream: camera.localStream,
    remoteCameraStreams: camera.remoteStreams,
    cameraShareError: camera.error,
    stoppedPeers: screen.stoppedPeers,
    resumingPeers: screen.resumingPeers,
    stopWatchingPeer: screen.stopWatchingPeer,
    resumeWatchingPeer: screen.resumeWatchingPeer,
    shareResolution,
    setShareResolution,
    shareFps,
    setShareFps,
    shareBitrate,
    setShareBitrate,
    shareAudioMode,
    setShareAudioMode,
    smartQualityEnabled,
    setSmartQualityEnabled,

    isMicOn: mic.active,
    toggleMic,
    micError: mic.error,
    localMicStream: mic.localStream,
    remoteMicStreams: mic.remoteStreams,

    noiseSuppressionOn,
    // Only meaningful once the mic has actually started — before that it's
    // just the pending preference for the next start.
    noiseSuppressionAvailable,
    toggleNoiseSuppression,
  };
}
