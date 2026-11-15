// KeyboardEvent.code -> Windows scan code (set 1), for remote control.
//
// Keys travel as *physical* keys, the way AnyDesk and RDP send them: the
// person controlling presses the key in the position of "A", and what that
// types is decided by this computer's keyboard layout, not theirs. That is
// the only behaviour that works for shortcuts (Ctrl+Z is the same key on
// every layout) and for games, and it means no text ever has to be
// translated between layouts.
//
// The table is closed on purpose. A code that is not here never reaches
// golive-input — whatever the page sends.

/** [scan code, extended (E0 prefix)] */
type ScanCode = readonly [number, 0 | 1];

const TABLE: Record<string, ScanCode> = {
  Escape: [0x01, 0],
  Digit1: [0x02, 0],
  Digit2: [0x03, 0],
  Digit3: [0x04, 0],
  Digit4: [0x05, 0],
  Digit5: [0x06, 0],
  Digit6: [0x07, 0],
  Digit7: [0x08, 0],
  Digit8: [0x09, 0],
  Digit9: [0x0a, 0],
  Digit0: [0x0b, 0],
  Minus: [0x0c, 0],
  Equal: [0x0d, 0],
  Backspace: [0x0e, 0],
  Tab: [0x0f, 0],
  KeyQ: [0x10, 0],
  KeyW: [0x11, 0],
  KeyE: [0x12, 0],
  KeyR: [0x13, 0],
  KeyT: [0x14, 0],
  KeyY: [0x15, 0],
  KeyU: [0x16, 0],
  KeyI: [0x17, 0],
  KeyO: [0x18, 0],
  KeyP: [0x19, 0],
  BracketLeft: [0x1a, 0],
  BracketRight: [0x1b, 0],
  Enter: [0x1c, 0],
  ControlLeft: [0x1d, 0],
  KeyA: [0x1e, 0],
  KeyS: [0x1f, 0],
  KeyD: [0x20, 0],
  KeyF: [0x21, 0],
  KeyG: [0x22, 0],
  KeyH: [0x23, 0],
  KeyJ: [0x24, 0],
  KeyK: [0x25, 0],
  KeyL: [0x26, 0],
  Semicolon: [0x27, 0],
  Quote: [0x28, 0],
  Backquote: [0x29, 0],
  ShiftLeft: [0x2a, 0],
  Backslash: [0x2b, 0],
  KeyZ: [0x2c, 0],
  KeyX: [0x2d, 0],
  KeyC: [0x2e, 0],
  KeyV: [0x2f, 0],
  KeyB: [0x30, 0],
  KeyN: [0x31, 0],
  KeyM: [0x32, 0],
  Comma: [0x33, 0],
  Period: [0x34, 0],
  Slash: [0x35, 0],
  ShiftRight: [0x36, 0],
  NumpadMultiply: [0x37, 0],
  AltLeft: [0x38, 0],
  Space: [0x39, 0],
  CapsLock: [0x3a, 0],
  F1: [0x3b, 0],
  F2: [0x3c, 0],
  F3: [0x3d, 0],
  F4: [0x3e, 0],
  F5: [0x3f, 0],
  F6: [0x40, 0],
  F7: [0x41, 0],
  F8: [0x42, 0],
  F9: [0x43, 0],
  F10: [0x44, 0],
  NumLock: [0x45, 0],
  ScrollLock: [0x46, 0],
  Numpad7: [0x47, 0],
  Numpad8: [0x48, 0],
  Numpad9: [0x49, 0],
  NumpadSubtract: [0x4a, 0],
  Numpad4: [0x4b, 0],
  Numpad5: [0x4c, 0],
  Numpad6: [0x4d, 0],
  NumpadAdd: [0x4e, 0],
  Numpad1: [0x4f, 0],
  Numpad2: [0x50, 0],
  Numpad3: [0x51, 0],
  Numpad0: [0x52, 0],
  NumpadDecimal: [0x53, 0],
  // The extra key left of Z on ABNT2 and ISO keyboards ("\\" / "<").
  IntlBackslash: [0x56, 0],
  F11: [0x57, 0],
  F12: [0x58, 0],
  // ABNT2's "/?" key, right of the right Shift's neighbour.
  IntlRo: [0x73, 0],
  // ABNT2's numpad "." next to the comma one.
  NumpadComma: [0x7e, 0],
  NumpadEnter: [0x1c, 1],
  ControlRight: [0x1d, 1],
  NumpadDivide: [0x35, 1],
  PrintScreen: [0x37, 1],
  AltRight: [0x38, 1],
  Home: [0x47, 1],
  ArrowUp: [0x48, 1],
  PageUp: [0x49, 1],
  ArrowLeft: [0x4b, 1],
  ArrowRight: [0x4d, 1],
  End: [0x4f, 1],
  ArrowDown: [0x50, 1],
  PageDown: [0x51, 1],
  Insert: [0x52, 1],
  Delete: [0x53, 1],
  MetaLeft: [0x5b, 1],
  MetaRight: [0x5c, 1],
  ContextMenu: [0x5d, 1],
};

export function scanCodeFor(code: string): ScanCode | null {
  return Object.prototype.hasOwnProperty.call(TABLE, code) ? TABLE[code] : null;
}

// The other way round, for the keys golive-input grabs on the controlling
// computer (see its --grab-keys): they come out as scan codes and go to the
// page as the KeyboardEvent.code it would have seen. NumpadEnter and Enter
// share a scan code apart from the E0 prefix, which is part of the key here.
const BY_SCAN = new Map<number, string>();
for (const [code, [scan, extended]] of Object.entries(TABLE)) {
  const key = scan | (extended << 8);
  if (!BY_SCAN.has(key)) BY_SCAN.set(key, code);
}

export function codeForScanCode(scan: number, extended: boolean): string | null {
  return BY_SCAN.get((scan & 0xff) | (extended ? 0x100 : 0)) ?? null;
}
