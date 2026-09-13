// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/emoji.test.mts
import assert from "node:assert/strict";
import {
  getEmojiTrigger,
  replaceShortcodes,
  searchEmoji,
  twemojiUrl,
  type EmojiEntry,
  type EmojiIndex,
} from "./emoji";

// A hand-made index, so this runs offline: the real one is emojibase's data
// off the CDN, and only its shape matters here.
function entry(unicode: string, label: string, shortcodes: string[], order: number, tags: string[] = []): EmojiEntry {
  return { unicode, label, shortcodes, words: [label, ...tags], order };
}
const entries = [
  entry("😂", "rosto chorando de rir", ["joy"], 3, ["rir"]),
  entry("😭", "rosto chorando aos berros", ["sob"], 99, ["chorando", "triste"]),
  entry("❤️", "coracao vermelho", ["heart"], 154, ["amor"]),
  entry("💘", "coracao com flecha", ["cupid", "heart_with_arrow"], 140),
  entry("👍️", "polegar para cima", ["+1", "thumbsup"], 351),
  entry("💯", "cem pontos", ["100"], 160),
];
const index: EmojiIndex = {
  entries,
  byShortcode: new Map(entries.flatMap((e) => e.shortcodes.map((code) => [code, e] as const))),
};

// ─── Twemoji file names ────────────────────────────────────────────────────
const base = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg/";
assert.equal(twemojiUrl("😭"), `${base}1f62d.svg`);
// The variation selector goes, outside a ZWJ sequence…
assert.equal(twemojiUrl("❤️"), `${base}2764.svg`);
assert.equal(twemojiUrl("👍️"), `${base}1f44d.svg`);
// …and stays inside one.
assert.equal(twemojiUrl("❤️‍🔥"), `${base}2764-fe0f-200d-1f525.svg`);
assert.equal(twemojiUrl("👨‍👩‍👧"), `${base}1f468-200d-1f469-200d-1f467.svg`);

// ─── The ":" trigger ───────────────────────────────────────────────────────
assert.deepEqual(getEmojiTrigger(":", 1), { start: 0, query: "" });
assert.deepEqual(getEmojiTrigger("oi :so", 6), { start: 3, query: "so" });
assert.deepEqual(getEmojiTrigger("oi :cora", 8), { start: 3, query: "cora" });
assert.equal(getEmojiTrigger("Obs:", 4), null, "a colon glued to a word opens nothing");
assert.equal(getEmojiTrigger("10:30", 5), null);
assert.equal(getEmojiTrigger("oi :)", 5), null, "an emoticon closes it");
assert.equal(getEmojiTrigger("oi :so mais", 11), null, "a space ends the name");
// Only what is before the cursor counts.
assert.deepEqual(getEmojiTrigger(":so tudo", 3), { start: 0, query: "so" });

// ─── ":sob:" → 😭 ──────────────────────────────────────────────────────────
assert.deepEqual(replaceShortcodes("to :sob:", 8, index), { text: "to 😭", caret: 5 });
assert.deepEqual(replaceShortcodes(":sob::joy:", 10, index), { text: "😭😂", caret: 4 });
// Case does not matter, unknown names stay as typed.
assert.equal(replaceShortcodes(":SOB: :nope:", 0, index).text, "😭 :nope:");
// Glued to a word: a time or a ratio, not an emoji.
assert.equal(replaceShortcodes("placar 1:100:2", 0, index).text, "placar 1:100:2");
assert.equal(replaceShortcodes("nota :100:", 0, index).text, "nota 💯");
// The cursor after the name moves with the text; one before it stays put.
assert.deepEqual(replaceShortcodes(":sob: ok", 8, index), { text: "😭 ok", caret: 5 });
assert.deepEqual(replaceShortcodes("oi :sob:", 1, index), { text: "oi 😭", caret: 1 });
// Nothing to do: the very same object back, so callers can compare by text.
assert.deepEqual(replaceShortcodes("sem nada", 3, index), { text: "sem nada", caret: 3 });

// ─── Searching ─────────────────────────────────────────────────────────────
const first = (query: string) => searchEmoji(index, query)[0]?.entry.unicode;
assert.equal(first("sob"), "😭", "an exact shortcode wins");
assert.equal(first("so"), "😭");
assert.equal(first("heart"), "❤️", "the shorter shortcode first among prefixes");
assert.equal(first("chorando"), "😂", "a word of the name, in emoji order");
assert.equal(first("triste"), "😭", "tags count");
// Both hearts are *named* "coração …", so they come in the standard order.
assert.equal(first("coracao"), "💘", "names starting with it, in emoji order");
assert.equal(first("amor"), "❤️", "a tag still finds it");
assert.equal(first("+1"), "👍️");
assert.equal(searchEmoji(index, "sob")[0]?.shortcode, "sob");
assert.equal(searchEmoji(index, "arrow")[0]?.shortcode, "heart_with_arrow", "shows the name that matched");
assert.ok(searchEmoji(index, "").length > 0, "':' alone offers the popular ones");
assert.equal(searchEmoji(index, "zzz").length, 0);

console.log("emoji: ok");
