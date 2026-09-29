// A system-wide *listening* hook for the shortcuts — keys and mouse buttons —
// in place of Electron's globalShortcut wherever it can be used.
//
// globalShortcut registers a hotkey with the OS, and a registered hotkey is
// *taken*: the OS delivers it to GoLive and to nobody else. Bind Ctrl+C and
// copying stops working everywhere; bind a letter and it stops typing. It also
// cannot see mouse buttons at all, and has no key-up (see main.ts's push to
// talk section for the workaround that costs).
//
// A low-level hook (libuiohook, through uiohook-napi) only listens. Every key
// and click still reaches whatever app it was meant for, so the person's own
// Windows shortcuts keep working, a mouse's side buttons can be bound, and
// push to talk gets a real release.
//
// Windows only for now. On macOS the hook needs the Accessibility permission,
// and on Linux it only works under X11; both keep using globalShortcut, as
// before, rather than prompting or silently failing. Anything the hook cannot
// represent (a key missing from the table below) also falls back to
// globalShortcut, combo by combo — see canHandle.

import path from "node:path";
import { app } from "electron";
import type { UiohookKeyboardEvent, UiohookMouseEvent } from "uiohook-napi";

type Hook = typeof import("uiohook-napi");

interface ParsedCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** A uiohook keycode, or a mouse button as the renderer numbers them. */
  key: { kind: "key"; code: number } | { kind: "mouse"; button: number };
}

let hookModule: Hook | null | undefined;

/**
 * Loaded lazily and forgivingly: a missing or broken native module must cost
 * the shortcuts their hook, never the app its start.
 */
function loadHook(): Hook | null {
  if (hookModule !== undefined) return hookModule;
  hookModule = null;
  if (process.platform !== "win32") return null;
  try {
    // Packaged, the module is copied next to the app as real files (a native
    // binary cannot load from inside app.asar) — see electron-builder.yml.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hookModule = app.isPackaged
      ? (require(path.join(process.resourcesPath, "node_modules", "uiohook-napi")) as Hook)
      : (require("uiohook-napi") as Hook);
  } catch (err) {
    console.error("[inputHook] Could not load uiohook-napi:", (err as Error).message);
  }
  return hookModule;
}

// ── Accelerator parsing ────────────────────────────────────────────────────

const NAMED_KEYS: Record<string, string> = {
  Space: "Space",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Escape: "Escape",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  CapsLock: "CapsLock",
  NumLock: "NumLock",
  ScrollLock: "ScrollLock",
  PrintScreen: "PrintScreen",
  ";": "Semicolon",
  ":": "Semicolon",
  "=": "Equal",
  "+": "Equal",
  ",": "Comma",
  "<": "Comma",
  "-": "Minus",
  _: "Minus",
  ".": "Period",
  ">": "Period",
  "/": "Slash",
  "?": "Slash",
  "`": "Backquote",
  "~": "Backquote",
  "[": "BracketLeft",
  "{": "BracketLeft",
  "\\": "Backslash",
  "|": "Backslash",
  "]": "BracketRight",
  "}": "BracketRight",
  "'": "Quote",
  '"': "Quote",
};

// What the top row types with Shift held on a US layout — the page records
// `e.key`, so Shift+1 arrives as "Shift+!".
const SHIFTED_DIGITS: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
};

function keycodeFor(hook: Hook, name: string): number | null {
  const table = hook.UiohookKey as Record<string, number>;
  const upper = name.length === 1 ? name.toUpperCase() : name;
  if (/^[A-Z0-9]$/.test(upper)) return table[upper] ?? null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(name)) return table[name] ?? null;
  if (SHIFTED_DIGITS[name]) return table[SHIFTED_DIGITS[name]] ?? null;
  const mapped = NAMED_KEYS[name];
  return mapped ? table[mapped] ?? null : null;
}

// The accelerator is split on "+", which is also a key ("Shift++" for the
// plus key). The last part is the key and may itself be "+".
function splitAccelerator(accelerator: string): string[] {
  if (accelerator.endsWith("++")) {
    return [...accelerator.slice(0, -2).split("+").filter(Boolean), "+"];
  }
  return accelerator.split("+").filter(Boolean);
}

function parse(hook: Hook, accelerator: string): ParsedCombo | null {
  const parts = splitAccelerator(accelerator);
  const last = parts.pop();
  if (!last) return null;
  const combo: ParsedCombo = {
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    key: { kind: "key", code: 0 },
  };
  for (const part of parts) {
    switch (part) {
      case "CommandOrControl":
      case "CmdOrCtrl":
      case "Control":
      case "Ctrl":
        combo.ctrl = true;
        break;
      case "Alt":
        combo.alt = true;
        break;
      case "Shift":
        combo.shift = true;
        break;
      case "Meta":
      case "Super":
      case "Command":
      case "Cmd":
        combo.meta = true;
        break;
      default:
        return null;
    }
  }
  const mouse = /^Mouse(\d+)$/i.exec(last);
  if (mouse) {
    combo.key = { kind: "mouse", button: Number(mouse[1]) };
    return combo;
  }
  const code = keycodeFor(hook, last);
  if (code === null) return null;
  combo.key = { kind: "key", code };
  return combo;
}

// libuiohook numbers left, right, middle, then the side buttons; the page
// (DOM MouseEvent.button + 1) numbers left, middle, right. Everything from 4
// up agrees.
function rendererButton(uiohookButton: number): number {
  if (uiohookButton === 2) return 3;
  if (uiohookButton === 3) return 2;
  return uiohookButton;
}

