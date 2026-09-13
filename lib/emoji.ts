// Emoji for the chats: how one is drawn (Twemoji), how one is found by name
// (":sob" in the composer), and how a name typed out in full becomes the
// emoji itself (":sob:" → 😭).
//
// Nothing here is bundled. The pictures come from the maintained Twemoji fork
// (jdecked/twemoji) and the names from emojibase-data, both off jsDelivr —
// the same CDN the picker (frimousse) loads its own data from.
//
// Only the *drawing* is Twemoji. What is typed and sent is the ordinary
// Unicode character: a message has to read correctly in a notification, a
// search, a copy-paste and any client that has never heard of Twemoji. Where
// the character is plain text — a textarea, a message — it is the Twemoji
// *font* (see the @font-face in app/globals.css) that draws it, since a text
// field cannot hold a picture.

import { getLocale, type Locale } from "@/lib/i18n";

/**
 * The Emoji version everything offered is pinned to: the one the Twemoji font
 * covers (twemoji-colr-font 15.0.3, in globals.css). Anything newer would be
 * a picture in the picker and a missing glyph once it is in the text box.
 * Raise it together with that font.
 */
export const EMOJI_VERSION = 15;
const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg/";
export const EMOJIBASE_URL = `https://cdn.jsdelivr.net/npm/emojibase-data@${EMOJI_VERSION}`;

const ZWJ = "\u200d";

/**
 * The Twemoji picture for one emoji.
 *
 * Twemoji names its files by code point, with one rule to know: the variation
 * selector U+FE0F is dropped *unless* the emoji is a ZWJ sequence. "❤️" is
 * 2764.svg, but "❤️‍🔥" keeps every code point it has.
 */
export function twemojiUrl(emoji: string): string {
  const raw = emoji.includes(ZWJ) ? emoji : emoji.replace(/\ufe0f/g, "");
  const points: string[] = [];
  for (const char of raw) points.push((char.codePointAt(0) ?? 0).toString(16));
  return `${TWEMOJI_BASE}${points.join("-")}.svg`;
}

// ─── The index ──────────────────────────────────────────────────────────────

export type EmojiEntry = {
  unicode: string;
  /** Its name in the site's language ("rosto chorando aos berros"). */
  label: string;
  /** Discord/Slack-style names, in English ("sob"). May be empty. */
  shortcodes: string[];
  /** Label and tags, lowercased and without accents, for searching. */
  words: string[];
  order: number;
};

export type EmojiIndex = {
  entries: EmojiEntry[];
  byShortcode: Map<string, EmojiEntry>;
};

type EmojibaseEmoji = {
  hexcode: string;
  emoji: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
  version?: number;
};
type ShortcodeFile = Record<string, string | string[]>;

// emojibase's "component" group: the bare skin-tone swatches and hair
// styles. Pieces other emoji are made of, not something anybody sends.
const COMPONENT_GROUP = 2;

/** Lowercase, accents stripped — "Coração" and "coracao" are one search. */
export function normalizeEmojiQuery(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as T;
}

/**
 * Fetches and builds the index for one language. The app goes through
 * ensureEmojiIndex, which caches it; this is exported for checking the real
 * data from a script.
 */
