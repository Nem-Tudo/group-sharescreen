// Mentions that stand for a set of people worked out when the message is sent:
// "@online", "@offline", and expressions joining those and the roles with
// & (and), | (or) and ! (not), grouped with braces — "{@Admin&@online}" is
// whoever holds Admin and is online right now, "{@Mod&{@VIP|@online}}" whoever
// is a Mod and either a VIP or online.
//
// The text keeps what the author typed, role names and all; the message's
// `mentions` carries the same thing by id — "@expr:role:abc&online" — the way
// a role's mention is "@Name" in the text and "@role:<id>" there. The API
// checks, evaluates and stores that entry; this side writes it on send (see
// GroupMessageComposer) and reads it back to draw the message and to tell
// whether it mentions whoever is reading.
//
// The twin of the API's server/mentionExpr.ts. Everything down to the "web
// app only" line is the same code on both sides — the grammar, the canonical
// form and the permission rule — and must stay so, or a mention written here
// is not the one read there. No React, no DOM: tested in mentionExpr.test.mts.

import { normalizeSearch } from "./chatMentions";

export const EVERYONE_MENTION = "@everyone";
export const ONLINE_MENTION = "@online";
export const OFFLINE_MENTION = "@offline";
export const ROLE_MENTION_PREFIX = "@role:";
export const EXPR_MENTION_PREFIX = "@expr:";

/** Bounds on one expression — nobody needs more, and each is work per member. */
export const MAX_EXPR_ATOMS = 16;
export const MAX_EXPR_DEPTH = 6;
export const MAX_EXPR_LENGTH = 600;

export type MentionAtom =
  | { kind: "everyone" }
  | { kind: "online" }
  | { kind: "offline" }
  | { kind: "role"; id: string };

export type MentionExpr =
  | MentionAtom
  | { kind: "not"; arg: MentionExpr }
  | { kind: "and"; args: MentionExpr[] }
  | { kind: "or"; args: MentionExpr[] };

/** What one atom's text ("@Admin", "online", "role:abc") stands for, or null. */
export type AtomResolver = (raw: string) => MentionAtom | null;

function isAtom(expr: MentionExpr): expr is MentionAtom {
  return expr.kind === "everyone" || expr.kind === "online" || expr.kind === "offline" || expr.kind === "role";
}

/**
 * Reads an expression. The grammar, loosest-binding first:
 *
 *   or      := and ("|" and)*
 *   and     := unary ("&" unary)*
 *   unary   := "!" unary | primary
 *   primary := "{" or "}" | atom
 *   atom    := anything up to the next { } & or |, trimmed
 *
 * so "&" binds tighter than "|", as in most languages, and braces group.
 * Whitespace between the parts is ignored. What an atom means is `resolve`'s
 * business: the web app looks up role names, the API reads "role:<id>".
 * Null for anything malformed, too big, or with an atom that resolves to
 * nothing — an expression is used whole or not at all.
 */
export function parseMentionExpr(source: string, resolve: AtomResolver): MentionExpr | null {
  if (!source || source.length > MAX_EXPR_LENGTH) return null;
  let pos = 0;
  let atoms = 0;
  let failed = false;

  const skipSpace = () => {
    while (pos < source.length && /\s/.test(source[pos])) pos += 1;
  };

  function parseOr(depth: number): MentionExpr | null {
    const args: MentionExpr[] = [];
    const first = parseAnd(depth);
    if (!first) return null;
    args.push(first);
    skipSpace();
    while (source[pos] === "|") {
      pos += 1;
      const next = parseAnd(depth);
      if (!next) return null;
      args.push(next);
      skipSpace();
    }
    return args.length === 1 ? args[0] : { kind: "or", args };
  }

  function parseAnd(depth: number): MentionExpr | null {
    const args: MentionExpr[] = [];
    const first = parseUnary(depth);
    if (!first) return null;
    args.push(first);
    skipSpace();
    while (source[pos] === "&") {
      pos += 1;
      const next = parseUnary(depth);
      if (!next) return null;
      args.push(next);
      skipSpace();
    }
    return args.length === 1 ? args[0] : { kind: "and", args };
  }

  function parseUnary(depth: number): MentionExpr | null {
    skipSpace();
    if (source[pos] === "!") {
      pos += 1;
      const arg = parseUnary(depth);
      return arg ? { kind: "not", arg } : null;
    }
    return parsePrimary(depth);
  }

  function parsePrimary(depth: number): MentionExpr | null {
    skipSpace();
    if (source[pos] === "{") {
      if (depth >= MAX_EXPR_DEPTH) return null;
      pos += 1;
      const inner = parseOr(depth + 1);
      skipSpace();
      if (!inner || source[pos] !== "}") return null;
      pos += 1;
      return inner;
    }
    const start = pos;
    while (pos < source.length && !"{}&|".includes(source[pos])) pos += 1;
    const raw = source.slice(start, pos).trim();
    if (!raw) return null;
    atoms += 1;
    if (atoms > MAX_EXPR_ATOMS) {
      failed = true;
      return null;
    }
    return resolve(raw);
  }

  const expr = parseOr(0);
  skipSpace();
  if (failed || !expr || pos !== source.length) return null;
  return normalizeMentionExpr(expr);
}

