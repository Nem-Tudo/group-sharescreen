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
//
// System audio
// ------------
// Optional, off unless the share asked for it (see MobileQualitySheet, where
// the checkbox is always offered unticked). The native side captures what
// other apps are playing with AudioPlaybackCapture — GoLive's own uid
// excluded, so the room does not hear itself — and sends it over the same
// bridge as interleaved 16-bit PCM, which lib/pcmAudioTrack.ts turns back
// into an audio track through the jitter-buffering AudioWorklet the desktop
// helper already uses.
//
// It is optional in the strict sense: every way it can fail (Android 9 or
// older, RECORD_AUDIO refused, no remote-submix path, an app that opted out
// of being captured) ends in a share that still works and is simply silent.
// A share that died because its sound could not be captured would be a far
// worse outcome than one that never had any.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { translate } from "@/lib/i18n";
import { startPcmAudioTrack, prewarmPcmAudioWorklet, type PcmAudioTrack } from "@/lib/pcmAudioTrack";

interface ScreenCaptureFrameEvent {
  /** Base64 JPEG, no `data:` prefix. */
  data: string;
  width: number;
  height: number;
}

interface ScreenCaptureAudioEvent {
  /** Base64 interleaved stereo 16-bit little-endian PCM at 48 kHz — the
   *  format lib/pcmAudioTrack.ts reads, and the same one the desktop
   *  helper produces. */
  data: string;
}

interface ScreenCaptureStateEvent {
  /** The native capture ended on its own — the system's "Stop sharing" chip
   *  every MediaProjection session gets, not something this app's UI can
   *  hide. Mirrors the browser's own getDisplayMedia track firing `ended`
   *  for the same gesture. */
  state: "stopped";
}

