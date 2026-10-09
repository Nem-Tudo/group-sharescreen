"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getSharedAudioContext, ensureSharedAudioContextRunning } from "./audioContext";
import { getDesktopBridge, type DesktopSoundboardSound } from "./desktop";
import { iceConfigFor } from "./iceConfig";
import { ensureIceServers } from "./iceServers";
import { signalingClient, type PeerInfo } from "./signalingClient";
import {
  SOUNDBOARD_MAX_BYTES,
  SOUNDBOARD_MAX_CATALOG_SOUNDS,
  SOUNDBOARD_MAX_DURATION_MS,
  clampSoundboardVolume,
  effectiveSoundboardVolume,
  isSoundboardFileWithinLimits,
} from "./soundboardRules";

const GLOBAL_VOLUME_KEY = "golive:soundboard:global-volume";
const PEER_VOLUMES_KEY = "golive:soundboard:peer-volumes";
const PEER_MUTED_KEY = "golive:soundboard:peer-muted";
const SIGNAL_CHANNEL = "soundboard";
const DATA_CHANNEL = "soundboard";
const TRANSFER_TIMEOUT_MS = 30_000;
const CHUNK_BYTES = 32 * 1024;
const BUFFERED_HIGH_WATER = 512 * 1024;
const BUFFERED_LOW_WATER = 256 * 1024;

export type SoundboardErrorKey =
  | "soundboard.fileTooLarge"
  | "soundboard.invalidAudio"
  | "soundboard.maxTenSeconds"
  | "soundboard.readFailed"
  | "soundboard.saveFailed"
  | "soundboard.transferFailed";

export interface RemoteSoundboardSound {
  id: string;
  name: string;
  emoji: string;
  fileName: string;
  durationMs: number;
  sizeBytes: number;
  hash: string;
}

export interface RemoteSoundboardCatalog {
  peerId: string;
  userId: string;
  name: string;
  sounds: RemoteSoundboardSound[];
}

export interface PendingSoundboardImport {
  fileName: string;
  data: Uint8Array;
  durationMs: number;
}

export interface SoundboardSnapshot {
  active: boolean;
  canManageLibrary: boolean;
  selfUserId: string | null;
  localSounds: DesktopSoundboardSound[];
  remoteCatalogs: RemoteSoundboardCatalog[];
  globalVolume: number;
  peerVolumes: Record<string, number>;
  peerMuted: Record<string, boolean>;
  downloading: string[];
  errorKey: SoundboardErrorKey | null;
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readNumberMap(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) out[id] = clampSoundboardVolume(value);
    }
    return out;
  } catch {
    return {};
  }
}

function readBooleanMap(key: string): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === true) out[id] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing and a full storage quota both turn persistence into a
    // best-effort feature. The live control must still work in this session.
  }
}

const SERVER_SNAPSHOT: SoundboardSnapshot = {
  active: false,
  canManageLibrary: false,
  selfUserId: null,
  localSounds: [],
  remoteCatalogs: [],
  globalVolume: 1,
  peerVolumes: {},
  peerMuted: {},
  downloading: [],
  errorKey: null,
};

let snapshot: SoundboardSnapshot = {
  ...SERVER_SNAPSHOT,
  globalVolume: clampSoundboardVolume(readNumber(GLOBAL_VOLUME_KEY, 1)),
  peerVolumes: readNumberMap(PEER_VOLUMES_KEY),
  peerMuted: readBooleanMap(PEER_MUTED_KEY),
};

const listeners = new Set<() => void>();

function publish(patch: Partial<SoundboardSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSoundboardSnapshot(): SoundboardSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}

export function clearSoundboardError(): void {
  if (snapshot.errorKey) publish({ errorKey: null });
}

export function setSoundboardGlobalVolume(value: number): void {
  const globalVolume = clampSoundboardVolume(value);
  persist(GLOBAL_VOLUME_KEY, globalVolume);
  publish({ globalVolume });
  activeRuntime?.updateGains();
}

export function setSoundboardPeerVolume(userId: string, value: number): void {
  if (!userId) return;
  const peerVolumes = { ...snapshot.peerVolumes, [userId]: clampSoundboardVolume(value) };
  persist(PEER_VOLUMES_KEY, peerVolumes);
  publish({ peerVolumes });
  activeRuntime?.updateGains();
}

export function toggleSoundboardPeerMute(userId: string): void {
  if (!userId) return;
  const peerMuted = { ...snapshot.peerMuted };
  if (peerMuted[userId]) delete peerMuted[userId];
  else peerMuted[userId] = true;
  persist(PEER_MUTED_KEY, peerMuted);
  publish({ peerMuted });
  activeRuntime?.updateGains();
}

function copyBytes(value: Uint8Array): Uint8Array {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

async function decodeSound(bytes: Uint8Array): Promise<AudioBuffer> {
  const running = await ensureSharedAudioContextRunning();
  const context = getSharedAudioContext();
  if (!context || !running) throw new Error("audio-context-unavailable");
  return context.decodeAudioData(copyBytes(bytes).buffer as ArrayBuffer);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", copyBytes(bytes).buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const fileName = value.split(/[\\/]/).pop()?.slice(0, 100) ?? "";
  return fileName || null;
}

function cleanRemoteSound(value: unknown): RemoteSoundboardSound | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 128) : "";
  const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const emoji = typeof raw.emoji === "string" ? raw.emoji.trim().slice(0, 16) : "";
  const fileName = cleanFileName(raw.fileName);
  const durationMs = typeof raw.durationMs === "number" ? raw.durationMs : Number.NaN;
  const sizeBytes = typeof raw.sizeBytes === "number" ? raw.sizeBytes : Number.NaN;
  const hash = typeof raw.hash === "string" && /^[a-f0-9]{64}$/i.test(raw.hash) ? raw.hash.toLowerCase() : "";
  if (!id || !name || !emoji || !fileName || !hash) return null;
  if (!isSoundboardFileWithinLimits(sizeBytes, durationMs)) return null;
  return { id, name, emoji, fileName, durationMs, sizeBytes, hash };
}

