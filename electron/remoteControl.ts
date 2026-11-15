// "Controle remoto": somebody in the room drives this computer's mouse and
// keyboard, with the permission of the person sitting at it.
//
// The whole path, and which part of it owns what:
//
//   viewer's page --WebRTC data channel--> this person's page (lib/remoteControl.ts)
//     --IPC--> here --stdin--> golive-input.exe --SendInput--> Windows
//
// This file is the gate. The page can *ask* for a session; only a click in a
// window this file opens — not the page, not anything the page can draw —
// says yes. After that the page hands over input, and this file checks every
// event (shape, range, a closed key table, a rate) before it reaches the
// helper. The helper has its own guarantees on top (see input.cpp, "Safety"):
// the person at the computer always wins, Ctrl+Alt+Esc on the real keyboard
// always stops it, and GoLive's own windows can't be clicked from afar — which
// is what makes the "Permitir" button and the "Parar" banner here safe from
// the person they are about.
//
// Sessions end on their own whenever there is any doubt: the page leaving or
// crashing, the shared surface changing or going away, the helper exiting,
// fifteen minutes without input, or the app quitting.

import { app, BrowserWindow, ipcMain, screen, type WebContents } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  IPC,
  REMOTE_CONTROL_CURSORS,
  REMOTE_CONTROL_ZONES,
  type RemoteControlConsent,
  type RemoteControlCursor,
  type RemoteControlEndReason,
  type RemoteControlEvent,
  type RemoteControlLang,
  type RemoteControlRequestInfo,
  type RemoteControlWindowData,
  type RemoteControlZone,
} from "./channels";
import { onSharedSourceChanged, sharedDisplayId, sharedSourceArgs } from "./nativeVideo";
import { codeForScanCode, scanCodeFor } from "./remoteControlKeys";

const HELPER = "golive-input.exe";
const CONSENT_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 4000;
const PING_INTERVAL_MS = 1000;
const IDLE_TIMEOUT_MS = 15 * 60_000;
// Input events per second, sustained, with a burst of the same size. A person
// moving a mouse at 144 Hz while typing fast is well under it; a page gone
// wrong flooding the helper is not.
const RATE_PER_SECOND = 400;
const MAX_BATCH = 64;
const CONSENT_WIDTH = 420;
const CONSENT_HEIGHT = 300;
const BANNER_WIDTH = 560;
const BANNER_HEIGHT = 64;

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, HELPER)
    : path.join(__dirname, "..", "native", "bin", HELPER);
}

/** Whether remote control can run here at all: Windows, with the helper shipped. */
export function isRemoteControlAvailable(): boolean {
  return process.platform === "win32" && existsSync(helperPath());
}

interface Session {
  child: ChildProcessWithoutNullStreams;
  name: string;
  handle: string | null;
  avatar: string | null;
  lang: RemoteControlLang;
  kind: RemoteControlRequestInfo["kind"];
  lastInputAt: number;
  paused: boolean;
  /** stdin is full; pointer moves are dropped until it drains. */
  congested: boolean;
  tokens: number;
  tokensAt: number;
  pingTimer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout | null;
  banner: BrowserWindow | null;
  /** Set by what ended it, so the helper's exit is not reported as a second reason. */
  ending: RemoteControlEndReason | null;
}

interface PendingConsent {
  info: RemoteControlRequestInfo;
  window: BrowserWindow;
  resolve: (allowed: boolean | "timeout") => void;
  timer: NodeJS.Timeout;
}

function readLang(raw: unknown): RemoteControlLang {
  return raw === "en" || raw === "es" ? raw : "pt";
}

function readRequest(raw: unknown): RemoteControlRequestInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64) : "";
  if (!name) return null;
  const handle =
    typeof value.handle === "string" && /^[a-zA-Z0-9_.-]{1,32}$/.test(value.handle) ? value.handle : undefined;
  let avatar: string | undefined;
  if (typeof value.avatar === "string" && value.avatar.length < 1000) {
    try {
      if (new URL(value.avatar).protocol === "https:") avatar = value.avatar;
    } catch {
      // No picture, then: the initial is drawn instead.
    }
  }
  return {
    kind: value.kind === "offer" ? "offer" : "request",
    name,
    handle,
    avatar,
    lang: readLang(value.lang),
  };
}

const clamp16 = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(65535, Math.max(0, Math.round(value))) : null;

