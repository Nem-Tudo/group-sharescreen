// node --experimental-strip-types lib/messageTokens.test.mts
//
// The twin of the API's server/messageTokens.test.ts: what the composer turns
// into tokens, and how a stored text is cut back into names and rooms.

import assert from "node:assert/strict";
import {
  UNKNOWN_ROOM,
  UNKNOWN_USER,
  encodeMentions,
  plainTokens,
  splitTokens,
  userTokenIds,
} from "./messageTokens";

const ANA = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const JOAO = "9c858901-8a57-4791-81fe-4c455b099bc9";
const JOAO_SILVA = "4c24bdd5-4a2a-4c5d-9e84-1f2d7f1d2b11";
const GUEST = "guest:6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b";
const GERAL = "abc123def456";
const GERAL_DOIS = "zzz999yyy888";

// --- encoding: what the composer sends ------------------------------------

assert.equal(encodeMentions("oi @Ana tudo bem", [{ id: ANA, name: "Ana" }], []), `oi <@${ANA}> tudo bem`);

// Case and accents do not matter to who is meant.
assert.equal(encodeMentions("@ana", [{ id: ANA, name: "Ana" }], []), `<@${ANA}>`);

// A compound name is taken whole, not as the shorter name it starts with.
assert.equal(
  encodeMentions(
    "fala @João Silva e @João",
    [
      { id: JOAO, name: "João" },
      { id: JOAO_SILVA, name: "João Silva" },
    ],
    []
  ),
  `fala <@${JOAO_SILVA}> e <@${JOAO}>`
);

// Two people with one name: whoever is listed first wins, which is how the
// composer makes the one actually picked from the suggestions count.
assert.equal(
  encodeMentions(
    "@Ana",
    [
      { id: GUEST, name: "Ana" },
      { id: ANA, name: "Ana" },
    ],
    []
  ),
  `<@${GUEST}>`
);

// Only a name standing on its own: not inside an e-mail, not the start of a
// longer word, and not anybody this room does not have.
assert.equal(encodeMentions("ana@Ana.com @Anabela @Zé", [{ id: ANA, name: "Ana" }], []), "ana@Ana.com @Anabela @Zé");

// @everyone and roles are not people and stay exactly as typed.
assert.equal(encodeMentions("@everyone @Mods", [{ id: ANA, name: "Ana" }], []), "@everyone @Mods");

// Rooms, including a hyphen: "#geral-dois" is that room, never "#geral".
const rooms = [
  { id: GERAL, name: "geral" },
  { id: GERAL_DOIS, name: "geral-dois" },
];
assert.equal(encodeMentions("veja #geral e #geral-dois", [], rooms), `veja <#${GERAL}> e <#${GERAL_DOIS}>`);
assert.equal(encodeMentions("#geral-tres", [], [{ id: GERAL, name: "geral" }]), "#geral-tres");

// A token already in the text is left alone rather than read a second time.
assert.equal(encodeMentions(`<@${ANA}> e @Ana`, [{ id: ANA, name: "Ana" }], []), `<@${ANA}> e <@${ANA}>`);

// Plain text with nothing to encode, and an empty list, change nothing.
assert.equal(encodeMentions("só texto", [], []), "só texto");

// --- splitting: what the screen draws --------------------------------------

assert.deepEqual(splitTokens(`oi <@${ANA}>, olha <#${GERAL}>!`), [
  { type: "text", value: "oi " },
  { type: "user", id: ANA },
  { type: "text", value: ", olha " },
  { type: "room", id: GERAL },
  { type: "text", value: "!" },
]);

// A guest's id has a colon, and is still a person.
assert.deepEqual(splitTokens(`<@${GUEST}>`), [{ type: "user", id: GUEST }]);
// A colon is never part of a room id, so that is just text.
assert.deepEqual(splitTokens("<#guest:x>"), [{ type: "text", value: "<#guest:x>" }]);

// Text with no tokens is one run — which is every message from before them.
assert.deepEqual(splitTokens("@Ana escreveu à mão"), [{ type: "text", value: "@Ana escreveu à mão" }]);
assert.deepEqual(splitTokens(""), []);

assert.deepEqual(userTokenIds(`<@${ANA}> <@${GUEST}> <@${ANA}> <#${GERAL}>`), [ANA, GUEST]);

// --- plain text: the quote a reply keeps ----------------------------------

assert.equal(
  plainTokens(
    `oi <@${ANA}> e <@sumiu>, em <#${GERAL}> e <#apagada0000>`,
    (id) => (id === ANA ? "Ana" : null),
    (id) => (id === GERAL ? "geral" : null)
  ),
  `oi @Ana e @${UNKNOWN_USER}, em #geral e #${UNKNOWN_ROOM}`
);

// Round trip: what the composer encodes reads back as what was typed.
const typed = "oi @Ana, bora pra #geral";
const encoded = encodeMentions(typed, [{ id: ANA, name: "Ana" }], [{ id: GERAL, name: "geral" }]);
assert.equal(
  plainTokens(
    encoded,
    (id) => (id === ANA ? "Ana" : null),
    (id) => (id === GERAL ? "geral" : null)
  ),
  typed
);

console.log("messageTokens: ok");