function descriptionOf(value: unknown): RTCSessionDescriptionInit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  if (type !== "offer" && type !== "answer" && type !== "pranswer" && type !== "rollback") return null;
  if (type === "rollback") return { type };
  return typeof raw.sdp === "string" ? { type, sdp: raw.sdp } : null;
}

function candidateOf(value: unknown): RTCIceCandidateInit | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.candidate !== "string") return null;
  return {
    candidate: raw.candidate,
    sdpMid: typeof raw.sdpMid === "string" ? raw.sdpMid : null,
    sdpMLineIndex: typeof raw.sdpMLineIndex === "number" ? raw.sdpMLineIndex : null,
    usernameFragment: typeof raw.usernameFragment === "string" ? raw.usernameFragment : undefined,
  };
}

type SenderLink = {
  pc: RTCPeerConnection;
  data: RTCDataChannel;
  sender: RTCRtpSender;
  pendingIce: RTCIceCandidateInit[];
};

type ReceiverLink = {
  pc: RTCPeerConnection;
  data: RTCDataChannel | null;
  source: MediaStreamAudioSourceNode | null;
  gain: GainNode | null;
};

type IncomingTransfer = {
  peerId: string;
  transferId: string;
  sound: RemoteSoundboardSound;
  purpose: "download" | "play";
  playGeneration: number | null;
  chunks: Uint8Array[];
  total: number;
};

type LocalOutput = {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  monitorGain: GainNode;
  // Keep the WebRTC source clocked even while no effect is playing. This
  // makes the soundboard track independent from the microphone lifecycle.
  // The oscillator never reaches the local speakers and is far below audible
  // level on the RTP path.
  keepAlive: OscillatorNode;
  keepAliveGain: GainNode;
};

class SoundboardRuntime {
  readonly room: string;
  private forceRelay = false;
  private deafened = false;
  private micOn = true;
  private stopped = false;
  private signalUnsubscribe: (() => void) | null = null;
  private stateUnsubscribe: (() => void) | null = null;
  private peers = new Map<string, PeerInfo>();
  private capablePeers = new Set<string>();
  private helloSent = new Set<string>();
  private senders = new Map<string, SenderLink>();
  private receivers = new Map<string, ReceiverLink>();
  private receiverIce = new Map<string, RTCIceCandidateInit[]>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private remoteCatalogs = new Map<string, RemoteSoundboardCatalog>();
  private localSounds: DesktopSoundboardSound[] = [];
  private output: LocalOutput | null = null;
  private activeSources = new Map<string, AudioBufferSourceNode>();
  private playGeneration = new Map<string, number>();
  private decoded = new Map<string, AudioBuffer>();
  private requested = new Map<string, ReturnType<typeof setTimeout>>();
  private playRequests = new Map<string, { timer: ReturnType<typeof setTimeout>; generation: number }>();
  private remoteDecoded = new Map<string, AudioBuffer>();
  private remoteActiveSources = new Map<string, AudioBufferSourceNode>();
  private remotePlayGeneration = new Map<string, number>();
  private incoming = new Map<string, IncomingTransfer>();
  private sending = new Set<string>();
  private bridge = getDesktopBridge()?.soundboard ?? null;

  constructor(room: string) {
    this.room = room;
  }

  start(): void {
    ensureIceServers();
    publish({
      active: true,
      canManageLibrary: Boolean(this.bridge),
      selfUserId: signalingClient.state.selfUserId,
      localSounds: [],
      remoteCatalogs: [],
      downloading: [],
      errorKey: null,
    });

    this.signalUnsubscribe = signalingClient.onSignal((from, raw) => {
      void this.handleSignal(from, raw);
    });
    this.stateUnsubscribe = signalingClient.subscribe(this.syncPeers);
    this.syncPeers();
    if (this.bridge) {
      this.ensureOutput();
      void this.refreshLocalSounds();
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.signalUnsubscribe?.();
    this.stateUnsubscribe?.();
    this.signalUnsubscribe = null;
    this.stateUnsubscribe = null;

    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const timer of this.requested.values()) clearTimeout(timer);
    this.requested.clear();
    for (const request of this.playRequests.values()) clearTimeout(request.timer);
    this.playRequests.clear();
    this.incoming.clear();

    for (const peerId of [...this.senders.keys()]) this.closeSender(peerId, true);
    for (const peerId of [...this.receivers.keys()]) this.closeReceiver(peerId);
    for (const source of this.activeSources.values()) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.activeSources.clear();
    this.playGeneration.clear();
    for (const source of this.remoteActiveSources.values()) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.remoteActiveSources.clear();
    this.remotePlayGeneration.clear();
    this.remoteDecoded.clear();

    if (this.output) {
      try {
        this.output.keepAlive.stop();
      } catch {}
      this.output.keepAlive.disconnect();
      this.output.keepAliveGain.disconnect();
      this.output.monitorGain.disconnect();
      this.output.destination.stream.getTracks().forEach((track) => track.stop());
      this.output = null;
    }

    if (activeRuntime === this) {
      activeRuntime = null;
      publish({
        active: false,
        canManageLibrary: false,
        selfUserId: null,
        localSounds: [],
        remoteCatalogs: [],
        downloading: [],
        errorKey: null,
      });
    }
  }

  setDeafened(deafened: boolean): void {
    if (this.deafened === deafened) return;
    this.deafened = deafened;
    this.updateGains();
  }

