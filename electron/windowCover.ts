// Whether the main window is hidden behind another application's window — the
// shell's half of experiment "desktop-cover-hide" (see the site's lib/pageHidden).
//
// The window runs with background throttling off (see main.ts), which keeps
// timers and the socket alive in the background and, as a side effect, turns
// Chromium's own occlusion tracking off too. So a call left open behind a game
// in full screen goes on decoding every video in the room and drawing every
// frame of it for nobody — on the machine that is running the game. Electron has
// no way to ask whether the window is covered, so golive-audiocap answers it
// (`--watch-cover`, see electron/native/src/audiocap.cpp).
//
// Started only when the page asks (it is an experiment), and only reported as
// covered once that has held for COVERED_HOLD_MS: alt-tabbing past a game, or a
// window dragged across, is not somebody leaving. Back in sight is reported at
// once, since that is somebody looking again.

import { app, type BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const HELPER = "golive-audiocap.exe";
const COVERED_HOLD_MS = 3000;
// A helper from before --watch-cover answers with its usage line and this code.
const EXIT_BAD_ARGS = 2;
const RESTART_DELAY_MS = 5000;
const MAX_RESTARTS = 5;

function helperPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, HELPER) : path.join(__dirname, "..", "native", "bin", HELPER);
}

function hwndOf(window: BrowserWindow): string {
  const handle = window.getNativeWindowHandle();
  return (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
}

export function createCoverWatch(onChange: (covered: boolean) => void) {
  let window: BrowserWindow | null = null;
  let wanted = false;
  let child: ChildProcessWithoutNullStreams | null = null;
  // What the page was told, and what the helper says right now.
  let covered = false;
  let raw = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let restarts = 0;
  let unsupported = process.platform !== "win32";

  function report(next: boolean) {
    if (covered === next) return;
    covered = next;
    onChange(next);
  }

  function setRaw(next: boolean) {
    raw = next;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    if (!next) {
      report(false);
      return;
    }
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (raw) report(true);
    }, COVERED_HOLD_MS);
  }

  function start() {
    if (child || unsupported || !wanted || !window || window.isDestroyed()) return;
    if (!existsSync(helperPath())) {
      unsupported = true;
      return;
    }
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(helperPath(), ["--watch-cover", hwndOf(window)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      unsupported = true;
      return;
    }
    child = proc;
    let buffer = "";
    proc.stdout.on("data", (data: Buffer) => {
      buffer += data.toString();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "COVERED 1") setRaw(true);
        else if (line === "COVERED 0") setRaw(false);
      }
    });
    proc.stderr.on("data", () => {});
    proc.on("error", () => {
      unsupported = true;
    });
    proc.on("exit", (code) => {
      if (child !== proc) return;
      child = null;
      setRaw(false);
      if (code === EXIT_BAD_ARGS) {
        unsupported = true;
        return;
      }
      // Gone with the window (a new one gets setWindow), or crashed: a few
      // tries, then the window is simply never reported covered, as before.
      if (!wanted || restarts >= MAX_RESTARTS) return;
      restarts += 1;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        start();
      }, RESTART_DELAY_MS);
      restartTimer.unref?.();
    });
  }

  function stop() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const proc = child;
    child = null;
    if (proc) {
      // Closing stdin is the helper's shutdown signal; kill() is the backstop.
      try {
        proc.stdin.end();
      } catch {
        // Already closed.
      }
      const forceKill = setTimeout(() => {
        if (proc.exitCode === null) proc.kill();
      }, 1000);
      forceKill.unref?.();
      proc.once("exit", () => clearTimeout(forceKill));
    }
    setRaw(false);
  }

  return {
    /** The window to watch, or null while there is none. */
    setWindow(next: BrowserWindow | null) {
      if (window === next) return;
      stop();
      window = next;
      restarts = 0;
      start();
    },
    /** What the page asked for — see IPC.windowCoverWatch. */
    setWanted(next: boolean) {
      if (wanted === next) return;
      wanted = next;
      restarts = 0;
      if (next) start();
      else stop();
    },
    isCovered: () => covered,
    stop,
  };
}
