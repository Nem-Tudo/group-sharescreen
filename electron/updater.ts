// Keeps the *shell* current.
//
// Worth being precise about what this does and does not cover, because the
// wrapper architecture splits it in two:
//
//   - The website — every screen, all the WebRTC, the mesh/cascade — is
//     loaded live from golive.nemtudo.me, so a deploy reaches users on their
//     next launch with nothing to install and nothing here involved.
//   - This file covers the other half: main.ts, the preloads, the picker.
//     That code ships inside the executable, so changing it means a new
//     installer, and without an updater users would sit on whatever build
//     they first downloaded forever.
//
// Feed comes from the same GitHub release the /download route reads (see
// electron-builder.yml's publish block) — electron-builder writes the
// `latest.yml` manifest alongside the installers, which is what
// electron-updater polls.
//
// Downloading is the easy half. *Applying* the update is where this goes
// wrong on other people's machines, and a good part of this file exists
// entirely for that — see "When the install does not take" below.

import { app, ipcMain, BrowserWindow, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IPC } from "./channels";
import { stopSystemAudioCapture } from "./systemAudio";

// First check is delayed rather than immediate: launch is already busy
// creating the window and loading the site, and an update that lands four
// minutes late costs nobody anything.
const FIRST_CHECK_DELAY_MS = 45_000;
// Long-running sessions are the norm for this app — a call left open all
// afternoon — so re-checking matters, but rarely.
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

// The version sitting downloaded on disk, or null while there is nothing to
// apply. Kept here rather than only announced, because the announcement is
// unreliable by nature: the renderer is a remote website that reloads on
// every navigation, and the download typically lands long before or long
// after any given page exists. See IPC.updatePending.
let pendingVersion: string | null = null;

// Timestamp of the last check, so an on-demand one can be throttled. The
// scheduled polls don't need this — they are hours apart — but the
// admin-triggered path is driven by a remote page that reloads on every
// navigation, and a run of reloads right after a broadcast would otherwise
// mean a run of GitHub requests from the same machine.
let lastCheckAt = 0;
const MIN_CHECK_GAP_MS = 60_000;

// Where /download lives, so a machine that cannot install by itself can hand
// the person the installer instead. Passed in rather than re-derived from
// GOLIVE_APP_URL here: main.ts already resolves that, and two copies of one
// default origin is exactly the sort of thing that drifts apart.
let downloadUrl = "";

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
//
// Every failure path in this file used to be a silent `catch {}`, on the
// reasoning that a failed update is not something the user did or can fix.
// That is still true of a failed *check* — and completely wrong for a failed
// *install*, because "the update never applies" is then indistinguishable
// from "there was no update", on a machine that is not the developer's and
// cannot be attached to a debugger. So the whole thing writes to a file that
// can be asked for.

// Truncation rather than rotation into a .1 file: this log exists to be
// pasted into a bug report, and one file that is always the recent past is
// easier to ask someone for than two.
const LOG_MAX_BYTES = 256 * 1024;

let logPath = "";

