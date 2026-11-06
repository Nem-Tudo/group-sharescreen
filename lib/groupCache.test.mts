import { test } from "node:test";
import assert from "node:assert/strict";
import { appendCachedMessage, getCachedChannel, putCachedChannel } from "./groupCache.ts";
import type { GroupMessage } from "./groupsApi.ts";

const message = (channelId: string, n: number, ts = n): GroupMessage =>
  ({ id: `m${n}`, channelId, groupId: "g", from: "u", text: `#${n}`, ts }) as unknown as GroupMessage;

test("a room held but not on screen keeps only the newest messages, however many arrive", () => {
  putCachedChannel("busy", { messages: [message("busy", 0)], authors: {}, hasMore: false, fetchedAt: 0 });
  for (let n = 1; n <= 1000; n++) appendCachedMessage(message("busy", n), null);
  const held = getCachedChannel("busy");
  assert.ok(held);
  assert.equal(held.messages.length, 300);
  assert.equal(held.messages[0].id, "m701");
  assert.equal(held.messages.at(-1)?.id, "m1000");
  // What was let go is still there to load, as with any capped room.
  assert.equal(held.hasMore, true);
});

test("a late message still lands in order", () => {
  putCachedChannel("late", { messages: [message("late", 1, 10), message("late", 2, 30)], authors: {}, hasMore: false, fetchedAt: 0 });
  appendCachedMessage(message("late", 3, 20), null);
  assert.deepEqual(
    getCachedChannel("late")?.messages.map((m) => m.id),
    ["m1", "m3", "m2"]
  );
  assert.equal(getCachedChannel("late")?.hasMore, false);
});

test("a room nobody opened is not started by a live message", () => {
  appendCachedMessage(message("never-opened", 1), null);
  assert.equal(getCachedChannel("never-opened"), null);
});