/** One event from the page, as the helper's command line — or null to drop it. */
function toCommand(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Record<string, unknown>;
  switch (event.t) {
    case "m": {
      const x = clamp16(event.x);
      const y = clamp16(event.y);
      return x === null || y === null ? null : `m ${x} ${y}`;
    }
    case "b": {
      const x = clamp16(event.x);
      const y = clamp16(event.y);
      const button = event.b;
      if (x === null || y === null || typeof button !== "number" || !Number.isInteger(button)) return null;
      if (button < 0 || button > 4) return null;
      return `b ${button} ${event.d === true ? 1 : 0} ${x} ${y}`;
    }
    case "w": {
      const read = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? Math.max(-1200, Math.min(1200, Math.round(value))) : 0;
      const dx = read(event.dx);
      const dy = read(event.dy);
      return dx === 0 && dy === 0 ? null : `w ${dx} ${dy}`;
    }
    case "k": {
      if (typeof event.c !== "string" || event.c.length > 32) return null;
      const scan = scanCodeFor(event.c);
      return scan ? `k ${scan[0]} ${scan[1]} ${event.d === true ? 1 : 0}` : null;
    }
    default:
      return null;
  }
}

export function createRemoteControl(options: {
  /** Whether this OS keeps a window out of captures (see main's captureProtectionLevel). */
  canHideFromViewers: boolean;
  /** Where events for the page go. */
  send: (event: RemoteControlEvent) => void;
  /** A session started or ended — the tray menu shows a "stop" item while one runs. */
  onActiveChange: () => void;
  logo: () => string | null;
}) {
  let session: Session | null = null;
  let pending: PendingConsent | null = null;

  const preload = path.join(__dirname, "remote-control-preload.js");
  const html = path.join(__dirname, "..", "remote-control.html");

  function alive(window: BrowserWindow | null): window is BrowserWindow {
    return Boolean(window && !window.isDestroyed());
  }

  function createOverlay(width: number, height: number, focusable: boolean): BrowserWindow {
    const window = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable,
      title: "Go Live",
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    window.setMenuBarVisibility(false);
    // Above full-screen games too, like the ringing window.
    window.setAlwaysOnTop(true, "screen-saver", 2);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // For the person at this computer only. The people watching the share
    // have nothing to do with the prompt or the banner, and a "Parar" button
    // they can see is one they would try to aim at.
    if (options.canHideFromViewers) window.setContentProtection(true);
    return window;
  }

  /** The display the share is on, for the banner; the primary one otherwise. */
  function bannerDisplay() {
    const id = sharedDisplayId();
    return (id && screen.getAllDisplays().find((d) => String(d.id) === id)) || screen.getPrimaryDisplay();
  }

  function windowData(sender: WebContents): RemoteControlWindowData | null {
    if (pending && alive(pending.window) && sender === pending.window.webContents) {
      const { info } = pending;
      return {
        mode: "consent",
        kind: info.kind,
        name: info.name,
        handle: info.handle ?? null,
        avatar: info.avatar ?? null,
        lang: info.lang,
        timeoutSeconds: Math.round(CONSENT_TIMEOUT_MS / 1000),
        logo: options.logo(),
      };
    }
    if (session && alive(session.banner) && sender === session.banner.webContents) {
      return {
        mode: "banner",
        kind: session.kind,
        name: session.name,
        handle: session.handle,
        avatar: session.avatar,
        lang: session.lang,
        timeoutSeconds: 0,
        logo: options.logo(),
      };
    }
    return null;
  }

  // ── Consent ───────────────────────────────────────────────────────────

  function askConsent(info: RemoteControlRequestInfo): Promise<boolean | "timeout"> {
    return new Promise((resolve) => {
      const window = createOverlay(CONSENT_WIDTH, CONSENT_HEIGHT, true);
      const settle = (answer: boolean | "timeout") => {
        if (!pending || pending.window !== window) return;
        clearTimeout(pending.timer);
        pending = null;
        if (alive(window)) window.close();
        resolve(answer);
      };
      pending = {
        info,
        window,
        resolve: settle,
        timer: setTimeout(() => settle("timeout"), CONSENT_TIMEOUT_MS),
      };
      window.once("ready-to-show", () => {
        // In the middle of monitor 1, where the ringing window appears too:
        // one place to look. showInactive so it does not take the keyboard
        // from whatever is being typed — the window itself also refuses a
        // click for its first moments (see remote-control.html), so a click
        // already on its way when it appears cannot land on "Permitir".
        const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
        window.setBounds({
          x: Math.round(x + (width - CONSENT_WIDTH) / 2),
          y: Math.round(y + (height - CONSENT_HEIGHT) / 2),
          width: CONSENT_WIDTH,
          height: CONSENT_HEIGHT,
        });
        window.showInactive();
      });
      window.on("closed", () => settle(false));
      void window.loadFile(html);
    });
  }

  function cancelConsent() {
    pending?.resolve(false);
  }

  // ── Session ───────────────────────────────────────────────────────────

  function openBanner(active: Session) {
    const window = createOverlay(BANNER_WIDTH, BANNER_HEIGHT, false);
    active.banner = window;
    window.once("ready-to-show", () => {
      const { x, y, width } = bannerDisplay().workArea;
      window.setBounds({
        x: Math.round(x + (width - BANNER_WIDTH) / 2),
        y: y + 8,
        width: BANNER_WIDTH,
        height: BANNER_HEIGHT,
      });
      window.showInactive();
    });
    window.on("closed", () => {
      if (active.banner === window) active.banner = null;
    });
    void window.loadFile(html);
  }

  function write(active: Session, lines: string): boolean {
    try {
      return active.child.stdin.write(lines);
    } catch {
      return false;
    }
  }

  function end(reason: RemoteControlEndReason) {
    const active = session;
    if (!active) return;
    session = null;
    active.ending = reason;
    clearInterval(active.pingTimer);
    if (active.idleTimer) clearTimeout(active.idleTimer);
    // "q" releases everything held and exits; closing stdin does the same if
    // the write cannot get through. The kill is for a helper that is stuck.
    write(active, "q\n");
    try {
      active.child.stdin.end();
    } catch {
      // Already closed.
    }
    const child = active.child;
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 2000).unref?.();
    if (alive(active.banner)) active.banner.close();
    active.banner = null;
    options.send({ type: "ended", reason });
    options.onActiveChange();
  }

  function armIdle(active: Session) {
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.idleTimer = setTimeout(() => {
      if (session === active) end("idle");
    }, IDLE_TIMEOUT_MS);
  }

  function startHelper(info: RemoteControlRequestInfo): Promise<RemoteControlConsent> {
    const sourceArgs = sharedSourceArgs();
    if (!sourceArgs) return Promise.resolve({ ok: false, reason: "no-source" });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(helperPath(), [...sourceArgs, "--protect-pid", String(process.pid)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return Promise.resolve({ ok: false, reason: "failed" });
    }

    const now = Date.now();
    const active: Session = {
      child,
      name: info.name,
      handle: info.handle ?? null,
      avatar: info.avatar ?? null,
      lang: info.lang,
      kind: info.kind,
      lastInputAt: now,
      paused: false,
      congested: false,
      tokens: RATE_PER_SECOND,
      tokensAt: now,
      pingTimer: setInterval(() => write(active, "p\n"), PING_INTERVAL_MS),
      idleTimer: null,
      banner: null,
      ending: null,
    };

    return new Promise<RemoteControlConsent>((resolve) => {
      let ready = false;
      let buffered = "";
      const readyTimer = setTimeout(() => {
        if (ready) return;
        clearInterval(active.pingTimer);
        child.kill();
        resolve({ ok: false, reason: "failed" });
      }, READY_TIMEOUT_MS);

      child.stdin.on("drain", () => {
        active.congested = false;
      });
      child.stdin.on("error", () => {});
      child.stderr.on("data", () => {});
      child.stdout.on("data", (data: Buffer) => {
        buffered += data.toString("latin1");
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line === "READY" && !ready) {
            ready = true;
            clearTimeout(readyTimer);
            session = active;
            armIdle(active);
            openBanner(active);
            options.onActiveChange();
            resolve({ ok: true });
          } else if (session !== active) {
            continue;
          } else if (line === "LOCAL") {
            options.send({ type: "local" });
          } else if (line === "HOTKEY") {
            end("hotkey");
          } else if (line === "GONE") {
            end("gone");
          } else if (line.startsWith("BLOCKED ")) {
            const why = line.slice(8);
            if (why === "golive" || why === "covered" || why === "elevated") options.send({ type: "blocked", why });
          } else if (line.startsWith("ZONE ")) {
            const zone = line.slice(5) as RemoteControlZone;
            if (REMOTE_CONTROL_ZONES.includes(zone)) options.send({ type: "zone", zone });
          } else if (line.startsWith("CURSOR ")) {
            const shape = line.slice(7) as RemoteControlCursor;
            if (REMOTE_CONTROL_CURSORS.includes(shape)) options.send({ type: "cursor", shape });
          }
        }
        if (buffered.length > 4096) buffered = "";
      });
      child.on("error", () => {
        if (!ready) {
          clearTimeout(readyTimer);
          clearInterval(active.pingTimer);
          resolve({ ok: false, reason: "failed" });
        }
      });
      child.on("exit", () => {
        clearInterval(active.pingTimer);
        if (!ready) {
          clearTimeout(readyTimer);
          resolve({ ok: false, reason: "failed" });
          return;
        }
        if (session === active) end("helper");
      });
    });
  }

  async function request(info: RemoteControlRequestInfo): Promise<RemoteControlConsent> {
    if (!isRemoteControlAvailable()) return { ok: false, reason: "unsupported" };
    if (session || pending) return { ok: false, reason: "busy" };
    // Not worth interrupting anybody for a session that could not start.
    if (!sharedSourceArgs()) return { ok: false, reason: "no-source" };
    const answer = await askConsent(info);
    if (answer === "timeout") return { ok: false, reason: "timeout" };
    if (!answer) return { ok: false, reason: "declined" };
    if (session) return { ok: false, reason: "busy" };
    return startHelper(info);
  }

  function input(raw: unknown) {
    const active = session;
    if (!active || active.paused || !Array.isArray(raw)) return;
    const now = Date.now();
    active.tokens = Math.min(RATE_PER_SECOND, active.tokens + ((now - active.tokensAt) / 1000) * RATE_PER_SECOND);
    active.tokensAt = now;
    let lines = "";
    for (const event of raw.slice(0, MAX_BATCH)) {
      if (active.tokens < 1) break;
      const command = toCommand(event);
      if (!command) continue;
      // A pointer move is worth dropping when the pipe is behind: only the
      // newest position matters. Buttons and keys never are — a lost "up" is
      // a stuck key.
      if (active.congested && command.startsWith("m ")) continue;
      active.tokens -= 1;
      lines += `${command}\n`;
    }
    if (!lines) return;
    active.lastInputAt = now;
    armIdle(active);
    if (!write(active, lines)) active.congested = true;
  }

  // ── Grabbing the system shortcuts (this computer controls another) ──────
  //
  // The Windows key, Alt+Tab, Ctrl+Esc, Alt+F4 and PrintScreen are Windows'
  // before any page sees them, so "Win+R" on the person controlling opened
  // *their* Run box. A second golive-input, in --grab-keys mode, keeps them
  // from Windows while the page says its surface has the keyboard and GoLive
  // is in front, and hands them back here to go across. Started on the first
  // grab, stopped a minute after the last one ends.

  interface Grabber {
    child: ChildProcessWithoutNullStreams;
    on: boolean;
    pingTimer: NodeJS.Timeout;
    stopTimer: NodeJS.Timeout | null;
  }

  const GRAB_IDLE_MS = 60_000;
  let grabber: Grabber | null = null;
  // A helper from before --grab-keys existed says so with exit code 2; asking
  // again on every focus would only start it again for nothing.
  let grabUnsupported = false;

  function writeGrab(active: Grabber, line: string) {
    try {
      active.child.stdin.write(line);
    } catch {
      // Exiting; "exit" below clears it.
    }
  }

  function stopGrabber() {
    const active = grabber;
    if (!active) return;
    grabber = null;
    clearInterval(active.pingTimer);
    if (active.stopTimer) clearTimeout(active.stopTimer);
    writeGrab(active, "q\n");
    try {
      active.child.stdin.end();
    } catch {
      // Already closed.
    }
    const child = active.child;
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 2000).unref?.();
  }

  function startGrabber(): Grabber | null {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(helperPath(), ["--grab-keys", "--protect-pid", String(process.pid)], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return null;
    }
    const active: Grabber = {
      child,
      on: false,
      pingTimer: setInterval(() => writeGrab(active, "p\n"), PING_INTERVAL_MS),
      stopTimer: null,
    };
    let buffered = "";
    let ready = false;
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => {});
    child.stdout.on("data", (data: Buffer) => {
      buffered += data.toString("latin1");
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line === "READY") {
          ready = true;
          continue;
        }
        const match = /^KEY (\d{1,3}) ([01]) ([01])$/.exec(line);
        if (!match || grabber !== active || !active.on) continue;
        const code = codeForScanCode(Number(match[1]), match[2] === "1");
        if (code) options.send({ type: "key", code, down: match[3] === "1" });
      }
      if (buffered.length > 4096) buffered = "";
    });
    const gone = (exitCode?: number | null) => {
      clearInterval(active.pingTimer);
      if (!ready && exitCode === 2) grabUnsupported = true;
      if (grabber === active) grabber = null;
    };
    child.on("error", () => gone());
    child.on("exit", (exitCode) => gone(exitCode));
    return active;
  }

  function setGrab(on: boolean) {
    if (on) {
      if (grabUnsupported || !isRemoteControlAvailable()) return;
      if (!grabber) grabber = startGrabber();
      const active = grabber;
      if (!active) return;
      if (active.stopTimer) clearTimeout(active.stopTimer);
      active.stopTimer = null;
      if (!active.on) {
        active.on = true;
        writeGrab(active, "g 1\n");
      }
      return;
    }
    const active = grabber;
    if (!active) return;
    if (active.on) {
      active.on = false;
      writeGrab(active, "g 0\n");
    }
    if (!active.stopTimer) {
      active.stopTimer = setTimeout(() => {
        if (grabber === active && !active.on) stopGrabber();
      }, GRAB_IDLE_MS);
    }
  }

  function setPaused(paused: boolean) {
    const active = session;
    if (!active || active.paused === paused) return;
    active.paused = paused;
    // Everything held is let go while nobody is on the other end to let go
    // of it. The idle timer keeps running: a pause that never resumes ends.
    if (paused) write(active, "r\n");
  }

  function registerIpc(fromApp: (sender: WebContents) => boolean) {
    ipcMain.handle(IPC.remoteControlRequest, async (event, raw: unknown): Promise<RemoteControlConsent> => {
      if (!fromApp(event.sender)) return { ok: false, reason: "unsupported" };
      const info = readRequest(raw);
      if (!info) return { ok: false, reason: "failed" };
      return request(info);
    });
    ipcMain.on(IPC.remoteControlInput, (event, raw: unknown) => {
      if (fromApp(event.sender)) input(raw);
    });
    ipcMain.on(IPC.remoteControlPause, (event, raw: unknown) => {
      if (fromApp(event.sender)) setPaused(raw === true);
    });
    ipcMain.on(IPC.remoteControlStop, (event) => {
      if (!fromApp(event.sender)) return;
      cancelConsent();
      end("page");
    });
    ipcMain.on(IPC.remoteControlGrab, (event, raw: unknown) => {
      if (fromApp(event.sender)) setGrab(raw === true);
    });
    ipcMain.handle(IPC.remoteControlWindowData, (event) => windowData(event.sender));
    ipcMain.on(IPC.remoteControlWindowChoose, (event, raw: unknown) => {
      if (pending && alive(pending.window) && event.sender === pending.window.webContents) {
        pending.resolve(raw === "allow");
        return;
      }
      if (session && alive(session.banner) && event.sender === session.banner.webContents && raw === "stop") {
        end("banner");
      }
    });
    onSharedSourceChanged(() => end("source-changed"));
    screen.on("display-removed", () => {
      // The helper notices a monitor that is gone by itself; the banner may
      // have been on it.
      const active = session;
      if (active && alive(active.banner)) {
        const { x, y, width } = bannerDisplay().workArea;
        active.banner.setBounds({
          x: Math.round(x + (width - BANNER_WIDTH) / 2),
          y: y + 8,
          width: BANNER_WIDTH,
          height: BANNER_HEIGHT,
        });
      }
    });
  }

  return {
    registerIpc,
    /** Whether a session is running — for the tray's "stop" item. */
    isActive: () => session !== null,
    /** The page that owned the session is gone (navigated, reloaded, crashed). */
    pageGone() {
      cancelConsent();
      end("navigated");
      stopGrabber();
    },
    stopFromTray() {
      end("tray");
    },
    destroy() {
      cancelConsent();
      end("page");
      stopGrabber();
    },
  };
}
