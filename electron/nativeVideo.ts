// Screen capture encoded on the GPU — the shell's half.
//
// The share's picker, and the getDisplayMedia call behind it, stay exactly as
// they are: the person picks a screen or a window the usual way. What changes
// is who captures it afterwards. When the page asks (see
// lib/nativeVideoCapture.ts), this starts golive-videocap on the surface that
// was just picked, and forwards the H.264 it writes to the page, which puts it
// on the wire in place of Chromium's own capture. Why that is worth a helper
// process is at the top of electron/native/src/videocap.cpp.
//
// An experiment: the page only asks when the "native-video-capture" feature
// is on for this person, and every way this can fail sends the share back to
// Chromium's capture rather than ending it.

import { app, screen, type DesktopCapturerSource, type WebContents } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { NativeFrameReader } from "../lib/nativeVideoFrames";
import { IPC, type NativeVideoStartOptions, type NativeVideoStartResult } from "./channels";

const HELPER = "golive-videocap.exe";
const READY_TIMEOUT_MS = 6000;
const PROBE_TIMEOUT_MS = 10000;
const EXIT_UNSUPPORTED = 3;
const EXIT_TARGET_GONE = 4;

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, HELPER)
    : path.join(__dirname, "..", "native", "bin", HELPER);
}

/** Whether it is worth asking at all: Windows, with the helper shipped. */
export function isNativeVideoAvailable(): boolean {
  return process.platform === "win32" && existsSync(helperPath());
}

// ---------------------------------------------------------------------------
// Probe

export interface NativeVideoProbe {
  supported: boolean;
  encoder: string | null;
}

let probe: Promise<NativeVideoProbe> | null = null;

/**
 * Whether this machine has Graphics Capture and a hardware H.264 encoder.
 * Asked once per run: neither changes while the app is open, and the answer
 * costs a process start.
 */
export function probeNativeVideo(): Promise<NativeVideoProbe> {
  if (probe) return probe;
  probe = new Promise<NativeVideoProbe>((resolve) => {
    if (!isNativeVideoAvailable()) {
      resolve({ supported: false, encoder: null });
      return;
    }
    let output = "";
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(helperPath(), ["--probe"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve({ supported: false, encoder: null });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve({ supported: false, encoder: null });
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ supported: false, encoder: null });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const line = output.split(/\r?\n/).find((l) => l.startsWith("OK "));
      resolve(code === 0 && line ? { supported: true, encoder: line.slice(3).trim() } : { supported: false, encoder: null });
    });
    child.stdin.end();
  });
  return probe;
}

// ---------------------------------------------------------------------------
// Which surface

let lastSource: { id: string; displayId: string } | null = null;

/**
 * Remembered by the display-media handler (see main.ts) for every share it
 * answers, because the page cannot name the surface itself: it only ever gets
 * a MediaStream. The native capture is started right after that answer, on
 * this.
 */
export function rememberSharedSource(source: DesktopCapturerSource): void {
  lastSource = { id: source.id, displayId: source.display_id };
}

function argsForSource(source: { id: string; displayId: string }): string[] | null {
  const [kind, handle] = source.id.split(":");
  if (kind === "window") {
    // Electron's window source id carries the HWND itself.
    return handle && /^\d+$/.test(handle) ? ["--window", handle] : null;
  }
  if (kind !== "screen") return null;
  const displays = screen.getAllDisplays();
  const display = displays.find((d) => String(d.id) === source.displayId) ?? screen.getPrimaryDisplay();
  const centre = {
    x: Math.round(display.bounds.x + display.bounds.width / 2),
    y: Math.round(display.bounds.y + display.bounds.height / 2),
  };
  // The helper runs per-monitor DPI aware, in physical pixels; Electron's
  // bounds are in DIPs.
  const point = screen.dipToScreenPoint(centre);
  return ["--monitor", String(point.x), String(point.y)];
}

// ---------------------------------------------------------------------------
// Capture

interface Capture {
  child: ChildProcessWithoutNullStreams;
  target: WebContents;
  stopping: boolean;
  detach: () => void;
}

let capture: Capture | null = null;

