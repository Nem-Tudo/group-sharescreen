"use client";

// Type-only: erased at compile time, so this doesn't pull the runtime module
// (and its `class ... extends AudioWorkletNode` at module scope, see below)
// into the server bundle.
import type { RnnoiseWorkletNode, loadRnnoise as LoadRnnoiseFn } from "@sapphi-red/web-noise-suppressor";
import {
  getSharedAudioContext,
  ensureSharedAudioContextRunning,
  RNNOISE_SAMPLE_RATE,
} from "./audioContext";

// Static assets copied from node_modules/@sapphi-red/web-noise-suppressor/dist
// into public/rnnoise — served as plain files so this works regardless of
// bundler (the package's own docs assume Vite's `?url` imports, which Next.js
// doesn't support).
const WORKLET_URL = "/rnnoise/workletProcessor.js";
const WASM_URL = "/rnnoise/rnnoise.wasm";
const WASM_SIMD_URL = "/rnnoise/rnnoise_simd.wasm";

// The wasm binary never changes at runtime, so it's fetched once and reused
// across every mic start in this tab instead of re-downloading it each time.
let wasmBinaryPromise: Promise<ArrayBuffer> | null = null;

function getRnnoiseWasmBinary(loadRnnoise: typeof LoadRnnoiseFn): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = loadRnnoise({ url: WASM_URL, simdUrl: WASM_SIMD_URL }).catch((err: unknown) => {
      // Let a later mic start try again instead of permanently remembering
      // this one failure (e.g. a transient network blip on first load).
      wasmBinaryPromise = null;
      throw err;
    });
  }
  return wasmBinaryPromise;
}

export type MicNoiseGraph = {
  rawStream: MediaStream;
  // The app-wide shared context (see audioContext.ts) — emphatically not
  // this graph's to close.
  audioCtx: AudioContext;
  source: MediaStreamAudioSourceNode;
  rnnoiseNode: RnnoiseWorkletNode;
  destination: MediaStreamAudioDestinationNode;
  // Tears the graph down explicitly. This has to exist because the
  // "ended"-driven teardown below cannot be relied on: per spec,
  // MediaStreamTrack.stop() does *not* fire "ended" (that event is only for a
  // source ending on its own), and stop() is exactly what the caller does
  // when the mic is switched off. Without an explicit call the raw capture
  // stayed open — browser mic indicator still lit, the device still held
  // against the next getUserMedia — and the RNNoise worklet kept running WASM
  // on the shared context, one leaked processor per mic start.
  stop: () => void;
};

export type MicCaptureResult = {
  // What actually gets broadcast over WebRTC — either the RNNoise-processed
  // output, or (if setup failed) the raw capture, unprocessed.
  stream: MediaStream;
  // Null when RNNoise couldn't be set up (unsupported browser, blocked
  // fetch, etc.) — the caller uses this to grey out the suppression toggle.
  graph: MicNoiseGraph | null;
};

// Mono is asked for rather than assumed. RNNoise processes a single channel
// (maxChannels below), and an AudioWorkletNode left on its default
// channelCountMode hands a stereo input straight through as stereo — two
// channels of which only the first is ever written, the second staying
// digital silence. Anyone whose voice arrives on the right channel (a mic in
// input 2 of an interface, VoiceMeeter, VB-Cable) broadcast nothing at all.
// This is only a request, so the graph is pinned to mono as well.
function micConstraints(deviceId?: string | null): MediaTrackConstraints {
  return deviceId ? { channelCount: 1, deviceId: { exact: deviceId } } : { channelCount: 1 };
}

// The picked input is gone — unplugged since it was chosen, or its id
// rotated out from under the stored preference. Browsers report that as
// OverconstrainedError/NotFoundError, which the caller's catch turns into
// "verifique a permissão do navegador": a message about something that was
// never the problem.
function isMissingDeviceError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError";
}

// Opens the raw capture, falling back to the default input when the chosen
// one has gone missing — the same trade captureCamera makes in useRoomMedia,
// for the same reason: a working microphone beats an error about permissions
// that were never denied. The stored choice is deliberately left alone, so
// the next start tries that device again once it is back.
async function captureRawMic(deviceId?: string | null): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
  } catch (err) {
    if (!deviceId || !isMissingDeviceError(err)) throw err;
    return navigator.mediaDevices.getUserMedia({ audio: micConstraints(null) });
  }
}

