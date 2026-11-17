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

test("game mode's movement and in-place clicks round-trip, and an out-of-range one is refused", async () => {
  const { encodeRelative, encodeButtonHere, MAX_RELATIVE, T_RELATIVE, VERSION } = await import("./remoteControlWire.ts");
  assert.deepEqual(decode(encodeRelative(-37, 1200)), { t: "relative", dx: -37, dy: 1200 });
  // Clamped on the way out rather than wrapped around an i16.
  assert.deepEqual(decode(encodeRelative(99_999, -99_999)), { t: "relative", dx: MAX_RELATIVE, dy: -MAX_RELATIVE });
  assert.deepEqual(decode(encodeButtonHere(1, true)), { t: "buttonHere", b: 1, d: true });
  assert.equal(decode(encodeButtonHere(9, true)), null);
  // Hand-made, past what this side would send: not taken.
  const view = new DataView(new ArrayBuffer(6));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_RELATIVE);
  view.setInt16(2, MAX_RELATIVE + 1);
  assert.equal(decode(view.buffer), null);
});

test("permissions and the clipboard round-trip, and an oversized paste is refused rather than cut", async () => {
  const { encodePerms, encodeClipboard, MAX_CLIPBOARD_BYTES } = await import("./remoteControlWire.ts");
  const perms = { mouse: false, keyboard: true, clipboard: true, sound: false };
  assert.deepEqual(decode(encodePerms(perms)), { t: "perms", perms });
  const withSound = { mouse: true, keyboard: false, clipboard: false, sound: true };
  assert.deepEqual(decode(encodePerms(withSound)), { t: "perms", perms: withSound });
  // From a host page from before the sound: no bit, so no sound.
  assert.equal((decode(encodePerms({ mouse: true, keyboard: true, clipboard: false })) as { perms: { sound: boolean } }).perms.sound, false);
  const text = "senha? não — só um texto com acentos e emoji 🎮\nsegunda linha";
  assert.deepEqual(decode(encodeClipboard(text)!), { t: "clipboard", text });
  assert.equal(encodeClipboard("x".repeat(MAX_CLIPBOARD_BYTES + 1)), null);
  // Big enough to have needed the clipboard's own size rule, under its limit.
  const big = "y".repeat(MAX_CLIPBOARD_BYTES);
  assert.equal((decode(encodeClipboard(big)!) as { text: string }).text.length, MAX_CLIPBOARD_BYTES);
});

test("the sound and the pointer: one byte each, and a state this side does not know is not one", async () => {
  const { encodeSound, encodeSoundWant, soundStateFor, SOUND_STATES, T_POINTER, encodeSimple } = await import(
    "./remoteControlWire.ts"
  );
  for (const state of SOUND_STATES) {
    const event = decode(encodeSound(state)) as { t: string; value: number };
    assert.equal(event.t, "sound");
    assert.equal(soundStateFor(event.value), state);
  }
  assert.deepEqual(decode(encodeSoundWant(true)), { t: "sound", value: 1 });
  assert.deepEqual(decode(encodeSoundWant(false)), { t: "sound", value: 0 });
  assert.equal(soundStateFor(200), null);
  assert.deepEqual(decode(encodeSimple(T_POINTER, 1)), { t: "pointer", inPicture: true });
  assert.deepEqual(decode(encodeSimple(T_POINTER, 0)), { t: "pointer", inPicture: false });
  assert.equal(decode(encodeSimple(T_POINTER)), null);
});