export async function startNativeVideo(
  target: WebContents,
  options: NativeVideoStartOptions
): Promise<NativeVideoStartResult> {
  stopNativeVideo();
  if (!(await probeNativeVideo()).supported) return { ok: false, reason: "unsupported" };
  const source = lastSource;
  const sourceArgs = source ? argsForSource(source) : null;
  if (!sourceArgs) return { ok: false, reason: "no-source" };

  const args = [
    ...sourceArgs,
    "--max-width",
    String(Math.round(options.maxWidth)),
    "--max-height",
    String(Math.round(options.maxHeight)),
    "--fps",
    String(Math.round(options.fps)),
    "--bitrate",
    String(Math.round(options.bitrateKbps)),
    "--cursor",
    options.cursor === false ? "0" : "1",
  ];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(helperPath(), args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return { ok: false, reason: "failed" };
  }

  const active: Capture = { child, target, stopping: false, detach: () => {} };
  capture = active;
  const reader = new NativeFrameReader();

  return new Promise<NativeVideoStartResult>((resolve) => {
    let settled = false;
    const settle = (result: NativeVideoStartResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok) stopNativeVideo();
      resolve(result);
    };
    const timer = setTimeout(() => settle({ ok: false, reason: "timeout" }), READY_TIMEOUT_MS);
    timer.unref?.();

    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
      let newline: number;
      while ((newline = stderr.indexOf("\n")) >= 0) {
        const line = stderr.slice(0, newline).trim();
        stderr = stderr.slice(newline + 1);
        const ready = /^READY (\d+) (\d+) (.*)$/.exec(line);
        if (ready) {
          settle({ ok: true, width: Number(ready[1]), height: Number(ready[2]), encoder: ready[3] });
        } else if (line) {
          process.stderr.write(`[videocap] ${line}\n`);
        }
      }
    });

    child.stdout.on("data", (data: Buffer) => {
      if (active.stopping || capture !== active || target.isDestroyed()) return;
      let frames;
      try {
        frames = reader.push(data);
      } catch (err) {
        console.error("[golive] native video stream unreadable:", err);
        end(active, "failed");
        return;
      }
      for (const frame of frames) {
        const { data: payload, ...meta } = frame;
        target.send(IPC.nativeVideoFrame, meta, payload);
      }
    });

    child.on("error", () => {
      settle({ ok: false, reason: "failed" });
      end(active, "failed");
    });
    child.on("exit", (code) => {
      settle({ ok: false, reason: code === EXIT_UNSUPPORTED ? "unsupported" : code === EXIT_TARGET_GONE ? "no-source" : "failed" });
      if (active.stopping || capture !== active) return;
      end(active, code === EXIT_TARGET_GONE ? "target-gone" : "failed");
    });

    active.detach = watchTarget(active);
  });
}

export function controlNativeVideo(command: { bitrateKbps?: number; keyFrame?: boolean }): void {
  const active = capture;
  if (!active || active.stopping) return;
  const lines: string[] = [];
  if (typeof command.bitrateKbps === "number" && Number.isFinite(command.bitrateKbps)) {
    lines.push(`bitrate ${Math.round(command.bitrateKbps)}`);
  }
  if (command.keyFrame) lines.push("key");
  if (lines.length === 0) return;
  try {
    active.child.stdin.write(`${lines.join("\n")}\n`);
  } catch {
    // The helper is on its way out; its exit handler reports that.
  }
}

/** Stops the capture. Safe when nothing is running. */
export function stopNativeVideo(): void {
  const active = capture;
  if (!active) return;
  capture = null;
  active.stopping = true;
  active.detach();
  const { child } = active;
  // Closing stdin is the helper's shutdown signal; kill() is the backstop for
  // one that is wedged in a driver.
  try {
    child.stdin.end();
  } catch {
    // Already closed.
  }
  const forceKill = setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 2000);
  forceKill.unref?.();
  child.once("exit", () => clearTimeout(forceKill));
}

// The capture ended on its own. The page is told, and its share falls back to
// Chromium's capture or ends, depending on why (see nativeVideoCapture.ts).
function end(active: Capture, reason: "target-gone" | "failed") {
  // Already stopped — by the page, or by a start that failed before it was
  // ever handed to the page. Neither is news to it.
  if (active.stopping) return;
  const target = active.target;
  stopNativeVideo();
  if (!target.isDestroyed()) target.send(IPC.nativeVideoEnded, reason);
}

// A page that goes away takes its share with it; see the same function in
// systemAudio.ts for why each of these events.
function watchTarget(active: Capture): () => void {
  const { target } = active;
  const onGone = () => {
    if (capture === active) stopNativeVideo();
  };
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) onGone();
  };
  target.once("destroyed", onGone);
  target.on("render-process-gone", onGone);
  target.on("did-start-navigation", onNavigate);
  return () => {
    if (target.isDestroyed()) return;
    target.off("destroyed", onGone);
    target.off("render-process-gone", onGone);
    target.off("did-start-navigation", onNavigate);
  };
}
