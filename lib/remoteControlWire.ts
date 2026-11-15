// The wire format of "Controle remoto"'s data channels (see lib/remoteControl.ts):
// a few bytes per event, [version, type, ...], big-endian. Its own module so it
// can be tested without a room, a socket or React.

export const VERSION = 1;
export const T_MOVE = 1; // seq u16, x u16, y u16
export const T_BUTTON = 2; // button u8, down u8, x u16, y u16
export const T_WHEEL = 3; // dx i16, dy i16
export const T_KEY = 4; // down u8, length u8, code (ASCII)
export const T_PING = 5; // [stamp u32] — a ping with a stamp is answered with T_PONG
export const T_BYE = 6;
export const T_LOCAL = 7; // host -> controller: the person there moved the mouse
export const T_BLOCKED = 8; // host -> controller: why u8
export const T_READY = 9; // host -> controller: taking input
export const T_PONG = 10; // host -> controller: stamp u32, echoed from T_PING
export const T_CURSOR = 11; // host -> controller: shape u8 (CURSORS)
export const T_ZONE = 12; // host -> controller: zone u8 (ZONES)
// "Modo jogo": the mouse as *movement*, the way games read it, rather than as
// a place on the screen. Sent on the reliable channel — a lost delta is aim
// that drifts, unlike a lost position, which the next one replaces.
export const T_RELATIVE = 13; // dx i16, dy i16
export const T_BUTTON_HERE = 14; // button u8, down u8 — a click where the pointer already is
// Permissions (see the shell's consent window): what the person at the
// computer let through, and the clipboard when copying and pasting is one.
export const T_CLIPBOARD = 15; // either way: UTF-8 text, up to MAX_CLIPBOARD_BYTES
export const T_PERMS = 16; // host -> controller: bits u8 (PERM_*)

export const PERM_MOUSE = 1;
export const PERM_KEYBOARD = 2;
export const PERM_CLIPBOARD = 4;
/** Text copied across in one go, at most. Far under a data channel's message limit. */
export const MAX_CLIPBOARD_BYTES = 64 * 1024;

export interface RemoteControlPerms {
  mouse: boolean;
  keyboard: boolean;
  clipboard: boolean;
}

export function encodePerms(perms: RemoteControlPerms): ArrayBuffer {
  const bytes = new Uint8Array(3);
  bytes[0] = VERSION;
  bytes[1] = T_PERMS;
  bytes[2] = (perms.mouse ? PERM_MOUSE : 0) | (perms.keyboard ? PERM_KEYBOARD : 0) | (perms.clipboard ? PERM_CLIPBOARD : 0);
  return bytes.buffer;
}

/** Null when the text is too long to send — it is not cut, which would paste half of something. */
export function encodeClipboard(text: string): ArrayBuffer | null {
  const body = new TextEncoder().encode(text);
  if (body.byteLength > MAX_CLIPBOARD_BYTES) return null;
  const bytes = new Uint8Array(2 + body.byteLength);
  bytes[0] = VERSION;
  bytes[1] = T_CLIPBOARD;
  bytes.set(body, 2);
  return bytes.buffer;
}

// Every type above was added without a version bump on purpose: a side that
// does not know one decodes it as null and ignores it, and a stamp on a ping
// is extra bytes an older host never reads. Old and new apps keep working
// together, the new ones just learn more.

export const BLOCKED_WHY = ["golive", "covered", "elevated"] as const;
export type RemoteControlBlocked = (typeof BLOCKED_WHY)[number];

/** What is under the remote pointer: "ok", or why a click there is dropped. */
export const ZONES = ["ok", "golive", "covered", "elevated"] as const;
export type RemoteControlZone = (typeof ZONES)[number];

/**
 * The remote pointer's shapes, as CSS cursor names — the same list, in the
 * same order, as electron/channels.ts's REMOTE_CONTROL_CURSORS.
 */
export const CURSORS = [
  "default",
  "text",
  "pointer",
  "wait",
  "progress",
  "crosshair",
  "ew-resize",
  "ns-resize",
  "nwse-resize",
  "nesw-resize",
  "move",
  "not-allowed",
  "help",
  "none",
] as const;
export type RemoteControlCursor = (typeof CURSORS)[number];

export function encodePing(stamp: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(6));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_PING);
  view.setUint32(2, stamp >>> 0);
  return view.buffer;
}

export function encodePong(stamp: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(6));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_PONG);
  view.setUint32(2, stamp >>> 0);
  return view.buffer;
}

export function encodeMove(seq: number, x: number, y: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_MOVE);
  view.setUint16(2, seq & 0xffff);
  view.setUint16(4, x);
  view.setUint16(6, y);
  return view.buffer;
}

export function encodeButton(button: number, down: boolean, x: number, y: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_BUTTON);
  view.setUint8(2, button);
  view.setUint8(3, down ? 1 : 0);
  view.setUint16(4, x);
  view.setUint16(6, y);
  return view.buffer;
}

/** Largest movement one message carries; more is split across several. */
export const MAX_RELATIVE = 4000;

export function encodeRelative(dx: number, dy: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(6));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_RELATIVE);
  view.setInt16(2, Math.max(-MAX_RELATIVE, Math.min(MAX_RELATIVE, Math.round(dx))));
  view.setInt16(4, Math.max(-MAX_RELATIVE, Math.min(MAX_RELATIVE, Math.round(dy))));
  return view.buffer;
}

export function encodeButtonHere(button: number, down: boolean): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_BUTTON_HERE);
  view.setUint8(2, button);
  view.setUint8(3, down ? 1 : 0);
  return view.buffer;
}