function modifiersMatch(
  combo: ParsedCombo,
  e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
): boolean {
  return (
    combo.ctrl === e.ctrlKey &&
    combo.alt === e.altKey &&
    combo.shift === e.shiftKey &&
    combo.meta === e.metaKey
  );
}

// ── The hook itself ────────────────────────────────────────────────────────

export interface InputHookCallbacks {
  /** An ordinary shortcut went down. */
  onAction(action: string): void;
  /** The push-to-talk combo went down (true) or came up (false). */
  onPushToTalk(held: boolean): void;
  /**
   * Whether GoLive's own window has focus. The page follows keys itself
   * while it does (and knows when not to, like while typing in the chat), so
   * the hook stays quiet then rather than firing every shortcut twice.
   */
  appFocused(): boolean;
}

export function createInputHook(callbacks: InputHookCallbacks) {
  let actions = new Map<string, ParsedCombo>();
  let ptt: ParsedCombo | null = null;
  let pttHeld = false;
  let running = false;
  // Keys and buttons currently down, so the OS's auto-repeat of a held key
  // fires a toggle once rather than a dozen times.
  const down = new Set<string>();

  function isDownEvent(id: string): boolean {
    if (down.has(id)) return false;
    down.add(id);
    return true;
  }

  function setPtt(held: boolean) {
    if (pttHeld === held) return;
    pttHeld = held;
    callbacks.onPushToTalk(held);
  }

  function pressed(kind: "key" | "mouse", value: number, e: UiohookKeyboardEvent | UiohookMouseEvent) {
    const id = `${kind}:${value}`;
    if (!isDownEvent(id)) return;
    const matches = (combo: ParsedCombo) =>
      (combo.key.kind === "key" ? kind === "key" && combo.key.code === value : kind === "mouse" && combo.key.button === value) &&
      modifiersMatch(combo, e);
    if (ptt && matches(ptt)) setPtt(true);
    if (callbacks.appFocused()) return;
    for (const [action, combo] of actions) {
      if (matches(combo)) callbacks.onAction(action);
    }
  }

  function released(kind: "key" | "mouse", value: number) {
    down.delete(`${kind}:${value}`);
    if (!ptt || !pttHeld) return;
    const main = ptt.key.kind === "key" ? kind === "key" && ptt.key.code === value : kind === "mouse" && ptt.key.button === value;
    // A modifier of the combo coming up ends it too — otherwise letting go
    // of Ctrl first would leave a press that never closes.
    if (main || (kind === "key" && isModifierOf(ptt, value))) setPtt(false);
  }

  function isModifierOf(combo: ParsedCombo, code: number): boolean {
    const k = loadHook()!.UiohookKey;
    return (
      (combo.ctrl && (code === k.Ctrl || code === k.CtrlRight)) ||
      (combo.alt && (code === k.Alt || code === k.AltRight)) ||
      (combo.shift && (code === k.Shift || code === k.ShiftRight)) ||
      (combo.meta && (code === k.Meta || code === k.MetaRight))
    );
  }

  const onKeyDown = (e: UiohookKeyboardEvent) => pressed("key", e.keycode, e);
  const onKeyUp = (e: UiohookKeyboardEvent) => released("key", e.keycode);
  const onMouseDown = (e: UiohookMouseEvent) => pressed("mouse", rendererButton(Number(e.button)), e);
  const onMouseUp = (e: UiohookMouseEvent) => released("mouse", rendererButton(Number(e.button)));

  // Running only while something is bound: a low-level mouse hook sits in
  // the path of every mouse movement on the machine, and there is no reason
  // to be there for somebody who never set a shortcut.
  function refresh() {
    const hook = loadHook();
    if (!hook) return;
    const wanted = actions.size > 0 || ptt !== null;
    if (wanted === running) return;
    const { uIOhook } = hook;
    try {
      if (wanted) {
        uIOhook.on("keydown", onKeyDown);
        uIOhook.on("keyup", onKeyUp);
        uIOhook.on("mousedown", onMouseDown);
        uIOhook.on("mouseup", onMouseUp);
        uIOhook.start();
      } else {
        uIOhook.stop();
        uIOhook.removeListener("keydown", onKeyDown);
        uIOhook.removeListener("keyup", onKeyUp);
        uIOhook.removeListener("mousedown", onMouseDown);
        uIOhook.removeListener("mouseup", onMouseUp);
        down.clear();
      }
      running = wanted;
    } catch (err) {
      console.error("[inputHook] Failed to toggle the hook:", (err as Error).message);
    }
  }

  return {
    /** Whether this accelerator can be followed by the hook on this machine. */
    canHandle(accelerator: string): boolean {
      const hook = loadHook();
      return Boolean(hook && accelerator && parse(hook, accelerator));
    },
    /** The ordinary shortcuts the hook follows; everything else is replaced. */
    setActions(next: Record<string, string>) {
      const hook = loadHook();
      actions = new Map();
      if (hook) {
        for (const [action, accelerator] of Object.entries(next)) {
          const combo = accelerator ? parse(hook, accelerator) : null;
          if (combo) actions.set(action, combo);
        }
      }
      refresh();
    },
    setPushToTalk(accelerator: string) {
      const hook = loadHook();
      setPtt(false);
      ptt = hook && accelerator ? parse(hook, accelerator) : null;
      refresh();
    },
    stop() {
      setPtt(false);
      actions = new Map();
      ptt = null;
      refresh();
    },
  };
}