  setMicOn(micOn: boolean): void {
    this.micOn = micOn;
    // Do not rebuild or gate the soundboard connection here. The data channel
    // remains alive across a mic toggle and is also the fallback transport
    // for effects while the microphone is closed.
  }

  setForceRelay(forceRelay: boolean): void {
    if (this.forceRelay === forceRelay) return;
    this.forceRelay = forceRelay;
    if (this.stopped) return;

    for (const peerId of [...this.senders.keys()]) {
      this.closeSender(peerId, false);
      void this.openSender(peerId);
    }
    for (const peerId of [...this.receivers.keys()]) {
      this.closeReceiver(peerId);
      signalingClient.sendSignal(peerId, { channel: SIGNAL_CHANNEL, kind: "reconnect-request" });
    }
  }

  // Microphone mute/unmute must never gate the soundboard. A mic toggle can
  // tear down or rebuild the app's ordinary audio capture path, so use that
  // transition only as a chance to re-assert this completely separate track.
  // The mic state itself is deliberately not read here.
  refreshOutgoingAudio(reconnect = false): void {
    if (this.stopped || !this.bridge || this.localSounds.length === 0) return;
    const output = this.ensureOutput();
    const track = output?.destination.stream.getAudioTracks()[0];
    if (!output || !track) return;

    // `enabled` belongs to the soundboard track, not the microphone track.
    // Re-assert it in case an audio lifecycle transition left it disabled.
    track.enabled = true;

    for (const peerId of this.capablePeers) {
      const link = this.senders.get(peerId);
      // A mic transition is allowed to rebuild the *soundboard's own* peer
      // connection. The data channel already proved that peer discovery is
      // still healthy; rebuilding here gives the audio transceiver a fresh
      // send-only negotiation after the mic capture has been stopped/started.
      if (reconnect && link) {
        this.closeSender(peerId, false);
        void this.openSender(peerId);
        continue;
      }
      if (!link) {
        void this.openSender(peerId);
        continue;
      }
      if (link.pc.connectionState === "failed" || link.pc.connectionState === "closed") {
        this.closeSender(peerId, false);
        void this.openSender(peerId);
        continue;
      }
      if (link.sender.track !== track) {
        void link.sender.replaceTrack(track).catch(() => this.scheduleSenderRetry(peerId));
      }
    }
  }

  updateGains(): void {
    const globalVolume = snapshot.globalVolume;
    if (this.output) {
      this.output.monitorGain.gain.value = this.deafened ? 0 : globalVolume;
    }
    for (const [peerId, receiver] of this.receivers) {
      if (!receiver.gain) continue;
      const userId = this.peers.get(peerId)?.userId ?? peerId;
      receiver.gain.gain.value = effectiveSoundboardVolume(
        globalVolume,
        snapshot.peerVolumes[userId] ?? 1,
        snapshot.peerMuted[userId] === true,
        this.deafened
      );
    }
  }

  async refreshLocalSounds(): Promise<void> {
    if (!this.bridge || this.stopped) return;
    try {
      this.localSounds = await this.bridge.list();
      if (this.stopped) return;
      publish({ localSounds: [...this.localSounds] });
      if (this.localSounds.length === 0) {
        for (const peerId of [...this.senders.keys()]) this.closeSender(peerId, true);
      } else {
        for (const peerId of this.capablePeers) void this.openSender(peerId);
        this.broadcastCatalog();
      }
    } catch {
      publish({ errorKey: "soundboard.readFailed" });
    }
  }

  async pickImport(): Promise<PendingSoundboardImport | null> {
    if (!this.bridge) return null;
    clearSoundboardError();
    try {
      const picked = await this.bridge.pick();
      if (!picked) return null;
      if (!picked.ok) {
        publish({
          errorKey:
            picked.error === "file-too-large" ? "soundboard.fileTooLarge" : "soundboard.invalidAudio",
        });
        return null;
      }
      if (picked.data.byteLength > SOUNDBOARD_MAX_BYTES) {
        publish({ errorKey: "soundboard.fileTooLarge" });
        return null;
      }
      const buffer = await decodeSound(picked.data);
      const durationMs = Math.round(buffer.duration * 1000);
      if (durationMs <= 0 || durationMs > SOUNDBOARD_MAX_DURATION_MS) {
        publish({ errorKey: "soundboard.maxTenSeconds" });
        return null;
      }
      return {
        fileName: picked.fileName,
        data: picked.data,
        durationMs,
      };
    } catch {
      publish({ errorKey: "soundboard.invalidAudio" });
      return null;
    }
  }

  async saveImport(pending: PendingSoundboardImport, name: string, emoji: string): Promise<boolean> {
    if (!this.bridge) return false;
    clearSoundboardError();
    try {
      const saved = await this.bridge.save({
        name,
        emoji,
        fileName: pending.fileName,
        durationMs: pending.durationMs,
        data: pending.data,
      });
      if (!saved) {
        publish({ errorKey: "soundboard.saveFailed" });
        return false;
      }
      await this.refreshLocalSounds();
      return true;
    } catch {
      publish({ errorKey: "soundboard.saveFailed" });
      return false;
    }
  }

  async removeSound(id: string): Promise<void> {
    if (!this.bridge) return;
    this.playGeneration.set(id, (this.playGeneration.get(id) ?? 0) + 1);
    const active = this.activeSources.get(id);
    if (active) {
      try {
        active.stop();
      } catch {}
      active.disconnect();
      this.activeSources.delete(id);
    }
    this.decoded.delete(id);
    try {
      await this.bridge.remove(id);
      await this.refreshLocalSounds();
    } catch {
      publish({ errorKey: "soundboard.saveFailed" });
    }
  }

