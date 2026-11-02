// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/nativeVideoSink.test.mts
//
// The rules that keep the desktop app's GPU capture and its stand-in track in
// step, without a worker, a browser or an encoder.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";

let framesWritten = 0;
const stamps: number[] = [];
class FakeVideoFrame {
  constructor(_data: unknown, init: { timestamp: number }) {
    framesWritten += 1;
    stamps.push(init.timestamp);
  }
  close() {}
}
(globalThis as Record<string, unknown>).VideoFrame = FakeVideoFrame;

const { SenderSink } = await import("./nativeVideoSink.ts");

const writer = {
  write: async () => {},
  close: async () => {},
} as unknown as WritableStreamDefaultWriter<VideoFrame>;

const frame = (key: boolean) => ({ key, data: new Uint8Array([key ? 1 : 2]) });
// Past the microtask a frame coming out of the encoder schedules the next one on, and
// past the gap between writes.
const settle = () => new Promise((resolve) => setTimeout(resolve, 8));

function startSink(t: TestContext) {
  const keyRequests = { count: 0 };
  let last: ReturnType<typeof frame> | null = null;
  const sink = new SenderSink(writer, {
    requestKeyFrame: () => {
      keyRequests.count += 1;
    },
    lastKey: () => last,
  });
  t.after(() => sink.close());
  const internals = sink as unknown as { queue: unknown[]; inflight: unknown };
  // The encoder coming back with the frame it was given.
  const encoded = (type: "key" | "delta" = "delta") => {
    const out: Array<{ data: ArrayBuffer }> = [];
    const controller = { enqueue: (f: { data: ArrayBuffer }) => out.push(f) };
    const result = sink.onEncoded(
      { type, data: new ArrayBuffer(1) },
      controller as unknown as TransformStreamDefaultController<{ type?: "key" | "delta" | "empty"; data: ArrayBuffer }>
    );
    return { out, result };
  };
  return { sink, keyRequests, internals, encoded, setLast: (f: ReturnType<typeof frame> | null) => (last = f) };
}

test("the worker the page loads is built from this code", async () => {
  // @ts-expect-error A plain script, with no types of its own.
  const { buildSinkWorker, OUTPUT } = await import("./nativeVideoSink.build.mjs");
  const onDisk = readFileSync(OUTPUT, "utf8").split(String.fromCharCode(13)).join("");
  assert.equal(onDisk, await buildSinkWorker(), 'rode "npm run workers:build"');
});

test("a connected viewer is fed from an IDR on, one frame per stand-in frame", async (t) => {
  const { sink, encoded } = startSink(t);
  sink.setConnected(true);
  const before = framesWritten;
  sink.onNative(frame(false));
  assert.equal(framesWritten, before, "antes do IDR nada entra");
  sink.onNative(frame(true));
  assert.equal(framesWritten, before + 1);
  // Lockstep: the next waits for the previous to come out of the encoder.
  sink.onNative(frame(false));
  assert.equal(framesWritten, before + 1);
  encoded("delta");
  await settle();
  assert.equal(framesWritten, before + 2);
});

test("a stand-in frame says when it was really captured, and time only goes forward", async (t) => {
  const { sink, encoded } = startSink(t);
  sink.setConnected(true);
  stamps.length = 0;
  const at = (key: boolean, timeMs: number) => ({ ...frame(key), timeMs });
  sink.onNative(at(true, 1000));
  encoded("delta");
  await settle();
  // A burst: arriving together, captured 33 ms apart. WebRTC drops a frame whose
  // capture time it has seen, so these must not be squeezed together.
  sink.onNative(at(false, 1033));
  encoded("delta");
  await settle();
  sink.onNative(at(false, 1066));
  encoded("delta");
  await settle();
  // The helper's clock never does this, but one slip must not stop the picture.
  sink.onNative(at(false, 1066));
  assert.deepEqual(stamps, [1_000_000, 1_033_000, 1_066_000, 1_067_000]);
});

