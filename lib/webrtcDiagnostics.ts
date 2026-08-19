"use client";

import { useSyncExternalStore } from "react";

export type WebRtcChannel = "screen" | "camera" | "mic";
export type WebRtcDirection = "send" | "receive";

type TrackSnapshot = {
  kind: string;
  label?: string;
  enabled: boolean;
  readyState: MediaStreamTrackState;
};

export type CandidatePairSnapshot = {
  localType?: string;
  remoteType?: string;
  protocol?: string;
  relayUsed: boolean;
};

export type WebRtcDiagnostic = {
  key: string;
  peerId: string;
  channel: WebRtcChannel;
  direction: WebRtcDirection;
  updatedAt: number;
  offerSent: boolean;
  offerReceived: boolean;
  answerSent: boolean;
  answerReceived: boolean;
  signalingState?: RTCSignalingState;
  iceGatheringState?: RTCIceGatheringState;
  iceConnectionState?: RTCIceConnectionState;
  connectionState?: RTCPeerConnectionState;
  localDescriptionType?: RTCSdpType;
  remoteDescriptionType?: RTCSdpType;
  localTracks: TrackSnapshot[];
  senders: TrackSnapshot[];
  receivers: TrackSnapshot[];
  remoteStreamReceived: boolean;
  candidatePair?: CandidatePairSnapshot;
  lastError?: string;
  events: { at: number; message: string }[];
};

const enabled = process.env.NODE_ENV === "development";
const listeners = new Set<() => void>();
let snapshot: WebRtcDiagnostic[] = [];

function keyOf(channel: WebRtcChannel, direction: WebRtcDirection, peerId: string) {
  return `${channel}:${direction}:${peerId}`;
}

function trackSnapshot(track: MediaStreamTrack | null): TrackSnapshot | null {
  if (!track) return null;
  return {
    kind: track.kind,
    label: track.label || undefined,
    enabled: track.enabled,
    readyState: track.readyState,
  };
}

function emit() {
  listeners.forEach((listener) => listener());
}

function upsert(
  channel: WebRtcChannel,
  direction: WebRtcDirection,
  peerId: string,
  patch: Partial<WebRtcDiagnostic>,
  event?: string
) {
  if (!enabled) return;
  const key = keyOf(channel, direction, peerId);
  const previous = snapshot.find((item) => item.key === key);
  const now = Date.now();
  const base: WebRtcDiagnostic = previous ?? {
    key,
    peerId,
    channel,
    direction,
    updatedAt: now,
    offerSent: false,
    offerReceived: false,
    answerSent: false,
    answerReceived: false,
    localTracks: [],
    senders: [],
    receivers: [],
    remoteStreamReceived: false,
    events: [],
  };
  const next = {
    ...base,
    ...patch,
    updatedAt: now,
    events: event ? [...base.events, { at: now, message: event }].slice(-30) : base.events,
  };
  snapshot = previous
    ? snapshot.map((item) => (item.key === key ? next : item))
    : [...snapshot, next];
  emit();
}

