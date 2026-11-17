// Staying reachable with the window closed.
//
// This is the desktop's whole answer to "a call has to ring even with the app
// closed", and it is worth being blunt about why it looks nothing like the
// answer on the other two platforms. A browser and an Android phone can be
// woken by a *push service* — a third party that holds a message until the
// device is next online. Electron has no such thing: there is no server
// anywhere that can deliver anything to a desktop application that is not
// running. Nobody's Electron app has one, which is exactly why every desktop
// chat application converges on the same design instead — the app does not
// close when the window does, it goes to the tray with its connection open,
// and it starts with the system so that "closed" is a state the machine
// rarely gets into.
//
// So there are two settings and they are not independent in effect, only in
// meaning:
//
//   - runInBackground: closing the window hides it instead of quitting.
//     Without this the app is gone the moment somebody presses X, and no
//     amount of anything else brings a ring to it.
//   - openAtLogin: the app starts hidden with the machine. Without this, the
//     first setting only helps until the next reboot.
//
// Both default to *on* for the same reason the feature exists at all, and both
// are visible and reversible from the tray menu — an application that decides
// on its own to keep running and to start itself has to say so somewhere the
// user can find it, or it is indistinguishable from something they would want
// removed.

import { app } from "electron";
import { execFile } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BackgroundSettings } from "./channels";

const SETTINGS_FILE = "background.json";

/**
 * Passed to the copy of ourselves the OS starts at login.
 *
 * `openAsHidden` is the documented way to do this and it works on exactly one
 * platform (macOS), so the argument is what actually carries the intent on
 * Windows and Linux — main.ts reads it before deciding whether to show the
 * window. Sent on every platform rather than only where it is needed, because
 * a launch that is hidden on one OS and visible on another is the kind of
 * difference nobody remembers when reading the code six months later.
 */
export const HIDDEN_ARG = "--golive-hidden";

// How soon after logon a Store launch still counts as the startup task.
const STORE_LOGON_WINDOW_MS = 90_000;

/**
 * The Store build's answer to "did logon start us?".
 *
 * Its startup task (appx.addAutoLaunchExtension) cannot pass HIDDEN_ARG, and
 * nothing else tells a startup-task launch from a click on the Start menu
 * without WinRT. So it goes by timing: explorer.exe starts at logon, and a
 * launch within STORE_LOGON_WINDOW_MS of it is taken as the startup task.
 * Someone who opens the app by hand that early finds it in the tray, and a
 * second click shows the window (second-instance → focusMainWindow).
 *
 * Started at module load and awaited at ready-to-show, so the PowerShell
 * round trip overlaps the page load instead of delaying the window.
 */
const storeLogonLaunch: Promise<boolean> =
  process.platform === "win32" && process.windowsStore && !process.argv.some((arg) => arg.includes("://"))
    ? new Promise((resolve) => {
        const startedAt = Date.now() - process.uptime() * 1000;
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-Process explorer -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1).StartTime.ToUniversalTime().ToString('o')",
          ],
          { windowsHide: true, timeout: 5000 },
          (error, stdout) => {
            const explorerAt = error ? NaN : Date.parse(String(stdout).trim());
            resolve(Number.isFinite(explorerAt) && startedAt - explorerAt < STORE_LOGON_WINDOW_MS);
          }
        );
      })
    : Promise.resolve(false);

/** launchedHidden, plus the Store build's timing check — see storeLogonLaunch. */
export async function launchedHiddenAsync(): Promise<boolean> {
  return launchedHidden() || (await storeLogonLaunch);
}

// An unattended update (see updater.ts's installWhenIdle) taken while the
// window was hidden in the tray: the installer relaunches us with no
// arguments, so the "stay hidden" intent travels in a file instead — written
// just before quitting, consumed by the very next launch, and stale after a
// few minutes so a failed install opened by hand days later still shows up.
const RELAUNCH_HIDDEN_FILE = "relaunch-hidden.json";
const RELAUNCH_HIDDEN_MAX_AGE_MS = 10 * 60_000;

export function markRelaunchHidden() {
  try {
    writeFileSync(path.join(app.getPath("userData"), RELAUNCH_HIDDEN_FILE), JSON.stringify({ savedAt: Date.now() }));
  } catch {
    // Worst case the window shows after the update, which is what it always did.
  }
}

let relaunchHidden: boolean | null = null;