  async openFolder(): Promise<void> {
    try {
      await this.bridge?.openFolder();
    } catch {
      publish({ errorKey: "soundboard.readFailed" });
    }
  }

  async playSound(id: string): Promise<void> {
    if (!this.bridge || this.stopped) return;
    const sound = this.localSounds.find((entry) => entry.id === id);
    if (!sound) return;
    clearSoundboardError();

    // One live AudioBufferSourceNode per sound id is the restart-on-trigger
    // rule: pressing the same button again stops the old source before a new
    // one starts. The generation also covers the decode/read window: ten
    // frantic clicks while the file is still loading still produce only the
    // newest start, never ten sources that finish loading together.
    const generation = (this.playGeneration.get(id) ?? 0) + 1;
    this.playGeneration.set(id, generation);
    const isCurrent = () => !this.stopped && this.playGeneration.get(id) === generation;

    const previous = this.activeSources.get(id);
    if (previous) {
      try {
        previous.stop();
      } catch {}
      previous.disconnect();
      this.activeSources.delete(id);
    }

    try {
      let buffer = this.decoded.get(id);
      if (!buffer) {
        const bytes = await this.bridge.read(id);
        if (!isCurrent()) return;
        if (!bytes || bytes.byteLength > SOUNDBOARD_MAX_BYTES) throw new Error("missing-sound");
        buffer = await decodeSound(bytes);
        if (!isCurrent()) return;
        const durationMs = Math.round(buffer.duration * 1000);
        if (!isSoundboardFileWithinLimits(bytes.byteLength, durationMs)) throw new Error("invalid-sound");
        this.decoded.set(id, buffer);
      }

      const output = this.ensureOutput();
      if (!output) throw new Error("audio-context-unavailable");
      this.refreshOutgoingAudio();
      await ensureSharedAudioContextRunning();
      if (!isCurrent()) return;

      const source = output.context.createBufferSource();
      source.buffer = buffer;
      source.connect(output.destination);
      source.connect(output.monitorGain);
      this.activeSources.set(id, source);
      source.addEventListener(
        "ended",
        () => {
          if (this.activeSources.get(id) === source) this.activeSources.delete(id);
          source.disconnect();
        },
        { once: true }
      );
      source.start(0);
      if (!this.micOn) this.broadcastFallbackPlay(id);
    } catch {
      if (isCurrent()) publish({ errorKey: "soundboard.readFailed" });
    }
  }

  private broadcastFallbackPlay(soundId: string): void {
    for (const sender of this.senders.values()) {
      this.sendJson(sender.data, { kind: "fallback-play", soundId });
    }
  }

  private async handleFallbackPlay(peerId: string, soundId: string): Promise<void> {
    const sound = this.remoteCatalogs.get(peerId)?.sounds.find((entry) => entry.id === soundId);
    const receiver = this.receivers.get(peerId);
    if (!sound || !receiver?.data || receiver.data.readyState !== "open") return;

    const key = `${peerId}:${soundId}`;
    const generation = (this.remotePlayGeneration.get(key) ?? 0) + 1;
    this.remotePlayGeneration.set(key, generation);
    const cached = this.remoteDecoded.get(`${key}:${sound.hash}`);
    if (cached) {
      await this.playRemoteBuffer(peerId, sound, cached, generation);
      return;
    }

    const pending = this.playRequests.get(key);
    if (pending) {
      pending.generation = generation;
      return;
    }

    const timer = setTimeout(() => {
      this.playRequests.delete(key);
      const transfer = this.incoming.get(peerId);
      if (transfer?.purpose === "play" && transfer.sound.id === soundId) this.incoming.delete(peerId);
    }, TRANSFER_TIMEOUT_MS);
    this.playRequests.set(key, { timer, generation });
    receiver.data.send(JSON.stringify({ kind: "file-request", soundId, purpose: "play" }));
  }

  private ensureReceiverGain(peerId: string, link: ReceiverLink): GainNode | null {
    if (link.gain) return link.gain;
    const context = getSharedAudioContext();
    if (!context) return null;
    const gain = context.createGain();
    const userId = this.peers.get(peerId)?.userId ?? peerId;
    gain.gain.value = effectiveSoundboardVolume(
      snapshot.globalVolume,
      snapshot.peerVolumes[userId] ?? 1,
      snapshot.peerMuted[userId] === true,
      this.deafened
    );
    gain.connect(context.destination);
    link.gain = gain;
    return gain;
  }

