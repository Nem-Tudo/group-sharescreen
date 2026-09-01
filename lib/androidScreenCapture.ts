"use client";

// Real screen sharing on Android — not the camera fallback.
//
// getDisplayMedia does not exist on Android in any Chromium embedding, not
// WebView and not Chrome itself (mobile Chrome defines the API surface and
// always rejects it — this is a platform limitation, not a Capacitor one).
// useRoomMedia's ordinary "compartilhar tela" path already knows this and
// falls back to the camera (see getScreenShareMode) — the same thing every
// other mobile browser does.
//
// This module is what the Android *app* does instead, and it works entirely
// outside that browser API: android/.../ScreenCapturePlugin.java +
// ScreenCaptureService.java capture the screen natively with MediaProjection
// and hand frames over as JPEGs; captureAndroidScreen draws each one onto a
// <canvas> and hands back `canvas.captureStream()` — an ordinary MediaStream
// with a real video track. Every call site above this (quality presets, the
// peer connections, the "ended" listener that treats a dropped share as a
// stop) already only ever wanted a MediaStream and needs no Android-specific
// handling of its own.
//
// The trade-off this makes, and why: a JPEG frame crosses the Capacitor
// plugin bridge as a base64 string, which is the simplest, most-verifiable
// path (no local HTTP server, no extra native dependency, no network-security
// exceptions to carve out) at the cost of real ceilings on resolution/fps —
// see CAPTURE_LIMITS below. This is a phone screen shared over a JSON bridge,
// not a game capture card; it reads documents, chats and slides fine and
// looks soft on fast motion, which is the honest trade for the simpler,
// easier-to-get-right implementation.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface ScreenCaptureFrameEvent {
  /** Base64 JPEG, no `data:` prefix. */
  data: string;
  width: number;
  height: number;
}

interface ScreenCaptureStateEvent {
  /** The native capture ended on its own — the system's "Stop sharing" chip
   *  every MediaProjection session gets, not something this app's UI can
   *  hide. Mirrors the browser's own getDisplayMedia track firing `ended`
   *  for the same gesture. */
  state: "stopped";
}

interface ScreenCapturePluginInterface {
  start(options: { width: number; height: number; density: number; fps: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "frame",
    listener: (event: ScreenCaptureFrameEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "stateChange",
    listener: (event: ScreenCaptureStateEvent) => void
  ): Promise<PluginListenerHandle>;
}

// No web/electron implementation is registered on purpose — every call site
// below is reached only after isAndroidScreenCaptureAvailable() has already
// confirmed this is the Android shell, so a missing implementation elsewhere
// is never exercised rather than something that needs handling here.
const ScreenCapture = registerPlugin<ScreenCapturePluginInterface>("ScreenCapture");

export function isAndroidScreenCaptureAvailable(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

// What the JPEG-over-bridge pipeline can actually carry. Both dials in the
// share-quality picker go well past this (1440p/120fps, built for a real
// hardware-encoded getDisplayMedia stream) — clamped here rather than at the
// picker, since the picker is shared with every platform that *can* do
// better and has no reason to know this one can't.
const MAX_CAPTURE_WIDTH = 1280;
const MAX_CAPTURE_HEIGHT = 720;
const MAX_CAPTURE_FPS = 15;

async function decodeJpeg(base64: string): Promise<ImageBitmap> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
}

export interface AndroidScreenCaptureOptions {
  width: number;
  height: number;
  fps: number;
}

/**
 * Starts the native capture and returns it as an ordinary MediaStream with a
 * single video track — no audio; the same degraded shape every other
 * getDisplayMedia caller in this app already tolerates (see useRoomMedia's
 * NotReadableError retry for system audio). Rejects with a NotAllowedError
 * DOMException when the user declines Android's screen-capture consent
 * dialog, so useRoomMedia's existing isCancelLikeError check treats it as a
 * silent cancel exactly like a dismissed getDisplayMedia picker — no
 * Android-specific branch needed there.
 */
export async function captureAndroidScreen(options: AndroidScreenCaptureOptions): Promise<MediaStream> {
  const width = Math.min(options.width, MAX_CAPTURE_WIDTH);
  const height = Math.min(options.height, MAX_CAPTURE_HEIGHT);
  const fps = Math.min(options.fps, MAX_CAPTURE_FPS);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Não foi possível preparar a captura de tela.");

  // Standard "mdpi" density (160dpi) scaled by the device's own pixel ratio,
  // matching what a VirtualDisplay expects — it only affects how the native
  // side lays out the capture, not anything JS reads back.
  const density = Math.round((window.devicePixelRatio || 1) * 160);

  try {
    await ScreenCapture.start({ width, height, density, fps });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : null;
    if (code === "cancelled") {
      throw new DOMException("Compartilhamento de tela cancelado.", "NotAllowedError");
    }
    throw err;
  }

  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    void ScreenCapture.stop();
    throw new Error("Não foi possível iniciar a captura de tela.");
  }

  let stopped = false;
  // Frames can arrive faster than one decode+draw takes; dropping a frame
  // that shows up mid-decode is the same trade-off the native side already
  // makes with acquireLatestImage — only the most recent picture matters for
  // a screen share, never every single one.
  let decoding = false;

  const frameHandle = await ScreenCapture.addListener("frame", (event) => {
    if (stopped || decoding) return;
    decoding = true;
    void decodeJpeg(event.data)
      .then((bitmap) => {
        if (stopped) {
          bitmap.close();
          return;
        }
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
      })
      .catch(() => {
        // One unreadable frame is not worth tearing the share down for — the
        // canvas just keeps showing the last good frame until the next one
        // decodes cleanly.
      })
      .finally(() => {
        decoding = false;
      });
  });

  // The system's own "Stop sharing" affordance (every MediaProjection
  // capture gets one, independent of this app's UI) ends the *native*
  // capture without either side of this bridge calling stop() — dispatching
  // `ended` here is what makes that reach useRoomMedia at all: its start()
  // already listens for exactly this event on every track and treats it as
  // the share ending (line "stream.getTracks().forEach(track =>
  // track.addEventListener('ended', ...))"), the same way a real
  // getDisplayMedia track's own `ended` is what that listener was written
  // for. A canvas track otherwise never ends on its own, so without this the
  // UI would keep showing an active share the OS had already killed.
  const stateHandle = await ScreenCapture.addListener("stateChange", (event) => {
    if (event.state === "stopped" && !stopped) {
      track.dispatchEvent(new Event("ended"));
    }
  });

  const nativeStop = track.stop.bind(track);
  // Same reasoning as lib/desktopSystemAudio.ts's identical override:
  // MediaStreamTrack.stop() fires no event, so this is the only way the
  // native side (a foreground service holding a MediaProjection) finds out
  // the share ended locally — and useRoomMedia's own teardown already stops
  // every track in the stream without knowing where any of them came from.
  track.stop = () => {
    if (stopped) return;
    stopped = true;
    void frameHandle.remove();
    void stateHandle.remove();
    void ScreenCapture.stop();
    nativeStop();
  };

  return stream;
}
