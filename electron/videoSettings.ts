// Which applications are kept out of the *picture* of a screen share,
// remembered between shares — the video counterpart of audioSettings.ts, and
// stored the same way and for the same reasons (see the header there: this
// names executables on this machine, which is information about the person
// rather than about the room, so it never crosses the bridge to the website).
//
// Kept in its own file and its own JSON rather than added as a third field to
// system-audio.json, because the two settings fail apart: a build that ships
// the video helper and not the audio one, or the other way round, should not
// be able to lose the other's list while rewriting its own.

import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAppKeys } from "./audioSettings";

export interface HiddenWindowSettings {
  /**
   * Lower-cased executable file names ("whatsapp.exe") whose windows are
   * painted over in a screen share.
   *
   * Names rather than window handles, for the same reason the mute list is:
   * this outlives what it talks about. A handle is a number that means a
   * different window tomorrow — or nothing at all — and "hide WhatsApp" has
   * to still mean WhatsApp after WhatsApp has been restarted.
   *
   * Starts empty on every machine and stays empty until somebody ticks
   * something. There is no sensible guess to ship: a black rectangle nobody
   * asked for, over a program they were happily sharing, is the kind of
   * thing people report as the share being broken.
   */
  hiddenApps: string[];
}

const SETTINGS_FILE = "hidden-windows.json";

// Read once and kept, because the answer is needed in the middle of starting
// a capture. Written through on every change, so this and the file cannot
// disagree.
let cached: HiddenWindowSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

export function getHiddenWindowSettings(): HiddenWindowSettings {
  if (cached) return cached;
  let stored: unknown = null;
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    // No file yet, which is the overwhelmingly common case.
  }
  const record = (stored ?? {}) as Record<string, unknown>;
  cached = { hiddenApps: normalizeAppKeys(record.hiddenApps) };
  return cached;
}

export function saveHiddenWindowSettings(settings: HiddenWindowSettings): HiddenWindowSettings {
  const next: HiddenWindowSettings = { hiddenApps: normalizeAppKeys(settings.hiddenApps) };
  cached = next;
  try {
    writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // Read-only or full disk. The setting still applies to this session, and
    // losing it on restart is a far smaller failure than refusing the share.
  }
  return next;
}
