// node --experimental-strip-types lib/chatMentions.test.mts
import assert from "node:assert/strict";
import {
  buildMentionsRegex,
  isUserMentionedInMessage,
  tokenizeMentions,
  getMentionTriggerInfo,
  filterMentionCandidates,
  applyMentionInsertion,
  normalizeSearch,
} from "./chatMentions";

// 1. normalizeSearch removes accents and converts to lowercase
assert.equal(normalizeSearch("João Silva"), "joao silva");
assert.equal(normalizeSearch("Érika Müller"), "erika muller");

// 2. buildMentionsRegex & tokenizeMentions with single and multi-word names
const names = ["João Silva", "João", "Ana Clara", "Carlos_123", "NemTudo"];
const regex = buildMentionsRegex(names);
assert.ok(regex !== null, "regex should not be null");

// Multi-word name matched as single mention
const tokens1 = tokenizeMentions("Olá @João Silva tudo bem?", regex);
assert.deepEqual(tokens1, [
  { type: "text", value: "Olá " },
  { type: "mention", value: "@João Silva", name: "João Silva" },
  { type: "text", value: " tudo bem?" },
]);

// Case-insensitive matching in message text
const tokensCase = tokenizeMentions("e aí @joão silva e @ana clara", regex);
assert.deepEqual(tokensCase, [
  { type: "text", value: "e aí " },
  { type: "mention", value: "@joão silva", name: "joão silva" },
  { type: "text", value: " e " },
  { type: "mention", value: "@ana clara", name: "ana clara" },
]);

// Longer compound name takes priority over prefix name
const tokensPriority = tokenizeMentions("@João Silva vs @João sozinho", regex);
assert.deepEqual(tokensPriority, [
  { type: "mention", value: "@João Silva", name: "João Silva" },
  { type: "text", value: " vs " },
  { type: "mention", value: "@João", name: "João" },
  { type: "text", value: " sozinho" },
]);

// Random words after @ that do not match room members are NOT highlighted
const tokensUnmatched = tokenizeMentions("Isso é @qualquercoisa e não @outrapessoa", regex);
assert.deepEqual(tokensUnmatched, [
  { type: "text", value: "Isso é @qualquercoisa e não @outrapessoa" },
]);

// Email addresses are not treated as mentions
const tokensEmail = tokenizeMentions("meu email é contato@joao.com", regex);
assert.deepEqual(tokensEmail, [
  { type: "text", value: "meu email é contato@joao.com" },
]);

// Word boundary check: @Joãozinho should not match @João
const tokensPartial = tokenizeMentions("Olá @Joãozinho", regex);
assert.deepEqual(tokensPartial, [
  { type: "text", value: "Olá @Joãozinho" },
]);

// Mentions at start, end, in parentheses
const tokensPunct = tokenizeMentions("(@NemTudo) @Carlos_123!", regex);
assert.deepEqual(tokensPunct, [
  { type: "text", value: "(" },
  { type: "mention", value: "@NemTudo", name: "NemTudo" },
  { type: "text", value: ") " },
  { type: "mention", value: "@Carlos_123", name: "Carlos_123" },
  { type: "text", value: "!" },
]);

// Empty candidates produce null regex and plain text tokens
const emptyRegex = buildMentionsRegex([]);
assert.equal(emptyRegex, null);
assert.deepEqual(tokenizeMentions("Olá @João", emptyRegex), [
  { type: "text", value: "Olá @João" },
]);

// 3. isUserMentionedInMessage for self notification highlight
assert.ok(isUserMentionedInMessage("Olá @João Silva!", "João Silva", names));
assert.ok(isUserMentionedInMessage("@joão silva fala aí", "João Silva", names));
assert.ok(!isUserMentionedInMessage("Olá @João Silva", "João", names), "Mentioning 'João Silva' should not notify 'João'");
assert.ok(isUserMentionedInMessage("Olá @João!", "João", names));
assert.ok(!isUserMentionedInMessage("Olá @Joãozinho", "João", names));
assert.ok(!isUserMentionedInMessage("Olá @alguem", null, names));

// 4. getMentionTriggerInfo
assert.deepEqual(getMentionTriggerInfo("Olá @", 5), {
  isTriggered: true,
  query: "",
  startIndex: 4,
});

assert.deepEqual(getMentionTriggerInfo("Olá @Jo", 7), {
  isTriggered: true,
  query: "Jo",
  startIndex: 4,
});

assert.deepEqual(getMentionTriggerInfo("Olá @João S", 11), {
  isTriggered: true,
  query: "João S",
  startIndex: 4,
});

// Cursor before @
assert.deepEqual(getMentionTriggerInfo("Olá @Jo", 3), {
  isTriggered: false,
  query: "",
  startIndex: -1,
});

// Email address (no space before @)
assert.deepEqual(getMentionTriggerInfo("contato@empresa", 12), {
  isTriggered: false,
  query: "",
  startIndex: -1,
});

// Multi-line query is invalid
assert.deepEqual(getMentionTriggerInfo("Olá @teste\noutro", 14), {
  isTriggered: false,
  query: "",
  startIndex: -1,
});

// 5. filterMentionCandidates
const candidates = [
  { id: "1", name: "João Silva" },
  { id: "2", name: "João" },
  { id: "3", name: "Maria Clara" },
  { id: "4", name: "Carlos Eduardo" },
  { id: "5", name: "Eduardo" },
];

assert.equal(filterMentionCandidates(candidates, "").length, 5);

// Accent-insensitive matching
const filteredJoao = filterMentionCandidates(candidates, "joao");
assert.equal(filteredJoao.length, 2);
assert.equal(filteredJoao[0].name, "João"); // Exact match scores higher
assert.equal(filteredJoao[1].name, "João Silva");

// Search by second word / substring in multi-word name
const filteredEduardo = filterMentionCandidates(candidates, "eduardo");
assert.equal(filteredEduardo.length, 2);
assert.equal(filteredEduardo[0].name, "Eduardo"); // Exact match higher
assert.equal(filteredEduardo[1].name, "Carlos Eduardo"); // Second word starts with query

const filteredClara = filterMentionCandidates(candidates, "clara");
assert.equal(filteredClara.length, 1);
assert.equal(filteredClara[0].name, "Maria Clara");

const filteredNone = filterMentionCandidates(candidates, "inexistente");
assert.equal(filteredNone.length, 0);

// 6. applyMentionInsertion
const insert1 = applyMentionInsertion("Olá @jo tudo bem", 7, 4, "João Silva");
assert.equal(insert1.newText, "Olá @João Silva tudo bem");
assert.equal(insert1.newCursorPos, 16);

const insertEnd = applyMentionInsertion("Olá @", 5, 4, "Maria Clara");
assert.equal(insertEnd.newText, "Olá @Maria Clara ");
assert.equal(insertEnd.newCursorPos, 17);

console.log("chatMentions: ok");