function errorText(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function recordWebRtcEvent(
  channel: WebRtcChannel,
  direction: WebRtcDirection,
  peerId: string,
  message: string,
  patch: Partial<WebRtcDiagnostic> = {}
) {
  if (!enabled) return;
  console.info(`[WebRTC][${channel}][${direction}][${peerId}] ${message}`);
  upsert(channel, direction, peerId, patch, message);
}

export function recordWebRtcError(
  channel: WebRtcChannel,
  direction: WebRtcDirection,
  peerId: string,
  operation: string,
  error: unknown
) {
  if (!enabled) return;
  const detail = errorText(error);
  console.error(`[WebRTC][${channel}][${direction}][${peerId}] ${operation}: ${detail}`);
  upsert(channel, direction, peerId, { lastError: `${operation}: ${detail}` }, `${operation} falhou`);
}

export function summarizeIceCandidate(candidate: RTCIceCandidateInit) {
  try {
    const parsed = new RTCIceCandidate(candidate);
    return [parsed.type, parsed.protocol, parsed.foundation && `foundation ${parsed.foundation}`]
      .filter(Boolean)
      .join(" / ");
  } catch {
    return "candidato ICE";
  }
}

export function attachPeerConnectionDiagnostics(
  pc: RTCPeerConnection,
  channel: WebRtcChannel,
  direction: WebRtcDirection,
  peerId: string,
  localStream?: MediaStream
) {
  if (!enabled) return;

  const update = (event?: string) => {
    upsert(
      channel,
      direction,
      peerId,
      {
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
        localDescriptionType: pc.localDescription?.type,
        remoteDescriptionType: pc.remoteDescription?.type,
        localTracks: (localStream?.getTracks() ?? []).map(trackSnapshot).filter((item): item is TrackSnapshot => item !== null),
        senders: pc.getSenders().map((sender) => trackSnapshot(sender.track)).filter((item): item is TrackSnapshot => item !== null),
        receivers: pc.getReceivers().map((receiver) => trackSnapshot(receiver.track)).filter((item): item is TrackSnapshot => item !== null),
      },
      event
    );
  };

  const onSignaling = () => update(`signalingState = ${pc.signalingState}`);
  const onGathering = () => update(`iceGatheringState = ${pc.iceGatheringState}`);
  const onIceConnection = () => {
    update(`iceConnectionState = ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      void readSelectedCandidatePair(pc, channel, direction, peerId);
    }
  };
  const onConnection = () => {
    update(`connectionState = ${pc.connectionState}`);
    if (pc.connectionState === "connected") {
      void readSelectedCandidatePair(pc, channel, direction, peerId);
    }
  };

  pc.addEventListener("signalingstatechange", onSignaling);
  pc.addEventListener("icegatheringstatechange", onGathering);
  pc.addEventListener("iceconnectionstatechange", onIceConnection);
  pc.addEventListener("connectionstatechange", onConnection);
  update("RTCPeerConnection criado");
}

type StatsRecord = {
  id: string;
  type: string;
  state?: string;
  nominated?: boolean;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  protocol?: string;
};

async function readSelectedCandidatePair(
  pc: RTCPeerConnection,
  channel: WebRtcChannel,
  direction: WebRtcDirection,
  peerId: string
) {
  try {
    const stats = await pc.getStats();
    const records = [...stats.values()] as StatsRecord[];
    const transport = records.find((item) => item.type === "transport" && item.selectedCandidatePairId);
    const pair = transport?.selectedCandidatePairId
      ? records.find((item) => item.id === transport.selectedCandidatePairId)
      : records.find((item) => item.type === "candidate-pair" && item.state === "succeeded" && item.nominated);
    if (!pair) return;
    const local = records.find((item) => item.id === pair.localCandidateId);
    const remote = records.find((item) => item.id === pair.remoteCandidateId);
    const candidatePair = {
      localType: local?.candidateType,
      remoteType: remote?.candidateType,
      protocol: local?.protocol ?? remote?.protocol,
      relayUsed: local?.candidateType === "relay" || remote?.candidateType === "relay",
    };
    upsert(channel, direction, peerId, { candidatePair }, "par ICE selecionado");
  } catch (error) {
    recordWebRtcError(channel, direction, peerId, "getStats", error);
  }
}

export function refreshPeerConnectionDiagnostics(
  pc: RTCPeerConnection,
  channel: WebRtcChannel,
  direction: WebRtcDirection,
  peerId: string,
  patch: Partial<WebRtcDiagnostic> = {}
) {
  if (!enabled) return;
  upsert(channel, direction, peerId, {
    ...patch,
    signalingState: pc.signalingState,
    iceGatheringState: pc.iceGatheringState,
    iceConnectionState: pc.iceConnectionState,
    connectionState: pc.connectionState,
    localDescriptionType: pc.localDescription?.type,
    remoteDescriptionType: pc.remoteDescription?.type,
    senders: pc.getSenders().map((sender) => trackSnapshot(sender.track)).filter((item): item is TrackSnapshot => item !== null),
    receivers: pc.getReceivers().map((receiver) => trackSnapshot(receiver.track)).filter((item): item is TrackSnapshot => item !== null),
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

const EMPTY: WebRtcDiagnostic[] = [];
function getServerSnapshot() {
  return EMPTY;
}

export function useWebRtcDiagnostics() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const WEBRTC_DIAGNOSTICS_ENABLED = enabled;
