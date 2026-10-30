"use client";

import { useSyncExternalStore } from "react";
import { trackTileExperiment, TILE_EXPERIMENT_EVENTS } from "./clipsMode";
import { trackFeatureEvent } from "./features";
import { accountTierOf, tierAtLeast } from "./entitlements";
import { isMobileDevice } from "./announcement";

// "Efeitos de câmera" (experiment "camera-effects"): background blur, colour
// filters and face overlays (dog, cat, sunglasses, clown, crown, bunny, bear,
// pig, mustache, heart eyes, devil, angel, pirate, party hat) drawn into
// the camera before it is sent, so whoever watches needs nothing at all.
// Experiment "camera-effects-3d" adds 3D objects that follow the head turning
// (cinema 3D glasses, top hat, viking helmet), in with the other faces, and
// the reactions: a switch of their own, on top of any face, that turns what
// the face, head and hands do into particles (a blink throws sparkles, a
// smile hearts, a clap confetti...) — see CAMERA_FACES_3D and
// CameraReactions. Experiment "camera-warp" adds the warps: the face itself
// pushed around (sad, angry, fat, thin...), nothing drawn on it — see
// CameraWarp.
//
// The work is in public/workers/camera-effects.js (the frame loop), which
// starts public/workers/camera-detect.js for the models (MediaPipe), so a
// model loading never holds the frames up. This side only wires the camera
// track to it:
//
//   camera track → MediaStreamTrackProcessor → (worker) → MediaStreamTrackGenerator
//
// and hands the generator to the room in the camera track's place. Those two
// exist on the page in Chromium only (Chrome, Edge, the desktop app, Android).
// Safari (iPhone, iOS 18 and up) has the standard ones instead, which live in
// workers only: there a clone of the camera is transferred into the worker,
// which builds the processor and a VideoTrackGenerator itself and sends the
// generated track back (see createWorkerEffectsTrack). Whether a browser has
// either is what offers the switch; see cameraEffectsSupported.
//
// What it costs when nobody picked anything is nothing: no worker exists
// until an effect is chosen, and a camera started with none is the plain
// capture. One that had effects earlier in the same session keeps its
// pipeline, but the worker passes frames straight through without drawing.

export type CameraBackground =
  | "none"
  | "blur"
  | "sunset"
  | "beach"
  | "space"
  | "office"
  | "aurora"
  | "studio"
  // An image of the person's own (Pro Max and up), kept in this browser —
  // see setCustomCameraBackground.
  | "custom"
  // A transmission in the room, live (Pro Max and up, experiment
  // "camera-stream-bg") — see setCameraBackgroundTrack. Never stored: which
  // one only means something in this room, this visit.
  | "stream";
export type CameraColor = "none" | "mono" | "sepia" | "vivid";
export type CameraFace =
  | "none"
  | "dog"
  | "cat"
  | "bunny"
  | "bear"
  | "pig"
  | "glasses"
  | "hearts"
  | "pirate"
  | "mustache"
  | "clown"
  | "crown"
  | "devil"
  | "angel"
  | "party"
  | "glasses3d"
  | "tophat3d"
  | "viking3d";

// The reactions (experiment "camera-effects-3d"): on or off, beside the face.
export type CameraReactions = "none" | "on";

// The warps (experiment "camera-warp"): the picture of the face moved around
// its landmarks, no drawing on top. Beside the face, so a dog nose can go on
// a fat face.
export type CameraWarp =
  | "none"
  | "sad"
  | "angry"
  | "happy"
  | "surprised"
  | "fat"
  | "thin"
  | "bigeyes"
  | "bighead";

export interface CameraEffectSettings {
  background: CameraBackground;
  color: CameraColor;
  face: CameraFace;
  reactions: CameraReactions;
  warp: CameraWarp;
}

export const CAMERA_REACTIONS: CameraReactions[] = ["none", "on"];
export const CAMERA_WARPS: CameraWarp[] = [
  "none",
  "sad",
  "angry",
  "happy",
  "surprised",
  "fat",
  "thin",
  "bigeyes",
  "bighead",
];

