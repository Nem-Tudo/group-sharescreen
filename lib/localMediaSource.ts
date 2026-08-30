"use client";

import { readZipEntries, readZipEntryBlob, ZipError } from "./zipReader";

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
// A module-level singleton rather than React state: the playback has to
// outlive any component (the capture function in useRoomMedia reaches for it,
// and so does the transport UI), and there is exactly one local playback at a
// time because there is exactly one screen channel to carry it.

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
};

type Listener = () => void;

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
  return a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `local-${idCounter}`;
}

class LocalMediaSource {
  private listeners = new Set<Listener>();
  private element: HTMLVideoElement | null = null;
  private queue: LocalMediaItem[] = [];
  private index = 0;
  private playing = false;
  private position = 0;
  private duration = 0;
  private failed: string | null = null;

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
  } = { queue: [], index: 0, playing: false, position: 0, duration: 0, failed: null };

  getSnapshot = () => this.snapshot;

  private refresh() {
    this.snapshot = {
      queue: this.queue,
      index: this.index,
      playing: this.playing,
      position: this.position,
      duration: this.duration,
      failed: this.failed,
    };
    for (const listener of this.listeners) listener();
  }

  get current(): LocalMediaItem | null {
    return this.queue[this.index] ?? null;
  }

  get hasQueue(): boolean {
    return this.queue.length > 0;
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
      this.refresh();
    });
    el.addEventListener("pause", () => {
      this.playing = false;
      this.refresh();
    });
    el.addEventListener("timeupdate", () => {
      this.position = el.currentTime || 0;
      this.refresh();
    });
    el.addEventListener("durationchange", () => {
      this.duration = Number.isFinite(el.duration) ? el.duration : 0;
      this.refresh();
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
        ? `O navegador não conseguiu tocar "${item.name}".`
        : "O navegador não conseguiu tocar esse arquivo.";
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

  private resizeCanvas() {
    const el = this.element;
    const canvas = this.canvas;
    if (!el || !canvas) return;
    const width = el.videoWidth || FALLBACK_WIDTH;
    const height = el.videoHeight || FALLBACK_HEIGHT;
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
      this.queue.length > 1 ? `${this.index + 1} de ${this.queue.length}` : "áudio",
      canvas.width / 2,
      canvas.height / 2 + canvas.height / 10,
      canvas.width * 0.9
    );
  }

  // The live stream of whatever is playing. Called by useRoomMedia's capture
  // when the share source is "file", inside the click that started the share.
  async captureStream(fps: number): Promise<MediaStream> {
    if (!this.hasQueue) throw new Error("Escolha um arquivo para transmitir primeiro.");
    const el = this.ensureElement();
    if (this.stream) return this.stream;

    if (typeof AudioContext === "undefined") {
      throw new Error("Este navegador não permite transmitir arquivos locais.");
    }

    // Video: a canvas redrawn on a timer rather than requestAnimationFrame.
    // rAF stops entirely in a background tab, which would freeze the room's
    // picture the moment the person sharing switches windows; a throttled
    // timer degrades to about a frame a second instead, which is worse than
    // full rate and far better than a still image.
    const canvas = document.createElement("canvas");
    canvas.width = FALLBACK_WIDTH;
    canvas.height = FALLBACK_HEIGHT;
    this.canvas = canvas;
    this.resizeCanvas();
    this.draw();
    if (this.drawTimer) clearInterval(this.drawTimer);
    this.drawTimer = setInterval(() => this.draw(), Math.max(1000 / Math.max(fps, 1), 16));
    const stream = canvas.captureStream(fps);

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
    sourceNode.connect(destination);
    sourceNode.connect(monitor);
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
    return stream;
  }

  // Replaces the queue wholesale. Everything the previous one held — object
  // URLs, and for a zip the extracted blobs those URLs are the only reference
  // to — is released here.
  setQueue(items: LocalMediaItem[]) {
    for (const item of this.queue) URL.revokeObjectURL(item.url);
    this.queue = items;
    this.index = 0;
    this.failed = null;
    this.position = 0;
    this.duration = 0;
    if (items.length > 0) {
      const el = this.ensureElement();
      el.src = items[0].url;
      el.load();
    }
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
    this.refresh();
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

  // Called when the share stops. The queue is kept — starting the same files
  // again should not mean picking them again — but playback stops and the
  // whole broadcast graph is torn down, since its tracks went with the share.
  release() {
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

export const localMediaSource = new LocalMediaSource();

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
      });
    }
  }

  return items;
}

export { ZipError };