export async function buildEmojiIndex(locale: Locale): Promise<EmojiIndex> {
  // English shortcodes whatever the language, because that is what everybody
  // who has used Discord or Slack types; the label and tags are what make the
  // search work in Portuguese and Spanish too.
  //
  // data.json rather than the smaller compact.json: it is the very file the
  // picker fetches, so whichever opens first fills the browser's cache for the
  // other — and only it says which Emoji version each emoji belongs to.
  const [data, github, iamcal] = await Promise.all([
    fetchJson<EmojibaseEmoji[]>(`${EMOJIBASE_URL}/${locale}/data.json`),
    fetchJson<ShortcodeFile>(`${EMOJIBASE_URL}/en/shortcodes/github.json`),
    fetchJson<ShortcodeFile>(`${EMOJIBASE_URL}/en/shortcodes/iamcal.json`),
  ]);
  const codesFor = (hexcode: string): string[] => {
    const found = new Set<string>();
    for (const file of [github, iamcal]) {
      const value = file[hexcode] ?? file[`${hexcode}-FE0F`];
      for (const code of ([] as string[]).concat(value ?? [])) found.add(code.toLowerCase());
    }
    return [...found];
  };

  const entries: EmojiEntry[] = [];
  const byShortcode = new Map<string, EmojiEntry>();
  for (const emoji of data) {
    if (emoji.group === COMPONENT_GROUP) continue;
    // The data runs a point release ahead of the font (15.1 in the @15 set).
    if ((emoji.version ?? 0) > EMOJI_VERSION) continue;
    const entry: EmojiEntry = {
      unicode: emoji.emoji,
      label: emoji.label,
      shortcodes: codesFor(emoji.hexcode),
      words: [emoji.label, ...(emoji.tags ?? [])].map(normalizeEmojiQuery),
      order: emoji.order ?? Number.MAX_SAFE_INTEGER,
    };
    entries.push(entry);
    for (const code of entry.shortcodes) {
      if (!byShortcode.has(code)) byShortcode.set(code, entry);
    }
  }
  entries.sort((a, b) => a.order - b.order);
  return { entries, byShortcode };
}

// One index per language, loaded on first use and kept for the session. The
// files are versioned URLs, so after the first visit the browser answers from
// its own cache.
const indexes = new Map<Locale, EmojiIndex>();
const loading = new Map<Locale, Promise<EmojiIndex | null>>();
const listeners = new Set<() => void>();