// The ones offered as plain choices; "custom" has a control of its own.
export const CAMERA_BACKGROUNDS: CameraBackground[] = [
  "none",
  "blur",
  "sunset",
  "beach",
  "space",
  "office",
  "aurora",
  "studio",
];
export const CAMERA_COLORS: CameraColor[] = ["none", "mono", "sepia", "vivid"];
export const CAMERA_FACES: CameraFace[] = [
  "none",
  "dog",
  "cat",
  "bunny",
  "bear",
  "pig",
  "glasses",
  "hearts",
  "pirate",
  "mustache",
  "clown",
  "crown",
  "devil",
  "angel",
  "party",
];

// Only for whoever is in experiment "camera-effects-3d" (these and the
// reactions): offered after the other faces, and dropped back to nothing for
// anyone outside it (see effectiveCameraEffects) — a choice stored while in it
// must not keep drawing once the experiment is gone.
export const CAMERA_FACES_3D: CameraFace[] = ["glasses3d", "tophat3d", "viking3d"];
export const CAMERA_EFFECTS_3D_FEATURE = "camera-effects-3d";
export const CAMERA_EFFECTS_3D_EVENTS = {
  pick: "camera_fx3d_pick", // escolheu um dos efeitos 3D ou ligou as reações
  reaction: "camera_fx3d_reaction", // uma reação disparou (uma vez por tipo de reação por sessão)
  error: "camera_fx3d_error", // o Three.js não carregou, ou o desenho 3D falhou
  slow: "camera_fx3d_slow", // value: ms por quadro com efeito 3D (uma vez por sessão, acima de 30)
};

function track3d(name: string, value?: number) {
  trackFeatureEvent(name, {
    feature: CAMERA_EFFECTS_3D_FEATURE,
    ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
  });
}

// Only for whoever is in experiment "camera-warp"; dropped back to nothing for
// anyone outside it, like the 3D ones.
export const CAMERA_WARP_FEATURE = "camera-warp";
export const CAMERA_WARP_EVENTS = {
  pick: "camera_warp_pick", // escolheu uma distorção
  error: "camera_warp_error", // o WebGL da distorção não abriu, ou o desenho falhou
  slow: "camera_warp_slow", // value: ms por quadro com distorção (uma vez por sessão, acima de 30)
};

function trackWarp(name: string, value?: number) {
  trackFeatureEvent(name, {
    feature: CAMERA_WARP_FEATURE,
    ...(value ? { value: Math.max(1, Math.round(value)) } : {}),
  });
}

/**
 * `settings` as they may actually be drawn: a 3D face (or a warp) taken away
 * from whoever is not in its experiment, and the custom background (or a
 * transmission as the background) from whoever is not on the plan for it, or
 * has no image stored (no transmission picked, or it ended).
 */
export function effectiveCameraEffects(
  settings: CameraEffectSettings,
  allow3d: boolean,
  allowCustomBackground: boolean,
  allowWarp: boolean,
  allowStreamBackground: boolean
): CameraEffectSettings {
  let next = settings;
  if (!allowStreamBackground && next.background === "stream") next = { ...next, background: "none" };
  if (!allowWarp && next.warp !== "none") next = { ...next, warp: "none" };
  if (!allow3d && CAMERA_FACES_3D.includes(next.face)) next = { ...next, face: "none" };
  if (!allow3d && next.reactions !== "none") next = { ...next, reactions: "none" };
  if (!allowCustomBackground && next.background === "custom") next = { ...next, background: "none" };
  return next;
}

// ---------------------------------------------------------------------------
// The custom background (Pro Max and up)

export const CUSTOM_BACKGROUND_TIER = "premium_max" as const;

// Experiment "custom-bg-free": the custom background for anyone, whatever
// the plan, to see whether it gets used (and whether locking it sells Pro Max).
export const CUSTOM_BG_FREE_FEATURE = "custom-bg-free";

/** The plan alone, without the experiment: what decides who it changes anything for. */
export function planAllowsCustomBackground(flags: readonly string[] | undefined | null): boolean {
  return tierAtLeast(accountTierOf(flags), CUSTOM_BACKGROUND_TIER);
}

export function canUseCustomBackground(flags: readonly string[] | undefined | null, free: boolean): boolean {
  return free || planAllowsCustomBackground(flags);
}

// A JPEG data URL in localStorage: shrunk to fit MAX_CUSTOM_BACKGROUND_SIDE so
// it stays a couple of hundred KB, well inside the quota, and is there again
// on the next visit without anything going to the server.
const CUSTOM_BACKGROUND_KEY = "sharescreen:cameraBackgroundImage";
const MAX_CUSTOM_BACKGROUND_SIDE = 1280;
const MAX_CUSTOM_BACKGROUND_BYTES = 20 * 1024 * 1024;

