// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/nativeVideoCapture.test.mts
//
// A viewer's link is ended with pc.close(), which fires no event. Its sink
// used to queue every frame of the share from then on.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";

// The real survey imports React context that Node cannot load.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./gpuShareSurvey") {
      return { url: "data:text/javascript,export function noteGpuShareEnded() {}", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

class FakeTrack {
  kind = "video";
  writable = new WritableStream<unknown>();
  stop() {}
}
// Each one is a stand-in frame a sink handed to its encoder.
let framesWritten = 0;
class FakeVideoFrame {
  constructor() {
    framesWritten += 1;
  }
  close() {}
}
const globals = globalThis as Record<string, unknown>;
globals.MediaStreamTrackGenerator = FakeTrack;
globals.VideoFrame = FakeVideoFrame;
globals.RTCRtpSender = class {};

let deliver: ((meta: unknown, data: Uint8Array) => void) | null = null;
globals.window = {
  golive: {
    nativeVideo: {
      onFrame(onFrame: (meta: unknown, data: Uint8Array) => void) {
        deliver = onFrame;
        return () => {
          deliver = null;
        };
      },
      control() {},
      stop() {},
    },
  },
};

const { NativeVideoSource } = await import("./nativeVideoCapture.ts");

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "connected";
  addTrack() {
    return {
      createEncodedStreams: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => {},
    };
  }
  getTransceivers() {
    return [];
  }
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: string, listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: string, listener: () => void) {
    this.listeners.delete(listener);
  }
  setState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    for (const listener of this.listeners) listener();
  }
  // As in Chromium, closing changes the state without a connectionstatechange.
  close() {
    this.connectionState = "closed";
  }
}

const IDR_HEADER = [0, 0, 0, 1, 0x65];
const SLICE_HEADER = [0, 0, 0, 1, 0x41];
const KEY_INTERVAL = 120;
// About half a minute of video: far past the 30-frame backlog limit in pump().
const MANY_FRAMES = 2000;

function sendFrames(count: number, first = 0) {
  for (let i = first; i < first + count; i += 1) {
    const data = new Uint8Array(64 * 1024);
    data.set(i % KEY_INTERVAL === 0 ? IDR_HEADER : SLICE_HEADER);
    deliver!({ key: false, sequence: i, width: 1920, height: 1080, timeMs: i }, data);
  }
}

interface SinkInternals {
  queue: unknown[];
}

function startShare(t: TestContext) {
  const source = new NativeVideoSource(8000, 60);
  // The source's timers would keep the run alive after a failed assertion.
  t.after(() => source.stop());
  source.setPreviewActive(false);
  const sinks = (source as unknown as { sinks: Set<SinkInternals> }).sinks;
  const addViewer = () => {
    const pc = new FakePeerConnection();
    source.attach(pc as unknown as RTCPeerConnection, {} as MediaStream);
    return { pc, sink: [...sinks].at(-1)! };
  };
  return { source, sinks, addViewer };
}

test("a viewer closed with pc.close() is dropped and holds no frames", (t) => {
  const { sinks, addViewer } = startShare(t);
  const viewer = addViewer();
  sendFrames(10);
  viewer.pc.close();
  sendFrames(MANY_FRAMES);
  assert.equal(viewer.sink.queue.length, 0);
  assert.equal(sinks.size, 0);
});

for (const state of ["disconnected", "failed"] as const) {
  test(`a ${state} link holds no frames`, (t) => {
    const { addViewer } = startShare(t);
    const viewer = addViewer();
    viewer.pc.connectionState = state;
    sendFrames(MANY_FRAMES);
    assert.equal(viewer.sink.queue.length, 0);
  });
}

test("a connected viewer is still fed", (t) => {
  const { addViewer } = startShare(t);
  addViewer();
  const before = framesWritten;
  sendFrames(1);
  assert.equal(framesWritten, before + 1);
});

test("a link that comes back starts again from an IDR", (t) => {
  const { addViewer } = startShare(t);
  const viewer = addViewer();
  sendFrames(1);
  viewer.pc.setState("disconnected");
  sendFrames(MANY_FRAMES);
  viewer.pc.setState("connected");
  const before = framesWritten;
  sendFrames(KEY_INTERVAL - 1, 1);
  assert.equal(viewer.sink.queue.length, 0);
  assert.equal(framesWritten, before);
  sendFrames(1);
  assert.equal(framesWritten, before + 1);
});
