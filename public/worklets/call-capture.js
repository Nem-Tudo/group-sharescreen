// "Gravar chamada" (see lib/callRecording.ts): hands the page raw stereo PCM
// from whatever is connected to it — one voice, one screen's sound, or the
// mix of all of them.
//
// Posts { time, left, right } every CHUNK frames, `time` being the audio
// graph's clock at the chunk's first frame. The page only reads it once, for
// the first chunk (how far into the recording this capture began); after
// that the graph is continuous and the frame count is the clock.
//
// With nothing connected (a stream that ended) the inputs are empty and this
// writes silence, so the capture never has a hole in it.
//
// "flush" hands over whatever is buffered, then answers "flushed" — the page
// waits for that before closing the file, so the last fraction of a second is
// not lost.

const CHUNK = 4096;

class CallCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CHUNK);
    this.right = new Float32Array(CHUNK);
    this.filled = 0;
    this.chunkTime = null;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "flush") {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ flushed: true });
      }
    };
  }

  flush() {
    if (!this.filled) return;
    const left = this.left.slice(0, this.filled);
    const right = this.right.slice(0, this.filled);
    this.port.postMessage({ time: this.chunkTime, left, right }, [left.buffer, right.buffer]);
    this.filled = 0;
    this.chunkTime = null;
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0] || [];
    const l = input[0];
    const r = input[1] || input[0];
    const frames = l ? l.length : 128;
    let offset = 0;
    while (offset < frames) {
      if (this.chunkTime === null) this.chunkTime = currentTime + offset / sampleRate;
      const n = Math.min(frames - offset, CHUNK - this.filled);
      if (l) {
        this.left.set(l.subarray(offset, offset + n), this.filled);
        this.right.set(r.subarray(offset, offset + n), this.filled);
      } else {
        this.left.fill(0, this.filled, this.filled + n);
        this.right.fill(0, this.filled, this.filled + n);
      }
      this.filled += n;
      offset += n;
      if (this.filled === CHUNK) this.flush();
    }
    return true;
  }
}

registerProcessor("golive-call-capture", CallCaptureProcessor);