let customCached: string | null | undefined;
const customListeners = new Set<() => void>();

function readCustomBackground(): string | null {
  if (customCached !== undefined) return customCached;
  try {
    customCached = window.localStorage.getItem(CUSTOM_BACKGROUND_KEY);
  } catch {
    customCached = null;
  }
  return customCached;
}

/** The stored custom background, as a data URL (for the thumbnail), or null. */
export function useCustomCameraBackground(): string | null {
  return useSyncExternalStore(
    (listener) => {
      customListeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== CUSTOM_BACKGROUND_KEY) return;
        customCached = undefined;
        listener();
        void pushCustomBackground();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        customListeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    readCustomBackground,
    () => null
  );
}

/**
 * Takes an image file as the custom background and picks it. Throws (with
 * nothing changed) for a file that is not a readable image, or one too big
 * to keep.
 */
export async function setCustomCameraBackground(file: File): Promise<void> {
  if (!file.type.startsWith("image/") || file.size > MAX_CUSTOM_BACKGROUND_BYTES) {
    throw new Error("not an image");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_CUSTOM_BACKGROUND_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  // Throws on a full quota, before anything is switched over to it.
  window.localStorage.setItem(CUSTOM_BACKGROUND_KEY, dataUrl);
  customCached = dataUrl;
  customListeners.forEach((listener) => listener());
  trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.bgUpload);
  await pushCustomBackground();
  setCameraEffect("background", "custom");
}

// The worker gets the image decoded, once per worker and once per change.
let customPushed = 0;
async function pushCustomBackground() {
  const target = worker;
  if (!target) return;
  const push = ++customPushed;
  const dataUrl = readCustomBackground();
  let bitmap: ImageBitmap | null = null;
  if (dataUrl) {
    try {
      bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    } catch {
      bitmap = null;
    }
  }
  // A newer push, or another worker, took over while this one decoded.
  if (push !== customPushed || worker !== target) {
    bitmap?.close();
    return;
  }
  target.postMessage({ type: "background-image", bitmap }, bitmap ? [bitmap] : []);
}

export const CAMERA_EFFECTS_FEATURE = "camera-effects";

// Versioned: public/ files are cached by Cloudflare for a month under their
// plain URL, so a fixed worker kept being served as the old one. Bump this
// whenever public/workers/camera-effects.js or camera-detect.js changes (the
// detector is loaded with the same ?v=).
const WORKER_VERSION = 12;
const WORKER_URL = `/workers/camera-effects.js?v=${WORKER_VERSION}`;
const SETTINGS_KEY = "sharescreen:cameraEffects";
// How long the worker (and the models it loaded) outlives the last camera
// using it: long enough that a stop and start, or a flip, does not load
// everything again; short enough not to sit on the memory all call.
const WORKER_IDLE_MS = 30_000;
// Average time per drawn frame past which the session is reported as slow.
const SLOW_FRAME_MS = 30;

const NONE: CameraEffectSettings = { background: "none", color: "none", face: "none", reactions: "none", warp: "none" };

export function hasAnyCameraEffect(settings: CameraEffectSettings): boolean {
  return (
    settings.background !== "none" ||
    settings.color !== "none" ||
    settings.face !== "none" ||
    settings.reactions !== "none" ||
    settings.warp !== "none"
  );
}

// ---------------------------------------------------------------------------
// What the person picked (per browser)

const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY) {
      cached = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function pick<T extends string>(value: unknown, options: T[]): T {
  return options.includes(value as T) ? (value as T) : options[0];
}

// Parsed once per change, so the snapshot keeps its identity between renders.
let cached: CameraEffectSettings | null = null;
function readSettings(): CameraEffectSettings {
  if (cached) return cached;
  let parsed: Partial<Record<keyof CameraEffectSettings, unknown>> = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") ?? {};
  } catch {
    parsed = {};
  }
  cached = {
    background: pick(parsed.background, [...CAMERA_BACKGROUNDS, "custom"]),
    color: pick(parsed.color, CAMERA_COLORS),
    face: pick(parsed.face, [...CAMERA_FACES, ...CAMERA_FACES_3D]),
    // The reactions were a face once: carried over to their own switch.
    reactions: parsed.face === "reactions" && parsed.reactions === undefined ? "on" : pick(parsed.reactions, CAMERA_REACTIONS),
    warp: pick(parsed.warp, CAMERA_WARPS),
  };
  return cached;
}

