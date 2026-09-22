"use client";

import { readZipEntries, readZipEntryBlob, ZipError } from "./zipReader";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";
import { canDemux, openAudioDemuxer, type AudioDemuxer } from "./mediaDemux";
import { MultiAudioEngine, probeTracks, type ProbedTrack } from "./multiAudioEngine";
import {
  describeTrack,
  FILE_AUDIO_TRACKS_EVENTS,
  publishAudioTracks,
  registerAudioTrackOwner,
  type AudioTrackOwner,
  type FileAudioTrack,
} from "./fileAudioTracks";
import { trackFeatureEvent } from "./features";

// Playing a file from your own disk into the room.
//
// The room's other sources are links: everyone embeds the same YouTube/Twitch
// address and a small record keeps them on the same second. A file on one
// person's machine cannot work that way — nobody else has it — so this takes
// the other route the app already has for "everyone sees what is on my
// screen": it plays the file locally and broadcasts the result as an ordinary
// transmission (see useRoomMedia's screen channel, whose capture asks this
// module for a stream when the share source is "file").
//
// That choice decides everything else about it. There is no protocol, no
// server record and nothing to synchronize, because what the room receives is
// live video and audio rather than an instruction to play something. Pausing
// or skipping is a local act whose effect everyone sees for the same reason
// they see a paused video on a shared screen.
//
// Module-level instances rather than React state: a playback has to outlive
// any component (the capture function in useRoomMedia reaches for it, and so
// does the transport UI in whichever tile is currently rendering it).
//
// There is one instance per *slot*. Slots are a fixed list rather than a
// growable one because each is a broadcast channel of its own and channels are
// wired up with hooks, which cannot be called in a loop of varying length (see
// useRoomMedia). Three of them: every extra file is another canvas capture and
// another video encode on this one machine, so the ceiling is set by what a
// laptop can actually do at once rather than by what the UI could list.

export type LocalMediaItem = {
  id: string;
  name: string;
  // Object URL for the file/blob. Revoked when the queue is replaced, which is
  // also the only thing keeping a zip's extracted blobs alive.
  url: string;
  // Whether this item has a picture, decided from its extension. An audio file
  // is broadcast just the same — the canvas below draws its name instead of a
  // black rectangle, so a room listening to an album still sees what is on.
  hasVideo: boolean;
  // The file itself, for reading its audio tracks (see lib/mediaDemux). The
  // element plays `url`; this is read lazily, a few bytes at a time.
  blob: Blob;
};

// Experiment "file-audio-tracks" (see lib/fileAudioTracks), set by
// useRoomMedia. Off: every file plays exactly as before, element audio only.
let audioTracksEnabled = false;
export function setLocalAudioTracksEnabled(value: boolean) {
  if (audioTracksEnabled === value) return;
  audioTracksEnabled = value;
  for (const source of Object.values(localMediaSources)) source.audioTracksToggled();
}

type Listener = () => void;

// Which of the two add-source flows this queue came from (see
// LocalMediaPicker). Presentation only — a local file is played and broadcast
// exactly the same way either way — but it is what the transport bar reads to
// call itself the room's music rather than a transmission, and keeping the two
// entry points distinguishable is the point of offering them separately.
export type LocalMediaMode = "video" | "music";

// Who may drive a file once it is playing. "anyone" is everybody in the room;
// what "owner" narrows it to depends on what the file *is*, and the two answers
// are the ones the rest of the app already uses:
//
//   - a file put on as a video is something a participant brought, so "owner"
//     is that person alone — the same meaning a room video source's has;
//   - a file put on as music is the room's soundtrack, so "owner" is the room's
//     management, exactly like a YouTube one (see the server's RoomMusicSource).
//     Whoever is playing it always controls it — it is their machine — and the
//     room's owner and admins may too, so an admin can skip a track they did
//     not choose.
//
// Nobody else's buttons can touch this machine's playback directly, so all of
// this works by relaying the action back to whoever is playing it (see
// useRoomMedia's file-control signal), which then does what it would have done
// if they had pressed it themselves. The room sees the result the same way it
// sees everything else about the file: as live video and audio.
export type LocalMediaControlMode = "owner" | "anyone";

// One broadcast channel each (see useRoomMedia), so a person can have several
// files going at once the way they can have a screen and a camera at once.
export const LOCAL_MEDIA_SLOTS = ["file1", "file2", "file3"] as const;
export type LocalMediaSlot = (typeof LOCAL_MEDIA_SLOTS)[number];

