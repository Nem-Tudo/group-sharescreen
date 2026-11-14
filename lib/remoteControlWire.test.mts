// "Controle remoto"'s wire format: what the controller sends is exactly what
// the host reads, and anything malformed is refused rather than guessed at —
// the host turns these bytes into real clicks and key presses.
import assert from "node:assert/strict";
import test from "node:test";
import {
  T_BLOCKED,
  T_LOCAL,
  T_PING,
  decode,
  encodeButton,
  encodeKey,
  encodeMove,
  encodeSimple,
  encodeWheel,
  newer,
} from "@/lib/remoteControlWire";

test("moves, buttons, wheel and keys round-trip", () => {
  assert.deepEqual(decode(encodeMove(7, 0, 65535)), { t: "move", seq: 7, x: 0, y: 65535 });
  assert.deepEqual(decode(encodeMove(70000, 1, 2)), { t: "move", seq: 70000 & 0xffff, x: 1, y: 2 });
  assert.deepEqual(decode(encodeButton(2, true, 100, 200)), { t: "button", b: 2, d: true, x: 100, y: 200 });
  assert.deepEqual(decode(encodeButton(0, false, 0, 0)), { t: "button", b: 0, d: false, x: 0, y: 0 });
  assert.deepEqual(decode(encodeWheel(-120, 240)), { t: "wheel", dx: -120, dy: 240 });
  assert.deepEqual(decode(encodeKey("KeyA", true)), { t: "key", c: "KeyA", d: true });
  assert.deepEqual(decode(encodeKey("ArrowLeft", false)), { t: "key", c: "ArrowLeft", d: false });
  assert.deepEqual(decode(encodeSimple(T_PING)), { t: "ping" });
  assert.deepEqual(decode(encodeSimple(T_LOCAL)), { t: "local" });
  assert.deepEqual(decode(encodeSimple(T_BLOCKED, 1)), { t: "blocked", why: "covered" });
});

test("the wheel is clamped to what the helper accepts", () => {
  assert.deepEqual(decode(encodeWheel(-99999, 99999)), { t: "wheel", dx: -1200, dy: 1200 });
});

test("key codes outside plain letters and digits are never encoded", () => {
  assert.equal(encodeKey("", true), null);
  assert.equal(encodeKey("Key A", true), null);
  assert.equal(encodeKey("Ação", true), null);
  assert.equal(encodeKey("x".repeat(33), true), null);
});

test("malformed or foreign messages decode to nothing", () => {
  assert.equal(decode("hello"), null);
  assert.equal(decode(new ArrayBuffer(0)), null);
  assert.equal(decode(new ArrayBuffer(100)), null);
  // Another version.
  const future = new Uint8Array(encodeMove(1, 1, 1));
  future[0] = 2;
  assert.equal(decode(future.buffer), null);
  // A move one byte short.
  assert.equal(decode(encodeMove(1, 1, 1).slice(0, 7)), null);
  // A button beyond the five there are.
  const button = new Uint8Array(encodeButton(0, true, 1, 1));
  button[2] = 9;
  assert.equal(decode(button.buffer), null);
  // A key whose stated length does not match.
  const key = new Uint8Array(encodeKey("KeyA", true)!);
  key[3] = 9;
  assert.equal(decode(key.buffer), null);
  // A blocked reason that does not exist.
  assert.equal(decode(encodeSimple(T_BLOCKED, 7)), null);
  // An unknown type.
  assert.equal(decode(encodeSimple(99)), null);
});

test("sequence numbers compare across the wrap", () => {
  assert.equal(newer(2, 1), true);
  assert.equal(newer(1, 2), false);
  assert.equal(newer(5, 5), false);
  assert.equal(newer(0, 65535), true);
  assert.equal(newer(65535, 0), false);
});