export function useCameraEffectSettings(): CameraEffectSettings {
  return useSyncExternalStore(subscribe, readSettings, () => NONE);
}

export function setCameraEffect<K extends keyof CameraEffectSettings>(
  key: K,
  value: CameraEffectSettings[K]
) {
  const next = { ...readSettings(), [key]: value };
  cached = next;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage refused — the choice just won't survive a reload.
  }
  if (value !== "none") trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.pick);
  if (
    (key === "face" && CAMERA_FACES_3D.includes(value as CameraFace)) ||
    (key === "reactions" && value === "on")
  ) {
    track3d(CAMERA_EFFECTS_3D_EVENTS.pick);
  }
  if (key === "warp" && value !== "none") trackWarp(CAMERA_WARP_EVENTS.pick);
  emit();
}

// ---------------------------------------------------------------------------
// Whether this browser can run it

type TrackProcessor = { readable: ReadableStream };
type TrackProcessorCtor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => TrackProcessor;
type TrackGenerator = MediaStreamTrack & { writable: WritableStream };
type TrackGeneratorCtor = new (init: { kind: "video" }) => TrackGenerator;

function insertableStreams(): { Processor: TrackProcessorCtor; Generator: TrackGeneratorCtor } | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    MediaStreamTrackProcessor?: TrackProcessorCtor;
    MediaStreamTrackGenerator?: TrackGeneratorCtor;
  };
  if (!scope.MediaStreamTrackProcessor || !scope.MediaStreamTrackGenerator) return null;
  if (typeof OffscreenCanvas === "undefined" || typeof VideoFrame === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  return { Processor: scope.MediaStreamTrackProcessor, Generator: scope.MediaStreamTrackGenerator };
}

// The worker-only kind (Safari) can only be seen from inside a worker: a
// throwaway one is asked once per page, the first time anyone wants to know.
// null: not asked yet, or not answered yet.
let workerTracks: boolean | null = null;
let workerTracksProbe: Promise<boolean> | null = null;
const supportListeners = new Set<() => void>();

function probeWorkerTracks(): Promise<boolean> {
  if (workerTracksProbe) return workerTracksProbe;
  workerTracksProbe = new Promise<boolean>((resolve) => {
    if (typeof Worker === "undefined" || typeof MediaStreamTrack === "undefined") {
      resolve(false);
      return;
    }
    let probe: Worker;
    try {
      probe = new Worker(WORKER_URL);
    } catch {
      resolve(false);
      return;
    }
    const done = (answer: boolean) => {
      clearTimeout(timer);
      probe.terminate();
      resolve(answer);
    };
    const timer = setTimeout(() => done(false), 10_000);
    probe.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; workerTracks?: boolean };
      if (data.type === "probe") done(Boolean(data.workerTracks));
    };
    probe.onerror = () => done(false);
    probe.postMessage({ type: "probe" });
  }).then((answer) => {
    workerTracks = answer;
    supportListeners.forEach((listener) => listener());
    return answer;
  });
  return workerTracksProbe;
}

export function cameraEffectsSupported(): boolean {
  if (insertableStreams() !== null) return true;
  if (typeof window === "undefined") return false;
  if (workerTracks === null) void probeWorkerTracks();
  return workerTracks === true;
}

function subscribeSupport(listener: () => void) {
  supportListeners.add(listener);
  return () => {
    supportListeners.delete(listener);
  };
}

/**
 * cameraEffectsSupported for render: false on the server (and in Safari until
 * its worker has answered), the answer after.
 */
export function useCameraEffectsSupported(): boolean {
  return useSyncExternalStore(subscribeSupport, cameraEffectsSupported, () => false);
}

// ---------------------------------------------------------------------------
// Loading status, for the panel's "carregando…" line

let loading = false;
let failed = false;
const statusListeners = new Set<() => void>();
function setStatus(next: { loading?: boolean; failed?: boolean }) {
  loading = next.loading ?? loading;
  failed = next.failed ?? failed;
  statusSnapshot = { loading, failed };
  statusListeners.forEach((listener) => listener());
}
let statusSnapshot = { loading, failed };
const SERVER_STATUS = { loading: false, failed: false };