export function encodeWheel(dx: number, dy: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(6));
  view.setUint8(0, VERSION);
  view.setUint8(1, T_WHEEL);
  view.setInt16(2, Math.max(-1200, Math.min(1200, Math.round(dx))));
  view.setInt16(4, Math.max(-1200, Math.min(1200, Math.round(dy))));
  return view.buffer;
}

export function encodeKey(code: string, down: boolean): ArrayBuffer | null {
  if (!/^[A-Za-z0-9]{1,32}$/.test(code)) return null;
  const bytes = new Uint8Array(4 + code.length);
  bytes[0] = VERSION;
  bytes[1] = T_KEY;
  bytes[2] = down ? 1 : 0;
  bytes[3] = code.length;
  for (let i = 0; i < code.length; i++) bytes[4 + i] = code.charCodeAt(i);
  return bytes.buffer;
}

export function encodeSimple(type: number, extra?: number): ArrayBuffer {
  const bytes = new Uint8Array(extra === undefined ? 2 : 3);
  bytes[0] = VERSION;
  bytes[1] = type;
  if (extra !== undefined) bytes[2] = extra;
  return bytes.buffer;
}

export type Decoded =
  | { t: "move"; seq: number; x: number; y: number }
  | { t: "button"; b: number; d: boolean; x: number; y: number }
  | { t: "relative"; dx: number; dy: number }
  | { t: "buttonHere"; b: number; d: boolean }
  | { t: "wheel"; dx: number; dy: number }
  | { t: "key"; c: string; d: boolean }
  | { t: "ping"; stamp: number | null }
  | { t: "pong"; stamp: number }
  | { t: "bye" }
  | { t: "local" }
  | { t: "blocked"; why: RemoteControlBlocked }
  | { t: "cursor"; shape: RemoteControlCursor }
  | { t: "zone"; zone: RemoteControlZone }
  | { t: "clipboard"; text: string }
  | { t: "perms"; perms: RemoteControlPerms }
  | { t: "ready" };

export function decode(data: unknown): Decoded | null {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 2) return null;
  // The clipboard is the one message that carries more than a few bytes.
  if (data.byteLength > 2 && new DataView(data).getUint8(1) === T_CLIPBOARD) {
    if (new DataView(data).getUint8(0) !== VERSION || data.byteLength > 2 + MAX_CLIPBOARD_BYTES) return null;
    try {
      return { t: "clipboard", text: new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data, 2)) };
    } catch {
      return null;
    }
  }
  if (data.byteLength > 64) return null;
  const view = new DataView(data);
  if (view.getUint8(0) !== VERSION) return null;
  switch (view.getUint8(1)) {
    case T_MOVE:
      return data.byteLength === 8
        ? { t: "move", seq: view.getUint16(2), x: view.getUint16(4), y: view.getUint16(6) }
        : null;
    case T_BUTTON: {
      if (data.byteLength !== 8) return null;
      const b = view.getUint8(2);
      return b > 4 ? null : { t: "button", b, d: view.getUint8(3) === 1, x: view.getUint16(4), y: view.getUint16(6) };
    }
    case T_WHEEL:
      return data.byteLength === 6 ? { t: "wheel", dx: view.getInt16(2), dy: view.getInt16(4) } : null;
    case T_RELATIVE: {
      if (data.byteLength !== 6) return null;
      const dx = view.getInt16(2);
      const dy = view.getInt16(4);
      return Math.abs(dx) <= MAX_RELATIVE && Math.abs(dy) <= MAX_RELATIVE ? { t: "relative", dx, dy } : null;
    }
    case T_BUTTON_HERE: {
      if (data.byteLength !== 4) return null;
      const b = view.getUint8(2);
      return b > 4 ? null : { t: "buttonHere", b, d: view.getUint8(3) === 1 };
    }
    case T_KEY: {
      const length = view.getUint8(3);
      if (length < 1 || length > 32 || data.byteLength !== 4 + length) return null;
      let code = "";
      for (let i = 0; i < length; i++) code += String.fromCharCode(view.getUint8(4 + i));
      return /^[A-Za-z0-9]+$/.test(code) ? { t: "key", c: code, d: view.getUint8(2) === 1 } : null;
    }
    case T_PING:
      return { t: "ping", stamp: data.byteLength === 6 ? view.getUint32(2) : null };
    case T_PONG:
      return data.byteLength === 6 ? { t: "pong", stamp: view.getUint32(2) } : null;
    case T_BYE:
      return { t: "bye" };
    case T_LOCAL:
      return { t: "local" };
    case T_BLOCKED: {
      const why = BLOCKED_WHY[data.byteLength === 3 ? view.getUint8(2) : -1];
      return why ? { t: "blocked", why } : null;
    }
    case T_CURSOR: {
      const shape = CURSORS[data.byteLength === 3 ? view.getUint8(2) : -1];
      return shape ? { t: "cursor", shape } : null;
    }
    case T_ZONE: {
      const zone = ZONES[data.byteLength === 3 ? view.getUint8(2) : -1];
      return zone ? { t: "zone", zone } : null;
    }
    case T_PERMS: {
      if (data.byteLength !== 3) return null;
      const bits = view.getUint8(2);
      return {
        t: "perms",
        perms: {
          mouse: (bits & PERM_MOUSE) !== 0,
          keyboard: (bits & PERM_KEYBOARD) !== 0,
          clipboard: (bits & PERM_CLIPBOARD) !== 0,
        },
      };
    }
    case T_READY:
      return { t: "ready" };
    default:
      return null;
  }
}

/** Whether a later sequence number is newer, across the u16 wrap. */
export function newer(seq: number, than: number): boolean {
  return ((seq - than) & 0xffff) < 0x8000 && seq !== than;
}