const VIDEO_EXTENSIONS = ["mp4", "webm", "ogv", "ogm", "mov", "m4v", "mkv"];
const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba"];

// What the picture is when there is no picture — an audio file, or a video
// whose metadata hasn't landed yet.
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isPlayableName(name: string): boolean {
  const ext = extensionOf(name);
  return VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext);
}

function mimeForName(name: string): string {
  const ext = extensionOf(name);
  if (VIDEO_EXTENSIONS.includes(ext)) return ext === "mkv" ? "video/x-matroska" : `video/${ext}`;
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  return `audio/${ext}`;
}

// Filenames sort the way a person expects rather than the way bytes do: "10"
// after "9", and case ignored. A folder of tracks is almost always numbered,
// and plain lexicographic order puts track 10 second.
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, formatLocale(), { numeric: true, sensitivity: "base" });
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `local-${idCounter}`;
}

class LocalMediaSource implements AudioTrackOwner {
  private listeners = new Set<Listener>();
  private element: HTMLVideoElement | null = null;
  private queue: LocalMediaItem[] = [];
  private index = 0;
  private playing = false;
  private position = 0;
  private duration = 0;
  private failed: string | null = null;
  private mode: LocalMediaMode = "video";
  private controlMode: LocalMediaControlMode = "owner";
  // Bumped whenever something a *viewer* would need to know changes — what is
  // playing, whether it is playing, where it is. useRoomMedia listens and
  // announces it to the room (see setSharing's `files`), which is what lets
  // someone else's transport show a real position for a file on this machine.
  private onAnnounce: (() => void) | null = null;

  constructor(readonly slot: LocalMediaSlot) {
    registerAudioTrackOwner(this);
  }

  // ─── Audio tracks (experiment "file-audio-tracks") ─────────────────────
  //
  // A file with two or more audio tracks gets them decoded by
  // MultiAudioEngine instead of by the element: each track has an output,
  // every output feeds a stream destination of its own (the tracks viewers
  // can be switched to, see lib/fileAudioTracks), and the room default's
  // output also feeds the main destination and this person's speakers. The
  // element's own audio is silenced meanwhile (elementGain), since it is
  // either the same audio or, for an AC3 first track, nothing at all.
  private audioTracks: FileAudioTrack[] = [];
  private audioTrack: number | null = null;
  private probed: { key: string; demuxer: AudioDemuxer; tracks: ProbedTrack[] } | null = null;
  private probeToken = 0;
  private engine: MultiAudioEngine | null = null;
  private elementGain: GainNode | null = null;
  private trackDestinations = new Map<number, MediaStreamAudioDestinationNode>();
  private routedDefault: GainNode | null = null;

  audioTrackOffer(): { key: string; tracks: FileAudioTrack[]; defaultIndex: number } | null {
    if (!this.engine || !this.probed || this.audioTrack === null || this.audioTracks.length < 2) return null;
    return { key: this.probed.key, tracks: this.audioTracks, defaultIndex: this.audioTrack };
  }

  outgoingAudioFor(index: number | null): MediaStreamTrack | null {
    const main = this.audioDestination?.stream.getAudioTracks()[0] ?? null;
    if (index === null || !this.engine || !this.engine.outputs.has(index)) return main;
    return this.trackDestination(index)?.stream.getAudioTracks()[0] ?? main;
  }

  private trackDestination(index: number): MediaStreamAudioDestinationNode | null {
    const context = this.audioContext;
    if (!context) return null;
    let destination = this.trackDestinations.get(index);
    if (!destination) {
      destination = context.createMediaStreamDestination();
      this.trackDestinations.set(index, destination);
    }
    return destination;
  }

  /** Called when the experiment flag flips. */
  audioTracksToggled() {
    if (audioTracksEnabled) {
      void this.probeCurrent();
      return;
    }
    this.stopEngine();
    this.probeToken += 1;
    this.probed = null;
    this.audioTracks = [];
    this.audioTrack = null;
    this.refresh();
  }

  // A different item is loaded: whatever was decoding for the last one goes.
  private itemChanged() {
    this.stopEngine();
    this.probeToken += 1;
    this.probed = null;
    this.audioTracks = [];
    this.audioTrack = null;
    void this.probeCurrent();
  }