/**
 * The same expression, tidied: an "and" inside an "and" (or an "or" inside an
 * "or") joined into its parent, "!!x" read as x, and the same term twice kept
 * once. The order is the author's. Canonical keys are written from this, so
 * two ways of typing the same thing store as the same thing.
 */
export function normalizeMentionExpr(expr: MentionExpr): MentionExpr {
  if (isAtom(expr)) return expr;
  if (expr.kind === "not") {
    const arg = normalizeMentionExpr(expr.arg);
    return arg.kind === "not" ? arg.arg : { kind: "not", arg };
  }
  const flat: MentionExpr[] = [];
  const seen = new Set<string>();
  for (const child of expr.args) {
    const tidy = normalizeMentionExpr(child);
    const parts = tidy.kind === expr.kind ? (tidy as { args: MentionExpr[] }).args : [tidy];
    for (const part of parts) {
      const key = mentionExprKey(part);
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push(part);
    }
  }
  return flat.length === 1 ? flat[0] : { kind: expr.kind, args: flat };
}

function atomKey(atom: MentionAtom): string {
  return atom.kind === "role" ? `role:${atom.id}` : atom.kind;
}

/**
 * The canonical text of an expression, by id: "role:abc&{role:def|online}".
 * Every and/or inside another term is braced, so it reads back exactly.
 */
export function mentionExprKey(expr: MentionExpr): string {
  const wrap = (child: MentionExpr) =>
    child.kind === "and" || child.kind === "or" ? `{${mentionExprKey(child)}}` : mentionExprKey(child);
  if (isAtom(expr)) return atomKey(expr);
  if (expr.kind === "not") return `!${wrap(expr.arg)}`;
  return expr.args.map(wrap).join(expr.kind === "and" ? "&" : "|");
}

/** Reads an atom of the canonical form. */
export function canonicalAtom(raw: string): MentionAtom | null {
  if (raw === "everyone" || raw === "online" || raw === "offline") return { kind: raw };
  const match = /^role:([A-Za-z0-9_-]{1,40})$/.exec(raw);
  return match ? { kind: "role", id: match[1] } : null;
}

/** The `mentions` entry for an expression — see the top of this file. */
export function mentionEntryOf(expr: MentionExpr): string {
  switch (expr.kind) {
    case "everyone":
      return EVERYONE_MENTION;
    case "online":
      return ONLINE_MENTION;
    case "offline":
      return OFFLINE_MENTION;
    case "role":
      return `${ROLE_MENTION_PREFIX}${expr.id}`;
    default:
      return `${EXPR_MENTION_PREFIX}${mentionExprKey(expr)}`;
  }
}

/** The expression a `mentions` entry stands for; null for a person's id or anything unreadable. */
export function exprOfEntry(entry: string): MentionExpr | null {
  if (entry === EVERYONE_MENTION) return { kind: "everyone" };
  if (entry === ONLINE_MENTION) return { kind: "online" };
  if (entry === OFFLINE_MENTION) return { kind: "offline" };
  if (entry.startsWith(ROLE_MENTION_PREFIX)) return canonicalAtom(`role:${entry.slice(ROLE_MENTION_PREFIX.length)}`);
  if (entry.startsWith(EXPR_MENTION_PREFIX)) return parseMentionExpr(entry.slice(EXPR_MENTION_PREFIX.length), canonicalAtom);
  return null;
}

/**
 * Whether an entry names a set of people worked out at send time — @online,
 * @offline or an expression — rather than somebody by id, @everyone or one role.
 * These are the ones whose audience the API stores with the message.
 */
export function isAudienceEntry(entry: string): boolean {
  return entry === ONLINE_MENTION || entry === OFFLINE_MENTION || entry.startsWith(EXPR_MENTION_PREFIX);
}

