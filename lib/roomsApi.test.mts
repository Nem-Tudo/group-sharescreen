// node --experimental-strip-types lib/roomsApi.test.mts
//
// A private room's access code lives inside its own handle
// ("priv-<nome>-<123456>"), and the server parses it back out rather than
// generating one of its own (see server/signaling.ts's roomCodeFromHandle).
// That makes the build/split pair here load-bearing in a way a normal
// formatting helper isn't: if they disagree with each other — or with the
// server's HANDLE_RE — someone lands in a room that isn't the one whose link
// they were sent, with no error to explain it.
import assert from "node:assert/strict";
import {
  generateRoomCode,
  isRoomCode,
  toPrivateRoomHandle,
  splitPrivateRoomHandle,
  isPrivateRoomHandle,
  ROOM_CODE_LENGTH,
  MAX_PRIVATE_ROOM_NAME_LENGTH,
  roomHandleFromInput,
} from "./roomsApi";

// Mirrors the server's HANDLE_RE — the whole point of the length cap below.
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,32}$/;

// Round trip: whatever we build, we can read back.
for (const name of ["familia", "a", "reuniao-time", "x_y-z", "A1"]) {
  const code = generateRoomCode();
  const handle = toPrivateRoomHandle(name, code);
  assert.ok(isPrivateRoomHandle(handle), `${handle} deveria ser privada`);
  assert.deepEqual(splitPrivateRoomHandle(handle), { name, code });
}

// A name at the documented maximum still produces a handle the server will
// accept. This is the constant that would silently rot if HANDLE_RE or the
// prefix ever changed.
const longest = "n".repeat(MAX_PRIVATE_ROOM_NAME_LENGTH);
const longestHandle = toPrivateRoomHandle(longest, generateRoomCode());
assert.ok(
  HANDLE_RE.test(longestHandle),
  `handle no limite deveria passar no HANDLE_RE: ${longestHandle} (${longestHandle.length})`
);
// And one character more does not — otherwise the cap is not the real cap.
assert.ok(!HANDLE_RE.test(toPrivateRoomHandle(longest + "n", generateRoomCode())));

// Codes are always exactly six digits, including the ones needing zero
// padding — "42" in a URL would be a different room than "000042".
for (let i = 0; i < 500; i += 1) {
  const code = generateRoomCode();
  assert.equal(code.length, ROOM_CODE_LENGTH);
  assert.ok(isRoomCode(code), `${code} deveria ser um código válido`);
}
assert.ok(isRoomCode("000000"));
assert.ok(!isRoomCode("12345"));
assert.ok(!isRoomCode("1234567"));
assert.ok(!isRoomCode("12345a"));
assert.ok(!isRoomCode(""));

// A name containing hyphens must split on the *last* one, or "reuniao-time"
// comes back as "reuniao".
assert.deepEqual(splitPrivateRoomHandle("priv-reuniao-time-123456"), {
  name: "reuniao-time",
  code: "123456",
});

// Things that carry no code: public handles, and private ones from before
// the scheme existed. Both must be null rather than a guess — the header
// falls back to showing the raw handle for exactly these.
assert.equal(splitPrivateRoomHandle("reuniao-time"), null);
assert.equal(splitPrivateRoomHandle("priv-familia"), null);
assert.equal(splitPrivateRoomHandle("priv-familia-12345"), null);
assert.equal(splitPrivateRoomHandle("priv-familia-abcdef"), null);
// A trailing number that isn't six digits is part of the name, not a code.
assert.equal(splitPrivateRoomHandle("priv-sala-2024"), null);

console.log("roomsApi: ok");

// ─── roomHandleFromInput ──────────────────────────────────────────────────
//
// The rule that matters most: anything unrecognised comes back untouched, so
// every input that used to reach the validation downstream still does.
assert.equal(roomHandleFromInput("reuniao-time"), "reuniao-time");
assert.equal(roomHandleFromInput("  reuniao-time  "), "reuniao-time");
assert.equal(roomHandleFromInput(""), "");
assert.equal(roomHandleFromInput("priv-familia-123456"), "priv-familia-123456");

// The canonical link, in the shapes it actually gets pasted in.
assert.equal(roomHandleFromInput("https://golive.nemtudo.me/watch/reuniao-time"), "reuniao-time");
assert.equal(roomHandleFromInput("http://golive.nemtudo.me/watch/reuniao-time"), "reuniao-time");
assert.equal(roomHandleFromInput("golive.nemtudo.me/watch/reuniao-time"), "reuniao-time");
assert.equal(roomHandleFromInput("https://www.golive.nemtudo.me/watch/reuniao-time"), "reuniao-time");
assert.equal(
  roomHandleFromInput("https://golive.nemtudo.me/watch/priv-familia-123456?x=1#y"),
  "priv-familia-123456"
);
assert.equal(roomHandleFromInput("https://golive.nemtudo.me/watch/sala/"), "sala");

// The short link, where the room is the whole path.
assert.equal(roomHandleFromInput("https://g.nemtudo.me/reuniao-time"), "reuniao-time");
assert.equal(roomHandleFromInput("g.nemtudo.me/reuniao-time"), "reuniao-time");

// A room name that reached the address bar encoded has to come back decoded.
assert.equal(roomHandleFromInput("https://g.nemtudo.me/sala%2Dteste"), "sala-teste");

// Other pages on our own host are not rooms — guessing one out of /pro would
// send somebody somewhere they never asked to go.
assert.equal(
  roomHandleFromInput("https://golive.nemtudo.me/pro"),
  "https://golive.nemtudo.me/pro"
);
assert.equal(
  roomHandleFromInput("https://golive.nemtudo.me/watch"),
  "https://golive.nemtudo.me/watch"
);
// Nor is a deeper path on the short host, which only ever names one segment.
assert.equal(roomHandleFromInput("https://g.nemtudo.me/a/b"), "https://g.nemtudo.me/a/b");
// Somebody else's link is somebody else's.
assert.equal(
  roomHandleFromInput("https://exemplo.com/watch/sala"),
  "https://exemplo.com/watch/sala"
);
// A malformed escape throws inside decodeURIComponent; a bad paste is not an
// exception.
assert.equal(roomHandleFromInput("https://g.nemtudo.me/%E0%A4%A"), "https://g.nemtudo.me/%E0%A4%A");

console.log("roomHandleFromInput: ok");
