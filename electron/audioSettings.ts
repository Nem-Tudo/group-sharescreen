// What the screen picker's audio controls decide, remembered between shares.
//
// These live in the shell rather than on the website, and that is not an
// accident of where the picker happens to be drawn. The mute list names
// *executables on this machine* — "discord.exe", "spotify.exe" — which is
// information about the person using the computer, not about the room they
// are in. The site never needs it, so it never sees it: the whole feature,
// from the checkbox to the process ids the capture runs against, stays on
// this side of the bridge.
//
// A JSON file in userData rather than a dependency on electron-store: this is
// two fields, and a corrupt or missing file simply means the defaults.

import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface SystemAudioSettings {
  /** Whether a screen share carries system audio at all. */
  enabled: boolean;
  /**
   * Executable file names, lower-cased ("discord.exe"), whose audio is left
   * out of the share.
   *
   * Names and not process ids, because this outlives the processes it talks
   * about: the setting has to still mean "Discord" tomorrow, after Discord
   * has been restarted and has a different pid.
   *
   * GoLive itself is *not* in here, on any machine. Its exclusion is
   * structural rather than a preference — sharing our own output puts the
   * room's voices back into the room — so it is applied by the capture
   * regardless of what this file says, and the picker shows it as a row that
   * cannot be switched off. Storing it would only create a way for it to go
   * missing.
   *
   * Nothing else starts out in here either. The picker lists the applications
   * that are open and the person ticks the ones they do not want heard;
   * shipping a guess — Discord is the obvious candidate — would silence
   * something the user never asked to have silenced, and they would have no
   * reason to go looking for the setting that did it.
   */
  mutedApps: string[];
}

const SETTINGS_FILE = "system-audio.json";

// Read once and kept, because the display-media handler asks for it in the
// middle of starting a share. Written through on every change, so the answer
// here and the file on disk cannot disagree.
let cached: SystemAudioSettings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

/**
 * Lower-cased, de-duplicated, and free of anything that isn't a file name.
 *
 * Shared with the hidden-window list (see videoSettings.ts): both are lists
 * of executables on this machine, written by the same picker, and a second
 * copy of this would be a second set of rules for what counts as one.
 */
export function normalizeAppKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    // A bare file name is the whole contract — a path here would silently
    // never match, since that is not what the capture compares against.
    const name = path.basename(entry.trim()).toLowerCase();
    if (name.length > 0 && name.length <= 260) seen.add(name);
  }
  return [...seen];
}

export function getSystemAudioSettings(): SystemAudioSettings {
  if (cached) return cached;
  let stored: unknown = null;
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    // No file yet (the overwhelmingly common case), or one that got
    // truncated. Either way the defaults are the answer.
  }
  const record = (stored ?? {}) as Record<string, unknown>;
  cached = {
    // Anything but an explicit false means on: a file written by an older
    // build has no such field, and system audio was always on then.
    enabled: record.enabled !== false,
    mutedApps: normalizeAppKeys(record.mutedApps),
  };
  return cached;
}

export function saveSystemAudioSettings(settings: SystemAudioSettings): SystemAudioSettings {
  const next: SystemAudioSettings = {
    enabled: settings.enabled !== false,
    mutedApps: normalizeAppKeys(settings.mutedApps),
  };
  cached = next;
  try {
    writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // A read-only or full disk. The setting still applies to this session —
    // losing it on restart is a much smaller failure than refusing the share
    // the user just configured.
  }
  return next;
}

/**
 * The executable this app runs as, lower-cased — "golive.exe" in a packaged
 * build, "electron.exe" from a checkout.
 *
 * Every process GoLive spawns runs the same binary (Chromium renders audio in
 * a child utility process, not in the renderer), so this one name identifies
 * the whole tree, in development as well as in a release.
 */
export function ownAppKey(): string {
  return path.basename(process.execPath).toLowerCase();
}
