import assert from "node:assert/strict";
import {
  SHORTCUT_DEFINITIONS,
  DEFAULT_SHORTCUTS,
  eventToShortcutString,
  shortcutToElectronAccelerator,
  matchesShortcut,
  isNativeBrowserShortcut,
  type ShortcutAction,
} from "./keyboardShortcuts";

// 1. All 7 actions must exist in DEFAULT_SHORTCUTS and be empty strings by default
const expectedActions: ShortcutAction[] = [
  "toggleDeafen",
  "toggleMute",
  "toggleScreenShare",
  "toggleCamera",
  "toggleMusicPlay",
  "nextMusic",
  "previousMusic",
];

assert.equal(Object.keys(DEFAULT_SHORTCUTS).length, 7);
for (const action of expectedActions) {
  assert.equal(DEFAULT_SHORTCUTS[action], "", `Default shortcut for ${action} must be empty`);
}

// 2. All 7 actions must have definitions with id, label, description, and category
assert.equal(SHORTCUT_DEFINITIONS.length, 7);
for (const def of SHORTCUT_DEFINITIONS) {
  assert.ok(expectedActions.includes(def.id));
  assert.ok(def.label.length > 0);
  assert.ok(def.description.length > 0);
  assert.ok(["audio", "video", "music"].includes(def.category));
  if (def.category === "audio") {
    assert.equal(def.appOnly, false, "Audio shortcuts must be available on web & app");
  } else {
    assert.equal(def.appOnly, true, "Video and music shortcuts must be app-only");
  }
}

// 3. eventToShortcutString should ignore bare modifiers
assert.equal(eventToShortcutString({ key: "Control", ctrlKey: true } as KeyboardEvent), null);
assert.equal(eventToShortcutString({ key: "Shift", shiftKey: true } as KeyboardEvent), null);
assert.equal(eventToShortcutString({ key: "Alt", altKey: true } as KeyboardEvent), null);
assert.equal(eventToShortcutString({ key: "Meta", metaKey: true } as KeyboardEvent), null);

// 4. eventToShortcutString handles combos
assert.equal(
  eventToShortcutString({ key: "m", ctrlKey: true, shiftKey: true } as KeyboardEvent),
  "Ctrl+Shift+M"
);
assert.equal(
  eventToShortcutString({ key: "F9" } as KeyboardEvent),
  "F9"
);
assert.equal(
  eventToShortcutString({ key: " ", ctrlKey: true } as KeyboardEvent),
  "Ctrl+Espaço"
);
assert.equal(
  eventToShortcutString({ key: "ArrowRight", altKey: true } as KeyboardEvent),
  "Alt+Seta Direita"
);

// 5. shortcutToElectronAccelerator conversion
assert.equal(
  shortcutToElectronAccelerator("Ctrl+Shift+M"),
  "CommandOrControl+Shift+M"
);
assert.equal(
  shortcutToElectronAccelerator("Ctrl+Espaço"),
  "CommandOrControl+Space"
);
assert.equal(
  shortcutToElectronAccelerator("Alt+Seta Direita"),
  "Alt+Right"
);
assert.equal(
  shortcutToElectronAccelerator(""),
  ""
);

// 6. matchesShortcut
assert.ok(
  matchesShortcut({ key: "m", ctrlKey: true, shiftKey: true } as KeyboardEvent, "Ctrl+Shift+M")
);
assert.ok(
  matchesShortcut({ key: "M", ctrlKey: true, shiftKey: true } as KeyboardEvent, "ctrl+shift+m")
);
assert.ok(!matchesShortcut({ key: "m", ctrlKey: true } as KeyboardEvent, "Ctrl+Shift+M"));

// 7. isNativeBrowserShortcut preserves native clipboard / editing actions
assert.ok(
  isNativeBrowserShortcut({ key: "c", ctrlKey: true } as KeyboardEvent),
  "Ctrl+C must be recognized as native"
);
assert.ok(
  isNativeBrowserShortcut({ key: "v", ctrlKey: true } as KeyboardEvent),
  "Ctrl+V must be recognized as native"
);
assert.ok(
  isNativeBrowserShortcut({ key: "x", ctrlKey: true } as KeyboardEvent),
  "Ctrl+X must be recognized as native"
);
assert.ok(
  isNativeBrowserShortcut({ key: "z", ctrlKey: true } as KeyboardEvent),
  "Ctrl+Z must be recognized as native"
);
assert.ok(
  !isNativeBrowserShortcut({ key: "F9" } as KeyboardEvent),
  "F9 is not a clipboard shortcut"
);

console.log("keyboardShortcuts: ok");

