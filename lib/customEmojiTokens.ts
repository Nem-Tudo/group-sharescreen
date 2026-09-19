// The custom emoji token — `<:name:id>`, or `<a:name:id>` for an animated
// one — and nothing else: no React, no DOM, no requests, so the pure parts
// can be tested and used anywhere (lib/groupReactions, lib/messageTokens).
// The twin of the API's customEmoji.ts; the two must agree on the patterns.
// Everything that talks to the API is in lib/customEmoji.ts.

export const CUSTOM_EMOJI_TOKEN = /<(a?):([A-Za-z0-9_]{2,32}):([A-Za-z0-9]{8,32})>/g;
const ONE_TOKEN = /^<(a?):([A-Za-z0-9_]{2,32}):([A-Za-z0-9]{8,32})>$/;
export const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;
/** The biggest picture the API accepts — see its customEmoji.ts. */
export const EMOJI_IMAGE_MAX_BYTES = 512 * 1024;

export interface ParsedEmojiToken {
  animated: boolean;
  name: string;
  id: string;
}

export function parseEmojiToken(value: string): ParsedEmojiToken | null {
  const match = ONE_TOKEN.exec(value);
  return match ? { animated: match[1] === "a", name: match[2], id: match[3] } : null;
}

export function emojiToken(emoji: { animated: boolean; name: string; id: string }): string {
  return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

export type EmojiSegment = { type: "text"; value: string } | { type: "emoji"; emoji: ParsedEmojiToken };

/** The text cut into plain runs and custom emoji, in order. */
export function splitEmojiTokens(text: string): EmojiSegment[] {
  if (!text.includes("<")) return [{ type: "text", value: text }];
  const out: EmojiSegment[] = [];
  let last = 0;
  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(CUSTOM_EMOJI_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", value: text.slice(last, at) });
    out.push({ type: "emoji", emoji: { animated: match[1] === "a", name: match[2], id: match[3] } });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Every custom emoji in the text as a person reads it: `:name:`. */
export function plainEmoji(text: string): string {
  if (!text.includes("<")) return text;
  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  return text.replace(CUSTOM_EMOJI_TOKEN, (_, _a: string, name: string) => `:${name}:`);
}

/** How a reaction's emoji reads in words: itself, or a custom one's `:name:`. */
export function emojiLabel(emoji: string): string {
  const token = parseEmojiToken(emoji);
  return token ? `:${token.name}:` : emoji;
}

/**
 * Whether a message is nothing but custom emoji (and spaces) — few enough to
 * be drawn big, the way Discord draws a message that is only emoji.
 */
export function isJumboEmojiText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<")) return false;
  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  const found = trimmed.match(CUSTOM_EMOJI_TOKEN);
  if (!found || found.length > 27) return false;
  CUSTOM_EMOJI_TOKEN.lastIndex = 0;
  return trimmed.replace(CUSTOM_EMOJI_TOKEN, "").trim() === "";
}

// ─── Between the text box and the wire ─────────────────────────────────────
//
// Structural types rather than lib/customEmoji's, so this file stays free of
// imports (see the top).

type EmojiLike = { id: string; name: string; animated: boolean; usable: boolean };
type EmojiSetLike = { sources: { emojis: EmojiLike[] }[] };

/** Every usable emoji, in the order they are offered: the group's own, then yours, then other groups'. */
export function usableCustomEmojis<E extends EmojiLike>(set: { sources: { emojis: E[] }[] } | null): E[] {
  if (!set) return [];
  return set.sources.flatMap((source) => source.emojis.filter((e) => e.usable));
}

/**
 * What goes in the text box for a custom emoji: `:name:` when that name
 * reads back as this very emoji (it is the first usable one of that name),
 * and the whole token otherwise — so picking the second "pepe" sends that one.
 */
export function composerTextFor(
  emoji: EmojiLike,
  set: EmojiSetLike | null,
  /** Whether a standard emoji answers to this name — ":fire:" would become 🔥 as it is typed. */
  isStandardName: (name: string) => boolean = () => false
): string {
  if (isStandardName(emoji.name.toLowerCase())) return emojiToken(emoji);
  const first = usableCustomEmojis(set).find((e) => e.name.toLowerCase() === emoji.name.toLowerCase());
  return first?.id === emoji.id ? `:${emoji.name}:` : emojiToken(emoji);
}

// A ":name:" not glued to a word (nor the inside of a token, "<:" / "<a:").
// A lookbehind rather than a consumed character, so ":a::b:" is two.
const NAME_IN_TEXT = /(?<![\p{L}\p{N}<]):([A-Za-z0-9_]{2,32}):/gu;

/**
 * For sending: every `:name:` that names a usable custom emoji becomes its
 * token. Run after the standard names have become their emoji, so a custom
 * emoji called "fire" does not take 🔥 away from anybody.
 */
export function encodeCustomEmojis(text: string, set: EmojiSetLike | null): string {
  const usable = usableCustomEmojis(set);
  if (usable.length === 0 || !text.includes(":")) return text;
  const byName = new Map<string, EmojiLike>();
  for (const emoji of usable) {
    const key = emoji.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, emoji);
  }
  return text.replace(NAME_IN_TEXT, (whole, name: string) => {
    const emoji = byName.get(name.toLowerCase());
    return emoji ? emojiToken(emoji) : whole;
  });
}
