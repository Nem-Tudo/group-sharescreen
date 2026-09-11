// node --experimental-strip-types lib/groupReactions.test.mts
//
// A message's reactions changed ahead of the server: an emoji keeps its place
// while anybody is on it, a new one goes last, an empty one goes away.
import assert from "node:assert/strict";
import { describeReaction, toggleReaction } from "./groupReactions";

const start = [
  { emoji: "👍", users: ["a", "b"] },
  { emoji: "🔥", users: ["b"] },
];

// Joining an existing emoji: added at the end of its users, the row unchanged.
assert.deepEqual(toggleReaction(start, "👍", "c", true), [
  { emoji: "👍", users: ["a", "b", "c"] },
  { emoji: "🔥", users: ["b"] },
]);
// Already on it: nothing changes (the same array back).
assert.equal(toggleReaction(start, "👍", "a", true), start);
// A new emoji goes at the end of the row.
assert.deepEqual(toggleReaction(start, "😂", "a", true).map((r) => r.emoji), ["👍", "🔥", "😂"]);
// Taking one back keeps the emoji while somebody is still on it...
assert.deepEqual(toggleReaction(start, "👍", "a", false), [
  { emoji: "👍", users: ["b"] },
  { emoji: "🔥", users: ["b"] },
]);
// ...and removes it when nobody is.
assert.deepEqual(toggleReaction(start, "🔥", "b", false), [{ emoji: "👍", users: ["a", "b"] }]);
// Taking back something that is not there changes nothing.
assert.equal(toggleReaction(start, "😢", "a", false), start);
// The input is never modified.
assert.deepEqual(start, [
  { emoji: "👍", users: ["a", "b"] },
  { emoji: "🔥", users: ["b"] },
]);

// The tooltip.
const names: Record<string, string> = { me: "Você", a: "Ana", b: "Bia", c: "Caio", d: "Duda", e: "Enzo", f: "Fê" };
const nameOf = (id: string) => names[id] ?? "Alguém";
assert.equal(describeReaction({ emoji: "👍", users: ["me"] }, nameOf), "Você reagiu com 👍");
assert.equal(describeReaction({ emoji: "👍", users: ["a", "b"] }, nameOf), "Ana e Bia reagiram com 👍");
assert.equal(describeReaction({ emoji: "👍", users: ["me", "a", "b"] }, nameOf), "Você, Ana e Bia reagiram com 👍");
assert.equal(
  describeReaction({ emoji: "🔥", users: ["a", "b", "c", "d", "e", "f", "me"] }, nameOf),
  "Ana, Bia, Caio, Duda, Enzo e mais 2 reagiram com 🔥"
);

console.log("groupReactions ok");
