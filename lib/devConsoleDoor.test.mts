// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/devConsoleDoor.test.mts
//
// The development console door in signalingClient.ts must never touch
// `window.golive`. That global is the shell bridge (Electron preload, Android
// Capacitor), and isDesktopApp() reads its mere presence as "we are the app".
// So under `next dev` an ordinary browser has to stay a browser.
import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "development";
// Just enough of a window for the module bodies that run on import.
const fakeWindow = new EventTarget() as EventTarget & Record<string, unknown>;
fakeWindow.location = new URL("http://localhost:3000/");
(globalThis as { window?: unknown }).window = fakeWindow;

test("dev door lives on its own global, not the shell bridge", async () => {
  // Dynamic, so the module body runs after the globals above are in place.
  await import("./signalingClient");
  const { isDesktopApp } = await import("./desktop");

  assert.equal(fakeWindow.golive, undefined, "window.golive must stay unset in a browser");
  assert.equal(isDesktopApp(), false, "a browser under next dev must not read as the desktop app");

  const door = fakeWindow.__goliveDev as { signaling?: unknown; adGate?: unknown } | undefined;
  assert.ok(door?.signaling, "the console door is still there");
  assert.equal(typeof door?.adGate, "function");
});