interface ScreenCapturePluginInterface {
  start(options: {
    width: number;
    height: number;
    density: number;
    fps: number;
    audio: boolean;
  }): Promise<{
    /** Whether system audio is actually going to arrive. False whenever it
     *  was asked for and could not be had — the permission was refused, or
     *  the platform is too old — which is the only way this side finds out. */
    audio: boolean;
    /** Why `audio` is false, when the microphone permission was the reason.
     *  "blocked" means Android no longer shows the prompt at all and only the
     *  app's settings screen can grant it. Absent on builds that predate it. */
    audioDenied?: "blocked" | "denied";
  }>;
  stop(): Promise<void>;
  openAppSettings(): Promise<void>;
  isSystemAudioSupported(): Promise<{ supported: boolean }>;
  addListener(
    eventName: "frame",
    listener: (event: ScreenCaptureFrameEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "audio",
    listener: (event: ScreenCaptureAudioEvent) => void
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

// How much audio the jitter buffer holds before any of it is heard. Well
// above the 60ms the desktop helper asks for, and deliberately: chunks
// arrive here over the Capacitor bridge, which delivers on the WebView's
// main thread — the same thread decoding a JPEG screen frame fifteen times a
// second. A chunk arriving 100ms late is ordinary there rather than a fault,
// and a buffer sized for the desktop would underrun on most of them, which
// is heard as continuous crackle. 150ms of delay against video that is
// already travelling through a JPEG pipeline is not a sync problem.
const AUDIO_BUFFER_SECONDS = 0.15;

// The explicit ArrayBuffer parameter is load-bearing: a bare `Uint8Array`
// widens to ArrayBufferLike, which a Blob will not take.
//
// Uint8Array.fromBase64 where the WebView has it: native and synchronous, so
// the order of the audio chunks cannot change, and it replaces a per-byte JS
// loop that ran on the UI thread for every screen frame (tens of KB, several
// times a second) and every 20 ms of audio. Older WebViews keep the loop.
const nativeFromBase64 = (
  Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }
).fromBase64?.bind(Uint8Array);

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  if (nativeFromBase64) {
    try {
      return nativeFromBase64(base64);
    } catch {
      // Something it rejects that atob might still read; fall through.
    }
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function decodeJpeg(base64: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([decodeBase64(base64)], { type: "image/jpeg" }));
}

/**
 * Whether the checkbox for system audio is worth offering at all. False off
 * the Android app, and false on Android 9 and older, where
 * AudioPlaybackCapture does not exist — a control that can only ever fail is
 * worse than no control.
 *
 * Asked of the plugin rather than guessed from the user agent, because the
 * answer is an SDK level and the plugin is the only thing that knows it.
 */
export async function isAndroidSystemAudioSupported(): Promise<boolean> {
  if (!isAndroidScreenCaptureAvailable()) return false;
  try {
    const { supported } = await ScreenCapture.isSystemAudioSupported();
    return supported;
  } catch {
    // An app build that predates the method. No audio to be had there.
    return false;
  }
}

/**
 * Loads the audio worklet ahead of the share that will need it, so the first
 * one does not pay for a network round trip between the consent dialog and
 * the first chunk of PCM. Cheap, idempotent, and safe to call with no
 * intention of ever sharing.
 */
export function prewarmAndroidSystemAudio(): void {
  if (!isAndroidScreenCaptureAvailable()) return;
  prewarmPcmAudioWorklet();
}

/**
 * Why a share that asked for system audio went out silent:
 * - "blocked": the microphone permission was refused so many times that
 *   Android stopped asking — only the app's settings screen can grant it now.
 * - "denied": refused at the prompt just now; the next share asks again.
 * - "unknown": anything else — the page's audio graph would not start, or an
 *   app build too old to say why.
 */
export type SystemAudioUnavailableReason = "blocked" | "denied" | "unknown";

/**
 * Opens GoLive's page in Android's settings, where a permission the system
 * has stopped asking for can be granted by hand. False on a build that
 * predates the method, or anywhere that is not the Android app.
 */
export async function openAndroidAppSettings(): Promise<boolean> {
  if (!isAndroidScreenCaptureAvailable()) return false;
  try {
    await ScreenCapture.openAppSettings();
    return true;
  } catch {
    return false;
  }
}

export interface AndroidScreenCaptureOptions {
  width: number;
  height: number;
  fps: number;
  /** Whether to capture what other apps are playing. Never assumed: the
   *  caller has to have been told yes. */
  systemAudio: boolean;
  /**
   * Called when `systemAudio` was asked for and cannot be delivered, so the
   * caller can say so. The share still starts, and still returns a stream —
   * this is a notice, not an error.
   */
  onSystemAudioUnavailable?: (reason: SystemAudioUnavailableReason) => void;
}

/**
 * Starts the native capture and returns it as an ordinary MediaStream: a
 * video track always, plus an audio track when the share asked for system
 * audio and the device could provide it. A stream with no audio track is the
 * same degraded shape every other getDisplayMedia caller in this app already
 * tolerates (see useRoomMedia's NotReadableError retry for system audio), so
 * nothing downstream needs a branch for it. Rejects with a NotAllowedError
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
  if (!ctx) throw new Error(translate("androidScreenCapture.couldNotPrepareTheScreenCapture"));

  // Standard "mdpi" density (160dpi) scaled by the device's own pixel ratio,
  // matching what a VirtualDisplay expects — it only affects how the native
  // side lays out the capture, not anything JS reads back.
  const density = Math.round((window.devicePixelRatio || 1) * 160);

  // Built before the capture is started, not after, for two reasons. The
  // audio graph can fail on its own (a context that will not resume, a
  // worklet that will not load), and finding that out while a MediaProjection
  // is already running would mean tearing down a share the user just
  // consented to. And a graph that exists by the time the first chunk of PCM
  // arrives is a graph that does not drop it.
  //
  // Null whenever audio was not asked for, and also whenever it was asked for
  // and the graph could not be built — the share carries on silent either
  // way, and `audio: false` below is what stops the native side from
  // capturing sound nothing would play.
  let pcm: PcmAudioTrack | null = null;
  if (options.systemAudio) {
    pcm = await startPcmAudioTrack({ targetSeconds: AUDIO_BUFFER_SECONDS });
    if (!pcm) options.onSystemAudioUnavailable?.("unknown");
  }

  // Typed as possibly absent, and read that way below. The APK and the web
  // app are deployed separately — the shell loads the live site (see
  // capacitor.config.ts) — so this code routinely runs against an older
  // installed build whose start() resolved with nothing at all. Reading
  // `.audio` off that would throw and take the whole share with it, which is
  // a far worse outcome than the silent share such a build can offer.
  let started: { audio?: boolean; audioDenied?: "blocked" | "denied" } | undefined;
  try {
    started = await ScreenCapture.start({ width, height, density, fps, audio: Boolean(pcm) });
  } catch (err) {
    pcm?.stop();
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : null;
    if (code === "cancelled") {
      throw new DOMException(translate("androidScreenCapture.screenSharingCancelled"), "NotAllowedError");
    }
    throw err;
  }

  // Asked for, the graph was built, and the native side still said no —
  // RECORD_AUDIO refused at the prompt is the case this is really for. The
  // graph is torn down rather than left connected to nothing, which would
  // put a permanently silent audio track in front of every viewer.
  if (pcm && !started?.audio) {
    pcm.stop();
    pcm = null;
    options.onSystemAudioUnavailable?.(started?.audioDenied ?? "unknown");
  }

  const stream = canvas.captureStream(fps);
  const track = stream.getVideoTracks()[0];
  if (!track) {
    pcm?.stop();
    void ScreenCapture.stop();
    throw new Error(translate("androidScreenCapture.couldNotStartTheScreenCapture"));
  }
  // From here on the audio is an ordinary member of the stream: the share's
  // teardown stops every track it finds without caring where they came from,
  // and this one's stop() takes its own graph with it (see pcmAudioTrack.ts).
  // The native capture behind it is stopped by the video track instead —
  // one ScreenCapture.stop() ends both halves, and hanging it off the track
  // that always exists means it cannot be missed.
  if (pcm) stream.addTrack(pcm.track);

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

  // Registered only when there is somewhere to put the audio. A listener
  // that decoded base64 and dropped it would be pure cost on the one thread
  // the screen frames also need.
  // Copied to a const so the listener below closes over a value the compiler
  // can see is non-null: `pcm` is reassigned above, so its narrowing does not
  // survive into a callback.
  const audio = pcm;
  const audioHandle = audio
    ? await ScreenCapture.addListener("audio", (event) => {
        if (stopped) return;
        // Straight into the jitter buffer, with no attempt to smooth or
        // reorder it here: the worklet on the other side of this push is
        // built for exactly this arrival pattern, and a second buffer in
        // front of it would only add delay.
        audio.push(decodeBase64(event.data));
      })
    : null;

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
    void audioHandle?.remove();
    void stateHandle.remove();
    void ScreenCapture.stop();
    // Stopped here as well as by the share's own teardown: the two arrive in
    // no guaranteed order, the audio track's stop() is idempotent, and
    // leaving a worklet node connected to a capture that has ended is how a
    // share that was stopped keeps a live audio track in the room.
    pcm?.stop();
    nativeStop();
  };

  return stream;
}
