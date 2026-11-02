// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/qualityNegotiation.test.mts
//
// When a viewer tells a broadcaster what it needs. Both rules lean towards the
// picture being sharp: more is asked for at once, less only after a while.

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { type TestContext } from "node:test";

const sent: Array<{ tier: string; idle?: boolean }> = [];
(globalThis as Record<string, unknown>).__qualitySent = sent;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./signalingClient") {
      const source =
        "export const signalingClient = { sendSignal(_to, data) { globalThis.__qualitySent.push(data); } };";
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { qualityNegotiator } = await import("./qualityNegotiation.ts");
const { retainStream } = await import("./streamUse.ts");

let nextPeer = 0;
function start(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000_000 });
  sent.length = 0;
  nextPeer += 1;
  const peer = `peer-${nextPeer}`;
  t.after(() => qualityNegotiator.forget("screen", peer));
  return peer;
}

const last = () => sent[sent.length - 1];

test("the first size goes out at once", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  assert.equal(last().tier, "1080p120");
  assert.equal(last().idle, undefined);
});

test("a tile that grew asks right away, one that shrank waits", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 320, 180);
  assert.equal(last().tier, "576p30");
  sent.length = 0;
  qualityNegotiator.report("screen", peer, 1920, 1080);
  t.mock.timers.tick(120);
  assert.equal(last().tier, "1080p120", "subir é quase imediato");
  sent.length = 0;
  qualityNegotiator.report("screen", peer, 320, 180);
  t.mock.timers.tick(5000);
  assert.equal(sent.length, 0, "descer espera");
  t.mock.timers.tick(1100);
  assert.equal(last().tier, "576p30");
});

test("a tile that comes back within the wait costs nothing at all", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  sent.length = 0;
  qualityNegotiator.report("screen", peer, 320, 180);
  t.mock.timers.tick(3000);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  t.mock.timers.tick(10_000);
  assert.equal(sent.length, 0);
});

test("a tile out of sight stops the encoder after a while, and resumes at once", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  sent.length = 0;
  qualityNegotiator.setHidden("screen", peer, true);
  t.mock.timers.tick(7000);
  assert.equal(sent.length, 0, "um alt-tab não custa nada");
  t.mock.timers.tick(1100);
  assert.equal(last().idle, true);
  assert.equal(qualityNegotiator.isIdle("screen", peer), true);
  // An older broadcaster reads the tier alone: the smallest there is.
  assert.equal(last().tier, "576p15");
  sent.length = 0;
  qualityNegotiator.setHidden("screen", peer, false);
  assert.equal(sent.length, 1, "volta na hora");
  assert.equal(last().tier, "1080p120");
  assert.equal(last().idle, undefined);
  assert.equal(qualityNegotiator.isIdle("screen", peer), false);
  // The one message whose loss is visible goes again.
  t.mock.timers.tick(5100);
  assert.equal(sent.length, 3);
});

test("back in sight inside the wait, nothing was sent at all", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  sent.length = 0;
  qualityNegotiator.setHidden("screen", peer, true);
  t.mock.timers.tick(5000);
  qualityNegotiator.setHidden("screen", peer, false);
  t.mock.timers.tick(20_000 - 5000 - 1);
  assert.equal(sent.length, 0);
});

test("a stream something else is using is never stopped", (t) => {
  const peer = start(t);
  const stream = {} as MediaStream;
  qualityNegotiator.bindStream("screen", peer, stream);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  const release = retainStream(stream);
  sent.length = 0;
  qualityNegotiator.setHidden("screen", peer, true);
  t.mock.timers.tick(15_000);
  assert.equal(sent.some((m) => m.idle), false, "um clipe ou gravação ainda precisa dos frames");
  // When nothing needs it any more, it stops.
  release();
  assert.equal(last().idle, true);
  // Something starting to use it brings it back.
  const again = retainStream(stream);
  assert.equal(last().idle, undefined);
  assert.equal(last().tier, "1080p120");
  again();
});

test("announce repeats what is standing, to a sender that has never heard it", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  qualityNegotiator.setHidden("screen", peer, true);
  t.mock.timers.tick(9000);
  sent.length = 0;
  qualityNegotiator.announce("screen", peer);
  assert.equal(sent.length, 1);
  assert.equal(last().idle, true);
});

test("a decoder that cannot keep up steps down, and back up once it is clean", (t) => {
  const peer = start(t);
  qualityNegotiator.report("screen", peer, 1920, 1080);
  const asked = () => last().tier;
  assert.equal(asked(), "1080p120");
  // Twice in a row, with the decoder busy.
  qualityNegotiator.noteDecoderDrops("screen", peer, 0.2, 0.8);
  assert.equal(asked(), "1080p120");
  qualityNegotiator.noteDecoderDrops("screen", peer, 0.2, 0.8);
  assert.notEqual(asked(), "1080p120");
  // Frames lost on the way in are not the decoder's: nothing to fix by shrinking.
  const stepped = asked();
  qualityNegotiator.noteDecoderDrops("screen", peer, 0.3, 0.1);
  qualityNegotiator.noteDecoderDrops("screen", peer, 0.3, 0.1);
  assert.equal(asked(), stepped);
  // A clean minute gives it back.
  qualityNegotiator.noteDecoderDrops("screen", peer, 0, 0.3);
  t.mock.timers.tick(61_000);
  qualityNegotiator.noteDecoderDrops("screen", peer, 0, 0.3);
  assert.equal(asked(), "1080p120");
});