export function subscribeEmojiIndex(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The index for the site's language, or null while it has not loaded. */
export function getEmojiIndex(): EmojiIndex | null {
  if (typeof window === "undefined") return null;
  return indexes.get(getLocale()) ?? null;
}

/** Starts loading the index if it is not already here. Safe to call often. */
export function ensureEmojiIndex(): void {
  if (typeof window === "undefined") return;
  const locale = getLocale();
  if (indexes.has(locale) || loading.has(locale)) return;
  const promise = buildEmojiIndex(locale)
    .then((index) => {
      indexes.set(locale, index);
      listeners.forEach((listener) => listener());
      return index;
    })
    .catch(() => {
      // Offline, or the CDN having a bad minute. Forgotten, so the next
      // keystroke tries again rather than the feature staying off all session.
      loading.delete(locale);
      return null;
    });
  loading.set(locale, promise);
}

// ─── Finding one ────────────────────────────────────────────────────────────

export type EmojiMatch = {
  entry: EmojiEntry;
  /** The name to show beside it — the shortcode that matched, when one did. */
  shortcode: string | null;
};

/** What ":" alone offers, before a single letter narrows it down. */
const POPULAR = ["joy", "heart", "sob", "+1", "fire", "skull", "pray", "eyes", "sparkles", "rofl"];

/**
 * The emoji whose name fits `query`, best first.
 *
 * Shortcodes lead (":sob" should put 😭 on top, not whatever has "sob" in a
 * tag), then names and tags in the site's language, and within a tier the
 * standard emoji order — the one every keyboard uses.
 */
export function searchEmoji(index: EmojiIndex, rawQuery: string, limit = 8): EmojiMatch[] {
  const query = normalizeEmojiQuery(rawQuery);
  if (!query) {
    return POPULAR.map((code) => index.byShortcode.get(code))
      .filter((entry): entry is EmojiEntry => Boolean(entry))
      .slice(0, limit)
      .map((entry) => ({ entry, shortcode: entry.shortcodes[0] ?? null }));
  }

  // Tiers, best first. The name outranks the tags throughout: every emoji
  // with tears is tagged "chorando", but only a few are *called* that.
  //   0  the shortcode exactly             :sob     → 😭
  //   1  the name exactly                  :fogo    → 🔥
  //   2  a shortcode starting with it      :hea     → ❤️
  //   3  the name starting with it         :cora    → ❤️ "coração vermelho"
  //   4  a later word of the name starting with it
  //   5  a tag exactly, or starting with it
  //   6  a shortcode containing it
  //   7  the name or a tag containing it
  const scored: { entry: EmojiEntry; shortcode: string | null; score: number }[] = [];
  for (const entry of index.entries) {
    let best = Infinity;
    let shortcode: string | null = entry.shortcodes[0] ?? null;
    for (const code of entry.shortcodes) {
      const score = code === query ? 0 : code.startsWith(query) ? 2 : code.includes(query) ? 6 : Infinity;
      if (score < best) {
        best = score;
        shortcode = code;
      }
    }
    if (best > 0) {
      entry.words.forEach((word, position) => {
        const label = position === 0;
        const score =
          label && word === query
            ? 1
            : label && word.startsWith(query)
              ? 3
              : label && word.includes(` ${query}`)
                ? 4
                : !label && (word.startsWith(query) || word.includes(` ${query}`))
                  ? 5
                  : word.includes(query)
                    ? 7
                    : Infinity;
        if (score < best) best = score;
      });
    }
    if (best !== Infinity) scored.push({ entry, shortcode, score: best });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      // Among shortcode prefixes, the shorter name is the likelier one:
      // ":heart" means ❤️ before it means 😍 (":heart_eyes").
      (a.score === 2 ? (a.shortcode?.length ?? 0) - (b.shortcode?.length ?? 0) : 0) ||
      a.entry.order - b.entry.order
  );
  return scored.slice(0, limit).map(({ entry, shortcode }) => ({ entry, shortcode }));
}

// ─── The ":" trigger ────────────────────────────────────────────────────────

export type EmojiTrigger = {
  /** Where the ":" is. */
  start: number;
  /** What has been typed after it, up to the cursor. */
  query: string;
};

// A ":" at the start or after a space, then letters, digits, "_", "+" or "-"
// up to the cursor. The space rule is what keeps "Obs:" and "10:30" from
// opening a list nobody asked for; the character set is what closes it on an
// emoticon like ":)" or ":/".
const TRIGGER = /(?:^|\s):([\p{L}\p{N}_+-]{0,32})$/u;

export function getEmojiTrigger(text: string, caret: number): EmojiTrigger | null {
  const match = TRIGGER.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

// ─── ":sob:" → 😭 ───────────────────────────────────────────────────────────

const SHORTCODE = /:([a-z0-9_+-]{1,40}):/gi;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Turns every known ":name:" in `text` into its emoji, and says where the
 * cursor ends up.
 *
 * A name glued to a word ("abc:sob:") is left alone, the same way the ":"
 * trigger ignores one: it is far more likely to be part of something else —
 * a time, a path, a ratio — than an emoji. An unknown name is left as typed.
 */
export function replaceShortcodes(
  text: string,
  caret: number,
  index: EmojiIndex
): { text: string; caret: number } {
  if (!text.includes(":")) return { text, caret };
  let out = "";
  let last = 0;
  let delta = 0;
  let caretInside: number | null = null;
  SHORTCODE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SHORTCODE.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start > 0 ? text[start - 1] : "";
    const entry = WORD_CHAR.test(before) ? undefined : index.byShortcode.get(match[1].toLowerCase());
    if (!entry) {
      // The closing ":" may be the opening one of the next name.
      SHORTCODE.lastIndex = start + 1;
      continue;
    }
    out += text.slice(last, start) + entry.unicode;
    if (end <= caret) delta += entry.unicode.length - match[0].length;
    else if (start < caret) caretInside = out.length;
    last = end;
  }
  if (last === 0) return { text, caret };
  out += text.slice(last);
  return { text: out, caret: caretInside ?? caret + delta };
}
