// node --experimental-strip-types lib/recentRooms.test.mts
//
// The home page's "Salas recentes" is only as useful as this store: a
// dropped fourth room, a corrupted payload, or a private handle shown as
// "priv-..." would either lose the link someone just left or make the
// buttons unrecognisable. Exercised here rather than in the UI because the
// persistence rules are independent of React.
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";

const store = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return store.has(key) ? store.get(key)! : null;
  },
  setItem(key: string, value: string) {
    store.set(key, value);
  },
  removeItem(key: string) {
    store.delete(key);
  },
  clear() {
    store.clear();
  },
};

before(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    configurable: true,
  });
});

const {
  getRecentRooms,
  rememberRecentRoom,
  forgetRecentRoom,
  recentRoomPresentation,
  MAX_RECENT_ROOMS,
} = await import("./recentRooms");

afterEach(() => {
  store.clear();
});

test("starts empty", () => {
  assert.deepEqual(getRecentRooms(), []);
});

test("remembers a new room at the front without reordering one already saved", () => {
  rememberRecentRoom("alpha", 1);
  rememberRecentRoom("beta", 2);
  assert.deepEqual(getRecentRooms(), [
    { handle: "beta", visitedAt: 2 },
    { handle: "alpha", visitedAt: 1 },
  ]);
  rememberRecentRoom("alpha", 3);
  assert.deepEqual(getRecentRooms(), [
    { handle: "beta", visitedAt: 2 },
    { handle: "alpha", visitedAt: 1 },
  ]);
});

test("keeps a room already in a full list in its slot", () => {
  rememberRecentRoom("one", 1);
  rememberRecentRoom("two", 2);
  rememberRecentRoom("three", 3);
  rememberRecentRoom("two", 4);
  assert.deepEqual(
    getRecentRooms().map((room) => room.handle),
    ["three", "two", "one"]
  );
});

test(`keeps only the ${MAX_RECENT_ROOMS} most recent rooms`, () => {
  rememberRecentRoom("one", 1);
  rememberRecentRoom("two", 2);
  rememberRecentRoom("three", 3);
  rememberRecentRoom("four", 4);
  assert.equal(getRecentRooms().length, MAX_RECENT_ROOMS);
  assert.deepEqual(
    getRecentRooms().map((room) => room.handle),
    ["four", "three", "two"]
  );
});

test("forgets a room without shuffling the rest, and can remember it again", () => {
  rememberRecentRoom("one", 1);
  rememberRecentRoom("two", 2);
  rememberRecentRoom("three", 3);
  forgetRecentRoom("two");
  assert.deepEqual(
    getRecentRooms().map((room) => room.handle),
    ["three", "one"]
  );
  forgetRecentRoom("missing");
  assert.deepEqual(
    getRecentRooms().map((room) => room.handle),
    ["three", "one"]
  );
  rememberRecentRoom("two", 4);
  assert.deepEqual(
    getRecentRooms().map((room) => room.handle),
    ["two", "three", "one"]
  );
});

test("ignores an invalid handle rather than writing a dead link", () => {
  rememberRecentRoom("bad room", 1);
  rememberRecentRoom("ok", 2);
  assert.deepEqual(getRecentRooms(), [{ handle: "ok", visitedAt: 2 }]);
});

test("survives corrupt storage instead of throwing", () => {
  store.set("sharescreen:recentRooms:v1", "{not-json");
  assert.deepEqual(getRecentRooms(), []);
  store.set("sharescreen:recentRooms:v1", JSON.stringify({ rooms: [] }));
  assert.deepEqual(getRecentRooms(), []);
  store.set(
    "sharescreen:recentRooms:v1",
    JSON.stringify([{ handle: "ok", visitedAt: 1 }, { handle: 12 }, "nope"])
  );
  assert.deepEqual(getRecentRooms(), [{ handle: "ok", visitedAt: 1 }]);
});

test("presents public and private handles as the names people know", () => {
  assert.deepEqual(recentRoomPresentation("reuniao-time"), {
    name: "reuniao-time",
    isPrivate: false,
    code: null,
  });
  assert.deepEqual(recentRoomPresentation("priv-familia-123456"), {
    name: "familia",
    isPrivate: true,
    code: "123456",
  });
  assert.deepEqual(recentRoomPresentation("priv-reuniao-time-000042"), {
    name: "reuniao-time",
    isPrivate: true,
    code: "000042",
  });
  // Private rooms from before codes existed have no trailing digits to show.
  assert.deepEqual(recentRoomPresentation("priv-familia"), {
    name: "familia",
    isPrivate: true,
    code: null,
  });
});
