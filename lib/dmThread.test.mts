// node --import ./lib/ts-resolve.mjs --experimental-strip-types --test lib/dmThread.test.mts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSendQueue,
  liveConversationList,
  mayHaveMore,
  newestFrom,
  threadMessages,
  unconfirmed,
  withConfirmed,
  withFreshPage,
  withOlderPage,
  DM_PAGE_SIZE,
} from "./dmThread";

const ME = "me";
const ANA = "ana";
const BIA = "bia";

let seq = 0;
function msg(from: string, to: string, ts: number, extra: Record<string, unknown> = {}) {
  seq += 1;
  return { id: `m${seq}`, from, to, text: `t${seq}`, ts, ...extra };
}
const ids = (list: { id: string }[]) => list.map((m) => m.id);

test("a thread holds each message once, in time order", () => {
  const a = msg(ANA, ME, 100);
  const b = msg(ME, ANA, 200);
  const c = msg(ANA, ME, 300);
  // The socket repeats one of the page's messages and brings one newer one.
  const merged = threadMessages([a, b], [b, c], ME, ANA);
  assert.deepEqual(ids(merged), [a.id, b.id, c.id]);
});

test("a thread ignores deliveries from other conversations", () => {
  const mine = msg(ANA, ME, 100);
  const elsewhere = msg(BIA, ME, 150);
  const toSomeoneElse = msg(ME, BIA, 160);
  const merged = threadMessages([mine], [elsewhere, toSomeoneElse], ME, ANA);
  assert.deepEqual(ids(merged), [mine.id]);
});

test("a thread is ordered by the server's time, not by arrival", () => {
  const late = msg(ANA, ME, 500);
  const early = msg(ME, ANA, 400);
  // Delivered late-first, which is what two sources interleaving looks like.
  const merged = threadMessages([], [late, early], ME, ANA);
  assert.deepEqual(ids(merged), [early.id, late.id]);
});

test("a placeholder disappears once its real message is on screen", () => {
  const pending = [
    { clientId: "c1", to: ANA },
    { clientId: "c2", to: ANA },
  ];
  // The socket copy of c1 has landed; c2 is still on its way.
  const delivered = [msg(ME, ANA, 100, { clientId: "c1" })];
  assert.deepEqual(
    unconfirmed(pending, delivered, ANA).map((p) => p.clientId),
    ["c2"]
  );
});

test("a placeholder only shows in the thread it was written in", () => {
  const pending = [
    { clientId: "c1", to: ANA },
    { clientId: "c2", to: BIA },
  ];
  assert.deepEqual(unconfirmed(pending, [], BIA).map((p) => p.clientId), ["c2"]);
  assert.deepEqual(unconfirmed(pending, [], null), []);
});

test("a fresh page keeps a message confirmed while it was loading", () => {
  const a = msg(ANA, ME, 100);
  const b = msg(ME, ANA, 200);
  const sentDuringRead = msg(ME, ANA, 300, { clientId: "c9" });
  // The read started before the send and came back without it.
  const fresh = withFreshPage([a, b, sentDuringRead], [a, b]);
  assert.deepEqual(ids(fresh), [a.id, b.id, sentDuringRead.id]);
});

test("a fresh page does not duplicate what it already contains", () => {
  const a = msg(ANA, ME, 100);
  const b = msg(ME, ANA, 200);
  assert.deepEqual(ids(withFreshPage([a, b], [a, b])), [a.id, b.id]);
  assert.deepEqual(ids(withFreshPage(null, [a])), [a.id]);
});

test("an older page goes in front, without repeating the seam", () => {
  const old1 = msg(ANA, ME, 10);
  const old2 = msg(ME, ANA, 20);
  const current1 = msg(ANA, ME, 30);
  // The server's `before` is exclusive, but a page that overlaps must not
  // put the same line on screen twice.
  const merged = withOlderPage([old2, current1], [old1, old2]);
  assert.deepEqual(ids(merged), [old1.id, old2.id, current1.id]);
});

test("a confirmed send is added once, even if the socket got there first", () => {
  const sent = msg(ME, ANA, 100, { clientId: "c1" });
  assert.deepEqual(ids(withConfirmed([], sent)), [sent.id]);
  assert.deepEqual(ids(withConfirmed([sent], sent)), [sent.id]);
});

test("only a full page suggests there is more history", () => {
  const full = Array.from({ length: DM_PAGE_SIZE }, (_, i) => msg(ANA, ME, i));
  assert.equal(mayHaveMore(full), true);
  assert.equal(mayHaveMore(full.slice(1)), false);
});

test("the read bookmark follows their newest message, not mine", () => {
  const theirs = msg(ANA, ME, 100);
  const mine = msg(ME, ANA, 200);
  assert.equal(newestFrom([theirs, mine], ANA), theirs.id);
  assert.equal(newestFrom([mine], ANA), null);
  assert.equal(newestFrom([theirs], null), null);
});

test("the list moves a conversation up when something arrives in it", () => {
  const user = (id: string) => ({ id, username: id, displayName: id, flags: [] });
  const list = [
    { user: user(ANA), lastMessage: msg(ANA, ME, 200), unread: 0 },
    { user: user(BIA), lastMessage: msg(BIA, ME, 100), unread: 2 },
  ];
  const arrived = msg(BIA, ME, 300);
  const live = liveConversationList(list, [arrived], ME);
  assert.deepEqual(live.map((row) => row.user.id), [BIA, ANA]);
  assert.equal(live[0].lastMessage.id, arrived.id);
  // Counts are the server's to decide.
  assert.equal(live[0].unread, 2);
  // And the input is not mutated.
  assert.equal(list[1].lastMessage.ts, 100);
});

test("the list ignores deliveries older than what it already shows", () => {
  const user = { id: ANA, username: ANA, displayName: ANA, flags: [] };
  const newest = msg(ANA, ME, 500);
  const live = liveConversationList(
    [{ user, lastMessage: newest, unread: 0 }],
    [msg(ANA, ME, 100)],
    ME
  );
  assert.equal(live[0].lastMessage.id, newest.id);
});

test("the send queue runs tasks in order even when the first is slowest", async () => {
  const enqueue = createSendQueue();
  const order: string[] = [];
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await Promise.all([
    enqueue(async () => {
      await wait(40);
      order.push("first");
    }),
    enqueue(async () => {
      await wait(5);
      order.push("second");
    }),
    enqueue(async () => {
      order.push("third");
    }),
  ]);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("one failed send does not stop the ones after it", async () => {
  const enqueue = createSendQueue();
  const order: string[] = [];
  const failing = enqueue(async () => {
    throw new Error("rede caiu");
  });
  const next = enqueue(async () => {
    order.push("next");
  });
  await assert.rejects(failing);
  await next;
  assert.deepEqual(order, ["next"]);
});