test("a burst goes to the encoder spaced out, or WebRTC's frame rate limiter eats part of it", async (t) => {
  const { sink, encoded } = startSink(t);
  sink.setConnected(true);
  const times: number[] = [];
  const base = framesWritten;
  sink.onNative(frame(true));
  for (let i = 0; i < 5; i += 1) sink.onNative(frame(false));
  times.push(performance.now());
  while (framesWritten < base + 6) {
    const seen = framesWritten;
    encoded("delta");
    while (framesWritten === seen) await new Promise((resolve) => setTimeout(resolve, 0));
    times.push(performance.now());
  }
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] - times[i - 1] >= 1.5, `escritas a ${times[i] - times[i - 1]} ms uma da outra`);
  }
});

for (const state of ["disconnected", "failed"]) {
  test(`a ${state} link holds no frames`, (t) => {
    const { sink, internals } = startSink(t);
    sink.setConnected(true);
    sink.onNative(frame(true));
    sink.setConnected(false);
    for (let i = 0; i < 2000; i += 1) sink.onNative(frame(i % 120 === 0));
    assert.equal(internals.queue.length, 0);
  });
}

test("a link that comes back starts again from an IDR", async (t) => {
  const { sink, keyRequests } = startSink(t);
  sink.setConnected(true);
  sink.onNative(frame(true));
  sink.setConnected(false);
  sink.setConnected(true);
  assert.ok(keyRequests.count >= 2, "pediu um IDR novo");
  const before = framesWritten;
  sink.onNative(frame(false));
  assert.equal(framesWritten, before);
  sink.onNative(frame(true));
  await settle();
  assert.equal(framesWritten, before + 1);
});

test("a viewer who is not looking gets nothing, and comes back on a fresh IDR", async (t) => {
  const { sink, keyRequests, internals } = startSink(t);
  sink.setConnected(true);
  sink.onNative(frame(true));
  sink.setPaused(true);
  const paused = framesWritten;
  for (let i = 0; i < 500; i += 1) sink.onNative(frame(i % 120 === 0));
  assert.equal(framesWritten, paused);
  assert.equal(internals.queue.length, 0);
  const requests = keyRequests.count;
  sink.setPaused(false);
  assert.equal(keyRequests.count, requests + 1, "voltar pede um IDR");
  sink.onNative(frame(false));
  assert.equal(framesWritten, paused, "só a partir do IDR");
  sink.onNative(frame(true));
  await settle();
  assert.equal(framesWritten, paused + 1);
});

test("a keyframe slot waits for the helper's next IDR", async (t) => {
  const { sink, keyRequests, encoded } = startSink(t);
  sink.setConnected(true);
  sink.onNative(frame(true));
  encoded("key");
  sink.onNative(frame(false));
  encoded("delta");
  await settle();
  const requests = keyRequests.count;
  // The stand-in made a keyframe for a frame that is not an IDR: a viewer asked.
  const { out, result } = encoded("key");
  assert.equal(out.length, 0, "fica segurado");
  assert.equal(keyRequests.count, requests + 1);
  assert.equal(sink.stats.keyHolds, 1);
  sink.onNative(frame(false));
  assert.equal(out.length, 0, "um quadro comum não preenche");
  sink.onNative(frame(true));
  assert.equal(out.length, 1, "o IDR preenche");
  await result;
});

test("a frame the encoder lost restarts the chain", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sink, keyRequests } = startSink(t);
  sink.setConnected(true);
  sink.onNative(frame(true));
  const requests = keyRequests.count;
  t.mock.timers.tick(301);
  assert.equal(keyRequests.count, requests + 1);
  assert.equal(sink.stats.resyncs, 2);
});

test("something out of step is never sent: it would put the stand-in's picture on the wire", (t) => {
  const { sink, encoded } = startSink(t);
  sink.setConnected(true);
  const { out } = encoded("delta");
  assert.equal(out.length, 0);
});