  private async probeCurrent() {
    const item = this.current;
    if (!audioTracksEnabled || !item || !canDemux(item.name) || this.probed?.key === item.id) return;
    const token = ++this.probeToken;
    const demuxer = await openAudioDemuxer(item.blob, item.name);
    if (token !== this.probeToken || !demuxer || demuxer.tracks.length < 2) return;
    const tracks = await probeTracks(demuxer.tracks);
    if (token !== this.probeToken) return;
    this.probed = { key: item.id, demuxer, tracks };
    this.audioTracks = tracks.map((t) => describeTrack(t.info, t.supported));
    const supported = tracks.filter((t) => t.supported);
    const preferred = supported.find((t) => t.info.isDefault) ?? supported[0];
    this.audioTrack = preferred ? preferred.info.index : null;
    trackFeatureEvent(FILE_AUDIO_TRACKS_EVENTS.multiTrack, { value: tracks.length });
    if (supported.length < tracks.length) trackFeatureEvent(FILE_AUDIO_TRACKS_EVENTS.unsupported);
    this.maybeStartEngine();
    this.refresh();
  }

  private maybeStartEngine() {
    const probed = this.probed;
    const context = this.audioContext;
    const element = this.element;
    if (this.engine || !probed || !context || !element || !this.elementGain) return;
    if (probed.key !== this.current?.id || this.audioTrack === null) return;
    const engine = new MultiAudioEngine(element, context, probed.demuxer, probed.tracks, (index) =>
      this.trackFailed(index)
    );
    if (!engine.playable) {
      engine.dispose();
      return;
    }
    this.engine = engine;
    this.elementGain.gain.value = 0;
    for (const [index, out] of engine.outputs) {
      const destination = this.trackDestination(index);
      if (destination) out.connect(destination);
    }
    this.routeDefault();
    publishAudioTracks(this.slot);
  }

  // The room default's output into the main destination and the speakers.
  private routeDefault() {
    const previous = this.routedDefault;
    if (previous) {
      try {
        if (this.audioDestination) previous.disconnect(this.audioDestination);
        if (this.monitorGain) previous.disconnect(this.monitorGain);
      } catch {
        // Already disconnected (its engine went away).
      }
    }
    const out = this.audioTrack !== null ? this.engine?.outputs.get(this.audioTrack) : undefined;
    this.routedDefault = out ?? null;
    if (!out) return;
    if (this.audioDestination) out.connect(this.audioDestination);
    if (this.monitorGain) out.connect(this.monitorGain);
  }

  private stopEngine() {
    const engine = this.engine;
    if (!engine) return;
    this.engine = null;
    this.routedDefault = null;
    engine.dispose();
    if (this.elementGain) this.elementGain.gain.value = 1;
    publishAudioTracks(this.slot);
  }

  // A track whose decoder gave up mid-way: listed as unsupported from now on,
  // and if it was the default, the next one that works takes over.
  private trackFailed(index: number) {
    this.audioTracks = this.audioTracks.map((t) => (t.index === index ? { ...t, supported: false } : t));
    if (this.audioTrack === index) {
      const next = this.audioTracks.find((t) => t.supported && this.engine?.outputs.has(t.index));
      this.audioTrack = next ? next.index : null;
      if (next) this.routeDefault();
      else {
        this.stopEngine();
        this.refresh();
        return;
      }
    }
    publishAudioTracks(this.slot);
    this.refresh();
  }

  /** The room's default track, which is also the one this person hears. */
  setAudioTrack(index: number) {
    if (!this.engine?.outputs.has(index) || this.audioTrack === index) return;
    this.audioTrack = index;
    this.routeDefault();
    trackFeatureEvent(FILE_AUDIO_TRACKS_EVENTS.defaultChange);
    publishAudioTracks(this.slot);
    this.refresh();
  }

