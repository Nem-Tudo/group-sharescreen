// Mention parsing, tokenizing, and autocomplete helpers for the room chat
// (ChatPanel.tsx).
//
// Mentions in GoLive are room-scoped: only participants who exist in the
// room can be mentioned, and display names may contain spaces, accents, and
// Unicode characters (e.g. "@João Silva", "@Ana Clara"). Any other "@word"
// not matching a room member is treated as regular plain text without
// highlight.

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strips diacritics/accents and converts to lowercase for case- and
// accent-insensitive searching (e.g. typing "@joao" matches "@João Silva").
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Builds a single RegExp that matches any of the provided candidate names
// preceded by "@" and bounded by whitespace/punctuation/end-of-string.
//
// Names are sorted by length descending so longer compound names (e.g.
// "João Silva") are matched before prefixes ("João"). Returns null when
// the list of names is empty so caller can skip regex matching entirely.
// `char` is the sign in front: "@" for people, "#" for a group's rooms.
export function buildMentionsRegex(names: string[], char: "@" | "#" = "@"): RegExp | null {
  const uniqueNames = Array.from(
    new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n && n.length > 0)))
  );
  if (uniqueNames.length === 0) return null;

  // Sort longest names first so multi-word names take precedence
  const sorted = uniqueNames.sort((a, b) => b.length - a.length);
  const alternation = sorted.map(escapeRegExp).join("|");

  // Matches @Name when preceded by start of string or whitespace / opening delimiter,
  // and followed by end of string or non-word character (punctuation, space, etc.).
  return new RegExp(`(?:(?<=^|[\\s(\\[{<"']))${char}(${alternation})(?=$|[^\\p{L}\\p{N}_])`, "gui");
}

// Regexes already built, by the exact set of names they match.
//
// For a list of messages that each mention a different handful of people:
// most messages mention nobody, the rest mention one or two, and the same few
// combinations recur down a conversation. Building each one is a sort, an
// escape per name and a compile, so it is done once per combination rather
// than once per message per render. Bounded because nothing else evicts.
const regexCache = new Map<string, RegExp | null>();
const REGEX_CACHE_MAX = 500;

/**
 * buildMentionsRegex, remembered. Safe to share between messages: the regex
 * is /g and so carries lastIndex, but tokenizeMentions resets it before every
 * use (pinned by chatMentions.test.mts).
 */
export function mentionsRegexFor(names: string[]): RegExp | null {
  const key = JSON.stringify([...names].sort());
  const held = regexCache.get(key);
  if (held !== undefined) return held;
  const regex = buildMentionsRegex(names);
  if (regexCache.size >= REGEX_CACHE_MAX) regexCache.clear();
  regexCache.set(key, regex);
  return regex;
}

/**
 * Who might be mentioned: the room's names, or a regex already built from
 * them by buildMentionsRegex. Passing the regex is what a list of messages
 * should do — building it is O(names log names) plus a compile, and the
 * answer is the same for every message in the list.
 */
export type KnownNames = string[] | RegExp;

export type MentionToken =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; name: string };

// Tokenizes plain text into text segments and valid mention tokens.
export function tokenizeMentions(text: string, mentionRegex: RegExp | null): MentionToken[] {
  if (!mentionRegex || !text) {
    return [{ type: "text", value: text }];
  }

  const tokens: MentionToken[] = [];
  let lastIndex = 0;
  mentionRegex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const matchStart = match.index;
    const matchText = match[0];
    const matchedName = match[1] ?? matchText.slice(1);

    if (matchStart > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, matchStart) });
    }

    tokens.push({
      type: "mention",
      value: matchText,
      name: matchedName,
    });

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", value: text }];
}

export const BROADCAST_MENTIONS = ["todos", "everyone"] as const;

export function isBroadcastMention(name: string): boolean {
  const norm = normalizeSearch(name);
  return norm === "todos" || norm === "everyone";
}