export function useCameraEffectsStatus(): { loading: boolean; failed: boolean } {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    () => statusSnapshot,
    () => SERVER_STATUS
  );
}

// ---------------------------------------------------------------------------
// The worker

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const live = new Set<number>();
// What the room wants drawn right now: null when the switch is off or nothing
// is picked. Sent to the worker whenever it changes and when it starts.
let current: CameraEffectSettings | null = null;
// The generated tracks the worker is still to send back (Safari's way).
const pendingTracks = new Map<number, { resolve: (track: MediaStreamTrack) => void; reject: (err: Error) => void }>();
// How long the worker gets to send one back before the plain camera is used.
const TRACK_TIMEOUT_MS = 8_000;
// Each effects track's way to end its pipeline while leaving the camera
// behind it running (see discardCameraEffectsTrack).
const effectTracks = new WeakMap<MediaStreamTrack, () => void>();
let reportedSlow = false;
let reportedSlow3d = false;
let reportedSlowWarp = false;

function ensureWorker(): Worker {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (worker) return worker;
  const created = new Worker(WORKER_URL);
  created.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | { type: "status"; loading: boolean }
      | { type: "error"; kind: string; reason: string }
      | { type: "stats"; frameMs: number; fx3d?: boolean; warp?: boolean }
      | { type: "reaction"; name: string }
      | { type: "track"; id: number; track?: MediaStreamTrack; error?: string }
      | { type: "prepared"; nonce: number }
      | { type: "ended"; id: number };
    if (data.type === "status") setStatus({ loading: data.loading });
    else if (data.type === "error") {
      // The hands model only takes away the claps and the thumbs up; the
      // rest keeps working, so the panel does not say it failed.
      if (data.kind !== "hand") {
        setStatus({ failed: true });
        trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.error);
      }
      if (data.kind === "three" || data.kind === "render3d" || data.kind === "hand") {
        track3d(CAMERA_EFFECTS_3D_EVENTS.error);
      }
      if (data.kind === "warp") trackWarp(CAMERA_WARP_EVENTS.error);
      if (data.kind === "stream-bg") trackStreamBackground(CAMERA_STREAM_BG_EVENTS.error);
    } else if (data.type === "stats") {
      if (!reportedSlow && data.frameMs > SLOW_FRAME_MS) {
        reportedSlow = true;
        trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.slow, data.frameMs);
      }
      if (data.fx3d && !reportedSlow3d && data.frameMs > SLOW_FRAME_MS) {
        reportedSlow3d = true;
        track3d(CAMERA_EFFECTS_3D_EVENTS.slow, data.frameMs);
      }
      if (data.warp && !reportedSlowWarp && data.frameMs > SLOW_FRAME_MS) {
        reportedSlowWarp = true;
        trackWarp(CAMERA_WARP_EVENTS.slow, data.frameMs);
      }
    } else if (data.type === "reaction") {
      track3d(CAMERA_EFFECTS_3D_EVENTS.reaction);
    } else if (data.type === "prepared") {
      preparing.get(data.nonce)?.();
    } else if (data.type === "track") {
      const pending = pendingTracks.get(data.id);
      pendingTracks.delete(data.id);
      if (data.track) {
        if (pending) pending.resolve(data.track);
        else data.track.stop();
      } else {
        pending?.reject(new Error(data.error || "no track"));
      }
    } else if (data.type === "ended") {
      release(data.id);
    }
  };
  created.onerror = () => {
    for (const finish of [...preparing.values()]) finish();
    for (const pending of pendingTracks.values()) pending.reject(new Error("worker failed"));
    pendingTracks.clear();
    setStatus({ failed: true, loading: false });
    trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.error);
  };
  created.postMessage({ type: "settings", settings: current });
  worker = created;
  void pushCustomBackground();
  syncBackgroundStream();
  return created;
}

function release(id: number) {
  if (!live.delete(id)) return;
  scheduleIdle();
}

function scheduleIdle() {
  if (live.size > 0 || !worker) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (live.size > 0 || !worker) return;
    worker.terminate();
    worker = null;
    syncBackgroundStream();
    preparedFor = null;
    setStatus({ loading: false });
  }, WORKER_IDLE_MS);
}

