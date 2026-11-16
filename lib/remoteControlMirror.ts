// "Controle remoto" as moderators see it: the controlled computer tells the
// admin's room viewer what it is being made to do, so a moderator watching the
// shared screen sees the other person's pointer, clicks and shortcuts drawn
// over it (sharescreen-admin's RemoteControlMirror).
//
// Sent through the server for the whole session, batched every BATCH_MS, and
// dropped there when no moderator asked for it. Never told whether one did:
// that would tell the person being controlled a moderator walked in. Never
// the text typed: a key that writes a character goes out as "•", unless Ctrl,
// Alt or the Windows key is held (a shortcut, not a letter of a password).
// Clipboard text never goes, only its size.
//
// Entries are short arrays, the first item the kind:
//   ["s", seconds, kind, perms, cursor, zone, paused]  the session so far (on start)
//   ["m", x, y]                pointer at x, y (0..65535 across the shared picture)
//   ["b", button, down, x, y]  a button, where it was pressed
//   ["c", button, down]        a button where the pointer is ("modo jogo")
//   ["d", dx, dy]              relative movement ("modo jogo"), summed per batch
//   ["w", dx, dy]              wheel, summed per batch
//   ["k", code, down]          a key (KeyboardEvent.code) or "•"
//   ["cur", shape] ["z", zone] ["p", perms] ["pause", 0|1] ["blk", why] ["loc"]
//   ["clip", "in"|"out", chars]

import type { RemoteControlInputEvent } from "./desktop";

export type MirrorEntry = (string | number)[];

export const MIRROR_BATCH_MS = 100;
/** Under the server's 64 per message. */
const MAX_BATCH = 48;

const MODIFIERS = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

/** Keys that write a character — what is typed, as opposed to pressed. */
const CHARACTER =
  /^(Key[A-Z]|Digit\d|Numpad\d|NumpadDecimal|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen|Space)$/;

export function permsBits(perms: { mouse: boolean; keyboard: boolean; clipboard: boolean }): number {
  return (perms.mouse ? 1 : 0) | (perms.keyboard ? 2 : 0) | (perms.clipboard ? 4 : 0);
}

/**
 * What of a key goes out: modifiers both ways (the admin builds combos from
 * them), anything else only when pressed, and a character as "•" unless a
 * shortcut modifier is held.
 */
export function mirrorKey(code: string, down: boolean, held: Set<string>): MirrorEntry | null {
  if (MODIFIERS.has(code)) {
    if (down) held.add(code);
    else held.delete(code);
    return ["k", code, down ? 1 : 0];
  }
  if (!down) return null;
  if (CHARACTER.test(code)) {
    const shortcut = [...held].some((c) => !c.startsWith("Shift"));
    return ["k", shortcut ? code : "•", 1];
  }
  return ["k", code, 1];
}

export class RemoteControlMirror {
  private on = false;
  private queue: MirrorEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = new Set<string>();
  private readonly send: (entries: MirrorEntry[]) => void;

  constructor(send: (entries: MirrorEntry[]) => void) {
    this.send = send;
  }

  get watching(): boolean {
    return this.on;
  }

  /** On for a session (off between them); `snapshot` is told first when it turns on. */
  setWatching(on: boolean, snapshot: MirrorEntry | null) {
    if (this.on === on) return;
    this.on = on;
    if (!on) {
      this.queue.length = 0;
      this.clearTimer();
      return;
    }
    if (snapshot) this.push(snapshot);
  }

  /** A batch of input as it goes to the helper. */
  input(event: RemoteControlInputEvent) {
    if (!this.on) {
      // Modifiers are still followed, so a shortcut held as watching starts reads right.
      if (event.t === "k") mirrorKey(event.c, event.d, this.held);
      return;
    }
    switch (event.t) {
      case "m":
        this.push(["m", event.x, event.y]);
        return;
      case "b":
        this.push(["b", event.b, event.d ? 1 : 0, event.x, event.y]);
        return;
      case "c":
        this.push(["c", event.b, event.d ? 1 : 0]);
        return;
      case "d":
        this.push(["d", event.dx, event.dy]);
        return;
      case "w":
        this.push(["w", event.dx, event.dy]);
        return;
      case "k": {
        const entry = mirrorKey(event.c, event.d, this.held);
        if (entry) this.push(entry);
        return;
      }
    }
  }

  /** Anything else worth telling (cursor, zone, perms, pause...). */
  note(entry: MirrorEntry) {
    if (this.on) this.push(entry);
  }

  /** The session ended: forget the keys held and anything unsent. */
  reset() {
    this.held.clear();
    this.queue.length = 0;
    this.clearTimer();
    this.on = false;
  }

  private push(entry: MirrorEntry) {
    const last = this.queue[this.queue.length - 1];
    const kind = entry[0];
    if (last && last[0] === kind) {
      // "The person there is moving their mouse" says nothing new twice in a row.
      if (kind === "loc") return;
      // Only the newest position matters; movement and wheel add up.
      if (kind === "m") {
        this.queue[this.queue.length - 1] = entry;
        return;
      }
      if (kind === "d" || kind === "w") {
        last[1] = clamp((last[1] as number) + (entry[1] as number));
        last[2] = clamp((last[2] as number) + (entry[2] as number));
        return;
      }
    }
    this.queue.push(entry);
    if (this.queue.length >= MAX_BATCH) {
      this.flush();
      return;
    }
    if (!this.timer) this.timer = setTimeout(() => this.flush(), MIRROR_BATCH_MS);
  }

  private flush() {
    this.clearTimer();
    if (!this.on || this.queue.length === 0) return;
    this.send(this.queue.splice(0));
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function clamp(value: number): number {
  return Math.max(-30000, Math.min(30000, Math.round(value)));
}
