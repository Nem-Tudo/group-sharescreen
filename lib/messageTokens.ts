// How a group message refers to people and rooms: `<@userId>` and `<#roomId>`,
// Discord's own convention — the twin of the API's server/messageTokens.ts,
// and the two must agree on the patterns below.
//
// The text carries ids and every screen draws the names. That is what lets
// the API read who a message mentions off the message itself, instead of
// trusting a list the web app worked out by matching "@Name" against every
// member it had loaded — which meant loading all of them, and a mention of
// anybody not loaded silently alerted nobody.
//
// The composer still shows names while somebody types (see encodeMentions,
// which turns them into tokens on the way out), and a message stored before
// the tokens existed still reads the old way (see TextChannelView's
// renderText). No React, no DOM: tested in messageTokens.test.mts.

import { normalizeSearch } from "./chatMentions";

const USER_TOKEN = /<@([A-Za-z0-9:_-]{1,80})>/g;
// Either kind, for splitting a text in one pass.
const ANY_TOKEN = /<([@#])([A-Za-z0-9:_-]{1,80})>/g;

export const UNKNOWN_USER = "unknown-user";
export const UNKNOWN_ROOM = "unknown-room";

export type TokenSegment =
  | { type: "text"; value: string }
  | { type: "user"; id: string }
  | { type: "room"; id: string };

/** The text cut into plain runs and tokens, in order. */
export function splitTokens(text: string): TokenSegment[] {
  const out: TokenSegment[] = [];
  let last = 0;
  ANY_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(ANY_TOKEN)) {
    const [whole, kind, id] = match;
    // A room id has no colon; "<#guest:...>" is not a room, so it stays text.
    if (kind === "#" && id.includes(":")) continue;
    if (id.length > (kind === "#" ? 40 : 80)) continue;
    const at = match.index ?? 0;
    if (at > last) out.push({ type: "text", value: text.slice(last, at) });
    out.push(kind === "@" ? { type: "user", id } : { type: "room", id });
    last = at + whole.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Every user the text refers to with `<@id>`, once each. */
export function userTokenIds(text: string): string[] {
  USER_TOKEN.lastIndex = 0;
  return [...new Set(Array.from(text.matchAll(USER_TOKEN), (m) => m[1]))];
}

/**
 * The text as a person reads it — `<@id>` as "@Name", `<#id>` as "#room" —
 * for the places that keep it as plain text: the quote a reply carries is a
 * snapshot, stored as written and shown without lookups.
 */
export function plainTokens(
  text: string,
  userName: (id: string) => string | null | undefined,
  roomName: (id: string) => string | null | undefined
): string {
  return splitTokens(text)
    .map((segment) =>
      segment.type === "text"
        ? segment.value
        : segment.type === "user"
          ? `@${userName(segment.id) ?? UNKNOWN_USER}`
          : `#${roomName(segment.id) ?? UNKNOWN_ROOM}`
    )
    .join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "@Name" or "#name" wherever it stands on its own: after the start, a space
 * or an opening bracket, and not running on into more of a word. Longest names
 * first, so "João Silva" is taken before the "João" it starts with.
 *
 * `continues` is what would make a match only the start of something longer.
 * A room name runs on through hyphens ("#geral-dois" is not "#geral"), where a
 * person's name, as in the room chat's own mentions, does not.
 */
function triggerPattern(char: "@" | "#", names: string[], continues: string): RegExp | null {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  if (unique.length === 0) return null;
  const alternation = unique.map(escapeRegExp).join("|");
  return new RegExp(
    // No "<" among what may come before, unlike the room chat's mentions: it
    // would let an "@" that is already inside a token be read again.
    `(?<=^|[\\s(\\[{"'])${escapeRegExp(char)}(${alternation})(?=$|[^${continues}])`,
    "giu"
  );
}

export type Named = { id: string; name: string };

/**
 * The composer's text with the people and rooms it names turned into tokens.
 *
 * `people` are the ones "@Name" may stand for, `rooms` the ones "#name" may.
 * Where two share a name the first listed wins — so a caller puts the ones
 * actually picked from the suggestions first, and a pick is never overruled
 * by somebody else who happens to be called the same.
 *
 * Anything left as plain text afterwards — a name nobody here has, an
 * "@everyone", a role — is exactly what it was.
 */
export function encodeMentions(text: string, people: Named[], rooms: Named[]): string {
  const personByName = new Map<string, string>();
  for (const person of people) {
    const key = normalizeSearch(person.name);
    if (key && !personByName.has(key)) personByName.set(key, person.id);
  }
  const roomByName = new Map<string, string>();
  for (const room of rooms) {
    const key = normalizeSearch(room.name);
    if (key && !roomByName.has(key)) roomByName.set(key, room.id);
  }

  let out = text;
  const peoplePattern = triggerPattern("@", people.map((p) => p.name), "\\p{L}\\p{N}_");
  if (peoplePattern) {
    out = out.replace(peoplePattern, (whole, name: string) => {
      const id = personByName.get(normalizeSearch(name));
      return id ? `<@${id}>` : whole;
    });
  }
  const roomPattern = triggerPattern("#", rooms.map((r) => r.name), "\\p{L}\\p{N}_\\-");
  if (roomPattern) {
    out = out.replace(roomPattern, (whole, name: string) => {
      const id = roomByName.get(normalizeSearch(name));
      return id ? `<#${id}>` : whole;
    });
  }
  return out;
}