/** Every role id the expression refers to, once each. */
export function rolesIn(expr: MentionExpr): string[] {
  const out = new Set<string>();
  const walk = (e: MentionExpr) => {
    if (e.kind === "role") out.add(e.id);
    else if (e.kind === "not") walk(e.arg);
    else if (e.kind === "and" || e.kind === "or") e.args.forEach(walk);
  };
  walk(expr);
  return [...out];
}

/** Whether it depends on who is online. */
export function usesPresence(expr: MentionExpr): boolean {
  if (expr.kind === "online" || expr.kind === "offline") return true;
  if (expr.kind === "not") return usesPresence(expr.arg);
  if (expr.kind === "and" || expr.kind === "or") return expr.args.some(usesPresence);
  return false;
}

/** One member, as far as an expression cares. */
export interface MentionSubject {
  hasRole(roleId: string): boolean;
  online: boolean;
}

/** Whether the expression takes in this member. */
export function matchesMention(expr: MentionExpr, subject: MentionSubject): boolean {
  switch (expr.kind) {
    case "everyone":
      return true;
    case "online":
      return subject.online;
    case "offline":
      return !subject.online;
    case "role":
      return subject.hasRole(expr.id);
    case "not":
      return !matchesMention(expr.arg, subject);
    case "and":
      return expr.args.every((arg) => matchesMention(arg, subject));
    case "or":
      return expr.args.some((arg) => matchesMention(arg, subject));
  }
}

/** What the author may mention on their own: @everyone's permission, and each role. */
export interface MentionRights {
  everyone: boolean;
  role(roleId: string): boolean;
}

/**
 * Whether the author may send this. The rule keeps anybody from reaching
 * more people than they could with the mentions they are allowed:
 *
 * - @everyone, @online and @offline need "Mencionar @everyone";
 * - a role needs to be mentionable, or that same permission;
 * - A & B reaches a subset of each, so either being allowed is enough —
 *   {@Mod&@online} is fine for anybody who may mention @Mod;
 * - A | B reaches both, so both must be allowed;
 * - !A reaches everybody but A, so it needs "Mencionar @everyone".
 */
export function mayMention(expr: MentionExpr, rights: MentionRights): boolean {
  switch (expr.kind) {
    case "everyone":
    case "online":
    case "offline":
    case "not":
      return rights.everyone;
    case "role":
      return rights.role(expr.id);
    case "and":
      return expr.args.some((arg) => mayMention(arg, rights));
    case "or":
      return expr.args.every((arg) => mayMention(arg, rights));
  }
}

// ─── Web app only ──────────────────────────────────────────────────────────

/** A role as the composer knows it — enough to read and write its name. */
export interface NamedRole {
  id: string;
  name: string;
}

const KEYWORDS = new Set(["everyone", "online", "offline"]);

/**
 * Reads an atom as a person types it: "@Admin", "Admin", "@online". Accents
 * and case do not matter, the "@" is optional, and @everyone, @online and
 * @offline win over a role that happens to share the name. Where two roles
 * share a name the first listed wins — callers list them highest first.
 */
export function typedAtomResolver(roles: readonly NamedRole[]): AtomResolver {
  const byName = new Map<string, string>();
  for (const role of roles) {
    const key = normalizeSearch(role.name.trim());
    if (key && !byName.has(key)) byName.set(key, role.id);
  }
  return (raw) => {
    const name = normalizeSearch((raw.startsWith("@") ? raw.slice(1) : raw).trim());
    if (name === "everyone" || name === "online" || name === "offline") return { kind: name };
    const id = byName.get(name);
    return id ? { kind: "role", id } : null;
  };
}

/**
 * Whether a role can be written into an expression by name and read back as
 * itself: nothing the grammar would split on, no leading "!" or "@", not one
 * of the keywords, and not sharing its name with a role listed before it.
 */
export function isWritableRole(role: NamedRole, roles: readonly NamedRole[]): boolean {
  const name = role.name.trim();
  if (!name || /[{}&|]/.test(name) || name.startsWith("!") || name.startsWith("@")) return false;
  const key = normalizeSearch(name);
  if (KEYWORDS.has(key)) return false;
  return roles.find((r) => normalizeSearch(r.name.trim()) === key)?.id === role.id;
}

/**
 * An expression as a person would type it — "{@Admin&{@Mod|@online}}", or
 * "@online" for a lone atom — or null when a role in it cannot be written by
 * name (see isWritableRole). What the mention editor inserts.
 */
