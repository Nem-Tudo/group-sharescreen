// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/helperShutdown.test.mts
//
// How a capture helper is ended. The helper itself cannot be run here (it
// needs Windows), so it is stood in for by a fake that records what was done
// to it.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { HELPER_FORCE_KILL_MS, endHelper } from "./helperShutdown";

function fakeHelper() {
  const calls: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    killed: false,
    stdin: { end: () => calls.push("stdin.end") },
    kill() {
      calls.push("kill");
      this.killed = true;
      return true;
    },
  });
  return { child, calls };
}

test("a helper that never said READY is killed at once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { child, calls } = fakeHelper();
  endHelper(child, false);
  // Synchronously: a quit right after this must not depend on a timer.
  assert.deepEqual(calls, ["kill"]);
  t.mock.timers.tick(HELPER_FORCE_KILL_MS);
  assert.deepEqual(calls, ["kill"]);
});

test("a listening helper is asked to stop through stdin first", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { child, calls } = fakeHelper();
  endHelper(child, true);
  assert.deepEqual(calls, ["stdin.end"]);
  child.emit("exit");
  t.mock.timers.tick(HELPER_FORCE_KILL_MS);
  assert.deepEqual(calls, ["stdin.end"]);
});

test("a listening helper that does not exit is killed after the backstop", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { child, calls } = fakeHelper();
  endHelper(child, true);
  t.mock.timers.tick(HELPER_FORCE_KILL_MS - 1);
  assert.deepEqual(calls, ["stdin.end"]);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ["stdin.end", "kill"]);
});