  // The broadcast plumbing. All of it exists to solve one problem: the
  // obvious approach — HTMLMediaElement.captureStream() — produces tracks
  // that *end* when the element's source changes, and the share pipeline
  // stops a share whose tracks ended (see the "ended" listeners in
  // useBroadcastChannel's start). That would make a queue of one file work
  // and a folder of twelve stop after the first.
  //
  // So the element is never captured directly. Its picture is drawn onto a
  // canvas and its sound is routed through a WebAudio graph, and it is those
  // two — a canvas and a MediaStreamAudioDestinationNode, neither of which
  // knows or cares what the element is playing — that the room receives.
  // Advancing the queue then changes what is drawn and heard, not what is
  // connected, and the share continues without a renegotiation.
  private canvas: HTMLCanvasElement | null = null;
  private drawTimer: ReturnType<typeof setInterval> | null = null;
  private audioContext: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  private monitorGain: GainNode | null = null;
  private stream: MediaStream | null = null;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // One frozen object per change, so useSyncExternalStore's identity check
  // does the right thing instead of tearing on every timeupdate.
  private snapshot: {
    queue: LocalMediaItem[];
    index: number;
    playing: boolean;
    position: number;
    duration: number;
    failed: string | null;
    mode: LocalMediaMode;
    controlMode: LocalMediaControlMode;
    audioTracks: FileAudioTrack[];
    audioTrack: number | null;
  } = {
    queue: [],
    index: 0,
    playing: false,
    position: 0,
    duration: 0,
    failed: null,
    mode: "video",
    controlMode: "owner",
    audioTracks: [],
    audioTrack: null,
  };

  getSnapshot = () => this.snapshot;

  private refresh() {
    this.snapshot = {
      queue: this.queue,
      index: this.index,
      playing: this.playing,
      position: this.position,
      duration: this.duration,
      failed: this.failed,
      mode: this.mode,
      controlMode: this.controlMode,
      audioTracks: this.audioTracks,
      audioTrack: this.audioTrack,
    };
    for (const listener of this.listeners) listener();
  }

  // A change the room has to hear about, as opposed to one only this tab's UI
  // cares about (a timeupdate tick). Deliberately only the discrete events —
  // play, pause, seek, track change, duration — because a playing file's
  // position is a function of time and everyone else extrapolates it from the
  // last one of these, exactly like a room video source does.
  private announce() {
    this.refresh();
    this.onAnnounce?.();
  }

  setAnnounceListener(listener: (() => void) | null) {
    this.onAnnounce = listener;
  }

  setControlMode(mode: LocalMediaControlMode) {
    this.controlMode = mode;
    this.announce();
  }

  get currentControlMode(): LocalMediaControlMode {
    return this.controlMode;
  }

  get current(): LocalMediaItem | null {
    return this.queue[this.index] ?? null;
  }

  get hasQueue(): boolean {
    return this.queue.length > 0;
  }

  // What is playing, for the caption the room is told about (see
  // signalingClient.setSharing's fileName). Just the filename: the folders
  // above it are this person's disk layout, not something a tile in someone
  // else's room should be showing.
  get currentName(): string | null {
    const item = this.current;
    if (!item) return null;
    return item.name.split("/").pop() ?? item.name;
  }

  // Never appended to the document: an element that was never inserted still
  // decodes, still draws to a canvas and still feeds a WebAudio graph, and
  // keeping it out of the tree is what lets it outlive every component.
  private ensureElement(): HTMLVideoElement {
    if (this.element) return this.element;
    const el = document.createElement("video");
    el.playsInline = true;
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.addEventListener("play", () => {
      this.playing = true;
      this.announce();
    });
    el.addEventListener("pause", () => {
      this.playing = false;
      this.announce();
    });
    el.addEventListener("seeked", () => {
      this.position = el.currentTime || 0;
      this.announce();
    });
    el.addEventListener("timeupdate", () => {
      this.position = el.currentTime || 0;
      this.refresh();
    });
    el.addEventListener("durationchange", () => {
      this.duration = Number.isFinite(el.duration) ? el.duration : 0;
      this.announce();
    });
    el.addEventListener("loadedmetadata", () => this.resizeCanvas());
    el.addEventListener("ended", () => {
      // Straight into the next one, which is the whole point of picking a
      // folder or a zip rather than a single file.
      if (this.index < this.queue.length - 1) void this.playAt(this.index + 1);
      else {
        this.playing = false;
        this.refresh();
      }
    });
    el.addEventListener("error", () => {
      const item = this.current;
      this.failed = item
        ? translate("localMediaSource.theBrowserCouldNotPlayName", { name: item.name })
        : translate("localMediaSource.theBrowserCouldNotPlayThat");
      this.refresh();
      // One bad file in a folder of fifty should not end the session — move
      // on, the same way any player does.
      if (this.index < this.queue.length - 1) {
        setTimeout(() => void this.playAt(this.index + 1), 1200);
      }
    });
    this.element = el;
    return el;
  }