// Loading a model, and its first run, hold the worker's thread — and with it
// every frame of a camera already going through it, which froze the picture
// for a few seconds on a phone each time effects were switched on. So the
// room keeps sending the plain camera until the worker says what is picked
// is ready, and only then swaps the effects in (see useRoomMedia).
const preparing = new Map<number, () => void>();
let prepareNonce = 0;
// The target the worker last said it was ready for (null: none, or the worker
// is gone). Compared by identity with `current`.
let preparedFor: CameraEffectSettings | null = null;
const PREPARE_TIMEOUT_MS = 30_000;

/** Resolves once the worker has loaded (and warmed up) what the current target needs. */
export function prepareCameraEffects(): Promise<void> {
  const target = current;
  if (!target) return Promise.resolve();
  if (cameraEffectsPrepared()) return Promise.resolve();
  const w = ensureWorker();
  const nonce = ++prepareNonce;
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => finish(), PREPARE_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      if (!preparing.delete(nonce)) return;
      if (current === target && worker === w) preparedFor = target;
      // Nobody may come to use it (the camera stopped meanwhile).
      scheduleIdle();
      resolve();
    };
    preparing.set(nonce, finish);
    w.postMessage({ type: "prepare", nonce });
  });
}

/** Whether an effects track started now would draw right away, without the loading freeze. */
export function cameraEffectsPrepared(): boolean {
  return worker !== null && current !== null && preparedFor === current;
}

/** What every effects track (live and future) draws. Null = pass through. */
export function setCameraEffectsTarget(settings: CameraEffectSettings | null) {
  const next = settings && hasAnyCameraEffect(settings) ? settings : null;
  if (next === current) return;
  current = next;
  if (next) setStatus({ failed: false });
  worker?.postMessage({ type: "settings", settings: next });
  syncBackgroundStream();
}

// ---------------------------------------------------------------------------
// A transmission as the background (Pro Max and up, experiment
// "camera-stream-bg")
//
// Someone's screen or camera in the room (or one's own screen) behind the
// person, live. The room's own track for it is cloned — stopping the clone
// ends nothing a tile is showing — and its frames go to the worker, which
// keeps only the newest to draw. Only while the effects actually draw it: a
// pick with the switch off, or no camera on, reads no frames at all. Which
// transmission is lib/cameraStreamBackground.ts's business; this side only
// gets its track.

export const CAMERA_STREAM_BG_FEATURE = "camera-stream-bg";
export const STREAM_BACKGROUND_TIER = CUSTOM_BACKGROUND_TIER;
export const CAMERA_STREAM_BG_EVENTS = {
  pick: "camera_stream_bg_pick", // escolheu uma transmissão como fundo
  locked: "camera_stream_bg_locked", // clicou no cadeado (abaixo do Pro Max)
  error: "camera_stream_bg_error", // os quadros da transmissão não chegaram ao worker
};

export function trackStreamBackground(name: string) {
  trackFeatureEvent(name, { feature: CAMERA_STREAM_BG_FEATURE });
}

// What the room says is picked (live), and what is being fed to the worker.
let backgroundTrack: MediaStreamTrack | null = null;
let piped: { source: MediaStreamTrack; clone: MediaStreamTrack; worker: Worker } | null = null;

/** The transmission's video track to draw behind the person, or null. */
export function setCameraBackgroundTrack(track: MediaStreamTrack | null) {
  if (track === backgroundTrack) return;
  backgroundTrack = track;
  syncBackgroundStream();
}

function syncBackgroundStream() {
  const wanted = worker && current?.background === "stream" ? backgroundTrack : null;
  if (piped && piped.source === wanted && piped.worker === worker) return;
  if (piped) {
    if (piped.worker === worker) piped.worker.postMessage({ type: "background-stream", readable: null });
    piped.clone.stop();
    piped = null;
  }
  if (!wanted || !worker || wanted.readyState === "ended") return;
  const clone = wanted.clone();
  try {
    const streams = insertableStreams();
    if (streams) {
      const processor = new streams.Processor({ track: clone, maxBufferSize: 1 });
      worker.postMessage({ type: "background-stream", readable: processor.readable }, [
        processor.readable as unknown as Transferable,
      ]);
    } else if (workerTracks) {
      // Safari: the processor only exists in the worker, so the track goes there.
      worker.postMessage({ type: "background-stream", track: clone }, [clone as unknown as Transferable]);
    } else {
      clone.stop();
      return;
    }
  } catch {
    clone.stop();
    trackStreamBackground(CAMERA_STREAM_BG_EVENTS.error);
    return;
  }
  piped = { source: wanted, clone, worker };
}

