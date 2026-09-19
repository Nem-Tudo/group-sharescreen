// npm test — the pure half of custom emoji (lib/customEmojiTokens), the twin
// of the API's customEmoji.test.ts for the token format.

import assert from "node:assert/strict";
import {
  composerTextFor,
  emojiLabel,
  encodeCustomEmojis,
  isJumboEmojiText,
  parseEmojiToken,
  plainEmoji,
  splitEmojiTokens,
} from "./customEmojiTokens";

const pepe = { id: "aaaaaaaa11", name: "pepe", animated: false, usable: true };
const pepe2 = { id: "bbbbbbbb22", name: "pepe", animated: true, usable: true };
const dance = { id: "cccccccc33", name: "dance", animated: true, usable: true };
const locked = { id: "dddddddd44", name: "locked", animated: false, usable: false };
const set = { sources: [{ emojis: [pepe, dance, locked] }, { emojis: [pepe2] }] };

// Tokens.
assert.deepEqual(parseEmojiToken("<a:dance:cccccccc33>"), { animated: true, name: "dance", id: "cccccccc33" });
assert.equal(parseEmojiToken("<:x:cccccccc33>"), null);
assert.deepEqual(splitEmojiTokens("oi <:pepe:aaaaaaaa11>!"), [
  { type: "text", value: "oi " },
  { type: "emoji", emoji: { animated: false, name: "pepe", id: "aaaaaaaa11" } },
  { type: "text", value: "!" },
]);
assert.equal(plainEmoji("<:pepe:aaaaaaaa11> ok"), ":pepe: ok");
assert.equal(emojiLabel("<a:dance:cccccccc33>"), ":dance:");
assert.equal(emojiLabel("👍"), "👍");

// Big when a message is only emoji.
assert.equal(isJumboEmojiText(" <:pepe:aaaaaaaa11> <a:dance:cccccccc33> "), true);
assert.equal(isJumboEmojiText("oi <:pepe:aaaaaaaa11>"), false);
assert.equal(isJumboEmojiText("oi"), false);

// ":name:" becomes the first usable emoji of that name — glued ones too.
assert.equal(encodeCustomEmojis("oi :pepe::dance:", set), "oi <:pepe:aaaaaaaa11><a:dance:cccccccc33>");
assert.equal(encodeCustomEmojis("abc:pepe:", set), "abc:pepe:"); // glued to a word
assert.equal(encodeCustomEmojis(":locked:", set), ":locked:"); // not usable here
assert.equal(encodeCustomEmojis(":nope:", set), ":nope:");
// An existing token is left alone.
assert.equal(encodeCustomEmojis("<a:pepe:bbbbbbbb22>", set), "<a:pepe:bbbbbbbb22>");

// What the box gets: the name when it reads back as this one, else the token.
assert.equal(composerTextFor(pepe, set), ":pepe:");
assert.equal(composerTextFor(pepe2, set), "<a:pepe:bbbbbbbb22>");
assert.equal(composerTextFor(pepe, set, (name) => name === "pepe"), "<:pepe:aaaaaaaa11>");