  // The largest picture any viewer can be sent: the share's resolution dial
  // (see setMaxSize). Nobody is ever served above it — the per-viewer tiers
  // are capped by the same dial — so a canvas bigger than this was pure cost:
  // a 4K film was redrawn at 4K every frame in this tab, then shrunk again by
  // every viewer's encoder. That is most of what made a big file slow to get
  // going and heavy to keep playing.
  private maxWidth = Infinity;
  private maxHeight = Infinity;

  setMaxSize(width: number, height: number) {
    if (this.maxWidth === width && this.maxHeight === height) return;
    this.maxWidth = width;
    this.maxHeight = height;
    this.resizeCanvas();
  }

  private resizeCanvas() {
    const el = this.element;
    const canvas = this.canvas;
    if (!el || !canvas) return;
    const sourceWidth = el.videoWidth || FALLBACK_WIDTH;
    const sourceHeight = el.videoHeight || FALLBACK_HEIGHT;
    // Fitted inside the box, aspect kept, never enlarged. Even numbers: an
    // odd dimension costs the encoder a padded row or column.
    const scale = Math.min(1, this.maxWidth / sourceWidth, this.maxHeight / sourceHeight);
    const width = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  private draw() {
    const canvas = this.canvas;
    const el = this.element;
    if (!canvas || !el) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (el.videoWidth > 0 && el.videoHeight > 0) {
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      return;
    }
    // No picture: an audio file, or a video still loading. A black rectangle
    // would read as "the share is broken", so draw what is playing instead.
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const item = this.current;
    if (!item) return;
    ctx.fillStyle = "#e4e4e7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(canvas.height / 16)}px system-ui, sans-serif`;
    // Just the filename, not the folders above it — this is a poster, not a
    // path readout, and a long path shrinks the one part that matters.
    const label = item.name.split("/").pop() ?? item.name;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width * 0.9);
    ctx.font = `400 ${Math.round(canvas.height / 28)}px system-ui, sans-serif`;
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(
      this.queue.length > 1 ? `${this.index + 1} de ${this.queue.length}` : translate("localMediaSource.audio"),
      canvas.width / 2,
      canvas.height / 2 + canvas.height / 10,
      canvas.width * 0.9
    );
  }

  // The live stream of whatever is playing. Called by useRoomMedia's capture
  // when the share source is "file", inside the click that started the share.
  async captureStream(fps: number): Promise<MediaStream> {
    if (!this.hasQueue) throw new Error(translate("localMediaSource.chooseAFileToBroadcastFirst"));
    const el = this.ensureElement();
    if (this.stream) return this.stream;

    if (typeof AudioContext === "undefined") {
      throw new Error(translate("localMediaSource.thisBrowserDoesNotAllowBroadcasting"));
    }

    // Music carries no picture at all. Skipping the canvas is not a cosmetic
    // choice: it drops a redraw timer and a whole video encode per slot, for a
    // rectangle whose only viewer-facing job would be to sit invisibly behind
    // a strip (see LocalMusicBar, which plays the audio and draws none of it).
    const wantsVideo = this.mode !== "music";

    // Video: a canvas redrawn on a timer rather than requestAnimationFrame.
    // rAF stops entirely in a background tab, which would freeze the room's
    // picture the moment the person sharing switches windows; a throttled
    // timer degrades to about a frame a second instead, which is worse than
    // full rate and far better than a still image.
    let stream: MediaStream;
    if (wantsVideo) {
      const canvas = document.createElement("canvas");
      canvas.width = FALLBACK_WIDTH;
      canvas.height = FALLBACK_HEIGHT;
      this.canvas = canvas;
      this.resizeCanvas();
      this.draw();
      if (this.drawTimer) clearInterval(this.drawTimer);
      this.drawTimer = setInterval(() => this.draw(), Math.max(1000 / Math.max(fps, 1), 16));
      stream = canvas.captureStream(fps);
    } else {
      stream = new MediaStream();
    }

    // Audio: the element feeds two places at once — the room, through a
    // stream destination, and this person's own speakers, through a gain node
    // they can turn down. Two separate paths on purpose: createMediaElementSource
    // *takes* the element's audio away from the speakers, so without the
    // monitor branch the broadcaster would hear nothing, and putting the gain
    // in front of both would mean turning it down for everybody.
    const context = new AudioContext();
    this.audioContext = context;
    const sourceNode = context.createMediaElementSource(el);
    const destination = context.createMediaStreamDestination();
    this.audioDestination = destination;
    const monitor = context.createGain();
    monitor.gain.value = 1;
    this.monitorGain = monitor;
    // The element's own audio, silenced while the audio-track engine plays
    // the file's tracks instead (see maybeStartEngine).
    const elementGain = context.createGain();
    this.elementGain = elementGain;
    sourceNode.connect(elementGain);
    elementGain.connect(destination);
    elementGain.connect(monitor);
    monitor.connect(context.destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);

    // Started here rather than in the picker so the play lands inside the same
    // gesture as the share — and after the graph is wired, so no audio is lost
    // before the destination exists.
    try {
      await context.resume();
    } catch {
      // A context that refuses to resume still produces a silent track; the
      // transport's play button is the way out.
    }
    try {
      await el.play();
    } catch {
      // Same.
    }

    this.stream = stream;
    // A multi-track file probed before the share started gets its engine
    // now that there is a graph to play it into.
    this.maybeStartEngine();
    return stream;
  }

