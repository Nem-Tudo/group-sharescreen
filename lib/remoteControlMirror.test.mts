// node --experimental-strip-types lib/remoteControlMirror.test.mts
//
// What moderators are told of a remote control session: never the letters
// typed, shortcuts yes, and nothing at all while nobody is watching.

import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteControlMirror, mirrorKey, type MirrorEntry } from "./remoteControlMirror.ts";

test("letters are masked, shortcuts and special keys are not", () => {
  const held = new Set<string>();
  assert.deepEqual(mirrorKey("KeyA", true, held), ["k", "•", 1]);
  assert.equal(mirrorKey("KeyA", false, held), null);
  assert.deepEqual(mirrorKey("ShiftLeft", true, held), ["k", "ShiftLeft", 1]);
  assert.deepEqual(mirrorKey("Digit1", true, held), ["k", "•", 1], "Shift + a digit is still typing");
  mirrorKey("ShiftLeft", false, held);
  mirrorKey("ControlLeft", true, held);
  assert.deepEqual(mirrorKey("KeyC", true, held), ["k", "KeyC", 1]);
  mirrorKey("ControlLeft", false, held);
  assert.deepEqual(mirrorKey("Enter", true, held), ["k", "Enter", 1]);
  assert.deepEqual(mirrorKey("Space", true, held), ["k", "•", 1]);
});

test("sends nothing until watched, then batches and coalesces", async () => {
  const sent: MirrorEntry[][] = [];
  const mirror = new RemoteControlMirror((e) => sent.push(e));
  mirror.input({ t: "m", x: 1, y: 1 });
  mirror.note(["cur", "text"]);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent.length, 0);

  mirror.setWatching(true, ["s", 5, "request", 3, "", "", 0]);
  mirror.input({ t: "m", x: 10, y: 10 });
  mirror.input({ t: "m", x: 20, y: 20 });
  mirror.input({ t: "w", dx: 0, dy: 100 });
  mirror.input({ t: "w", dx: 0, dy: 120 });
  mirror.input({ t: "b", b: 0, d: true, x: 20, y: 20 });
  mirror.note(["loc"]);
  mirror.note(["loc"]);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(sent, [
    [
      ["s", 5, "request", 3, "", "", 0],
      ["m", 20, 20],
      ["w", 0, 220],
      ["b", 0, 1, 20, 20],
      ["loc"],
    ],
  ]);

  mirror.setWatching(false, null);
  mirror.input({ t: "m", x: 30, y: 30 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent.length, 1);
});
