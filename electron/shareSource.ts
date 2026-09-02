// Which screen or window the last share was of, remembered between shares.
//
// The audio half of the picker already persisted (see audioSettings.ts); this
// is the other half, and it exists for one reason: the global "start sharing"
// shortcut. Pressed from inside a game, that shortcut opened a picker the
// person then had to alt-tab to and click — which is most of the value of
// having a shortcut at all, spent on getting to the window it opened.
//
// Same storage shape and the same reasoning as audioSettings: a JSON file in
// userData, defaults on anything missing or corrupt, and it never crosses the
// bridge to the website. What monitor somebody shares is a fact about their
// machine, not about the room.

import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface SavedShareSource {
  /**
   * Electron's own source id, e.g. "screen:0:0" or "window:65790:0".
   *
   * Tried first and trusted least. A display's id survives a restart on every
   * platform worth caring about; a window's is built from the OS window
   * handle, which is a fresh number every time the application launches. So
   * this is the fast path and `name` below is what actually carries a window
   * across sessions.
   */
  id: string;
  /**
   * The title the picker showed. What a window is matched on once its id has
   * gone stale — imperfect (two Chrome windows can read the same, and a
   * window whose title changed is a miss) and still far better than the
   * alternative, which is the picker opening every single time.
   */
  name: string;
  kind: "screen" | "window";
}

let cached: SavedShareSource | null | undefined;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "share-source.json");
}

export function getSavedShareSource(): SavedShareSource | null {
  if (cached !== undefined) return cached;
  let stored: unknown = null;
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    // No file yet, or a truncated one. Nothing saved is a perfectly good
    // answer — it just means the picker opens, which is what always happened.
  }
  const record = (stored ?? {}) as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  const kind = record.kind === "window" ? "window" : "screen";
  // An id is the minimum: without one there is nothing to try first, and a
  // name alone would match by title against a list this has never seen.
  cached = id ? { id, name, kind } : null;
  return cached;
}

export function saveShareSource(source: SavedShareSource): void {
  cached = source;
  try {
    writeFileSync(settingsPath(), JSON.stringify(source), "utf8");
  } catch {
    // A read-only or full userData directory. The share still happens; only
    // the memory of it is lost, and the picker opens next time — which is
    // exactly the old behaviour rather than a new failure.
  }
}