  // Replaces the queue wholesale. Everything the previous one held — object
  // URLs, and for a zip the extracted blobs those URLs are the only reference
  // to — is released here.
  setQueue(
    items: LocalMediaItem[],
    mode: LocalMediaMode = "video",
    controlMode: LocalMediaControlMode = "owner"
  ) {
    for (const item of this.queue) URL.revokeObjectURL(item.url);
    this.queue = items;
    this.mode = mode;
    this.controlMode = controlMode;
    this.index = 0;
    this.failed = null;
    this.position = 0;
    this.duration = 0;
    if (items.length > 0) {
      const el = this.ensureElement();
      el.src = items[0].url;
      el.load();
    }
    this.itemChanged();
    this.refresh();
  }

  async playAt(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    const el = this.ensureElement();
    this.index = index;
    this.failed = null;
    this.position = 0;
    this.duration = 0;
    el.src = this.queue[index].url;
    el.load();
    this.itemChanged();
    this.announce();
    try {
      await el.play();
    } catch {
      // The transport's play button is the fallback.
    }
  }

  togglePlay() {
    const el = this.element;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  seekTo(seconds: number) {
    const el = this.element;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
  }

  next() {
    void this.playAt(this.index + 1);
  }

  previous() {
    const el = this.element;
    // Restart the current track when it is already well underway — the
    // gesture everyone expects from a "previous" button.
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    void this.playAt(this.index - 1);
  }

  // Volume in the *broadcaster's own* ears only — see the monitor branch in
  // captureStream. The room's copy is taken before this node.
  setLocalVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    if (this.monitorGain) this.monitorGain.gain.value = clamped;
    // Before the graph exists (queue loaded, share not started yet) the
    // element still plays straight to the speakers, so this is where the
    // volume lives at that point.
    else if (this.element) this.element.volume = clamped;
  }

  // Applies a request that came from someone else in the room. The check lives
  // here, on the machine that would act on it, rather than only in the UI that
  // offers the buttons — see LocalMediaControlMode for what each mode admits.
  applyRemote(request: LocalMediaAction, fromRoomManager: boolean) {
    const allowed =
      this.controlMode === "anyone" || (this.mode === "music" && fromRoomManager);
    if (!allowed) return;
    switch (request.action) {
      case "toggle":
        this.togglePlay();
        break;
      case "next":
        this.next();
        break;
      case "previous":
        this.previous();
        break;
      case "seek":
        this.seekTo(request.seconds);
        this.announce();
        break;
      case "playAt":
        void this.playAt(request.index);
        break;
    }
  }