export function typedMention(expr: MentionExpr, roles: readonly NamedRole[]): string | null {
  const atom = (a: MentionAtom): string | null => {
    if (a.kind !== "role") return `@${a.kind}`;
    const role = roles.find((r) => r.id === a.id);
    return role && isWritableRole(role, roles) ? `@${role.name.trim()}` : null;
  };
  const wrap = (e: MentionExpr): string | null => {
    const inner = body(e);
    return inner !== null && (e.kind === "and" || e.kind === "or") ? `{${inner}}` : inner;
  };
  function body(e: MentionExpr): string | null {
    if (isAtom(e)) return atom(e);
    if (e.kind === "not") {
      const inner = wrap(e.arg);
      return inner === null ? null : `!${inner}`;
    }
    const parts = e.args.map(wrap);
    if (parts.some((p) => p === null)) return null;
    return parts.join(e.kind === "and" ? "&" : "|");
  }
  if (isAtom(expr)) return atom(expr);
  const inner = body(expr);
  return inner === null ? null : `{${inner}}`;
}

/** One "{…}" of a text that reads as a whole expression. */
export interface MentionExprSpan {
  start: number;
  /** One past the closing brace. */
  end: number;
  expr: MentionExpr;
  /** Its `mentions` entry — see mentionEntryOf. */
  entry: string;
}

/**
 * Every "{…}" in the text that is a whole expression: standing on its own
 * (after the start, a space or an opening bracket, and not running on into a
 * word), on one line, with at least one "@" in it, and reading through
 * `resolve` without a single unknown part. Anything else — "{a|b}" in a
 * snippet of code, a role nobody has — stays the plain text it is.
 */
export function findMentionExprs(text: string, resolve: AtomResolver): MentionExprSpan[] {
  const out: MentionExprSpan[] = [];
  if (!text || !text.includes("{")) return out;
  let from = 0;
  while (from < text.length) {
    const open = text.indexOf("{", from);
    if (open === -1) break;
    from = open + 1;
    if (open > 0 && !/[\s(["']/.test(text[open - 1])) continue;
    let depth = 0;
    let close = -1;
    for (let j = open; j < text.length && j - open < MAX_EXPR_LENGTH; j += 1) {
      const ch = text[j];
      if (ch === "\n") break;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1) continue;
    const next = text[close + 1];
    if (next !== undefined && /[\p{L}\p{N}_]/u.test(next)) continue;
    const source = text.slice(open, close + 1);
    if (!source.includes("@")) continue;
    const expr = parseMentionExpr(source, resolve);
    if (!expr) continue;
    out.push({ start: open, end: close + 1, expr, entry: mentionEntryOf(expr) });
    from = close + 1;
  }
  return out;
}

/** The text with every span blanked out, same length — for reading what lies outside them. */
export function blankSpans(text: string, spans: readonly { start: number; end: number }[]): string {
  if (spans.length === 0) return text;
  let out = "";
  let last = 0;
  for (const span of spans) {
    out += text.slice(last, span.start) + " ".repeat(span.end - span.start);
    last = span.end;
  }
  return out + text.slice(last);
}

/**
 * Whether a message's `mentions` take in this reader: by id, @everyone, a
 * role they hold, or an @online/@offline/expression. For those last ones the
 * API's answer (`pingedMe`, on a page it sent) is the truth — it knew who was
 * online when the message went out. Without it the message arrived live, and
 * whoever receives a message live is online, so it is worked out here with
 * the roles held now. The caller rules out the reader's own messages.
 */
export function mentionsTakeIn(
  entries: readonly string[] | undefined,
  reader: { id: string; roleIds: readonly string[] },
  pingedMe?: boolean
): boolean {
  if (!entries || entries.length === 0) return false;
  const subject: MentionSubject = { hasRole: (id) => reader.roleIds.includes(id), online: true };
  for (const entry of entries) {
    if (entry === reader.id || entry === EVERYONE_MENTION) return true;
    if (entry.startsWith(ROLE_MENTION_PREFIX)) {
      if (reader.roleIds.includes(entry.slice(ROLE_MENTION_PREFIX.length))) return true;
      continue;
    }
    if (!isAudienceEntry(entry)) continue;
    if (pingedMe !== undefined) {
      if (pingedMe) return true;
      continue;
    }
    const expr = exprOfEntry(entry);
    if (expr && matchesMention(expr, subject)) return true;
  }
  return false;
}
