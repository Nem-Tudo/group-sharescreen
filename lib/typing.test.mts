// node --experimental-strip-types lib/typing.test.mts
import assert from "node:assert/strict";
import { mock } from "node:test";
import { createTypingAnnouncer, formatTypingLabel, TYPING_IDLE_MS, TYPING_REFRESH_MS } from "./typing";

// 1. The line
assert.equal(formatTypingLabel(["Ana"]), "Ana is typing...");
assert.equal(formatTypingLabel(["Ana", "Bia"]), "Ana and Bia are typing...");
assert.equal(formatTypingLabel(["Ana", "Bia", "Caio"]), "3 people are typing...");

mock.timers.enable({ apis: ["setTimeout"] });

function setup() {
  const said: boolean[] = [];
  const announcer = createTypingAnnouncer((typing) => said.push(typing));
  return { said, announcer };
}

// 2. A burst is announced once, not per keystroke, and ends on its own
{
  const { said, announcer } = setup();
  announcer.input("o");
  announcer.input("oi");
  announcer.input("oi ");
  assert.deepEqual(said, [true]);
  mock.timers.tick(TYPING_IDLE_MS - 1);
  assert.deepEqual(said, [true], "still inside the idle window");
  mock.timers.tick(1);
  assert.deepEqual(said, [true, false], "stops after TYPING_IDLE_MS without keys");
  mock.timers.tick(60_000);
  assert.deepEqual(said, [true, false], "nothing more once stopped");
}

// 3. Somebody typing steadily is re-announced every TYPING_REFRESH_MS — and
//    never told "stopped" in the middle
{
  const { said, announcer } = setup();
  let text = "";
  // A key every second for 12 s.
  for (let second = 0; second < 12; second += 1) {
    text += "a";
    announcer.input(text);
    mock.timers.tick(1000);
  }
  assert.ok(!said.includes(false), "no false while the keys keep coming");
  const trues = said.filter(Boolean).length;
  assert.ok(trues >= 2 && trues <= 3, `re-announced every ~${TYPING_REFRESH_MS}ms (got ${trues} trues in 12s)`);
  mock.timers.tick(TYPING_IDLE_MS);
  assert.equal(said.at(-1), false);
}

// 4. Emptying the box says "stopped" at once
{
  const { said, announcer } = setup();
  announcer.input("oi");
  announcer.input("   ");
  assert.deepEqual(said, [true, false]);
  mock.timers.tick(60_000);
  assert.deepEqual(said, [true, false], "no second false from the idle timer");
}

// 5. Sending ends the burst quietly, and the next key is a new burst
{
  const { said, announcer } = setup();
  announcer.input("oi");
  announcer.sent();
  mock.timers.tick(60_000);
  assert.deepEqual(said, [true], "the message clears the line — no false");
  announcer.input("e");
  assert.deepEqual(said, [true, true], "next keystroke announces at once");
}

// 6. Going away mid-burst says "stopped"; going away idle says nothing; and
//    the announcer still works after (React dev mode re-runs effects)
{
  const { said, announcer } = setup();
  announcer.dispose();
  assert.deepEqual(said, []);
  announcer.input("oi");
  announcer.dispose();
  assert.deepEqual(said, [true, false]);
  mock.timers.tick(60_000);
  assert.deepEqual(said, [true, false], "timers were cleared");
  announcer.input("de novo");
  assert.deepEqual(said, [true, false, true], "usable after dispose");
  announcer.dispose();
}

mock.timers.reset();
console.log("typing: ok");
