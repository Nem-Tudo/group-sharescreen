"use client";

import { useSyncExternalStore } from "react";
import { trackTileExperiment, TILE_EXPERIMENT_EVENTS } from "./clipsMode";

// "Efeitos de câmera" (experiment "camera-effects"): background blur, colour
// filters and face overlays (dog, cat, sunglasses, clown, crown) drawn into
// the camera before it is sent, so whoever watches needs nothing at all.
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

export type CameraBackground = "none" | "blur";
export type CameraColor = "none" | "mono" | "sepia" | "vivid";
export type CameraFace = "none" | "dog" | "cat" | "glasses" | "clown" | "crown";

export interface CameraEffectSettings {
  background: CameraBackground;
  color: CameraColor;
  face: CameraFace;
}

export const CAMERA_BACKGROUNDS: CameraBackground[] = ["none", "blur"];
export const CAMERA_COLORS: CameraColor[] = ["none", "mono", "sepia", "vivid"];
export const CAMERA_FACES: CameraFace[] = ["none", "dog", "cat", "glasses", "clown", "crown"];

export const CAMERA_EFFECTS_FEATURE = "camera-effects";

const WORKER_URL = "/workers/camera-effects.js";
const SETTINGS_KEY = "sharescreen:cameraEffects";
// How long the worker (and the models it loaded) outlives the last camera
// using it: long enough that a stop and start, or a flip, does not load
// everything again; short enough not to sit on the memory all call.
const WORKER_IDLE_MS = 30_000;
// Average time per drawn frame past which the session is reported as slow.
const SLOW_FRAME_MS = 30;

const NONE: CameraEffectSettings = { background: "none", color: "none", face: "none" };

export function hasAnyCameraEffect(settings: CameraEffectSettings): boolean {
  return settings.background !== "none" || settings.color !== "none" || settings.face !== "none";
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
  let parsed: Partial<CameraEffectSettings> = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") ?? {};
  } catch {
    parsed = {};
  }
  cached = {
    background: pick(parsed.background, CAMERA_BACKGROUNDS),
    color: pick(parsed.color, CAMERA_COLORS),
    face: pick(parsed.face, CAMERA_FACES),
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
      | { type: "stats"; frameMs: number }
      | { type: "ended"; id: number };
    if (data.type === "status") setStatus({ loading: data.loading });
    else if (data.type === "error") {
      setStatus({ failed: true });
      trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.error);
    } else if (data.type === "stats") {
      if (!reportedSlow && data.frameMs > SLOW_FRAME_MS) {
        reportedSlow = true;
        trackTileExperiment(TILE_EXPERIMENT_EVENTS.cameraEffects.slow, data.frameMs);
      }
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
