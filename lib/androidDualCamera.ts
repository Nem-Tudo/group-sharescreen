"use client";

// Front and rear cameras at the same time, in the Android app.
//
// The WebView keeps one camera open at a time (a second getUserMedia fails
// with "NotReadableError: Could not start video source"), so this goes around
// it: android/.../DualCameraPlugin.java opens both lenses natively through
// Camera2's concurrent-camera support and sends JPEG frames over the plugin
// bridge, the same pipeline lib/androidScreenCapture.ts uses for the screen.
// Each lens gets its own canvas and its own `captureStream()`, so the rest of
// the app sees two ordinary MediaStreams.
//
// Only used while both cameras are on. A single camera stays on the WebView's
// getUserMedia, which is better in every way (hardware path, full
// resolution) — see useRoomMedia's camera2.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface DualCameraFrameEvent {
  lens: "front" | "back";
  /** Base64 JPEG, no `data:` prefix. */
  data: string;
  width: number;
  height: number;
  /** Degrees clockwise to turn the frame upright. */
  rotation: number;
}

interface DualCameraStateEvent {
  state: "stopped";
  reason?: string;
}

interface DualCameraPluginInterface {
  isSupported(): Promise<{ supported: boolean; reason?: string }>;
  start(options: { width: number; height: number; fps: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(eventName: "frame", listener: (event: DualCameraFrameEvent) => void): Promise<PluginListenerHandle>;
  addListener(eventName: "stateChange", listener: (event: DualCameraStateEvent) => void): Promise<PluginListenerHandle>;
}

const DualCamera = registerPlugin<DualCameraPluginInterface>("DualCamera");

// Two JPEG streams share one bridge (and one main thread to decode them on),
// and concurrent cameras are only guaranteed up to 720p anyway.
const MAX_WIDTH = 640;
const MAX_HEIGHT = 480;
const MAX_FPS = 15;

function isAndroidApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/**
 * Whether this phone can open both cameras together through the app. Null
 * off the Android app (the browser path is the only one there), false on an
 * app build that predates the plugin or a phone that cannot.
 */
export async function androidDualCameraSupport(): Promise<{ supported: boolean; reason?: string } | null> {
  if (!isAndroidApp()) return null;
  try {
    return await DualCamera.isSupported();
  } catch {
    // An installed app older than the plugin: the web app ships on its own
    // (the shell loads the live site), so this is an ordinary case.
    return { supported: false, reason: "app-outdated" };
  }
}

export interface AndroidDualCamera {
  front: MediaStream;
  back: MediaStream;
  /** Ends both lenses. Idempotent. */
  stop: () => void;
}

/** A code the caller can tell apart: "unsupported" means the phone, anything else a failure. */
export class AndroidDualCameraError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/**
 * Opens both lenses. `onStopped` runs when Android ends the capture on its
 * own (the app went to the background, another app took a camera) — not when
 * stop() is called.
 */
export async function startAndroidDualCamera(options: {
  width: number;
  height: number;
  fps: number;
  onStopped: (reason: string) => void;
}): Promise<AndroidDualCamera> {
  const width = Math.min(options.width, MAX_WIDTH);
  const height = Math.min(options.height, MAX_HEIGHT);
  const fps = Math.min(options.fps, MAX_FPS);

  const makeCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.width = height; // portrait until the first frame says otherwise
    canvas.height = width;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new AndroidDualCameraError("canvas", "failed");
    return { canvas, ctx, decoding: false };
  };
  const surfaces = { front: makeCanvas(), back: makeCanvas() };

  let stopped = false;
  let streams: MediaStream[] = [];
  const frameHandle = await DualCamera.addListener("frame", (event) => {
    const surface = surfaces[event.lens];
    if (stopped || !surface || surface.decoding) return;
    surface.decoding = true;
    const binary = atob(event.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    void createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (stopped) {
          bitmap.close();
          return;
        }
        const { canvas, ctx } = surface;
        const rotation = ((event.rotation % 360) + 360) % 360;
        const sideways = rotation === 90 || rotation === 270;
        const outW = sideways ? bitmap.height : bitmap.width;
        const outH = sideways ? bitmap.width : bitmap.height;
        if (canvas.width !== outW || canvas.height !== outH) {
          canvas.width = outW;
          canvas.height = outH;
        }
        ctx.save();
        ctx.translate(outW / 2, outH / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
        ctx.restore();
        bitmap.close();
      })
      .catch(() => {
        // One bad frame: keep the last good one on the canvas.
      })
      .finally(() => {
        surface.decoding = false;
      });
  });
  const stateHandle = await DualCamera.addListener("stateChange", (event) => {
    if (event.state !== "stopped" || stopped) return;
    stop();
    options.onStopped(event.reason ?? "stopped");
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    void frameHandle.remove();
    void stateHandle.remove();
    void DualCamera.stop().catch(() => {});
    for (const stream of streams) stream.getTracks().forEach((track) => track.stop());
  };

  try {
    await DualCamera.start({ width, height, fps });
  } catch (err) {
    stopped = true;
    void frameHandle.remove();
    void stateHandle.remove();
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "failed";
    const message = err instanceof Error ? err.message : String(err);
    throw new AndroidDualCameraError(message, code);
  }

  const front = surfaces.front.canvas.captureStream(fps);
  const back = surfaces.back.canvas.captureStream(fps);
  streams = [front, back];
  return { front, back, stop };
}
