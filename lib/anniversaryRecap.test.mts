// node --experimental-strip-types lib/anniversaryRecap.test.mts
//
// The recap's comparisons and "style" are the lines people screenshot, so a
// silly one ("0 flights", a typist who never typed) is the bug that shows.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareCall, compareMic, compareShare, earlierThanPercent, recapStyle, typingHours } from "./anniversaryRecap.ts";

test("comparisons pick the biggest unit the time fills at least once", () => {
  assert.deepEqual(compareCall(25), { key: "flights", n: 2 });
  assert.deepEqual(compareCall(4), { key: "matches", n: 2 });
  assert.deepEqual(compareCall(1), { key: "episodes", n: 1 });
  assert.deepEqual(compareCall(0.1), { key: "songs", n: 1 });
  assert.equal(compareCall(0), null);
  assert.equal(compareCall(Number.NaN), null);
  assert.deepEqual(compareShare(5), { key: "movies", n: 2 });
  assert.deepEqual(compareShare(0.6), { key: "games", n: 1 });
  assert.deepEqual(compareMic(3.2), { key: "podcasts", n: 3 });
});

test("typing hours only from a whole hour up", () => {
  assert.equal(typingHours(59), null);
  assert.equal(typingHours(150), 2);
});

test("style follows the biggest habit, and starts as 'starter'", () => {
  assert.equal(recapStyle({ callHours: 0.2, shareHours: 0, micHours: 0.1, messages: 3 }), "starter");
  assert.equal(recapStyle({ callHours: 30, shareHours: 15, micHours: 5, messages: 100 }), "listener");
  assert.equal(recapStyle({ callHours: 10, shareHours: 12, micHours: 2, messages: 0 }), "streamer");
  assert.equal(recapStyle({ callHours: 10, shareHours: 1, micHours: 9, messages: 0 }), "talker");
  assert.equal(recapStyle({ callHours: 1, shareHours: 0, micHours: 1, messages: 6000 }), "typist");
});

test("earlier-than percentage", () => {
  assert.equal(earlierThanPercent(1, 1000), 99);
  assert.equal(earlierThanPercent(1000, 1000), 0);
  assert.equal(earlierThanPercent(250, 1000), 75);
  assert.equal(earlierThanPercent(1, 1), 0);
});
