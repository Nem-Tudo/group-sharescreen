// Where the GPU capture's frames meet the peer connections, off the page's main
// thread. See lib/nativeVideoSink.ts for why.
//
// The streams arrive transferred: Chromium hands a transferred encoded stream
// and a transferred track generator straight to the worker's thread, so nothing
// in the per-frame path touches the main thread once they are here. The frames
// themselves come from the page, or, with a desktop shell new enough to hand out
// a MessagePort, directly from the shell (see electron/nativeVideo.ts), which
// takes the main thread out of that last hop too.

import { ParameterSetKeeper } from "./nativeVideoFrames";
import { SenderSink, type EncodedFrame, type NativeFrame, type SinkHost } from "./nativeVideoSink";

type InMessage =
  | { type: "frame"; data: ArrayBuffer; timeMs: number }
  | { type: "port"; port: MessagePort }
  | { type: "preview"; active: boolean }
  | {
      type: "sink";
      id: number;
      writable: WritableStream<VideoFrame>;
      encodedReadable: ReadableStream<EncodedFrame>;
      encodedWritable: WritableStream<EncodedFrame>;
    }
  | { type: "passthrough"; readable: ReadableStream<unknown>; writable: WritableStream<unknown> }
  | { type: "state"; id: number; connected: boolean }
  | { type: "paused"; id: number; paused: boolean }
  | { type: "close"; id: number }
  | { type: "stop" };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  setInterval: typeof setInterval;
};

const sinks = new Map<number, SenderSink>();
const keeper = new ParameterSetKeeper();
let lastKeyFrame: NativeFrame | null = null;
let previewActive = false;

const host: SinkHost = {
  requestKeyFrame: () => scope.postMessage({ type: "need-key" }),
  lastKey: () => lastKeyFrame,
};

function onFrame(raw: Uint8Array, timeMs: number | undefined) {
  const { data, idr } = keeper.process(raw);
  const frame: NativeFrame = { key: idr, data, timeMs };
  if (idr) lastKeyFrame = frame;
  for (const sink of sinks.values()) sink.onNative(frame);
  if (previewActive) {
    // A copy: the frame stays here as the last IDR, and sinks read it again.
    const copy = data.slice(0);
    scope.postMessage({ type: "preview-frame", key: idr, data: copy.buffer }, [copy.buffer]);
  }
}

scope.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case "frame":
      onFrame(new Uint8Array(message.data), message.timeMs);
      break;
    case "port":
      message.port.onmessage = (e: MessageEvent<{ data?: Uint8Array; timeMs?: number }>) => {
        if (e.data?.data instanceof Uint8Array) onFrame(e.data.data, e.data.timeMs);
      };
      break;
    case "preview":
      previewActive = message.active;
      break;
    case "sink": {
      const sink = new SenderSink(message.writable.getWriter(), host);
      sinks.set(message.id, sink);
      const transform = new TransformStream<EncodedFrame, EncodedFrame>({
        transform: (frame, controller) => sink.onEncoded(frame, controller),
      });
      void message.encodedReadable.pipeThrough(transform).pipeTo(message.encodedWritable).catch(() => {});
      break;
    }
    case "passthrough":
      void message.readable.pipeTo(message.writable).catch(() => {});
      break;
    case "state":
      sinks.get(message.id)?.setConnected(message.connected);
      break;
    case "paused":
      sinks.get(message.id)?.setPaused(message.paused);
      break;
    case "close":
      sinks.get(message.id)?.close();
      sinks.delete(message.id);
      break;
    case "stop":
      for (const sink of sinks.values()) sink.close();
      sinks.clear();
      break;
  }
};

// The counters behind the quality reports.
scope.setInterval(() => {
  if (sinks.size === 0) return;
  scope.postMessage({
    type: "stats",
    stats: [...sinks].map(([id, sink]) => ({ id, ...sink.stats })),
  });
}, 5000);