  private async playRemoteBuffer(
    peerId: string,
    sound: RemoteSoundboardSound,
    buffer: AudioBuffer,
    generation: number
  ): Promise<void> {
    const key = `${peerId}:${sound.id}`;
    if (this.remotePlayGeneration.get(key) !== generation) return;
    const link = this.receivers.get(peerId);
    const context = getSharedAudioContext();
    if (!link || !context) return;
    await ensureSharedAudioContextRunning();
    if (this.remotePlayGeneration.get(key) !== generation) return;
    const gain = this.ensureReceiverGain(peerId, link);
    if (!gain) return;

    const previous = this.remoteActiveSources.get(key);
    if (previous) {
      try {
        previous.stop();
      } catch {}
      previous.disconnect();
      this.remoteActiveSources.delete(key);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    this.remoteActiveSources.set(key, source);
    source.addEventListener(
      "ended",
      () => {
        if (this.remoteActiveSources.get(key) === source) this.remoteActiveSources.delete(key);
        source.disconnect();
      },
      { once: true }
    );
    source.start(0);
  }

  download(peerId: string, soundId: string): void {
    if (!this.bridge || this.stopped) return;
    const receiver = this.receivers.get(peerId);
    const sound = this.remoteCatalogs.get(peerId)?.sounds.find((entry) => entry.id === soundId);
    if (!receiver?.data || receiver.data.readyState !== "open" || !sound) {
      publish({ errorKey: "soundboard.transferFailed" });
      return;
    }
    const key = `${peerId}:${soundId}`;
    if (this.requested.has(key)) return;
    clearSoundboardError();

    const timer = setTimeout(() => {
      this.requested.delete(key);
      this.incoming.delete(peerId);
      this.publishDownloading();
      publish({ errorKey: "soundboard.transferFailed" });
    }, TRANSFER_TIMEOUT_MS);
    this.requested.set(key, timer);
    this.publishDownloading();
    receiver.data.send(JSON.stringify({ kind: "file-request", soundId }));
  }

  private ensureOutput(): LocalOutput | null {
    if (this.output) return this.output;
    const context = getSharedAudioContext();
    if (!context) return null;
    const destination = context.createMediaStreamDestination();
    const monitorGain = context.createGain();
    monitorGain.gain.value = this.deafened ? 0 : snapshot.globalVolume;
    monitorGain.connect(context.destination);

    // Keep this destination actively rendered independently of the mic graph.
    // The signal is intentionally not connected to context.destination, so it
    // can never be heard locally. -120 dBFS at 30 Hz is effectively silent,
    // but it prevents the RTP source from becoming a completely idle graph.
    const keepAlive = context.createOscillator();
    const keepAliveGain = context.createGain();
    keepAlive.frequency.value = 30;
    keepAliveGain.gain.value = 0.000001;
    keepAlive.connect(keepAliveGain);
    keepAliveGain.connect(destination);
    keepAlive.start();

    const track = destination.stream.getAudioTracks()[0];
    if (track) {
      track.contentHint = "music";
      track.enabled = true;
    }
    this.output = { context, destination, monitorGain, keepAlive, keepAliveGain };
    return this.output;
  }

  private syncPeers = (): void => {
    if (this.stopped) return;
    const next = new Map<string, PeerInfo>();
    for (const peer of signalingClient.state.peers) {
      if (peer.role === "moderator" || peer.role === "obs") continue;
      next.set(peer.id, peer);
    }

    for (const peerId of this.peers.keys()) {
      if (next.has(peerId)) continue;
      this.closeSender(peerId, false);
      this.closeReceiver(peerId);
      this.capablePeers.delete(peerId);
      this.helloSent.delete(peerId);
      this.receiverIce.delete(peerId);
      this.removeCatalog(peerId);
      this.clearPeerRequests(peerId);
    }

    this.peers = next;
    publish({ selfUserId: signalingClient.state.selfUserId });
    for (const peerId of next.keys()) this.sendHello(peerId);
    this.updateGains();
  };

  private sendHello(peerId: string): void {
    if (this.helloSent.has(peerId) || !this.peers.has(peerId)) return;
    this.helloSent.add(peerId);
    signalingClient.sendSignal(peerId, { channel: SIGNAL_CHANNEL, kind: "hello", version: 1 });
  }

  private async handleSignal(from: string, raw: unknown): Promise<void> {
    if (this.stopped || !raw || typeof raw !== "object") return;
    const data = raw as Record<string, unknown>;
    if (data.channel !== SIGNAL_CHANNEL || typeof data.kind !== "string") return;

    if (data.kind === "hello") {
      if (!this.peers.has(from)) return;
      this.capablePeers.add(from);
      this.sendHello(from);
      if (this.bridge) await this.openSender(from);
      return;
    }

    if (data.kind === "offer") {
      const description = descriptionOf(data.sdp);
      if (!description || description.type !== "offer" || !this.peers.has(from)) return;
      this.capablePeers.add(from);
      this.sendHello(from);
      await this.openReceiver(from, description);
      return;
    }

    if (data.kind === "answer") {
      const description = descriptionOf(data.sdp);
      const sender = this.senders.get(from);
      if (!sender || !description || description.type !== "answer") return;
      try {
        await sender.pc.setRemoteDescription(description);
        for (const candidate of sender.pendingIce.splice(0)) {
          await sender.pc.addIceCandidate(candidate).catch(() => {});
        }
      } catch {
        this.scheduleSenderRetry(from);
      }
      return;
    }

    if (data.kind === "ice") {
      const candidate = candidateOf(data.candidate);
      if (!candidate) return;
      if (data.role === "broadcaster") {
        const receiver = this.receivers.get(from);
        if (receiver?.pc.remoteDescription) {
          await receiver.pc.addIceCandidate(candidate).catch(() => {});
        } else {
          const queue = this.receiverIce.get(from) ?? [];
          queue.push(candidate);
          if (queue.length <= 128) this.receiverIce.set(from, queue);
        }
      } else if (data.role === "viewer") {
        const sender = this.senders.get(from);
        if (!sender) return;
        if (sender.pc.remoteDescription) {
          await sender.pc.addIceCandidate(candidate).catch(() => {});
        } else if (sender.pendingIce.length < 128) {
          sender.pendingIce.push(candidate);
        }
      }
      return;
    }

    if (data.kind === "reconnect-request") {
      if (!this.bridge || !this.capablePeers.has(from) || !this.peers.has(from)) return;
      this.closeSender(from, false);
      await this.openSender(from);
      return;
    }

    if (data.kind === "stop") {
      this.closeReceiver(from);
      this.removeCatalog(from);
    }
  }

  private async openSender(peerId: string): Promise<void> {
    if (
      this.stopped ||
      !this.bridge ||
      this.localSounds.length === 0 ||
      !this.peers.has(peerId) ||
      !this.capablePeers.has(peerId) ||
      this.senders.has(peerId)
    ) {
      return;
    }
    const output = this.ensureOutput();
    const track = output?.destination.stream.getAudioTracks()[0];
    if (!output || !track) return;

    const pc = new RTCPeerConnection(iceConfigFor(this.forceRelay));
    const data = pc.createDataChannel(DATA_CHANNEL, { ordered: true });
    // Explicit send-only transceiver: this connection exists to publish the
    // soundboard, never to mirror the microphone's bidirectional audio shape.
    // Keeping that direction explicit also makes a fresh negotiation after a
    // mic toggle deterministic.
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly",
      streams: [output.destination.stream],
    });
    const sender = transceiver.sender;
    const link: SenderLink = { pc, data, sender, pendingIce: [] };
    this.senders.set(peerId, link);