// Captures the mic and routes it through an RNNoise AudioWorklet before
// returning it, so background noise is suppressed for everyone else in the
// room. Falls back to the raw, unprocessed capture if RNNoise can't be set
// up — a noisy call still beats no call at all.
export async function captureNoiseSuppressedMic(
  suppressionEnabled: boolean,
  onGraphEnded?: () => void,
  // Null/undefined captures the system default input, same as before this
  // param existed.
  deviceId?: string | null
): Promise<MicCaptureResult> {
  const rawStream = await captureRawMic(deviceId);

  if (typeof window === "undefined" || typeof AudioWorkletNode === "undefined") {
    return { stream: rawStream, graph: null };
  }

  // The processed mic is produced by an audio graph, and a graph in a
  // suspended AudioContext does not run: its destination node emits digital
  // silence, which is then dutifully encoded and sent to everyone. That is
  // exactly what happened whenever the mic auto-started from a stored
  // preference on page load, before anything had been clicked — the person
  // appeared to be transmitting and no one could hear a word.
  //
  // So the graph is only built once the context is confirmed running. If the
  // browser won't start it yet, the raw capture is broadcast unprocessed
  // instead: noisy audio beats silent audio, and the caller greys out the
  // suppression toggle (graph === null) rather than claiming a feature that
  // isn't there.
  const running = await ensureSharedAudioContextRunning();
  const audioCtx = getSharedAudioContext();
  if (!running || !audioCtx) {
    return { stream: rawStream, graph: null };
  }

  // RNNoise is hard-wired to 48 kHz — its worklet slices fixed 480-sample
  // frames and the library node is documented "Assumes sample rate to be
  // 48kHz" — and nothing in it checks. At any other rate it does not fail;
  // it mis-reads the signal and its voice detector gates away what it no
  // longer recognises as speech, which at 16 kHz (a Bluetooth headset in
  // hands-free mode) is silence in all but name. audioContext.ts asks for
  // 48 kHz precisely so this holds, but a browser is free to refuse and hand
  // back the output device's own rate instead. On that context the raw
  // capture is broadcast unprocessed and the caller greys out the toggle,
  // exactly as it does when the worklet cannot load at all.
  if (audioCtx.sampleRate !== RNNOISE_SAMPLE_RATE) {
    return { stream: rawStream, graph: null };
  }

  try {
    // Dynamic: this package's classes do `extends AudioWorkletNode` at
    // module scope, which throws a bare ReferenceError if evaluated on the
    // server (React SSR still executes "use client" modules' static imports
    // on the server for the initial render). Importing it here, after the
    // AudioWorkletNode guard above, means it only ever loads in the browser.
    const { RnnoiseWorkletNode, loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
    // Adding the same module twice on one context is allowed and resolves
    // to the already-registered processor, so a second mic start in the same
    // tab costs nothing here.
    await audioCtx.audioWorklet.addModule(WORKLET_URL);
    const wasmBinary = await getRnnoiseWasmBinary(loadRnnoise);

    const source = audioCtx.createMediaStreamSource(rawStream);
    const destination = audioCtx.createMediaStreamDestination();
    const rnnoiseNode = new RnnoiseWorkletNode(audioCtx, { maxChannels: 1, wasmBinary });
    // RNNoise only ever processes mono, so both ends of the graph say so
    // rather than trusting the capture to be mono (see micConstraints — the
    // constraint is a request a browser may ignore). "explicit" down-mixes a
    // stereo input to one channel, so a voice on either side survives;
    // "max", the default, would pass two channels through and leave the
    // second one silent. The destination is pinned too, which covers the
    // bypass path below, where the capture reaches it without passing
    // through the node at all.
    rnnoiseNode.channelCount = 1;
    rnnoiseNode.channelCountMode = "explicit";
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";

    if (suppressionEnabled) {
      source.connect(rnnoiseNode);
      rnnoiseNode.connect(destination);
    } else {
      source.connect(destination);
    }

    // One teardown, reachable two ways. `stop()` below is the reliable path
    // (the caller switching the mic off); the "ended" listener stays as the
    // backstop for the raw capture dying on its own — a device unplugged, a
    // permission revoked, another app seizing it — which is the one case
    // stop() is never called for.
    let disposed = false;
    const teardown = () => {
      if (disposed) return;
      disposed = true;
      rawStream.getTracks().forEach((t) => t.stop());
      destination.stream.getTracks().forEach((t) => t.stop());
      source.disconnect();
      rnnoiseNode.disconnect();
      rnnoiseNode.destroy();
      // The context is shared with playback, the speaking analysers and
      // the sound effects now — closing it here would take the whole
      // page's audio down with the mic. Disconnecting this graph's own
      // nodes is the entire cleanup this owns.
      onGraphEnded?.();
    };

    // The destination's track is what's actually sent over WebRTC (see
    // useRoomMedia). Note this fires only when the track ends *on its own*:
    // an explicit stop() does not raise it, which is why teardown is also
    // exposed directly on the graph.
    const outputTrack = destination.stream.getAudioTracks()[0];
    outputTrack.addEventListener("ended", teardown, { once: true });
    // The raw capture ending is the failure this could not previously see at
    // all: the destination node happily keeps emitting digital silence, which
    // is then encoded and sent to the whole room while the UI still shows the
    // mic on and every peer connection reports "connected". Nobody hears a
    // word and nothing anywhere says why.
    for (const track of rawStream.getAudioTracks()) {
      track.addEventListener("ended", teardown, { once: true });
    }

    return {
      stream: destination.stream,
      graph: { rawStream, audioCtx, source, rnnoiseNode, destination, stop: teardown },
    };
  } catch {
    return { stream: rawStream, graph: null };
  }
}

// Reroutes the live audio graph between "through RNNoise" and "straight
// through" — toggling this never touches the broadcast track itself (it's
// always the destination node's track), so peers never see a renegotiation.
export function setGraphSuppressionEnabled(graph: MicNoiseGraph | null, enabled: boolean) {
  if (!graph) return;
  graph.source.disconnect();
  graph.rnnoiseNode.disconnect();
  if (enabled) {
    graph.source.connect(graph.rnnoiseNode);
    graph.rnnoiseNode.connect(graph.destination);
  } else {
    graph.source.connect(graph.destination);
  }
}
