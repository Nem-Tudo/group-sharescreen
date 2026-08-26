// node --experimental-strip-types lib/desktopSystemAudio.test.mts
//
// What this pins is an *ordering*, and the reason it matters is invisible
// from inside this module.
//
// startExcludedSystemAudio runs between the user's click on "compartilhar
// tela" and the getDisplayMedia call that click has to authorise. Chromium
// gives that click's transient activation about five seconds, and everything
// awaited here is spent out of it. So the one question that can rule the
// whole capture out — "is system audio even switched on?", which is what the
// shell answers from `start()` — has to be asked before anything expensive,
// not after.
//
// It used to be asked last. With "Compartilhar som da tela" off, a share paid
// for an AudioContext resume and a cold network fetch of the worklet before
// learning it needed neither, and getDisplayMedia was then refused for a
// gesture that had expired — which surfaces as NotAllowedError, which the
// share code treats as "the user dismissed the picker" and shows nothing at
// all. Clicking share did nothing, and only ever the first time.
import assert from "node:assert/strict";
import test from "node:test";

// Stands in for the whole browser side of this module. `audioContexts` is the
// actual assertion target: constructing one is the first thing that costs
// real time, so a run that never constructs one never spent the click.
let audioContexts = 0;

class FakeAudioContext {
  state = "suspended";
  constructor() {
    audioContexts += 1;
  }
  resume() {
    // A context that will not start — the browser refusing without a gesture
    // looks exactly like this, and it is the cheapest way to reach the
    // "give up after start() succeeded" path below.
    return Promise.reject(new Error("not allowed"));
  }
  addEventListener() {}
}

type Bridge = { start(): Promise<boolean>; stop(): void; onData(): () => void };

function installWindow(bridge: Bridge) {
  audioContexts = 0;
  (globalThis as Record<string, unknown>).window = {
    golive: { systemAudio: bridge },
    AudioContext: FakeAudioContext,
    addEventListener() {},
    removeEventListener() {},
  };
}

// Imported after the global exists: getSharedAudioContext memoizes the
// context it builds, and this module reads `window` at call time, so the
// import itself is harmless — but keeping the order explicit is what makes
// the memoization below (one context for the whole file) predictable.
installWindow({ start: async () => false, stop() {}, onData: () => () => {} });
const { startExcludedSystemAudio, prewarmExcludedSystemAudio } = await import("./desktopSystemAudio");

test("system audio switched off costs nothing but the one question", async () => {
  let started = 0;
  let stopped = 0;
  installWindow({
    // What electron/systemAudio.ts's startSystemAudioCapture returns when
    // the picker's "Compartilhar som da tela" is unticked.
    start: async () => {
      started += 1;
      return false;
    },
    stop() {
      stopped += 1;
    },
    onData: () => () => {},
  });

  assert.equal(await startExcludedSystemAudio(), null);
  assert.equal(started, 1, "the shell must still be asked");
  assert.equal(
    audioContexts,
    0,
    "no audio graph may be built for a share that was never going to carry system audio"
  );
  assert.equal(stopped, 0, "nothing was started, so nothing needs stopping");
});

test("a capture that cannot be wired up is stopped, not left running", async () => {
  let stopped = 0;
  installWindow({
    // The helper is running now — so every path out of here owes it a stop().
    start: async () => true,
    stop() {
      stopped += 1;
    },
    onData: () => () => {},
  });

  // The fake context refuses to resume, so the graph can never run.
  assert.equal(await startExcludedSystemAudio(), null);
  assert.equal(stopped, 1, "an OS-level audio capture must not outlive the share that started it");
});

test("prewarming is a no-op without the desktop bridge", () => {
  (globalThis as Record<string, unknown>).window = { addEventListener() {}, removeEventListener() {} };
  // The website loads this module too; it must not reach for anything that
  // only exists in the shell.
  assert.doesNotThrow(() => prewarmExcludedSystemAudio());
});
