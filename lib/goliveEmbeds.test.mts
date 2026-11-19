// node --import ./lib/ts-resolve.mjs --experimental-strip-types --test lib/goliveEmbeds.test.mts
//
// Which GoLive links in a message become a card (experiment "golive-embeds").

import { test } from "node:test";
import assert from "node:assert/strict";
import { goLiveLinksIn, parseGoLiveLink } from "./goliveEmbeds.ts";

test("rooms, long and short", () => {
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/watch/minha-sala"), { kind: "room", handle: "minha-sala" });
  assert.deepEqual(parseGoLiveLink("https://g.nemtudo.me/sala_1"), { kind: "room", handle: "sala_1" });
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/watch/priv-amigos-123456"), {
    kind: "room",
    handle: "priv-amigos-123456",
  });
  // A group's voice room opens through its group, never as a /watch card.
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/watch/grp-abc123"), null);
  assert.equal(parseGoLiveLink("https://g.nemtudo.me/invite"), null);
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/watch/a/b"), null);
});

test("gifts, profiles, effects, groups", () => {
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/gift/abcd1234"), { kind: "gift", code: "ABCD1234" });
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/user/nemtudo"), { kind: "user", id: "nemtudo" });
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/effect/abc123xyz"), { kind: "effect", id: "abc123xyz" });
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/effect/abc123xyz/panel"), null);
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/groups/j9hjobgc88"), {
    kind: "group",
    groupId: "j9hjobgc88",
    roomId: null,
  });
  assert.deepEqual(parseGoLiveLink("https://golive.nemtudo.me/groups/j9hjobgc88/room42"), {
    kind: "group",
    groupId: "j9hjobgc88",
    roomId: "room42",
  });
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/groups/messages"), null);
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/groups/rooms"), null);
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/groups"), null);
});

test("other sites and other pages are left alone", () => {
  assert.equal(parseGoLiveLink("https://youtube.com/watch/sala"), null);
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/pro"), null);
  assert.equal(parseGoLiveLink("https://golive.nemtudo.me/invite/abc"), null);
});

test("a message: order, dedupe, trailing punctuation, cap", () => {
  const text =
    "entra aí https://g.nemtudo.me/sala, e olha https://golive.nemtudo.me/user/fulano! " +
    "de novo https://golive.nemtudo.me/watch/sala https://golive.nemtudo.me/gift/XYZW9999 https://golive.nemtudo.me/effect/aaaa1111";
  assert.deepEqual(goLiveLinksIn(text), [
    { kind: "room", handle: "sala" },
    { kind: "user", id: "fulano" },
    { kind: "gift", code: "XYZW9999" },
  ]);
  assert.deepEqual(goLiveLinksIn("nada aqui"), []);
});