export function isCameraEffectsTrack(track: MediaStreamTrack | null | undefined): boolean {
  return Boolean(track && effectTracks.has(track));
}

/**
 * Ends an effects track that never made it into the room (the swap that was
 * to put it there declined), without stopping the camera it was wrapping —
 * that camera is still the one being sent.
 */
export function discardCameraEffectsTrack(track: MediaStreamTrack) {
  effectTracks.get(track)?.();
}

/**
 * The camera, with effects. Takes ownership of `source`: stopping the
 * returned track stops it too.
 *
 * The returned track answers getSettings/applyConstraints/muted for the
 * camera behind it — the room reads the capture's height for the per-viewer
 * tiers, re-applies resolution changes mid-share, and the dual camera reads
 * the lens's facing and device id, none of which a generated track knows.
 * Its `ended` fires when the camera's does, like the camera's own would.
 *
 * Rejects where neither kind of insertable streams is there, or Safari's
 * worker did not hand a track back; the caller sends the plain camera then.
 */
export async function createCameraEffectsTrack(source: MediaStreamTrack): Promise<MediaStreamTrack> {
  const streams = insertableStreams();
  if (streams) {
    const processor = new streams.Processor({ track: source, maxBufferSize: 1 });
    const generator = new streams.Generator({ kind: "video" });
    const id = nextId++;
    ensureWorker().postMessage(
      { type: "start", id, readable: processor.readable, writable: generator.writable, turns: isMobileDevice() },
      [processor.readable as unknown as Transferable, generator.writable as unknown as Transferable]
    );
    live.add(id);
    return wrapEffectsTrack(id, source, generator, (constraints) => source.applyConstraints(constraints));
  }
  if (!(await probeWorkerTracks())) throw new Error("insertable streams unavailable");
  return createWorkerEffectsTrack(source);
}

// Safari's way: the worker gets a clone of the camera (a transferred track is
// gone from the page, and the page still needs the camera's own answers) and
// sends the generated track back. Resolution changes reach the clone through
// the worker, since a clone does not follow its original's constraints.
async function createWorkerEffectsTrack(source: MediaStreamTrack): Promise<MediaStreamTrack> {
  const id = nextId++;
  const clone = source.clone();
  const target = ensureWorker();
  live.add(id);
  let generated: MediaStreamTrack;
  try {
    generated = await new Promise<MediaStreamTrack>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingTracks.delete(id);
        reject(new Error("timed out"));
      }, TRACK_TIMEOUT_MS);
      pendingTracks.set(id, {
        resolve: (track) => {
          clearTimeout(timer);
          resolve(track);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      target.postMessage({ type: "start-track", id, track: clone, turns: isMobileDevice() }, [clone as unknown as Transferable]);
    });
  } catch (err) {
    pendingTracks.delete(id);
    // Already gone if the transfer went through; the worker stops its copy.
    clone.stop();
    target.postMessage({ type: "stop", id });
    release(id);
    trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.error);
    throw err;
  }
  return wrapEffectsTrack(id, source, generated, async (constraints) => {
    await source.applyConstraints(constraints);
    worker?.postMessage({ type: "constraints", id, constraints });
  });
}

function wrapEffectsTrack(
  id: number,
  source: MediaStreamTrack,
  generated: MediaStreamTrack,
  applyConstraints: (constraints?: MediaTrackConstraints) => Promise<void>
): MediaStreamTrack {
  trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.start);

  let done = false;
  const finish = (keepSource = false) => {
    if (done) return false;
    done = true;
    worker?.postMessage({ type: "stop", id });
    if (!keepSource) source.stop();
    return true;
  };
  const stopGenerated = generated.stop.bind(generated);
  Object.assign(generated, {
    stop: () => {
      finish();
      stopGenerated();
    },
    getSettings: () => source.getSettings(),
    getCapabilities: () => source.getCapabilities?.() ?? {},
    getConstraints: () => source.getConstraints(),
    applyConstraints,
  });
  Object.defineProperty(generated, "muted", { get: () => source.muted });
  source.addEventListener("ended", () => {
    if (!finish()) return;
    stopGenerated();
    generated.dispatchEvent(new Event("ended"));
  });
  effectTracks.set(generated, () => {
    if (finish(true)) stopGenerated();
  });
  return generated;
}