  // Called when the share stops. The queue is kept — starting the same files
  // again should not mean picking them again — but playback stops and the
  // whole broadcast graph is torn down, since its tracks went with the share.
  release() {
    // Before the graph goes: its outputs are nodes of the context closed below.
    // The probe result is kept — the same file on the next share needs no
    // second reading of its headers.
    this.stopEngine();
    this.trackDestinations.clear();
    this.elementGain = null;
    if (this.drawTimer) {
      clearInterval(this.drawTimer);
      this.drawTimer = null;
    }
    this.stream = null;
    this.canvas = null;
    this.audioDestination = null;
    this.monitorGain = null;
    this.element?.pause();
    // The element's audio was rerouted into the graph by
    // createMediaElementSource and cannot be routed back — closing the
    // context is what returns it to the speakers, and a fresh graph is built
    // from scratch on the next share.
    const context = this.audioContext;
    this.audioContext = null;
    if (context) void context.close().catch(() => {});
    // createMediaElementSource may only be called once per element, so the
    // next share needs a new one. Dropping this reference is what makes
    // ensureElement build it.
    const element = this.element;
    this.element = null;
    if (element) element.removeAttribute("src");
    this.playing = false;
    // Whatever is in the queue is still there and still playable — the next
    // start reloads item `index` onto the fresh element.
    if (this.queue.length > 0) {
      const el = this.ensureElement();
      el.src = this.queue[this.index].url;
      el.load();
    }
    this.refresh();
  }
}

// One per slot, built once. Which one a picker fills is decided by
// nextFreeLocalMediaSlot below.
export const localMediaSources: Record<LocalMediaSlot, LocalMediaSource> = {
  file1: new LocalMediaSource("file1"),
  file2: new LocalMediaSource("file2"),
  file3: new LocalMediaSource("file3"),
};

// The first slot with nothing in it, or null when all three are busy. Adding a
// file fills a free slot rather than replacing whatever was playing — the same
// thing adding a second YouTube source does, and the reason there is more than
// one slot at all.
export function nextFreeLocalMediaSlot(
  isBusy: (slot: LocalMediaSlot) => boolean
): LocalMediaSlot | null {
  return LOCAL_MEDIA_SLOTS.find((slot) => !isBusy(slot)) ?? null;
}

// Where a file being played on somebody *else's* machine should be right now,
// extrapolated from the last state they announced (see PeerInfo.files). Same
// arithmetic, and the same reasoning, as a room video source's: a playing
// file's position is a function of time, so nobody has to stream positions for
// a viewer's scrubber to track one. A negative elapsed time (this viewer's
// clock behind the server's stamp) reads as "no time has passed" rather than
// as a rewind.
export function localFilePosition(
  file: { playing: boolean; positionSeconds: number; updatedAt: number },
  now = Date.now()
): number {
  if (!file.playing) return file.positionSeconds;
  return file.positionSeconds + Math.max(0, (now - file.updatedAt) / 1000);
}

// What a viewer's transport asks the person playing a file to do. Relayed to
// them through the ordinary signalling path (see useRoomMedia), and only
// honoured when that file's controlMode says "anyone" — checked on the machine
// that would act on it, which is the only place the answer is authoritative.
export type LocalMediaAction =
  | { action: "toggle" }
  | { action: "next" }
  | { action: "previous" }
  | { action: "seek"; seconds: number }
  | { action: "playAt"; index: number };

// The path inside the chosen folder when there is one, so a queue built from
// two different albums is still readable.
function relativeName(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

// Builds a queue from whatever the picker produced: one file, every playable
// file in a folder, or the playable entries of a zip. Folders arrive as a flat
// FileList with webkitRelativePath set, so a folder and a multi-select look
// the same from here.
export async function buildLocalMediaQueue(files: File[]): Promise<LocalMediaItem[]> {
  const items: LocalMediaItem[] = [];
  const zips = files.filter((f) => extensionOf(f.name) === "zip");
  const plain = files.filter((f) => isPlayableName(f.name));

  for (const file of [...plain].sort((a, b) => compareNames(relativeName(a), relativeName(b)))) {
    items.push({
      id: nextId(),
      name: relativeName(file),
      url: URL.createObjectURL(file),
      hasVideo: VIDEO_EXTENSIONS.includes(extensionOf(file.name)),
      blob: file,
    });
  }

  for (const zip of zips) {
    const entries = (await readZipEntries(zip))
      .filter((entry) => isPlayableName(entry.name))
      .sort((a, b) => compareNames(a.name, b.name));
    for (const entry of entries) {
      // Extracted up front rather than on demand: a queue that starts failing
      // halfway through is worse than one that took a moment to open, and a
      // deflated entry has to be inflated whole before it can be played at all.
      const blob = await readZipEntryBlob(zip, entry, mimeForName(entry.name));
      items.push({
        id: nextId(),
        name: entry.name,
        url: URL.createObjectURL(blob),
        hasVideo: VIDEO_EXTENSIONS.includes(extensionOf(entry.name)),
        blob,
      });
    }
  }

  return items;
}

export { ZipError };
