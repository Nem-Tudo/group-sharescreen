import { applyTextOp, transform, type TextOp } from "./textOt";

// One client's side of a shared text (the room's notepad and code editor —
// see lib/roomTools.ts), in the ot.js arrangement: at most one operation in
// flight (`pending`), everything typed meanwhile waiting in `buffer`, and an
// operation from somebody else transformed past both before it touches the
// local text. Ties go to the server's order (see textOt.ts), which is what the
// server assumes when it rebases what this sends.
//
// Pure: it never sends anything itself. `send` is handed in, which is what
// lets textSync.test.mts run three of these against a simulated server.

export type TextSyncSend = (msg: { version: number; op: TextOp; opId: string }) => void;

let opCounter = 0;

export class TextSyncClient {
  text: string;
  version: number;
  pending: { opId: string; op: TextOp } | null = null;
  buffer: TextOp | null = null;

  private readonly send: TextSyncSend;

  constructor(text: string, version: number, send: TextSyncSend) {
    this.send = send;
    this.text = text;
    this.version = version;
  }

  /** Whether anything typed here has not been acknowledged yet. */
  get dirty(): boolean {
    return this.pending !== null || this.buffer !== null;
  }

  /** The local text became `next`. */
  edit(next: string): void {
    const op = diffText(this.text, next);
    if (op.length === 0) return;
    this.text = next;
    this.buffer = this.buffer ? [...this.buffer, ...op] : op;
    this.flush();
  }

  /**
   * An operation the server applied as `version`. Returns what changed in the
   * local text (to move a caret by), or null for our own acknowledgement and
   * "out of step" for a gap — the caller then asks for the whole text again.
   */
  receive(op: TextOp, version: number, opId: string | null): TextOp | null | "out of step" {
    if (this.pending && opId === this.pending.opId) {
      this.version = version;
      this.pending = null;
      this.flush();
      return null;
    }
    if (version !== this.version + 1) return "out of step";
    let incoming = op;
    if (this.pending) {
      const [pending, rest] = transform(this.pending.op, incoming, false);
      this.pending = { ...this.pending, op: pending };
      incoming = rest;
    }
    if (this.buffer) {
      const [buffer, rest] = transform(this.buffer, incoming, false);
      this.buffer = buffer;
      incoming = rest;
    }
    this.version = version;
    this.text = applyTextOp(this.text, incoming);
    return incoming;
  }

  /** Starts over from the server's text, dropping whatever was not acknowledged. */
  reset(text: string, version: number): void {
    this.text = text;
    this.version = version;
    this.pending = null;
    this.buffer = null;
  }

  private flush(): void {
    if (this.pending || !this.buffer) return;
    const opId = `${Date.now().toString(36)}-${++opCounter}`;
    this.pending = { opId, op: this.buffer };
    this.buffer = null;
    this.send({ version: this.version, op: this.pending.op, opId });
  }
}

/** The operation that turns `before` into `after`: one delete and one insert, at most. */
export function diffText(before: string, after: string): TextOp {
  if (before === after) return [];
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  const op: TextOp = [];
  if (endBefore > start) op.push({ t: "d", p: start, n: endBefore - start });
  if (endAfter > start) op.push({ t: "i", p: start, s: after.slice(start, endAfter) });
  return op;
}

/** Where a caret at `index` ends up after `op` — so somebody else typing does not move yours. */
export function transformIndex(op: TextOp, index: number): number {
  let pos = index;
  for (const prim of op) {
    if (prim.t === "i") {
      if (prim.p < pos) pos += prim.s.length;
    } else if (prim.p < pos) {
      pos -= Math.min(prim.n, pos - prim.p);
    }
  }
  return pos;
}
