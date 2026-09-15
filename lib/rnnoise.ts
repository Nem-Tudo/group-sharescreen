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

// The input-gain dial: how loud this microphone is made *before* it is
// encoded and sent, as a linear amplitude multiplier (1 = the capture as the
// device hands it over).
//
// The floor is 1% rather than 0 on purpose. Zero here would be a second,
// invisible mute — indistinguishable from the mic button's, but persisted
// across reloads and reachable only by dragging a slider to its end. Someone
// who parks it there comes back tomorrow to a microphone that is on, lit
// green, showing no problem anywhere, and silent. 1% is inaudible in
// practice and still reads as "turned all the way down", which is a state
// the UI can explain.
//
// The ceiling is 2x (+6 dB). This is a digital multiplier applied after
// capture, so it lifts the noise floor exactly as much as the voice and
// clips whatever was already near full scale; past this the cure is
// reliably worse than the quiet. autoGainControl is deliberately turned off
// in micConstraints below rather than relied on for this: on Windows in
// particular, Chrome's AGC doesn't stay inside the digital signal — it winds
// the OS's own microphone level down when someone talks loudly, and that
// slider stays down for every other app after the call ends too. A genuinely
// quiet input is better fixed with this dial, which never touches anything
// outside the tab.
export const MIN_MIC_GAIN = 0.01;
export const MAX_MIC_GAIN = 2;
export const DEFAULT_MIC_GAIN = 1;

export function clampMicGain(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MIC_GAIN;
  return Math.min(MAX_MIC_GAIN, Math.max(MIN_MIC_GAIN, value));
}

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
  // Null when the graph was built but RNNoise itself could not be: an
  // unsupported browser, a context running at the wrong sample rate, a
  // worklet or wasm fetch that failed. The gain dial still works in that
  // state — only the suppression toggle is greyed out, which is why
  // "is there a graph" and "is suppression available" are now two questions
  // (see graphSuppressionAvailable).
  rnnoiseNode: RnnoiseWorkletNode | null;
  // The fixed leveler that stands in for the browser's own autoGainControl —
  // see MIC_LEVELER_* below for why it exists and connectUpstream for where
  // it sits in the chain.
  compressor: DynamicsCompressorNode;
  makeupGainNode: GainNode;
  // The input-volume dial, last in the chain — see connectUpstream for why
  // it sits after the suppressor rather than before it.
  gainNode: GainNode;
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
  // What actually gets broadcast over WebRTC — either the graph's output, or
  // (if not even a bare gain graph could be built) the raw capture.
  stream: MediaStream;
  // Null when no graph could be built at all. The caller uses this to grey
  // out the input-volume dial: with nothing in the path there is nowhere for
  // it to apply.
  graph: MicNoiseGraph | null;
};

// Whether noise suppression is actually in effect right now, as opposed to
// merely being the preference for the next mic start. A graph without an
// RNNoise node is still a working graph — the gain dial runs on it — so the
// old "graph !== null" test no longer answers this.
export function graphSuppressionAvailable(graph: MicNoiseGraph | null): boolean {
  return graph?.rnnoiseNode != null;
}

// Mono is asked for rather than assumed. RNNoise processes a single channel
// (maxChannels below), and an AudioWorkletNode left on its default
// channelCountMode hands a stereo input straight through as stereo — two
// channels of which only the first is ever written, the second staying
// digital silence. Anyone whose voice arrives on the right channel (a mic in
// input 2 of an interface, VoiceMeeter, VB-Cable) broadcast nothing at all.
// This is only a request, so the graph is pinned to mono as well.

// A fixed stand-in for the boost autoGainControl used to provide.
// autoGainControl (see micConstraints below) had two effects at once: it
// quietly wound down the OS's own mic level whenever someone spoke up, which
// is the bug this file now avoids, but it also brought a too-quiet mic up to
// a normal speaking volume — losing that along with it made every input
// sound noticeably quieter than before, even though nothing about the actual
// microphones changed.
//
// This replaces just the second half: a compressor narrows the signal's
// dynamic range (loud stays loud, quiet comes up closer to it) and a fixed
// gain after it restores the overall level — "fixed" meaning a constant
// multiplier baked in at build time, never adjusted at runtime the way AGC's
// was, so there is nothing here that can decide to touch a system setting
// again. It sits before the user's own input-gain dial (gainNode), so that
// dial still means "how loud on top of a normal level" rather than having to
// account for this makeup gain itself.
const MIC_LEVELER_THRESHOLD_DB = -50;
const MIC_LEVELER_KNEE_DB = 30;
const MIC_LEVELER_RATIO = 12;
const MIC_LEVELER_ATTACK_SECONDS = 0.003;
const MIC_LEVELER_RELEASE_SECONDS = 0.25;
// +9 dB — enough to bring a quiet mic back up to something like its old,
// AGC-boosted loudness. The compressor above is what keeps this from
// clipping a mic that was already loud to begin with.
const MIC_LEVELER_MAKEUP_GAIN = 10 ** (9 / 20);

