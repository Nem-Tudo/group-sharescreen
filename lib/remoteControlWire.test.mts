// node --experimental-strip-types lib/remoteControlWire.test.mts
//
// The remote control data channels between two apps of different ages. The
// round-trip ping, the pointer's shape and the "no entry" zone were added
// without a version bump (see remoteControlWire.ts): an old side has to keep
// working with a new one, and that is what is checked here.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURSORS,
  T_CURSOR,
  T_PING,
  T_ZONE,
  ZONES,
  decode,
  encodePing,
  encodePong,
  encodeSimple,
} from "./remoteControlWire.ts";

test("a stamped ping carries its stamp, and a pong echoes it across the u32 range", () => {
  assert.deepEqual(decode(encodePing(123_456)), { t: "ping", stamp: 123_456 });
  assert.deepEqual(decode(encodePong(0xffffffff)), { t: "pong", stamp: 0xffffffff });
  // performance.now() past 2^32 ms wraps rather than breaking the encoding.
  assert.deepEqual(decode(encodePing(2 ** 32 + 5)), { t: "ping", stamp: 5 });
});

test("an old controller's bare ping is still a ping, just without a stamp to answer", () => {
  assert.deepEqual(decode(encodeSimple(T_PING)), { t: "ping", stamp: null });
});

test("pointer shapes and zones decode by index, and anything out of range is ignored", () => {
  CURSORS.forEach((shape, index) => {
    assert.deepEqual(decode(encodeSimple(T_CURSOR, index)), { t: "cursor", shape });
  });
  ZONES.forEach((zone, index) => {
    assert.deepEqual(decode(encodeSimple(T_ZONE, index)), { t: "zone", zone });
  });
  assert.equal(decode(encodeSimple(T_CURSOR, CURSORS.length)), null);
  assert.equal(decode(encodeSimple(T_ZONE, 200)), null);
  // Without the byte that says which: not a message.
  assert.equal(decode(encodeSimple(T_CURSOR)), null);
});

test("the shapes stay in the shell's order", async () => {
  // electron/channels.ts keeps its own copy (the shell is built separately);
  // an index means the same shape on both sides only while the lists match.
  const { readFile } = await import("node:fs/promises");
  const channels = await readFile(new URL("../electron/channels.ts", import.meta.url), "utf8");
  const block = /REMOTE_CONTROL_CURSORS = \[([\s\S]*?)\] as const/.exec(channels)?.[1] ?? "";
  const shell = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shell, [...CURSORS]);
});
