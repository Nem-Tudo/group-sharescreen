// node --experimental-strip-types lib/mentionExpr.test.mts
//
// The twin of the API's server/mentionExpr.test.ts for the shared half, plus
// what only the web app does: reading role names, finding expressions in a
// message, writing one back out, and "does this mention me".

import assert from "node:assert/strict";
import test from "node:test";
import {
  blankSpans,
  canonicalAtom,
  findMentionExprs,
  isWritableRole,
  mayMention,
  mentionEntryOf,
  mentionExprKey,
  mentionsTakeIn,
  parseMentionExpr,
  typedAtomResolver,
  typedMention,
} from "./mentionExpr";

const ROLES = [
  { id: "r1", name: "Admin" },
  { id: "r2", name: "Moderação" },
  { id: "r3", name: "VIP Ouro" },
];
const resolve = typedAtomResolver(ROLES);
const key = (source: string) => {
  const expr = parseMentionExpr(source, resolve);
  return expr ? mentionExprKey(expr) : null;
};

test("role names are read accent- and case-insensitively, with spaces, @ optional", () => {
  assert.equal(key("{@admin&{moderacao|@VIP OURO}}"), "role:r1&{role:r2|role:r3}");
  assert.equal(key("{@Admin & @online}"), "role:r1&online");
});

test("the user's examples", () => {
  assert.equal(key("{@Admin&@online}"), "role:r1&online");
  assert.equal(key("{@Admin&@offline}"), "role:r1&offline");
  assert.equal(key("{@Admin&@Moderação}"), "role:r1&role:r2");
  assert.equal(key("{@Admin&@Moderação&@online}"), "role:r1&role:r2&online");
  assert.equal(key("{@Admin&{Moderação|@online}}"), "role:r1&{role:r2|online}");
});

test("keywords win over a role with the same name", () => {
  const withOnline = typedAtomResolver([{ id: "x", name: "Online" }]);
  assert.deepEqual(withOnline("@online"), { kind: "online" });
  assert.equal(isWritableRole({ id: "x", name: "Online" }, [{ id: "x", name: "Online" }]), false);
});

test("the same entry on both sides: typed here, canonical there", () => {
  const typedExpr = parseMentionExpr("{@admin&{@Moderação|@online}}", resolve)!;
  const entry = mentionEntryOf(typedExpr);
  const readBack = parseMentionExpr(entry.slice("@expr:".length), canonicalAtom)!;
  assert.equal(mentionEntryOf(readBack), entry);
});

test("finding expressions in a message", () => {
  const text = "bora {@Admin&@online} e {@VIP Ouro|@Moderação}! código {a|b} fica, {@ninguém&@online} também";
  const spans = findMentionExprs(text, resolve);
  assert.deepEqual(
    spans.map((s) => text.slice(s.start, s.end)),
    ["{@Admin&@online}", "{@VIP Ouro|@Moderação}"]
  );
  assert.deepEqual(
    spans.map((s) => s.entry),
    ["@expr:role:r1&online", "@expr:role:r3|role:r2"]
  );
  // Glued to a word, split across lines, or unbalanced: plain text.
  assert.equal(findMentionExprs("x{@Admin&@online}", resolve).length, 0);
  assert.equal(findMentionExprs("{@Admin&@online}s", resolve).length, 0);
  assert.equal(findMentionExprs("{@Admin&\n@online}", resolve).length, 0);
  assert.equal(findMentionExprs("{@Admin&{@online}", resolve).length, 0);
  // A lone role in braces is that role's own entry.
  assert.deepEqual(findMentionExprs("({@Admin})", resolve).map((s) => s.entry), ["@role:r1"]);
});

test("blanking spans keeps every other position", () => {
  const text = "a {@Admin&@online} b";
  const blanked = blankSpans(text, findMentionExprs(text, resolve));
  assert.equal(blanked.length, text.length);
  assert.equal(blanked.trim().replace(/\s+/g, " "), "a b");
});

test("writing an expression back out", () => {
  const expr = parseMentionExpr("{@admin&{@moderação|!@online}}", resolve)!;
  assert.equal(typedMention(expr, ROLES), "{@Admin&{@Moderação|!@online}}");
  assert.equal(typedMention(parseMentionExpr("@online", resolve)!, ROLES), "@online");
  // A role whose name the grammar would split cannot be written.
  const odd = [{ id: "z", name: "R&D" }];
  assert.equal(typedMention({ kind: "and", args: [{ kind: "role", id: "z" }, { kind: "online" }] }, odd), null);
  // Two roles sharing a name: only the first can be written.
  const twins = [
    { id: "a", name: "Staff" },
    { id: "b", name: "staff" },
  ];
  assert.equal(isWritableRole(twins[0], twins), true);
  assert.equal(isWritableRole(twins[1], twins), false);
});

test("does this mention me", () => {
  const me = { id: "me", roleIds: ["r1"] };
  assert.equal(mentionsTakeIn(["me"], me), true);
  assert.equal(mentionsTakeIn(["@everyone"], me), true);
  assert.equal(mentionsTakeIn(["@role:r1"], me), true);
  assert.equal(mentionsTakeIn(["@role:r2"], me), false);
  // Live: whoever receives it is online.
  assert.equal(mentionsTakeIn(["@online"], me), true);
  assert.equal(mentionsTakeIn(["@offline"], me), false);
  assert.equal(mentionsTakeIn(["@expr:role:r1&online"], me), true);
  assert.equal(mentionsTakeIn(["@expr:role:r2&online"], me), false);
  // From a page: the API's answer wins.
  assert.equal(mentionsTakeIn(["@online"], me, false), false);
  assert.equal(mentionsTakeIn(["@offline"], me, true), true);
  assert.equal(mentionsTakeIn(undefined, me), false);
});

test("permission rule matches the API's", () => {
  const onlyMod = { everyone: false, role: (id: string) => id === "r2" };
  const may = (source: string) => mayMention(parseMentionExpr(source, resolve)!, onlyMod);
  assert.equal(may("{@Moderação&@online}"), true);
  assert.equal(may("{@Moderação|@online}"), false);
  assert.equal(may("@offline"), false);
});
