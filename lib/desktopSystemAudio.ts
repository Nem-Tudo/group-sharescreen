"use client";

// System audio for a screen share, with the room's own audio left out of it.
//
// The echo this removes
// ---------------------
// Sharing your screen "with system audio" captures everything the machine is
// playing — and GoLive is one of the things playing: every other
// participant's voice, and the audio of any share you are watching. Those go
// back out to the room, so everyone hears themselves a moment late. In a
// browser there is nothing to be done about that; the capture is whatever
// the OS hands over.
//
// In the desktop app there is. The shell runs a small native helper that
// uses the WASAPI process-loopback API to capture the system mix *excluding*
// GoLive's own process tree, and streams the result here as PCM. This module
// is what turns that stream back into a MediaStreamTrack the existing share
// code can treat like any other audio track.
//
// Everything here is optional, in the strict sense the rest of lib/desktop.ts
// means it: this file ships with the *website*, which is mostly loaded in an
// ordinary browser, and in a desktop build that predates the feature. Every
// entry point returns null rather than throwing when the bridge is not
// there, and the caller falls back to asking getDisplayMedia for audio the
// ordinary way.

import { getDesktopBridge } from "./desktop";
import { getSharedAudioContext, ensureSharedAudioContextRunning } from "./audioContext";

// Served as a static asset rather than bundled, for the same reason
// rnnoise.ts serves its worklet that way: addModule() takes a URL, and
// Next.js has no equivalent of Vite's `?url` import.
const WORKLET_URL = "/worklets/system-audio.js";
const PROCESSOR_NAME = "golive-system-audio";

// Int16 full scale. The helper sends 16-bit PCM because that halves what
// crosses two IPC hops; Web Audio wants -1..1 floats, and this is the whole
// conversion.
const INT16_SCALE = 1 / 32768;

// addModule is idempotent per context, but the promise is cached anyway so
// starting a second share does not re-fetch the file — and so two shares
// started at once cannot race each other into a duplicate registration.
let workletPromise: Promise<void> | null = null;

function loadWorklet(ctx: AudioContext): Promise<void> {
  if (!workletPromise) {
    workletPromise = ctx.audioWorklet.addModule(WORKLET_URL).catch((err: unknown) => {
      // Cleared so a later share can try again rather than being permanently
      // poisoned by one transient fetch failure.
      workletPromise = null;
      throw err;
    });
  }
  return workletPromise;
}

export interface DesktopSystemAudio {
  /** The audio track to put in the share's MediaStream. */
  track: MediaStreamTrack;
  /** Stops the helper and tears the graph down. Safe to call twice. */
  stop(): void;
}

/**
 * Whether this session can capture system audio without the room's own audio
 * in it. False in every browser, on macOS and Linux, on Windows 10 (the
 * process-loopback API needs build 20348, which consumer Windows 10 never
 * reached), and in any desktop build shipped without the helper binary.
 */
export function canExcludeSelfFromSystemAudio(): boolean {
  return Boolean(getDesktopBridge()?.systemAudio);
}

/**
 * Fetches the worklet module ahead of time, so that starting a share does not
 * have to. Safe and cheap to call more than once, and safe before any user
 * gesture: loading a module does not require a running context, only a
 * created one.
 *
 * This matters more than it looks. Everything startExcludedSystemAudio awaits
 * happens *between* the user's click and getDisplayMedia, and getDisplayMedia
 * needs that click's transient activation to still be valid — Chromium gives
 * it about five seconds. A cold worklet fetch is a real network round trip to
 * the site (the desktop app loads the app over HTTPS like any page), and on
 * the very first share of a session it was enough, on top of everything else,
 * to spend that budget: getDisplayMedia then rejected with NotAllowedError,
 * which start() in useRoomMedia treats as "the user cancelled the picker" and
 * so shows nothing at all. A share that silently does nothing, only ever the
 * first time, is exactly what that looked like from outside.
 */
export function prewarmExcludedSystemAudio(): void {
  if (!getDesktopBridge()?.systemAudio) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  // Failure is fine and deliberately unobserved — startExcludedSystemAudio
  // retries (loadWorklet clears its own memo on error) and falls back.
  void loadWorklet(ctx).catch(() => {});
}

