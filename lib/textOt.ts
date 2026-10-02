// Operational transformation for the room's shared text tools (the notepad
// and the code editor — see roomTools.ts).
//
// Plain text, two primitives, nothing clever. An operation is a *list* of
// primitives applied in order, which is what a textarea edit becomes once the
// client diffs it: "replace the selection with what was typed" is one delete
// followed by one insert at the same place.
//
// The server is the authority on order (it numbers every operation it
// applies), and the client keeps at most one operation in flight — the
// classic ot.js arrangement. Both sides transform with `transform` below and
// break ties the same way: whatever the server has already applied wins, so
// two inserts at the same position end up in the order the server saw them.
//
// A copy of the API's server/textOt.ts. Keep them identical — the
// two sides only converge if they transform the same way.

export type TextPrim = { t: "i"; p: number; s: string } | { t: "d"; p: number; n: number };
export type TextOp = TextPrim[];

/** Applies `op` to `text`. Positions are clamped, so a malformed op cannot throw. */
export function applyTextOp(text: string, op: TextOp): string {
  let out = text;
  for (const prim of op) {
    const p = Math.max(0, Math.min(prim.p, out.length));
    if (prim.t === "i") out = out.slice(0, p) + prim.s + out.slice(p);
    else out = out.slice(0, p) + out.slice(Math.min(out.length, p + Math.max(0, prim.n)));
  }
  return out;
}

// `a` rewritten to apply after `b`, both written against the same text.
// `aWins` breaks the one real tie: two inserts at the same position.
function transformPrim(a: TextPrim, b: TextPrim, aWins: boolean): TextPrim[] {
  if (a.t === "i") {
    if (b.t === "i") {
      if (a.p < b.p || (a.p === b.p && aWins)) return [a];
      return [{ ...a, p: a.p + b.s.length }];
    }
    if (a.p <= b.p) return [a];
    if (a.p >= b.p + b.n) return [{ ...a, p: a.p - b.n }];
    // Typed inside a range somebody else deleted: it lands where the range was.
    return [{ ...a, p: b.p }];
  }
  if (b.t === "i") {
    if (b.p <= a.p) return [{ ...a, p: a.p + b.s.length }];
    if (b.p >= a.p + a.n) return [a];
    // Somebody typed inside the range this deletes: delete around it, keep it.
    const before = b.p - a.p;
    return [
      { t: "d", p: a.p, n: before },
      { t: "d", p: a.p + b.s.length, n: a.n - before },
    ];
  }
  // Two deletes: whatever the other one already removed is not removed twice.
  if (a.p + a.n <= b.p) return [a];
  if (a.p >= b.p + b.n) return [{ ...a, p: a.p - b.n }];
  const overlap = Math.min(a.p + a.n, b.p + b.n) - Math.max(a.p, b.p);
  const n = a.n - overlap;
  return n > 0 ? [{ t: "d", p: Math.min(a.p, b.p), n }] : [];
}

/**
 * Both operations rewritten past each other: `[a', b']` such that applying
 * `b` then `a'` gives the same text as applying `a` then `b'`.
 */
export function transform(a: TextOp, b: TextOp, aWins: boolean): [TextOp, TextOp] {
  if (a.length === 0 || b.length === 0) return [a, b];
  if (a.length > 1) {
    const [head, b1] = transform([a[0]], b, aWins);
    const [rest, b2] = transform(a.slice(1), b1, aWins);
    return [[...head, ...rest], b2];
  }
  if (b.length > 1) {
    const [a1, head] = transform(a, [b[0]], aWins);
    const [a2, rest] = transform(a1, b.slice(1), aWins);
    return [a2, [...head, ...rest]];
  }
  return [transformPrim(a[0], b[0], aWins), transformPrim(b[0], a[0], !aWins)];
}

/**
 * An operation as it came off the wire, or null when it is not one. Bounded
 * so nothing a client sends can make the server do unbounded work.
 */
export function parseTextOp(raw: unknown, maxPrims = 256, maxInsert = 30_000): TextOp | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > maxPrims) return null;
  const out: TextOp = [];
  let inserted = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { t, p, s, n } = item as Record<string, unknown>;
    if (typeof p !== "number" || !Number.isInteger(p) || p < 0) return null;
    if (t === "i") {
      if (typeof s !== "string" || s.length === 0) return null;
      inserted += s.length;
      if (inserted > maxInsert) return null;
      out.push({ t: "i", p, s });
    } else if (t === "d") {
      if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return null;
      out.push({ t: "d", p, n });
    } else {
      return null;
    }
  }
  return out;
}
