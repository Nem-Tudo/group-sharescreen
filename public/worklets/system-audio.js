// Plays PCM pushed in from the desktop shell as a live audio node.
//
// The audio arrives from another process entirely — a native WASAPI helper
// capturing the system mix with GoLive excluded (see electron/systemAudio.ts
// and lib/desktopSystemAudio.ts) — so it comes in bursts over IPC rather
// than on the audio clock. This node is what turns that back into a
// continuous stream the encoder can have: a jitter buffer, drained at
// exactly the rate the graph asks for.
//
// Two clocks, and why that needs handling
// ---------------------------------------
// The producer runs on the capture device's clock. The consumer — this
// processor — runs on the render device's clock. Those are usually the same
// piece of hardware, but nothing guarantees it (capture excludes a process,
// not a device; the user can also change their output device mid-share), and
// two independent crystals drift apart indefinitely. Left alone, that is a
// buffer that grows until latency is unbearable or empties until every other
// block is silence.
//
// So the read position advances at a rate nudged by how full the buffer is:
// slightly fast when it is filling up, slightly slow when it is draining.
// The correction is capped at 0.5%, which is under 9 cents of pitch — well
// below audible — and an order of magnitude more than real clock drift
// needs. It doubles as the resampler for the case where the graph is not
// running at the capture's 48 kHz, since a fractional read step is the same
// mechanism either way.

// The format the helper produces. Kept in step with SYSTEM_AUDIO_FORMAT in
// electron/channels.ts — this file cannot import it (it is served as a
// static asset to an AudioWorklet, which has no module resolution).
const SOURCE_RATE = 48000;
const CHANNELS = 2;

// One second of ring buffer. Far more than the target fill; the headroom is
// what absorbs a burst arriving after the main thread was busy, instead of
// throwing that audio away.
const RING_FRAMES = SOURCE_RATE;

// Where the buffer is kept, by default. Enough to ride out IPC jitter, small
// enough that the delay it adds to the shared audio is not something a viewer
// would notice against the video.
//
// Overridable per node through processorOptions.targetSeconds, because the
// two producers feeding this processor jitter by very different amounts. The
// desktop helper writes into a pipe read on its own thread, so 60ms is
// plenty. The Android capture (see lib/androidScreenCapture.ts) arrives as
// base64 over the Capacitor bridge, which is delivered on the WebView's main
// thread — the same thread that is decoding a JPEG screen frame fifteen
// times a second. A chunk arriving 100ms late there is ordinary, not a
// fault, and a buffer sized for the desktop would underrun on every one.
const DEFAULT_TARGET_SECONDS = 0.06;

// A backlog this size is not drift, it is a stall that has ended — the main
// thread was blocked and then delivered everything at once. Playing it out
// at 0.5% would take minutes to recover, so it is dropped instead: in a live
// stream the newest audio is the only audio worth having.
//
// Scaled off the target rather than fixed, so that raising the target raises
// the headroom with it: the floor is what the desktop has always used, and a
// larger buffer is allowed to run three times its own depth behind before
// its backlog counts as a stall rather than as the margin it was asked for.
const MIN_MAX_SECONDS = 0.3;

const MAX_CORRECTION = 0.005;

class SystemAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options && options.processorOptions && options.processorOptions.targetSeconds;
    const targetSeconds = typeof requested === "number" && requested > 0 ? requested : DEFAULT_TARGET_SECONDS;
    // Clamped to the ring, which is the hard ceiling on anything this can
    // hold — a target the buffer cannot physically reach would leave the
    // node permanently unprimed, which is silence forever rather than a
    // deeper buffer.
    this.targetFrames = Math.min(Math.round(SOURCE_RATE * targetSeconds), Math.round(RING_FRAMES / 2));
    this.maxFrames = Math.max(Math.round(SOURCE_RATE * MIN_MAX_SECONDS), this.targetFrames * 3);
    this.ring = new Float32Array(RING_FRAMES * CHANNELS);
    // Write position in frames, and a *fractional* read position — the
    // fraction is what carries both the drift correction and the resampling.
    this.write = 0;
    this.read = 0;
    this.available = 0;
    // Whether the buffer has ever reached its target fill. Until it has, the
    // node outputs silence rather than starting on the first chunk to
    // arrive — see the guard in process().
    this.primed = false;

    // No "capture ended" message to handle: when the shell's helper stops,
    // chunks simply stop arriving and this node keeps producing silence.
    // That is deliberate. The track is live in several peer connections by
    // then, and a node that stopped filling its output would leave their
    // encoders with nothing at all rather than with quiet.
    this.port.onmessage = (event) => {
      if (event.data instanceof Float32Array) this.push(event.data);
    };
  }

  // `samples` is interleaved stereo at SOURCE_RATE.
  push(samples) {
    const frames = Math.floor(samples.length / CHANNELS);
    if (frames === 0) return;

    // Dropping the oldest audio rather than refusing the newest. Only
    // reachable when the buffer was already near full, which means the
    // consumer is not keeping up and the backlog is stale by definition.
    if (this.available + frames > RING_FRAMES) {
      const overflow = this.available + frames - RING_FRAMES;
      this.read = (this.read + overflow) % RING_FRAMES;
      this.available -= overflow;
    }

    for (let i = 0; i < frames; i++) {
      const slot = ((this.write + i) % RING_FRAMES) * CHANNELS;
      for (let c = 0; c < CHANNELS; c++) {
        this.ring[slot + c] = samples[i * CHANNELS + c];
      }
    }
    this.write = (this.write + frames) % RING_FRAMES;
    this.available += frames;
  }

  // Linear interpolation between the two frames straddling a fractional
  // position. Cheap, and the artefacts it introduces sit far above anything
  // a 0.5% rate correction moves — it is the resampling that matters here,
  // not the drift nudge.
  sampleAt(position, channel) {
    const base = Math.floor(position);
    const frac = position - base;
    const a = this.ring[(base % RING_FRAMES) * CHANNELS + channel];
    const b = this.ring[((base + 1) % RING_FRAMES) * CHANNELS + channel];
    return a + (b - a) * frac;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const blockSize = output[0].length;

    // How fast to walk the buffer. The ratio handles a graph running at a
    // different rate than the capture; the correction handles drift between
    // the two clocks at whatever rate they are.
    const ratio = SOURCE_RATE / sampleRate;
    const fill = (this.available - this.targetFrames) / this.targetFrames;
    const correction = Math.max(-1, Math.min(1, fill)) * MAX_CORRECTION;
    const step = ratio * (1 + correction);

    // +1 because the interpolation above reads one frame ahead.
    const needed = Math.ceil(blockSize * step) + 1;

    // Running dry drops back to priming rather than resuming the instant one
    // block's worth of audio exists, which would leave no margin for the
    // next hiccup at all.
    //
    // In the case this is actually for — the main thread was busy and the
    // audio arrives late in a burst — it changes nothing measurable, because
    // that burst refills the buffer past the target in one go either way.
    // What it buys is the guarantee that playback never runs from an empty
    // buffer. The cost shows up only if the producer is *persistently*
    // slower than the graph consumes, which two clocks nominally at 48 kHz
    // are not: there it trades more frequent gaps for longer clean runs
    // between them.
    if (this.available < needed) this.primed = false;

    // Refuse to start on a nearly empty buffer, for the same reason: opening
    // a share on the first chunk to arrive means underrunning on the second,
    // and a stream that stutters through its first second reads as broken
    // rather than as one still filling up.
    if (!this.primed && this.available < this.targetFrames) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      // `false` would let the graph collect this node the moment it went
      // quiet, and the whole point is that it stays live through silence.
      return true;
    }
    this.primed = true;

    let position = this.read;
    for (let i = 0; i < blockSize; i++) {
      for (let c = 0; c < output.length; c++) {
        // A mono graph still gets the left channel rather than nothing.
        output[c][i] = this.sampleAt(position, Math.min(c, CHANNELS - 1));
      }
      position += step;
    }

    const consumed = Math.floor(position) - Math.floor(this.read);
    this.read = position % RING_FRAMES;
    this.available -= consumed;

    // See MIN_MAX_SECONDS: a backlog this far past target is recovered from by
    // skipping, not by playing it out.
    if (this.available > this.maxFrames) {
      const drop = this.available - this.targetFrames;
      this.read = (this.read + drop) % RING_FRAMES;
      this.available -= drop;
    }

    return true;
  }
}

registerProcessor("golive-system-audio", SystemAudioProcessor);