/**
 * Starts the excluded capture and returns it as a track, or null if it could
 * not be started — in which case the caller should request system audio the
 * ordinary way and accept the echo.
 *
 * Must be called *before* getDisplayMedia. A capture already running is how
 * the shell knows not to attach its own loopback track to the same request
 * (see the display-media handler in electron/main.ts), and there is no way
 * to take that track back off a stream once it has been granted.
 *
 * Every await here is spent out of the click's transient activation, which
 * getDisplayMedia still needs afterwards — see prewarmExcludedSystemAudio for
 * what that cost when it went wrong. Hence the order below: the one question
 * that can rule the whole thing out is asked first, and nothing else is
 * touched until it comes back yes.
 */
export async function startExcludedSystemAudio(): Promise<DesktopSystemAudio | null> {
  const bridge = getDesktopBridge()?.systemAudio;
  if (!bridge) return null;

  // Asked before anything else, and specifically before the AudioContext and
  // the worklet: this is also where "Compartilhar som da tela" being switched
  // off is answered (see startSystemAudioCapture in electron/systemAudio.ts),
  // and a share with system audio turned off has no business paying for an
  // audio graph it will never use. That was the whole of the bug — the
  // no-audio path did every expensive thing here and *then* found out, by
  // which point the click's activation could already be gone.
  if (!(await bridge.start())) return null;

  // From here on the helper is running, so every early return has to stop it.
  const abandon = () => {
    bridge.stop();
    return null;
  };

  // The graph has to be able to run for the capture to be worth anything: a
  // suspended context processes nothing, so the helper would fill a buffer
  // nobody drains.
  const ctx = getSharedAudioContext();
  if (!ctx || !(await ensureSharedAudioContextRunning())) return abandon();

  try {
    await loadWorklet(ctx);
  } catch {
    return abandon();
  }

  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
  } catch {
    return abandon();
  }

  const destination = ctx.createMediaStreamDestination();
  node.connect(destination);
  // Emphatically *not* connected to ctx.destination as well. That would play
  // the captured system audio back through the speakers on top of the
  // application that produced it — a second copy of everything, and one that
  // the helper would then have to exclude too.

  const unsubscribe = bridge.onData(
    (chunk) => {
      // A Uint8Array over bytes with no alignment guarantee, so an Int16Array
      // view onto it can throw — the conversion reads the pairs by hand
      // instead. It also has to happen somewhere, and here is cheaper than
      // it looks: ~96k multiplies a second, against an AudioWorklet that
      // would otherwise need to deal with alignment and endianness itself.
      // Samples, not frames: the stream is interleaved, so this counts both
      // channels. The worklet deinterleaves on the other side.
      const sampleCount = chunk.byteLength >> 1;
      const samples = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        // Little-endian, sign-extended from 16 bits.
        const raw = chunk[i * 2] | (chunk[i * 2 + 1] << 8);
        samples[i] = ((raw << 16) >> 16) * INT16_SCALE;
      }
      // Transferred rather than copied: the buffer is dead to this thread the
      // moment it is posted, which is exactly right.
      node.port.postMessage(samples, [samples.buffer]);
    },
    () => {
      // The helper exited on its own — a device invalidated mid-share is the
      // usual cause. Nothing to do but stop feeding the node, which keeps
      // producing silence so the share carries on without sound rather than
      // dying. Explicitly not calling stop() here: the track is live in
      // every viewer's peer connection, and removing it would renegotiate
      // the whole room over an audio problem.
      unsubscribe();
    }
  );

  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    unsubscribe();
    node.disconnect();
    bridge.stop();
    return null;
  }
  // The same hint getDisplayMedia's own audio would carry: this is system
  // audio — music, a game, a video — not speech, and the encoder should not
  // treat it the way it treats a voice.
  track.contentHint = "music";

  let stopped = false;
  const nativeStop = track.stop.bind(track);
  const teardown = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
    bridge.stop();
    node.disconnect();
    destination.disconnect();
    nativeStop();
  };

  // Replacing the track's own stop() rather than asking every caller to
  // remember this one. MediaStreamTrack.stop() fires no event, so there is
  // no way to observe it from outside — and the thing on the other end of
  // this track is an OS-level audio capture in another process, which must
  // not outlive it. The share's teardown path already stops every track in
  // the stream without knowing where any of them came from (see stop() in
  // useRoomMedia's useBroadcastChannel); this is what makes that enough.
  track.stop = teardown;

  return { track, stop: teardown };
}