// Module scope rather than rebuilt per call: it is a constant, and this runs
// once per arriving chat message (see useRoomSoundEffects). Being /g it
// carries lastIndex between calls, so reset before testing.
const BROADCAST_MENTION_RE = /(?:(?<=^|[\s(\[{<"']))@(todos|everyone)(?=$|[^\p{L}\p{N}_])/gui;

export function containsBroadcastMention(text: string): boolean {
  if (!text) return false;
  BROADCAST_MENTION_RE.lastIndex = 0;
  return BROADCAST_MENTION_RE.test(text);
}

// Checks if a specific user (selfName) is directly mentioned by name,
// taking into account all known room participant names so that mentioning
// a longer compound name (e.g. "@João Silva") does not falsely match a
// shorter prefix name (e.g. "João").
export function isUserDirectlyMentioned(
  text: string,
  selfName: string | null | undefined,
  known: KnownNames = []
): boolean {
  const trimmed = selfName?.trim();
  if (!trimmed || !text) return false;

  // A caller rendering a list of messages already built this regex once for
  // the whole list (see ChatPanel's mentionRegex) — taking it directly saves
  // re-escaping and re-compiling every name in the room per message. Note
  // such a regex must already include selfName, which ChatPanel's does.
  const regex =
    known instanceof RegExp
      ? known
      : buildMentionsRegex(known.includes(trimmed) ? known : [...known, trimmed]);
  if (!regex) return false;

  const tokens = tokenizeMentions(text, regex);
  const normSelf = normalizeSearch(trimmed);

  return tokens.some((t) => t.type === "mention" && normalizeSearch(t.name) === normSelf);
}

// Checks if a specific user (selfName) is among the parsed mentions in a message.
// Also triggers if a broadcast mention (@todos or @everyone) is present in the message.
export function isUserMentionedInMessage(
  text: string,
  selfName: string | null | undefined,
  known: KnownNames = []
): boolean {
  if (!text) return false;

  // Broadcast mentions (@todos, @everyone) notify everyone in the room
  if (containsBroadcastMention(text)) {
    return true;
  }

  return isUserDirectlyMentioned(text, selfName, known);
}

export interface MentionTriggerInfo {
  isTriggered: boolean;
  query: string;
  startIndex: number;
}

// Inspects the textarea text and cursor position to detect if the user is
// currently typing an "@mention".
// `char` is what opens the suggestions: "@" for people (the default, and all
// the room chat uses), "#" for a group's rooms. `maxQuery` is how long the typed
// part may run before it stops counting as a mention in progress — a room name
// is allowed a little longer than a person's.
export function getMentionTriggerInfo(
  text: string,
  cursorPos: number,
  char: "@" | "#" = "@",
  maxQuery = 25
): MentionTriggerInfo {
  if (cursorPos < 0) return { isTriggered: false, query: "", startIndex: -1 };

  const textBeforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = textBeforeCursor.lastIndexOf(char);

  if (lastAtIndex === -1) {
    return { isTriggered: false, query: "", startIndex: -1 };
  }

  // Ensure @ is at start of string or preceded by whitespace / opening delimiter
  const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
  if (charBefore !== " " && charBefore !== "\n" && charBefore !== "\t" && charBefore !== "(") {
    return { isTriggered: false, query: "", startIndex: -1 };
  }

  const query = textBeforeCursor.slice(lastAtIndex + 1);

  // Stop trigger if query contains newlines or exceeds max display name length
  if (query.includes("\n") || query.length > maxQuery) {
    return { isTriggered: false, query: "", startIndex: -1 };
  }

  // A trailing space ends the token: the mention is complete, whether the user
  // accepted a suggestion (applyMentionInsertion appends "@Name ") or typed the
  // name and a space themselves. This is the fix for the popup that stayed open
  // "@João |" forever and, with it, made Enter keep re-selecting a name instead
  // of sending. Live search for a spaced name ("@João S") still works because
  // that query ends in a letter, not a space — only the finished "@João " closes
  // the menu.
  if (/\s$/.test(query)) {
    return { isTriggered: false, query: "", startIndex: -1 };
  }

  return {
    isTriggered: true,
    query,
    startIndex: lastAtIndex,
  };
}

// Filters and ranks a candidate list of room participants according to the
// typed mention query.
export function filterMentionCandidates<T extends { name: string; aliases?: string[] }>(
  candidates: T[],
  query: string
): T[] {
  if (!candidates || candidates.length === 0) return [];

  const rawQuery = query.trim();
  if (!rawQuery) {
    return [...candidates];
  }

  const normQuery = normalizeSearch(rawQuery);

  type ScoredCandidate = { candidate: T; score: number };
  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const name = candidate.name?.trim();
    if (!name) continue;

    const normName = normalizeSearch(name);

    if (normName === normQuery) {
      scored.push({ candidate, score: 3 });
    } else if (normName.startsWith(normQuery)) {
      scored.push({ candidate, score: 2 });
    } else if (
      candidate.aliases?.some((alias) => normalizeSearch(alias).startsWith(normQuery))
    ) {
      scored.push({ candidate, score: 2 });
    } else if (
      // Checks if any individual word in a multi-word name starts with query
      normName.split(/\s+/).some((word) => word.startsWith(normQuery)) ||
      normName.includes(normQuery) ||
      candidate.aliases?.some((alias) => normalizeSearch(alias).includes(normQuery))
    ) {
      scored.push({ candidate, score: 1 });
    }
  }

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.candidate.name.length - b.candidate.name.length;
    })
    .map((s) => s.candidate);
}

// Calculates the new text and cursor position when a mention is selected from
// the autocomplete menu.
export function applyMentionInsertion(
  text: string,
  cursorPos: number,
  startIndex: number,
  selectedName: string,
  char: "@" | "#" = "@"
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, startIndex);
  let after = text.slice(cursorPos);
  if (after.startsWith(" ")) {
    after = after.slice(1);
  }
  const mentionText = `${char}${selectedName} `;
  const newText = before + mentionText + after;
  const newCursorPos = before.length + mentionText.length;
  return { newText, newCursorPos };
}