function takeRelaunchHidden(): boolean {
  if (relaunchHidden !== null) return relaunchHidden;
  relaunchHidden = false;
  const file = path.join(app.getPath("userData"), RELAUNCH_HIDDEN_FILE);
  try {
    const { savedAt } = JSON.parse(readFileSync(file, "utf8")) as { savedAt?: unknown };
    relaunchHidden = typeof savedAt === "number" && Date.now() - savedAt < RELAUNCH_HIDDEN_MAX_AGE_MS;
  } catch {
    return false;
  }
  try {
    unlinkSync(file);
  } catch {
    // The age check covers a file that could not be removed.
  }
  return relaunchHidden;
}

/** Whether *this* launch was the machine starting us, rather than a person. */
export function launchedHidden(): boolean {
  return (
    process.argv.includes(HIDDEN_ARG) ||
    takeRelaunchHidden() ||
    // macOS's own flag for the same thing, set when the app is opened as a
    // hidden login item.
    app.getLoginItemSettings().wasOpenedAsHidden
  );
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

// Only `runInBackground` is stored. `openAtLogin` deliberately is not: the
// operating system already holds that one (a registry entry, a login item, a
// .desktop file), the user can turn it off *there* without this app being
// involved, and a file that remembered a different answer would keep switching
// it back on behind their back.
interface StoredSettings {
  runInBackground: boolean;
}

const DEFAULTS: StoredSettings = { runInBackground: true };

let cached: StoredSettings | null = null;

function read(): StoredSettings {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<StoredSettings>;
    cached = { runInBackground: parsed.runInBackground !== false };
  } catch {
    // Missing or corrupt: the defaults, which is the behaviour somebody who
    // has never opened this menu expects anyway.
    cached = { ...DEFAULTS };
  }
  return cached;
}

function write(next: StoredSettings): void {
  cached = next;
  try {
    writeFileSync(settingsPath(), JSON.stringify(next));
  } catch {
    // Best-effort, like every other setting in this shell: it holds for this
    // run and is asked again next time.
  }
}

/**
 * Whether login items can be driven at all here.
 *
 * Electron implements setLoginItemSettings on Windows and macOS everywhere,
 * and on Linux only where a standard autostart directory exists. Reporting it
 * honestly is what lets the tray hide a switch rather than offer one that
 * silently does nothing.
 */
export function loginItemSupported(): boolean {
  // A Store (MSIX) install gets a virtualized registry: the Run key Electron
  // writes lands in the package's private hive, which Windows never reads at
  // logon — and getLoginItemSettings reads that same hive back, so the switch
  // would report "on" while nothing happens. Autostart there comes from the
  // windows.startupTask extension in the package manifest
  // (appx.addAutoLaunchExtension) and is toggled in Task Manager →
  // Startup.
  if (process.windowsStore) return false;
  return process.platform === "win32" || process.platform === "darwin" || process.platform === "linux";
}

export function getBackgroundSettings(): BackgroundSettings {
  const stored = read();
  let openAtLogin = false;
  if (loginItemSupported()) try {
    openAtLogin = app.getLoginItemSettings().openAtLogin;
  } catch {
    // Some Linux desktops throw rather than answer. False is the safe report:
    // it says "not starting with the system", which is what the user sees.
  }
  return {
    runInBackground: stored.runInBackground,
    openAtLogin,
    supported: loginItemSupported(),
  };
}

export function setRunInBackground(enabled: boolean): void {
  write({ runInBackground: enabled });
}

export function setOpenAtLogin(enabled: boolean): void {
  if (!loginItemSupported()) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // macOS only, and paired with the argument below rather than trusted on
      // its own — see HIDDEN_ARG.
      openAsHidden: enabled,
      args: enabled ? [HIDDEN_ARG] : [],
    });
  } catch {
    // Nothing to report and nothing to retry: the menu re-reads the real
    // state on its next open, so a failure shows up as the switch simply not
    // having moved.
  }
}

/**
 * Turns autostart on the first time the app runs, and never again.
 *
 * The "and never again" is the whole of it. Defaulting to on is defensible —
 * an app whose job is to ring cannot ring from a machine it was never started
 * on — but re-applying that default on every launch would silently undo a
 * person's decision to turn it off, which is not a default any more, it is a
 * refusal to take no for an answer.
 */
export function applyFirstRunDefaults(): void {
  const marker = path.join(app.getPath("userData"), "background-initialized");
  try {
    readFileSync(marker);
    return;
  } catch {
    // Not initialized yet — fall through.
  }
  setOpenAtLogin(true);
  try {
    writeFileSync(marker, String(Date.now()));
  } catch {
    // If the marker cannot be written the default is applied again next
    // launch. Idempotent, so the only cost is that a user who turns it off
    // may have to do it twice on a machine whose userData is not writable —
    // which is a machine with much larger problems.
  }
}
