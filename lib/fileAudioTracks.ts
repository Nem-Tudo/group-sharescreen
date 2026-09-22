"use client";

// Choosing the audio track of somebody else's local file (experiment
// "file-audio-tracks").
//
// The file lives on the broadcaster's machine, which decodes every track (see
// multiAudioEngine) and sends each viewer one of them: the room default, or
// the one that viewer picked. Picking is a request to that machine, which
// swaps the audio on its connection to the viewer (RTCRtpSender.replaceTrack
// — no renegotiation, nothing else changes). All peer to peer, through the
// ordinary signalling relay, like file-control: the server never needs to
// know a file has tracks.
//
//   viewer → owner   file-audio-query  { channel }             "what tracks?"
//   owner → viewer   file-audio-tracks { channel, key, tracks, defaultIndex }
//   viewer → owner   file-audio-choice { channel, key, index }  (null: default)
//
// `key` names one item of the owner's queue: a choice made for one film is
// not carried over to the next file, whose tracks are different.

import { useSyncExternalStore } from "react";
import { signalingClient } from "./signalingClient";
import { connectionRegistry } from "./connectionRegistry";
import { formatLocale, translate } from "./i18n";
import { codecLabel } from "./mediaDemux/codecs";
import type { AudioTrackInfo } from "./mediaDemux";
import { trackFeatureEvent } from "./features";

export const FILE_AUDIO_TRACKS_FEATURE = "file-audio-tracks";

export const FILE_AUDIO_TRACKS_EVENTS = {
  /** A file with several audio tracks started playing (value: how many). */
  multiTrack: "file_audio_multitrack",
  /** The broadcaster changed the room's default track. */
  defaultChange: "file_audio_default_change",
  /** A viewer picked a track for themselves. */
  viewerChoice: "file_audio_viewer_choice",
  /** A file whose tracks include one this browser cannot decode. */
  unsupported: "file_audio_unsupported",
} as const;

/** What a track picker shows. */
export type FileAudioTrack = {
  index: number;
  label: string;
  /** Codec, and channels when not plain stereo: "AAC 5.1". */
  detail: string;
  supported: boolean;
};

// ISO 639-2/B codes (common in Matroska) that Intl only knows by their /T form.
const B_TO_T: Record<string, string> = {
  fre: "fra",
  ger: "deu",
  chi: "zho",
  dut: "nld",
  cze: "ces",
  gre: "ell",
  per: "fas",
  rum: "ron",
  slo: "slk",
  ice: "isl",
  arm: "hye",
  geo: "kat",
  mac: "mkd",
  may: "msa",
  alb: "sqi",
  baq: "eus",
  bur: "mya",
  tib: "bod",
  wel: "cym",
};

function languageName(code: string | null): string | null {
  if (!code) return null;
  const normalized = B_TO_T[code.toLowerCase()] ?? code;
  try {
    const name = new Intl.DisplayNames([formatLocale()], { type: "language" }).of(normalized);
    if (name && name.toLowerCase() !== normalized.toLowerCase()) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    // Not a code Intl knows; shown as it is below.
  }
  return code;
}

export function describeTrack(info: AudioTrackInfo, supported: boolean): FileAudioTrack {
  const language = languageName(info.language);
  const name = info.name?.trim() || null;
  let label: string;
  if (name && language && !name.toLowerCase().includes(language.toLowerCase())) label = `${name} (${language})`;
  else label = name ?? language ?? translate("fileAudioTracks.trackNumber", { number: info.index + 1 });
  const channels = info.channels > 2 ? (info.channels === 6 ? " 5.1" : info.channels === 8 ? " 7.1" : ` ${info.channels}ch`) : "";
  return { index: info.index, label, detail: `${codecLabel(info.codecId, info.codec)}${channels}`, supported };
}

// ─── The owner's side ─────────────────────────────────────────────────────

/** What the owner's LocalMediaSource offers this module. */
export interface AudioTrackOwner {
  readonly slot: string;
  /** The current item's key and tracks, or null when there is nothing to choose. */
  audioTrackOffer(): { key: string; tracks: FileAudioTrack[]; defaultIndex: number } | null;
  /** The MediaStreamTrack carrying track `index`, or the room default for null. */
  outgoingAudioFor(index: number | null): MediaStreamTrack | null;
}

const owners = new Map<string, AudioTrackOwner>();
// `${slot} ${viewerPeerId}` → the index they chose, for the item named by key.
const choices = new Map<string, { key: string; index: number }>();

export function registerAudioTrackOwner(owner: AudioTrackOwner) {
  owners.set(owner.slot, owner);
}

function offerMessage(owner: AudioTrackOwner) {
  const offer = owner.audioTrackOffer();
  return {
    kind: "file-audio-tracks",
    channel: owner.slot,
    key: offer?.key ?? null,
    tracks: offer?.tracks ?? [],
    defaultIndex: offer?.defaultIndex ?? 0,
  };
}

function audioSender(pc: RTCPeerConnection): RTCRtpSender | undefined {
  return pc.getSenders().find((s) => s.track?.kind === "audio");
}

// Puts on this viewer's connection the track they chose, or the room default.
function applyChoice(owner: AudioTrackOwner, peerId: string) {
  const entry = connectionRegistry.findSend(owner.slot as never, peerId, null);
  if (!entry) return;
  const sender = audioSender(entry.pc);
  if (!sender) return;
  const offer = owner.audioTrackOffer();
  const choice = choices.get(`${owner.slot} ${peerId}`);
  const index = offer && choice && choice.key === offer.key ? choice.index : null;
  const track = owner.outgoingAudioFor(index);
  if (track && sender.track !== track) void sender.replaceTrack(track).catch(() => {});
}