function micConstraints(deviceId?: string | null): MediaTrackConstraints {
  // autoGainControl: false so Chrome's own AGC never touches the OS mic
  // level — see the MIN_MIC_GAIN/MAX_MIC_GAIN comment above for why that's
  // the wrong tool even when the intent (fixing a too-quiet mic) is right.
  const base = { channelCount: 1, autoGainControl: false };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
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

// Builds the RNNoise worklet node on the shared context, or returns null if
// it cannot be. Every "no suppression here" condition lives in this one
// function now, because the rest of the graph gets built either way — the
// gain dial has no reason to disappear just because the suppressor did.
async function createRnnoiseNode(audioCtx: AudioContext): Promise<RnnoiseWorkletNode | null> {
  if (typeof AudioWorkletNode === "undefined") return null;

  // RNNoise is hard-wired to 48 kHz — its worklet slices fixed 480-sample
  // frames and the library node is documented "Assumes sample rate to be
  // 48kHz" — and nothing in it checks. At any other rate it does not fail;
  // it mis-reads the signal and its voice detector gates away what it no
  // longer recognises as speech, which at 16 kHz (a Bluetooth headset in
  // hands-free mode) is silence in all but name. audioContext.ts asks for
  // 48 kHz precisely so this holds, but a browser is free to refuse and hand
  // back the output device's own rate instead. On that context the mic is
  // broadcast unsuppressed and the caller greys out the toggle, exactly as
  // it does when the worklet cannot load at all.
  if (audioCtx.sampleRate !== RNNOISE_SAMPLE_RATE) return null;

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

    const node = new RnnoiseWorkletNode(audioCtx, { maxChannels: 1, wasmBinary });
    // RNNoise only ever processes mono, so the node says so rather than
    // trusting the capture to be mono (see micConstraints — the constraint
    // is a request a browser may ignore). "explicit" down-mixes a stereo
    // input to one channel, so a voice on either side survives; "max", the
    // default, would pass two channels through and leave the second silent.
    node.channelCount = 1;
    node.channelCountMode = "explicit";
    return node;
  } catch {
    return null;
  }
}

// Wires — or re-wires — everything upstream of the leveler:
//
//   source -> [rnnoise] -> compressor -> makeup gain -> gain -> destination
//
// Two things about that order are deliberate.
//
// The leveler comes after the suppressor, so RNNoise always sees the capture
// at the level the device produced. RNNoise decides what is speech and what
// is noise from the signal it is handed, and a signal already pushed up by
// the leveler is one whose noise floor it was never trained on; a signal
// turned down to 1% by the dial ahead of it would be one it quite reasonably
// classifies as silence, which is why the user's own gain dial stays after
// the leveler rather than before it too.
//
// And makeup gain -> gain -> destination is made once, at build time, and
// never touched here. The destination's track is the one being broadcast, so
// leaving that last link alone is what lets suppression be toggled mid-call
// without interrupting it or making peers renegotiate.
function connectUpstream(graph: MicNoiseGraph, suppressionEnabled: boolean) {
  graph.source.disconnect();
  graph.rnnoiseNode?.disconnect();
  if (suppressionEnabled && graph.rnnoiseNode) {
    graph.source.connect(graph.rnnoiseNode);
    graph.rnnoiseNode.connect(graph.compressor);
  } else {
    graph.source.connect(graph.compressor);
  }
}

