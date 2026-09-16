"use client";

// Turns PCM pushed in from outside the browser into an ordinary
// MediaStreamTrack the share code can treat like any other.
//
// Two very different producers need exactly this, which is why it lives here
// rather than in either of them:
//
//   - lib/desktopSystemAudio.ts: a native WASAPI helper capturing the
//     Windows system mix with GoLive's own process tree excluded, streamed
//     over two IPC hops.
//   - lib/androidScreenCapture.ts: a MediaProjection AudioPlaybackCapture on
//     the Android app, streamed as base64 over the Capacitor plugin bridge.
//
// Both hand over the same thing — interleaved stereo 16-bit little-endian
// PCM at 48 kHz, in bursts, on a clock that is not the audio graph's — and
// both want the same thing back. The jitter buffer and the drift correction
// that make that work live in public/worklets/system-audio.js; this module is
// the graph around it, the Int16-to-Float conversion, and the teardown.

import { getSharedAudioContext, ensureSharedAudioContextRunning } from "./audioContext";

// Served as a static asset rather than bundled, for the same reason
// rnnoise.ts serves its worklet that way: addModule() takes a URL, and
// Next.js has no equivalent of Vite's `?url` import.
const WORKLET_URL = "/worklets/system-audio.js";
const PROCESSOR_NAME = "golive-system-audio";

// Int16 full scale. Both producers send 16-bit PCM because that halves what
// crosses the bridge; Web Audio wants -1..1 floats, and this is the whole
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

/**
 * Fetches the worklet module ahead of time, so that starting a share does not
 * have to. Safe and cheap to call more than once, and safe before any user
 * gesture: loading a module does not require a running context, only a
 * created one.
 *
 * This matters more than it looks on the desktop path — see
 * prewarmExcludedSystemAudio in lib/desktopSystemAudio.ts, where a cold
 * fetch here once ate enough of the click's transient activation budget to
 * make getDisplayMedia reject as if the picker had been dismissed.
 */
export function prewarmPcmAudioWorklet(): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  // Failure is fine and deliberately unobserved — startPcmAudioTrack retries
  // (loadWorklet clears its own memo on error) and its callers fall back.
  void loadWorklet(ctx).catch(() => {});
}

export interface PcmAudioTrack {
  /** The audio track to put in the share's MediaStream. */
  track: MediaStreamTrack;
  /**
   * Hands one chunk of interleaved stereo 16-bit little-endian PCM at 48 kHz
   * to the jitter buffer. Cheap to call often; the buffer is what decides
   * when any of it is heard.
   */
  push(chunk: Uint8Array): void;
  /** Tears the graph down. Safe to call twice. */
  stop(): void;
}

export interface PcmAudioTrackOptions {
  /**
   * How much audio the jitter buffer holds before it starts playing, in
   * seconds. Left unset it uses the worklet's own default (60ms), which fits
   * a producer whose delivery jitters by a few milliseconds. Raise it for one
   * that jitters by more — see the worklet's own comment on why the Android
   * bridge is that case.
   */
  targetSeconds?: number;
  /**
   * Run when the track is stopped, before the graph is torn down — the hook
   * each producer uses to shut down whatever is on the other end of it.
   *
   * Installed on the track's own stop() rather than left to the caller to
   * remember: MediaStreamTrack.stop() fires no event, so there is no way to
   * observe it from outside, and the thing being stopped is an OS-level
   * audio capture that must not outlive the track. Every share teardown in
   * this app already stops each track it finds without knowing where any of
   * them came from; this is what makes that enough.
   */
  onStop?: () => void;
}

/**
 * Builds the graph and returns the track, or null if it could not be built —
 * in which case the caller should carry on without system audio rather than
 * failing the whole share.
 */
export async function startPcmAudioTrack(
  options: PcmAudioTrackOptions = {}
): Promise<PcmAudioTrack | null> {
  // The graph has to be able to run for the capture to be worth anything: a
  // suspended context processes nothing, so the producer would fill a buffer
  // nobody drains.
  const ctx = getSharedAudioContext();
  if (!ctx || !(await ensureSharedAudioContextRunning())) return null;

  try {
    await loadWorklet(ctx);
  } catch {
    return null;
  }

  let node: AudioWorkletNode;
  try {
    node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { targetSeconds: options.targetSeconds },
    });
  } catch {
    return null;
  }

  const destination = ctx.createMediaStreamDestination();
  node.connect(destination);
  // Emphatically *not* connected to ctx.destination as well. That would play
  // the captured system audio back through the speakers on top of the
  // application that produced it — a second copy of everything, and one that
  // the capture would then have to exclude too.

  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    node.disconnect();
    destination.disconnect();
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
    options.onStop?.();
    node.disconnect();
    destination.disconnect();
    nativeStop();
  };
  track.stop = teardown;

  return {
    track,
    push(chunk: Uint8Array) {
      if (stopped) return;
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
    stop: teardown,
  };
}