/**
 * The owner's item or its tracks changed: tell everyone watching, and put
 * every viewer back on whatever their choice now resolves to (a new file
 * drops old choices, since its key differs).
 */
export function publishAudioTracks(slot: string) {
  const owner = owners.get(slot);
  if (!owner) return;
  const message = offerMessage(owner);
  for (const entry of connectionRegistry.list()) {
    if (entry.channel !== slot || entry.direction !== "send" || entry.originId !== null) continue;
    signalingClient.sendSignal(entry.peerId, message);
    applyChoice(owner, entry.peerId);
  }
}

// ─── The viewer's side ────────────────────────────────────────────────────

type Offer = { key: string | null; tracks: FileAudioTrack[]; defaultIndex: number };
const offers = new Map<string, Offer>();
// `${ownerPeerId} ${slot}` → what this viewer picked, for the key it was picked on.
const myChoices = new Map<string, { key: string; index: number }>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Asks the owner for the track list — on showing their file, or when it changes. */
export function queryAudioTracks(ownerPeerId: string, slot: string) {
  signalingClient.sendSignal(ownerPeerId, { kind: "file-audio-query", channel: slot });
}

export function chooseAudioTrack(ownerPeerId: string, slot: string, index: number | null) {
  const offer = offers.get(`${ownerPeerId} ${slot}`);
  if (!offer?.key) return;
  if (index === null) myChoices.delete(`${ownerPeerId} ${slot}`);
  else myChoices.set(`${ownerPeerId} ${slot}`, { key: offer.key, index });
  signalingClient.sendSignal(ownerPeerId, { kind: "file-audio-choice", channel: slot, key: offer.key, index });
  trackFeatureEvent(FILE_AUDIO_TRACKS_EVENTS.viewerChoice);
  changed();
}

export type AudioTrackView = { tracks: FileAudioTrack[]; selected: number; defaultIndex: number } | null;

const viewCache = new Map<string, { version: number; view: AudioTrackView }>();

function viewFor(ownerPeerId: string, slot: string): AudioTrackView {
  const id = `${ownerPeerId} ${slot}`;
  const cached = viewCache.get(id);
  if (cached && cached.version === version) return cached.view;
  const offer = offers.get(id);
  let view: AudioTrackView = null;
  if (offer?.key && offer.tracks.length > 0) {
    const mine = myChoices.get(id);
    const selected = mine && mine.key === offer.key ? mine.index : offer.defaultIndex;
    view = { tracks: offer.tracks, selected, defaultIndex: offer.defaultIndex };
  }
  viewCache.set(id, { version, view });
  return view;
}

/** The track list and this viewer's pick for someone's file; null when there is nothing to pick. */
export function useAudioTrackView(ownerPeerId: string, slot: string): AudioTrackView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => viewFor(ownerPeerId, slot),
    () => null
  );
}

// ─── Wiring ───────────────────────────────────────────────────────────────

let started = false;

/** Both sides' signal handling, once per page. Returns nothing to undo: it lives as long as the page. */
export function startFileAudioTracks() {
  if (started || typeof window === "undefined") return;
  started = true;
  signalingClient.onSignal((from, raw) => {
    const data = raw as { kind?: string; channel?: string; key?: string | null; index?: number | null } & Partial<Offer>;
    if (typeof data?.channel !== "string") return;
    if (data.kind === "file-audio-query") {
      const owner = owners.get(data.channel);
      if (owner) signalingClient.sendSignal(from, offerMessage(owner));
      return;
    }
    if (data.kind === "file-audio-choice") {
      const owner = owners.get(data.channel);
      if (!owner || typeof data.key !== "string") return;
      const id = `${data.channel} ${from}`;
      if (typeof data.index === "number" && Number.isInteger(data.index)) choices.set(id, { key: data.key, index: data.index });
      else choices.delete(id);
      applyChoice(owner, from);
      return;
    }
    if (data.kind === "file-audio-tracks") {
      const tracks = Array.isArray(data.tracks)
        ? data.tracks
            .filter((t): t is FileAudioTrack => Boolean(t) && typeof t.index === "number" && typeof t.label === "string")
            .slice(0, 32)
            .map((t) => ({
              index: t.index,
              label: String(t.label).slice(0, 80),
              detail: String(t.detail ?? "").slice(0, 24),
              supported: Boolean(t.supported),
            }))
        : [];
      offers.set(`${from} ${data.channel}`, {
        key: typeof data.key === "string" ? data.key : null,
        tracks,
        defaultIndex: typeof data.defaultIndex === "number" ? data.defaultIndex : 0,
      });
      changed();
    }
  });
  // A viewer's connection (re)opening: tell them what there is, and put their
  // choice back on it. Deferred a tick, because the pc is registered before
  // its tracks are added (see useRoomMedia's openSendPC).
  connectionRegistry.subscribe((event, connection) => {
    if (event !== "open" || connection.direction !== "send" || connection.originId !== null) return;
    const owner = owners.get(connection.channel);
    if (!owner || !owner.audioTrackOffer()) return;
    setTimeout(() => {
      signalingClient.sendSignal(connection.peerId, offerMessage(owner));
      applyChoice(owner, connection.peerId);
    }, 0);
  });
}