// Captures the mic and routes it through the RNNoise AudioWorklet and the
// input-gain node before returning it, so background noise is suppressed for
// everyone else in the room and the person can set how loud they arrive.
// Falls back to the raw, unprocessed capture when no graph can be built at
// all — a noisy call still beats no call at all.
export async function captureNoiseSuppressedMic(
  suppressionEnabled: boolean,
  onGraphEnded?: () => void,
  // Null/undefined captures the system default input, same as before this
  // param existed.
  deviceId?: string | null,
  // Where the input-volume dial is right now. Applied as the graph is built
  // rather than in a follow-up call, so a mic started at 30% is never
  // broadcast at 100% for the first few frames.
  initialGain: number = DEFAULT_MIC_GAIN
): Promise<MicCaptureResult> {
  const rawStream = await captureRawMic(deviceId);

  // The processed mic is produced by an audio graph, and a graph in a
  // suspended AudioContext does not run: its destination node emits digital
  // silence, which is then dutifully encoded and sent to everyone. That is
  // exactly what happened whenever the mic auto-started from a stored
  // preference on page load, before anything had been clicked — the person
  // appeared to be transmitting and no one could hear a word.
  //
  // So the graph is only built once the context is confirmed running. If the
  // browser won't start it yet, the raw capture is broadcast unprocessed
  // instead: unsuppressed audio at the device's own level beats silent
  // audio, and the caller greys out both dials rather than claiming
  // features that aren't there.
  const running = await ensureSharedAudioContextRunning();
  const audioCtx = getSharedAudioContext();
  if (!running || !audioCtx) {
    return { stream: rawStream, graph: null };
  }

  try {
    const source = audioCtx.createMediaStreamSource(rawStream);
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = MIC_LEVELER_THRESHOLD_DB;
    compressor.knee.value = MIC_LEVELER_KNEE_DB;
    compressor.ratio.value = MIC_LEVELER_RATIO;
    compressor.attack.value = MIC_LEVELER_ATTACK_SECONDS;
    compressor.release.value = MIC_LEVELER_RELEASE_SECONDS;
    const makeupGainNode = audioCtx.createGain();
    makeupGainNode.gain.value = MIC_LEVELER_MAKEUP_GAIN;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = clampMicGain(initialGain);
    const destination = audioCtx.createMediaStreamDestination();
    // All pinned mono for the reason createRnnoiseNode pins its node, and
    // pinned here as well because connectUpstream's bypass path reaches the
    // destination without passing through that node at all.
    compressor.channelCount = 1;
    compressor.channelCountMode = "explicit";
    makeupGainNode.channelCount = 1;
    makeupGainNode.channelCountMode = "explicit";
    gainNode.channelCount = 1;
    gainNode.channelCountMode = "explicit";
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";
    compressor.connect(makeupGainNode);
    makeupGainNode.connect(gainNode);
    gainNode.connect(destination);

    // Only the suppressor is optional — a graph without it is still a graph,
    // and still carries the volume dial.
    const rnnoiseNode = await createRnnoiseNode(audioCtx);

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
      compressor.disconnect();
      makeupGainNode.disconnect();
      gainNode.disconnect();
      rnnoiseNode?.disconnect();
      rnnoiseNode?.destroy();
      // The context is shared with playback, the speaking analysers and
      // the sound effects now — closing it here would take the whole
      // page's audio down with the mic. Disconnecting this graph's own
      // nodes is the entire cleanup this owns.
      onGraphEnded?.();
    };

    const graph: MicNoiseGraph = {
      rawStream,
      audioCtx,
      source,
      rnnoiseNode,
      compressor,
      makeupGainNode,
      gainNode,
      destination,
      stop: teardown,
    };
    connectUpstream(graph, suppressionEnabled);

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

    return { stream: destination.stream, graph };
  } catch {
    return { stream: rawStream, graph: null };
  }
}

// Reroutes the live audio graph between "through RNNoise" and "straight
// through" — toggling this never touches the broadcast track itself (it's
// always the destination node's track), so peers never see a renegotiation.
export function setGraphSuppressionEnabled(graph: MicNoiseGraph | null, enabled: boolean) {
  if (!graph) return;
  connectUpstream(graph, enabled);
}

// Sets the input volume on the live graph. Assigns to `gain.value` rather
// than ramping, same as the playback dial in audioGain.ts: a slider being
// dragged already arrives as a stream of small steps, and a ramp per step
// would only lag behind the person's hand.
export function setGraphInputGain(graph: MicNoiseGraph | null, gain: number) {
  if (!graph) return;
  graph.gainNode.gain.value = clampMicGain(gain);
}