function log(level: string, message: string) {
  if (!logPath) return;
  try {
    if (statSync(logPath).size > LOG_MAX_BYTES) writeFileSync(logPath, "");
  } catch {
    // No file yet, which is the ordinary first-write case.
  }
  try {
    appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${message}\n`);
  } catch {
    // A log that cannot be written must never be the reason the app breaks.
  }
}

// The shape electron-updater expects of `autoUpdater.logger`. Handing it this
// rather than leaving the default `console` matters for the same reason as
// above: a packaged Windows app has no console attached, so everything the
// updater already says about what it is doing goes nowhere.
const fileLogger = {
  info: (message?: unknown) => log("info", String(message)),
  warn: (message?: unknown) => log("warn", String(message)),
  error: (message?: unknown) => log("error", String(message)),
  debug: (message?: unknown) => log("debug", String(message)),
};

// ---------------------------------------------------------------------------
// When the install does not take
// ---------------------------------------------------------------------------
//
// `quitAndInstall` is fire-and-forget by construction: electron-updater
// spawns the NSIS installer *detached*, treats it as done the moment the
// process has a pid, and quits the app. Whether the installer then succeeded
// is something nobody ever learns. Several ordinary situations make it fail
// after that point, all of them invisible:
//
//   - The app was installed for all users. `oneClick: false` with
//     `perMachine: false` means the assisted installer *offers the choice*,
//     so some people are in `C:\Program Files\GoLive`, where a write needs
//     elevation. electron-updater only reaches for elevate.exe when the
//     build declares `perMachine: true`, which this one does not, so the
//     installer is spawned unelevated and aborts.
//   - The build is unsigned (no WIN_CSC_LINK in CI). Windows 11's Smart App
//     Control blocks unsigned executables outright and without a prompt;
//     Windows 10 has no such thing, which is one way this reproduces on one
//     machine and not another.
//   - A file the installer must replace is still locked — most plausibly
//     resources/golive-audiocap.exe, which is a *separate* process the
//     installer does not know to wait for.
//
// The symptom is identical in all three: press the button, the app comes
// back on the old version, and the same update is offered again forever.
//
// So the outcome of an attempt is recorded before quitting and judged on the
// next launch — if we are not running the version we tried to install, it
// did not work — and each failure escalates: silent, then the visible
// installer (which can prompt for UAC and can be clicked through), then hand
// the person the download page and stop pretending.
const STATE_FILE = "update-install.json";
const MAX_ATTEMPTS = 3;

interface InstallState {
  /** How many consecutive attempts have been observed not to take effect. */
  failures: number;
  /** The version an attempt was made for, while its outcome is unknown. */
  attemptVersion?: string;
  attemptMode?: string;
  attemptAt?: string;
}

let statePath = "";
let state: InstallState = { failures: 0 };

function readState(): InstallState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object") {
      const record = parsed as InstallState;
      return {
        failures: typeof record.failures === "number" ? record.failures : 0,
        attemptVersion:
          typeof record.attemptVersion === "string" ? record.attemptVersion : undefined,
        attemptMode: typeof record.attemptMode === "string" ? record.attemptMode : undefined,
      };
    }
  } catch {
    // Absent on a first run, and unparseable if a previous write was cut off
    // by the very quit it was recording. Both mean "no attempt pending".
  }
  return { failures: 0 };
}

function writeState(next: InstallState) {
  state = next;
  try {
    writeFileSync(statePath, JSON.stringify(next));
  } catch (error) {
    log("error", `could not persist install state: ${String(error)}`);
  }
}

/**
 * Reads the previous attempt's verdict, which is simply whether this launch
 * is the version that attempt was for.
 *
 * Called once at startup, before anything can record a new attempt.
 */
function settlePreviousAttempt() {
  if (!state.attemptVersion) return;
  const current = app.getVersion();
  if (state.attemptVersion === current) {
    log("info", `previous ${state.attemptMode} install succeeded: now on ${current}`);
    writeState({ failures: 0 });
    return;
  }
  const failures = state.failures + 1;
  log(
    "warn",
    `previous ${state.attemptMode} install did NOT take effect: wanted ${state.attemptVersion}, running ${current} (failure ${failures})`,
  );
  writeState({ failures });
}

/**
 * Whether this copy lives somewhere only an administrator can write.
 *
 * The point of asking is that a silent installer cannot obtain elevation —
 * it has no window to put a UAC prompt in front of — so on a per-machine
 * install the first attempt is already known to be hopeless, and the visible
 * installer is used straight away rather than after a wasted restart.
 *
 * Program Files specifically, not "anywhere outside LOCALAPPDATA":
 * `allowToChangeInstallationDirectory` is on, so a perfectly ordinary
 * per-user install can sit in D:\Apps\GoLive, and forcing a wizard on those
 * would be a regression for no reason.
 */
function needsElevatedInstall(): boolean {
  if (process.platform !== "win32") return false;
  const exe = process.execPath.toLowerCase();
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.ProgramW6432,
  ];
  return roots.some((root) => !!root && exe.startsWith(`${root.toLowerCase()}\\`));
}

function recordAttempt(version: string, mode: string) {
  writeState({
    failures: state.failures,
    attemptVersion: version,
    attemptMode: mode,
    attemptAt: new Date().toISOString(),
  });
}

function install(version: string) {
  // Out of ideas worth trying: three restarts have already been spent on
  // installers that did not take. Handing over the download page is an
  // admission rather than a graceful degradation, but it is the one path
  // that always works — and it is visible, which beats a button that does
  // nothing for the fourth time.
  if (state.failures >= MAX_ATTEMPTS) {
    log("error", `giving up after ${state.failures} failed attempts; opening ${downloadUrl}`);
    if (downloadUrl) void shell.openExternal(downloadUrl);
    return;
  }

  // The helper is a child process holding an open audio client, and its
  // executable is one of the files the installer has to replace. `will-quit`
  // stops it too, but that runs *after* electron-updater has already spawned
  // the installer — by which point a locked file is the installer's problem
  // rather than something an orderly shutdown can still prevent.
  stopSystemAudioCapture();

  const silent = state.failures === 0 && !needsElevatedInstall();
  const mode = silent ? "silent" : "visible";
  log("info", `installing ${version} (${mode}), app at ${process.execPath}`);
  recordAttempt(version, mode);

  // isForceRunAfter only applies to the silent path — electron-updater
  // ignores it otherwise and uses autoRunAppAfterInstall, which defaults to
  // true, so the app comes back either way. The user pressed a button
  // meaning "now", and being dropped back to the desktop is not what they
  // meant by it.
  autoUpdater.quitAndInstall(silent, true);
}

function check() {
  lastCheckAt = Date.now();
  autoUpdater.checkForUpdates().catch((error) => {
    // Offline, GitHub unreachable, a release without the right manifest —
    // all still invisible to the *user* on purpose. A failed check is not
    // something they did or can fix, and the app works perfectly without
    // one. It goes to the log, which is the only place anyone debugging
    // this from a distance can look.
    log("warn", `check failed: ${String(error)}`);
  });
}

/**
 * `onInstallRequested` runs in the moment between the user pressing the
 * button and the app being torn down, which is the last point at which
 * anything can still be read out of the running window. main.ts uses it to
 * write down where to come back to; passed in rather than reached for here
 * because this module knows about releases and not about windows.
 */
export function initAutoUpdater(
  appUrl: string,
  { onInstallRequested }: { onInstallRequested?: () => void } = {}
) {
  downloadUrl = new URL("/download", appUrl).toString();

  // Registered before the isPackaged bail-out below so the renderer's query
  // always gets a real answer. In dev that answer is null forever, which is
  // the truth — there is no packaged app to update — and is far better than
  // an invoke that rejects on a channel nobody handles.
  ipcMain.handle(IPC.updatePending, () => pendingVersion);
  ipcMain.on(IPC.updateCheck, () => {
    // Ignored outright in dev for the same reason initAutoUpdater bails
    // below: there is no packaged app to update, so a check would only log
    // an error. Nothing downstream cares — a nudge that finds nothing and a
    // nudge that never ran look identical from the page's side.
    if (!app.isPackaged) return;
    // Already downloaded: the button is showing (or is about to be), and
    // checking again would find the same release and re-download it.
    if (pendingVersion) return;
    if (Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) return;
    check();
  });
  ipcMain.on(IPC.updateInstall, () => {
    if (!pendingVersion) return;
    // Before install(), which quits: anything that needs the live window has
    // to happen while there still is one.
    onInstallRequested?.();
    install(pendingVersion);
  });

  // In development there is no packaged app to replace and no `app-update.yml`
  // for the updater to read, so it would only ever log an error. Bailing out
  // keeps `npm run electron:dev` quiet.
  if (!app.isPackaged) return;

  logPath = path.join(app.getPath("userData"), "updater.log");
  statePath = path.join(app.getPath("userData"), STATE_FILE);
  autoUpdater.logger = fileLogger;
  state = readState();
  log(
    "info",
    `launch: ${app.getVersion()} on ${process.platform} ${process.getSystemVersion()}, exe ${process.execPath}, needs-elevation ${needsElevatedInstall()}`,
  );
  settlePreviousAttempt();

  // Nothing here interrupts. Download in the background, tell the page it can
  // offer a button, install on quit regardless.
  //
  // There used to be a "Reiniciar agora / Depois" modal when the download
  // finished. It was removed deliberately — this app's sessions are calls,
  // and a dialog that steals focus mid-call is an interruption at the worst
  // possible moment to buy something the next restart hands over for free.
  // The green button the site now shows is the same offer with none of that:
  // it waits to be noticed instead of demanding an answer.
  autoUpdater.autoDownload = true;
  // The one line that makes the quiet safe: the downloaded update is applied
  // the next time the app closes on its own, so someone who never presses
  // the button still ends up current.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    pendingVersion = info.version;
    log("info", `downloaded ${info.version}`);
    // Every window, not just a "main" one: a room opened from a deep link
    // gets its own, and whichever one the user is looking at is the one that
    // has to show the button.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.updateReady, info.version);
    }
  });

  autoUpdater.on("error", (error) => {
    // Still swallowed as far as the user is concerned — electron-updater
    // reports ordinary offline conditions through here, and an unhandled
    // "error" event would crash the process — but no longer swallowed as far
    // as anyone debugging it is concerned.
    log("error", `updater error: ${error?.stack || String(error)}`);
  });

  // The same verdict-recording as the button path, for the quiet one:
  // `autoInstallOnAppQuit` runs a *silent* installer on an ordinary quit, so
  // it fails in exactly the same circumstances — and is in fact how most
  // people meet the problem, since it needs no button press. Recording the
  // attempt here is what lets the next launch notice and escalate, instead
  // of the machine retrying the same doomed silent install every session.
  app.on("before-quit", () => {
    if (!pendingVersion) return;
    if (state.attemptVersion) return; // install() already recorded this one.
    recordAttempt(pendingVersion, "on-quit");
  });

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  setInterval(check, CHECK_INTERVAL_MS);
}
