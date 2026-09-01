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
export function buildMentionsRegex(names: string[]): RegExp | null {
  const uniqueNames = Array.from(
    new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n && n.length > 0)))
  );
  if (uniqueNames.length === 0) return null;

  // Sort longest names first so multi-word names take precedence
  const sorted = uniqueNames.sort((a, b) => b.length - a.length);
  const alternation = sorted.map(escapeRegExp).join("|");

  // Matches @Name when preceded by start of string or whitespace / opening delimiter,
  // and followed by end of string or non-word character (punctuation, space, etc.).
  return new RegExp(`(?:(?<=^|[\\s(\\[{<"']))@(${alternation})(?=$|[^\\p{L}\\p{N}_])`, "gui");
}

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

// Checks if a specific user (selfName) is among the parsed mentions in a message,
// taking into account all known room participant names so that mentioning
// a longer compound name (e.g. "@João Silva") does not falsely notify a
// shorter prefix name (e.g. "João").
export function isUserMentionedInMessage(
  text: string,
  selfName: string | null | undefined,
  allKnownNames: string[] = []
): boolean {
  const trimmed = selfName?.trim();
  if (!trimmed || !text) return false;

  const names = allKnownNames.includes(trimmed) ? allKnownNames : [...allKnownNames, trimmed];
  const regex = buildMentionsRegex(names);
  if (!regex) return false;

  const tokens = tokenizeMentions(text, regex);
  const normSelf = normalizeSearch(trimmed);

  return tokens.some((t) => t.type === "mention" && normalizeSearch(t.name) === normSelf);
}

export interface MentionTriggerInfo {
  isTriggered: boolean;
  query: string;
  startIndex: number;
}

// Inspects the textarea text and cursor position to detect if the user is
// currently typing an "@mention".
export function getMentionTriggerInfo(text: string, cursorPos: number): MentionTriggerInfo {
  if (cursorPos < 0) return { isTriggered: false, query: "", startIndex: -1 };

  const textBeforeCursor = text.slice(0, cursorPos);
  const lastAtIndex = textBeforeCursor.lastIndexOf("@");

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
  if (query.includes("\n") || query.length > 25) {
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
export function filterMentionCandidates<T extends { name: string }>(
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
      // Checks if any individual word in a multi-word name starts with query
      normName.split(/\s+/).some((word) => word.startsWith(normQuery)) ||
      normName.includes(normQuery)
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
  selectedName: string
): { newText: string; newCursorPos: number } {
  const before = text.slice(0, startIndex);
  let after = text.slice(cursorPos);
  if (after.startsWith(" ")) {
    after = after.slice(1);
  }
  const mentionText = `@${selectedName} `;
  const newText = before + mentionText + after;
  const newCursorPos = before.length + mentionText.length;
  return { newText, newCursorPos };
}