    this.configureOwnerChannel(peerId, data);
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      signalingClient.sendSignal(peerId, {
        channel: SIGNAL_CHANNEL,
        role: "broadcaster",
        kind: "ice",
        candidate: event.candidate.toJSON(),
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && this.senders.get(peerId)?.pc === pc) {
        this.scheduleSenderRetry(peerId);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.senders.get(peerId)?.pc !== pc) return;
      signalingClient.sendSignal(peerId, {
        channel: SIGNAL_CHANNEL,
        role: "broadcaster",
        kind: "offer",
        sdp: pc.localDescription,
      });
    } catch {
      this.scheduleSenderRetry(peerId);
    }
  }

  private closeSender(peerId: string, signalStop: boolean): void {
    const sender = this.senders.get(peerId);
    if (!sender) return;
    this.senders.delete(peerId);
    sender.data.close();
    sender.pc.close();
    if (signalStop && this.peers.has(peerId)) {
      signalingClient.sendSignal(peerId, {
        channel: SIGNAL_CHANNEL,
        role: "broadcaster",
        kind: "stop",
      });
    }
  }

  private scheduleSenderRetry(peerId: string): void {
    this.closeSender(peerId, false);
    const previous = this.retryTimers.get(peerId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.retryTimers.delete(peerId);
      if (!this.stopped && this.peers.has(peerId) && this.capablePeers.has(peerId)) {
        void this.openSender(peerId);
      }
    }, 1000);
    this.retryTimers.set(peerId, timer);
  }

  private async openReceiver(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    this.closeReceiver(peerId);
    const pc = new RTCPeerConnection(iceConfigFor(this.forceRelay));
    const link: ReceiverLink = { pc, data: null, source: null, gain: null };
    this.receivers.set(peerId, link);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      signalingClient.sendSignal(peerId, {
        channel: SIGNAL_CHANNEL,
        role: "viewer",
        kind: "ice",
        candidate: event.candidate.toJSON(),
      });
    };
    pc.ondatachannel = (event) => {
      if (event.channel.label !== DATA_CHANNEL) {
        event.channel.close();
        return;
      }
      link.data = event.channel;
      this.configureViewerChannel(peerId, event.channel);
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.attachRemoteAudio(peerId, link, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed" || this.receivers.get(peerId)?.pc !== pc) return;
      this.closeReceiver(peerId);
      if (this.peers.has(peerId)) {
        signalingClient.sendSignal(peerId, { channel: SIGNAL_CHANNEL, kind: "reconnect-request" });
      }
    };

    try {
      await pc.setRemoteDescription(offer);
      const queued = this.receiverIce.get(peerId) ?? [];
      this.receiverIce.delete(peerId);
      for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => {});
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (this.receivers.get(peerId)?.pc !== pc) return;
      signalingClient.sendSignal(peerId, {
        channel: SIGNAL_CHANNEL,
        role: "viewer",
        kind: "answer",
        sdp: pc.localDescription,
      });
    } catch {
      this.closeReceiver(peerId);
      if (this.peers.has(peerId)) {
        signalingClient.sendSignal(peerId, { channel: SIGNAL_CHANNEL, kind: "reconnect-request" });
      }
    }
  }

  private attachRemoteAudio(peerId: string, link: ReceiverLink, stream: MediaStream): void {
    const context = getSharedAudioContext();
    if (!context) return;
    link.source?.disconnect();

    const source = context.createMediaStreamSource(stream);
    const gain = this.ensureReceiverGain(peerId, link);
    if (!gain) return;
    source.connect(gain);
    link.source = source;
    void ensureSharedAudioContextRunning();
  }

  private closeReceiver(peerId: string): void {
    const receiver = this.receivers.get(peerId);
    if (!receiver) return;
    this.receivers.delete(peerId);
    receiver.source?.disconnect();
    receiver.gain?.disconnect();
    receiver.data?.close();
    receiver.pc.close();
    this.incoming.delete(peerId);
    for (const [key, source] of [...this.remoteActiveSources.entries()]) {
      if (!key.startsWith(`${peerId}:`)) continue;
      try {
        source.stop();
      } catch {}
      source.disconnect();
      this.remoteActiveSources.delete(key);
    }
    for (const key of [...this.remoteDecoded.keys()]) {
      if (key.startsWith(`${peerId}:`)) this.remoteDecoded.delete(key);
    }
    for (const key of [...this.remotePlayGeneration.keys()]) {
      if (key.startsWith(`${peerId}:`)) this.remotePlayGeneration.delete(key);
    }
    this.clearPeerRequests(peerId);
  }

  private configureOwnerChannel(peerId: string, channel: RTCDataChannel): void {
    channel.onopen = () => this.sendCatalog(peerId);
    channel.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data.length > 16_000) return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      const data = message as Record<string, unknown>;
      if (data.kind === "catalog-request") {
        this.sendCatalog(peerId);
        return;
      }
      if (data.kind === "file-request" && typeof data.soundId === "string") {
        const purpose = data.purpose === "play" ? "play" : "download";
        void this.sendFile(peerId, channel, data.soundId, purpose);
      }
    };
  }

  private configureViewerChannel(peerId: string, channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      channel.send(JSON.stringify({ kind: "catalog-request" }));
    };
    channel.onmessage = (event) => {
      void this.handleViewerData(peerId, event.data);
    };
    channel.onclose = () => {
      this.incoming.delete(peerId);
      this.clearPeerRequests(peerId);
    };
  }

  private sendCatalog(peerId: string): void {
    const channel = this.senders.get(peerId)?.data;
    if (!channel || channel.readyState !== "open") return;
    const sounds = this.localSounds.slice(0, SOUNDBOARD_MAX_CATALOG_SOUNDS).map((sound) => ({
      id: sound.id,
      name: sound.name,
      emoji: sound.emoji,
      fileName: sound.fileName,
      durationMs: sound.durationMs,
      sizeBytes: sound.sizeBytes,
      hash: sound.hash,
    }));
    channel.send(JSON.stringify({ kind: "catalog", sounds }));
  }

  private broadcastCatalog(): void {
    for (const peerId of this.senders.keys()) this.sendCatalog(peerId);
  }

  private async sendFile(
    peerId: string,
    channel: RTCDataChannel,
    soundId: string,
    purpose: "download" | "play"
  ): Promise<void> {
    if (!this.bridge || this.sending.has(peerId) || channel.readyState !== "open") {
      this.sendJson(channel, { kind: "file-error", soundId, purpose });
      return;
    }
    const sound = this.localSounds.find((entry) => entry.id === soundId);
    if (!sound || sound.sizeBytes > SOUNDBOARD_MAX_BYTES) {
      this.sendJson(channel, { kind: "file-error", soundId, purpose });
      return;
    }

    this.sending.add(peerId);
    try {
      const bytes = await this.bridge.read(sound.id);
      if (!bytes || bytes.byteLength !== sound.sizeBytes || bytes.byteLength > SOUNDBOARD_MAX_BYTES) {
        throw new Error("missing");
      }
      const transferId = crypto.randomUUID();
      this.sendJson(channel, {
        kind: "file-start",
        transferId,
        purpose,
        sound: {
          id: sound.id,
          name: sound.name,
          emoji: sound.emoji,
          fileName: sound.fileName,
          durationMs: sound.durationMs,
          sizeBytes: sound.sizeBytes,
          hash: sound.hash,
        },
      });

      for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
        if (channel.readyState !== "open") throw new Error("closed");
        await this.waitForBuffer(channel);
        const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + CHUNK_BYTES));
        channel.send(copyBytes(chunk).buffer as ArrayBuffer);
      }
      this.sendJson(channel, { kind: "file-end", transferId, soundId: sound.id, purpose });
    } catch {
      this.sendJson(channel, { kind: "file-error", soundId, purpose });
    } finally {
      this.sending.delete(peerId);
    }
  }

  private sendJson(channel: RTCDataChannel, value: unknown): void {
    if (channel.readyState === "open") channel.send(JSON.stringify(value));
  }

  private async waitForBuffer(channel: RTCDataChannel): Promise<void> {
    if (channel.bufferedAmount <= BUFFERED_HIGH_WATER) return;
    channel.bufferedAmountLowThreshold = BUFFERED_LOW_WATER;
    await Promise.race([
      new Promise<void>((resolve) => {
        channel.addEventListener("bufferedamountlow", () => resolve(), { once: true });
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  }

  private async handleViewerData(peerId: string, raw: unknown): Promise<void> {
    if (typeof raw === "string") {
      if (raw.length > 64_000) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      const data = message as Record<string, unknown>;

      if (data.kind === "catalog") {
        const sounds = Array.isArray(data.sounds)
          ? data.sounds
              .slice(0, SOUNDBOARD_MAX_CATALOG_SOUNDS)
              .map(cleanRemoteSound)
              .filter((sound): sound is RemoteSoundboardSound => sound !== null)
          : [];
        const peer = this.peers.get(peerId);
        if (!peer) return;
        this.remoteCatalogs.set(peerId, {
          peerId,
          userId: peer.userId ?? peerId,
          name: peer.name,
          sounds,
        });
        this.publishCatalogs();
        return;
      }

      if (data.kind === "fallback-play" && typeof data.soundId === "string") {
        await this.handleFallbackPlay(peerId, data.soundId);
        return;
      }

      if (data.kind === "file-start") {
        const sound = cleanRemoteSound(data.sound);
        const transferId = typeof data.transferId === "string" ? data.transferId.slice(0, 128) : "";
        const purpose = data.purpose === "play" ? "play" : "download";
        if (!sound || !transferId) return;
        const key = `${peerId}:${sound.id}`;
        if (purpose === "download" && !this.requested.has(key)) return;
        const playRequest = this.playRequests.get(key);
        if (purpose === "play" && !playRequest) return;
        this.incoming.set(peerId, {
          peerId,
          transferId,
          sound,
          purpose,
          playGeneration: purpose === "play" ? playRequest?.generation ?? null : null,
          chunks: [],
          total: 0,
        });
        return;
      }

      if (data.kind === "file-end") {
        const transferId = typeof data.transferId === "string" ? data.transferId : "";
        const transfer = this.incoming.get(peerId);
        if (!transfer || transfer.transferId !== transferId) return;
        this.incoming.delete(peerId);
        await this.finishTransfer(transfer);
        return;
      }

      if (data.kind === "file-error" && typeof data.soundId === "string") {
        if (data.purpose === "play") this.clearPlayRequest(peerId, data.soundId);
        else this.clearRequest(peerId, data.soundId, true);
      }
      return;
    }

    let bytes: Uint8Array | null = null;
    if (raw instanceof ArrayBuffer) {
      bytes = new Uint8Array(raw);
    } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
      bytes = new Uint8Array(await raw.arrayBuffer());
    }
    if (!bytes) return;
    const transfer = this.incoming.get(peerId);
    if (!transfer) return;
    transfer.total += bytes.byteLength;
    if (transfer.total > transfer.sound.sizeBytes || transfer.total > SOUNDBOARD_MAX_BYTES) {
      this.incoming.delete(peerId);
      if (transfer.purpose === "play") this.clearPlayRequest(peerId, transfer.sound.id);
      else this.clearRequest(peerId, transfer.sound.id, true);
      return;
    }
    transfer.chunks.push(copyBytes(bytes));
  }

  private async finishTransfer(transfer: IncomingTransfer): Promise<void> {
    const { peerId, sound } = transfer;
    try {
      if (!this.bridge || transfer.total !== sound.sizeBytes) throw new Error("size");
      const bytes = new Uint8Array(transfer.total);
      let offset = 0;
      for (const chunk of transfer.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if ((await sha256(bytes)) !== sound.hash) throw new Error("hash");
      const buffer = await decodeSound(bytes);
      const durationMs = Math.round(buffer.duration * 1000);
      if (!isSoundboardFileWithinLimits(bytes.byteLength, durationMs)) throw new Error("limits");
      if (Math.abs(durationMs - sound.durationMs) > 250) throw new Error("duration");

      if (transfer.purpose === "play") {
        const key = `${peerId}:${sound.id}`;
        this.remoteDecoded.set(`${key}:${sound.hash}`, buffer);
        const generation = this.remotePlayGeneration.get(key) ?? transfer.playGeneration ?? 0;
        this.clearPlayRequest(peerId, sound.id);
        if (generation > 0) await this.playRemoteBuffer(peerId, sound, buffer, generation);
        return;
      }

      const saved = await this.bridge.save({
        name: sound.name,
        emoji: sound.emoji,
        fileName: sound.fileName,
        durationMs,
        data: bytes,
      });
      if (!saved) throw new Error("save");
      this.clearRequest(peerId, sound.id, false);
      await this.refreshLocalSounds();
    } catch {
      if (transfer.purpose === "play") this.clearPlayRequest(peerId, sound.id);
      else this.clearRequest(peerId, sound.id, true);
    }
  }

  private clearPlayRequest(peerId: string, soundId: string): void {
    const key = `${peerId}:${soundId}`;
    const request = this.playRequests.get(key);
    if (request) clearTimeout(request.timer);
    this.playRequests.delete(key);
  }

  private clearRequest(peerId: string, soundId: string, failed: boolean): void {
    const key = `${peerId}:${soundId}`;
    const timer = this.requested.get(key);
    if (timer) clearTimeout(timer);
    this.requested.delete(key);
    this.publishDownloading();
    if (failed) publish({ errorKey: "soundboard.transferFailed" });
  }

  private clearPeerRequests(peerId: string): void {
    for (const key of [...this.requested.keys()]) {
      if (!key.startsWith(`${peerId}:`)) continue;
      const timer = this.requested.get(key);
      if (timer) clearTimeout(timer);
      this.requested.delete(key);
    }
    for (const key of [...this.playRequests.keys()]) {
      if (!key.startsWith(`${peerId}:`)) continue;
      const request = this.playRequests.get(key);
      if (request) clearTimeout(request.timer);
      this.playRequests.delete(key);
    }
    this.publishDownloading();
  }

  private publishDownloading(): void {
    publish({ downloading: [...this.requested.keys()] });
  }

  private removeCatalog(peerId: string): void {
    if (!this.remoteCatalogs.delete(peerId)) return;
    this.publishCatalogs();
  }

  private publishCatalogs(): void {
    publish({
      remoteCatalogs: [...this.remoteCatalogs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
}

let activeRuntime: SoundboardRuntime | null = null;

export function useRoomSoundboardSession({
  room,
  deafened,
  forceRelayIce,
  micOn,
}: {
  room: string | null;
  deafened: boolean;
  forceRelayIce: boolean;
  micOn: boolean;
}): void {
  useEffect(() => {
    if (!room) return;
    activeRuntime?.stop();
    const runtime = new SoundboardRuntime(room);
    activeRuntime = runtime;
    runtime.start();
    return () => runtime.stop();
  }, [room]);

  useEffect(() => {
    if (activeRuntime?.room === room) activeRuntime.setDeafened(deafened);
  }, [room, deafened]);

  useEffect(() => {
    if (activeRuntime?.room === room) activeRuntime.setForceRelay(forceRelayIce);
  }, [room, forceRelayIce]);

  useEffect(() => {
    if (activeRuntime?.room === room) activeRuntime.setMicOn(micOn);
  }, [room, micOn]);
}

export async function pickSoundboardImport(): Promise<PendingSoundboardImport | null> {
  return activeRuntime?.pickImport() ?? null;
}

export async function saveSoundboardImport(
  pending: PendingSoundboardImport,
  name: string,
  emoji: string
): Promise<boolean> {
  return (await activeRuntime?.saveImport(pending, name, emoji)) ?? false;
}

export async function playLocalSoundboardSound(id: string): Promise<void> {
  await activeRuntime?.playSound(id);
}

export async function removeLocalSoundboardSound(id: string): Promise<void> {
  await activeRuntime?.removeSound(id);
}

export async function openLocalSoundboardFolder(): Promise<void> {
  await activeRuntime?.openFolder();
}

export async function refreshLocalSoundboard(): Promise<void> {
  await activeRuntime?.refreshLocalSounds();
}

export function downloadRemoteSoundboardSound(peerId: string, soundId: string): void {
  activeRuntime?.download(peerId, soundId);
}
