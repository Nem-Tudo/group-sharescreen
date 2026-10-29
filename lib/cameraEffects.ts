"use client";

import { useSyncExternalStore } from "react";
import { trackTileExperiment, TILE_EXPERIMENT_EVENTS } from "./clipsMode";
import { trackFeatureEvent } from "./features";
import { accountTierOf, tierAtLeast } from "./entitlements";

// "Efeitos de câmera" (experiment "camera-effects"): background blur, colour
// filters and face overlays (dog, cat, sunglasses, clown, crown, bunny, bear,
// pig, mustache, heart eyes, devil, angel, pirate, party hat) drawn into
// the camera before it is sent, so whoever watches needs nothing at all.
// Experiment "camera-effects-3d" adds 3D objects that follow the head turning
// (cinema 3D glasses, top hat, viking helmet), in with the other faces, and
// the reactions: a switch of their own, on top of any face, that turns what
// the face, head and hands do into particles (a blink throws sparkles, a
// smile hearts, a clap confetti...) — see CAMERA_FACES_3D and
// CameraReactions.
//
// The work is in public/workers/camera-effects.js. This side only wires the
// camera track to it:
//
//   camera track → MediaStreamTrackProcessor → (worker) → MediaStreamTrackGenerator
//
// and hands the generator to the room in the camera track's place. Insertable
// streams are Chromium only (Chrome, Edge, the desktop app, Android), so that
// is where the switch is offered; see cameraEffectsSupported.
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
  | "custom";
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

export interface CameraEffectSettings {
  background: CameraBackground;
  color: CameraColor;
  face: CameraFace;
  reactions: CameraReactions;
}

export const CAMERA_REACTIONS: CameraReactions[] = ["none", "on"];

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

/**
 * `settings` as they may actually be drawn: a 3D face taken away from whoever
 * is not in the experiment, and the custom background from whoever is not on
 * the plan for it (or has no image stored).
 */
export function effectiveCameraEffects(
  settings: CameraEffectSettings,
  allow3d: boolean,
  allowCustomBackground: boolean
): CameraEffectSettings {
  let next = settings;
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
// whenever public/workers/camera-effects.js changes.
const WORKER_VERSION = 6;
const WORKER_URL = `/workers/camera-effects.js?v=${WORKER_VERSION}`;
const SETTINGS_KEY = "sharescreen:cameraEffects";
// How long the worker (and the models it loaded) outlives the last camera
// using it: long enough that a stop and start, or a flip, does not load
// everything again; short enough not to sit on the memory all call.
const WORKER_IDLE_MS = 30_000;
// Average time per drawn frame past which the session is reported as slow.
const SLOW_FRAME_MS = 30;

const NONE: CameraEffectSettings = { background: "none", color: "none", face: "none", reactions: "none" };

export function hasAnyCameraEffect(settings: CameraEffectSettings): boolean {
  return (
    settings.background !== "none" ||
    settings.color !== "none" ||
    settings.face !== "none" ||
    settings.reactions !== "none"
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

export function cameraEffectsSupported(): boolean {
  return insertableStreams() !== null;
}

function noopSubscribe() {
  return () => {};
}

/** cameraEffectsSupported for render: false on the server, the answer after. */
export function useCameraEffectsSupported(): boolean {
  return useSyncExternalStore(noopSubscribe, cameraEffectsSupported, () => false);
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
// Each effects track's way to end its pipeline while leaving the camera
// behind it running (see discardCameraEffectsTrack).
const effectTracks = new WeakMap<MediaStreamTrack, () => void>();
let reportedSlow = false;
let reportedSlow3d = false;

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
      | { type: "stats"; frameMs: number; fx3d?: boolean }
      | { type: "reaction"; name: string }
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
    } else if (data.type === "stats") {
      if (!reportedSlow && data.frameMs > SLOW_FRAME_MS) {
        reportedSlow = true;
        trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.slow, data.frameMs);
      }
      if (data.fx3d && !reportedSlow3d && data.frameMs > SLOW_FRAME_MS) {
        reportedSlow3d = true;
        track3d(CAMERA_EFFECTS_3D_EVENTS.slow, data.frameMs);
      }
    } else if (data.type === "reaction") {
      track3d(CAMERA_EFFECTS_3D_EVENTS.reaction);
    } else if (data.type === "ended") {
      release(data.id);
    }
  };
  created.onerror = () => {
    setStatus({ failed: true, loading: false });
    trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.error);
  };
  created.postMessage({ type: "settings", settings: current });
  worker = created;
  void pushCustomBackground();
  return created;
}

function release(id: number) {
  if (!live.delete(id) || live.size > 0 || !worker) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (live.size > 0 || !worker) return;
    worker.terminate();
    worker = null;
    setStatus({ loading: false });
  }, WORKER_IDLE_MS);
}

/** What every effects track (live and future) draws. Null = pass through. */
export function setCameraEffectsTarget(settings: CameraEffectSettings | null) {
  const next = settings && hasAnyCameraEffect(settings) ? settings : null;
  if (next === current) return;
  current = next;
  if (next) setStatus({ failed: false });
  worker?.postMessage({ type: "settings", settings: next });
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
 * Throws where insertable streams are missing; the caller sends the plain
 * camera then.
 */
export function createCameraEffectsTrack(source: MediaStreamTrack): MediaStreamTrack {
  const streams = insertableStreams();
  if (!streams) throw new Error("insertable streams unavailable");
  const processor = new streams.Processor({ track: source, maxBufferSize: 1 });
  const generator = new streams.Generator({ kind: "video" });
  const id = nextId++;
  ensureWorker().postMessage(
    { type: "start", id, readable: processor.readable, writable: generator.writable },
    [processor.readable as unknown as Transferable, generator.writable as unknown as Transferable]
  );
  live.add(id);
  trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.start);

  let done = false;
  const finish = (keepSource = false) => {
    if (done) return false;
    done = true;
    worker?.postMessage({ type: "stop", id });
    if (!keepSource) source.stop();
    return true;
  };
  const stopGenerator = generator.stop.bind(generator);
  Object.assign(generator, {
    stop: () => {
      finish();
      stopGenerator();
    },
    getSettings: () => source.getSettings(),
    getCapabilities: () => source.getCapabilities?.() ?? {},
    getConstraints: () => source.getConstraints(),
    applyConstraints: (constraints?: MediaTrackConstraints) => source.applyConstraints(constraints),
  });
  Object.defineProperty(generator, "muted", { get: () => source.muted });
  source.addEventListener("ended", () => {
    if (!finish()) return;
    stopGenerator();
    generator.dispatchEvent(new Event("ended"));
  });
  effectTracks.set(generator, () => {
    if (finish(true)) stopGenerator();
  });
  return generator;
}
