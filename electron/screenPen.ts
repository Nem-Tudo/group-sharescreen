// "Desenhar na tela": a pen over the real desktop, the way screenshot and
// presentation tools have one (ZoomIt, Epic Pen), driven by three shortcuts
// the site lets people record (see the site's lib/screenPen.ts):
//
//   - draw    the pen comes down: the screen under it stops answering the
//             mouse, and the toolbar (pens, colours, undo…) appears. Pressing
//             it again, or Esc, gives the mouse back.
//   - show    the marks on screen or not. Shown, they stay over the desktop
//             while the mouse goes on working underneath, as if they were not
//             there.
//   - viewers whether the marks go out in the screen share. Independent of
//             the other two: it only decides what the capture sees.
//
// How it is built, and why it is cheap:
//
//   - One transparent, always-on-top window per monitor, created the first
//     time somebody draws on that monitor. Not drawing, it ignores the mouse
//     entirely (setIgnoreMouseEvents, no forwarding), and with no marks on it
//     it is not even shown — so a person with the shortcuts set and nothing
//     drawn pays nothing at all. It paints only when a mark changes: no
//     animation loop, no timers.
//   - "Not for viewers" is setContentProtection — the same OS switch the main
//     window uses for protected rooms (WDA_EXCLUDEFROMCAPTURE on Windows), so
//     the marks are simply not in the picture the share captures. Nothing is
//     composited into the stream; the share captures the screen, and the pen
//     is on the screen or not.
//   - The toolbar is a window of its own, always kept out of captures, so the
//     people watching see the marks and never the buttons.
//
// Nothing here hooks the system or touches another process: the windows are
// ordinary Electron windows and the shortcuts are the ones the app already
// follows (see inputHook.ts). That is what keeps it out of an antivirus's way.

import { BrowserWindow, ipcMain, screen, type Display, type WebContents } from "electron";
import path from "node:path";
import {
  IPC,
  SCREEN_PEN_COLORS,
  SCREEN_PEN_SIZES,
  SCREEN_PEN_TOOLS,
  type ScreenPenAction,
  type ScreenPenCanvasInfo,
  type ScreenPenState,
  type ScreenPenTool,
} from "./channels";

const TOOLBAR_WIDTH = 940;
const TOOLBAR_HEIGHT = 96;
const NOTICE_MS = 1800;

interface Canvas {
  window: BrowserWindow;
  displayId: number;
  marks: number;
  canUndo: boolean;
  canRedo: boolean;
}

export function createScreenPen(options: {
  /** Whether this OS can keep a window out of a capture (see main's captureProtectionLevel). */
  canHideFromViewers: boolean;
  /** For the site's usage stats. */
  onEvent: (name: string, value?: number) => void;
}) {
  let enabled = false;
  let labels: Record<string, string> = {};
  let drawing = false;
  let visible = true;
  let hiddenFromViewers = false;
  let tool: ScreenPenTool = "pen";
  let color = SCREEN_PEN_COLORS[0];
  let size = SCREEN_PEN_SIZES[1];
  let activeDisplay: number | null = null;
  let drawingSince = 0;
  let notice: string | null = null;
  let noticeTimer: NodeJS.Timeout | null = null;

  const canvases = new Map<number, Canvas>();
  let toolbar: BrowserWindow | null = null;

  const preload = path.join(__dirname, "screen-pen-preload.js");
  const html = (name: string) => path.join(__dirname, "..", name);

  function activeCanvas(): Canvas | null {
    return activeDisplay === null ? null : (canvases.get(activeDisplay) ?? null);
  }

  function stateFor(canvas: Canvas | null): ScreenPenState & { notice?: string | null } {
    const active = activeCanvas();
    return {
      drawing,
      visible,
      hiddenFromViewers,
      canHideFromViewers: options.canHideFromViewers,
      tool,
      color,
      size,
      active: canvas ? canvas.displayId === activeDisplay && drawing : undefined,
      canUndo: Boolean(active?.canUndo),
      canRedo: Boolean(active?.canRedo),
      hasMarks: Boolean(active && active.marks > 0),
      labels,
      notice,
    };
  }

  function alive(window: BrowserWindow | null): window is BrowserWindow {
    return Boolean(window && !window.isDestroyed());
  }

  function createCanvas(display: Display): Canvas {
    const { x, y, width, height } = display.bounds;
    const window = new BrowserWindow({
      x,
      y,
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      title: "GoLive",
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    // Above everything a person can be using, games in borderless mode
    // included — a pen under the window being pointed at is no pen.
    window.setAlwaysOnTop(true, "screen-saver");
    window.setIgnoreMouseEvents(true);
    if (options.canHideFromViewers) window.setContentProtection(hiddenFromViewers);
    // Set again once it exists: on Windows a window created on a monitor with
    // a different scale than the primary one comes up the wrong size.
    window.setBounds(display.bounds);
    window.setMenuBarVisibility(false);
    const canvas: Canvas = { window, displayId: display.id, marks: 0, canUndo: false, canRedo: false };
    window.once("ready-to-show", () => apply());
    window.on("closed", () => {
      if (canvases.get(display.id) === canvas) canvases.delete(display.id);
    });
    void window.loadFile(html("screen-pen.html"));
    canvases.set(display.id, canvas);
    return canvas;
  }

  function createToolbar(): BrowserWindow {
    const window = new BrowserWindow({
      width: TOOLBAR_WIDTH,
      height: TOOLBAR_HEIGHT,
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
      title: "GoLive",
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    // One level above the canvas, so it is never drawn over.
    window.setAlwaysOnTop(true, "screen-saver", 1);
    // The buttons are for the person drawing, never for the people watching.
    if (options.canHideFromViewers) window.setContentProtection(true);
    window.setMenuBarVisibility(false);
    window.once("ready-to-show", () => apply());
    window.on("closed", () => {
      if (toolbar === window) toolbar = null;
    });
    void window.loadFile(html("screen-pen-toolbar.html"));
    return window;
  }

  function placeToolbar(window: BrowserWindow) {
    const display =
      (activeDisplay !== null && screen.getAllDisplays().find((d) => d.id === activeDisplay)) ||
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width } = display.workArea;
    window.setBounds({
      x: Math.round(x + (width - TOOLBAR_WIDTH) / 2),
      y: Math.round(y + 12),
      width: TOOLBAR_WIDTH,
      height: TOOLBAR_HEIGHT,
    });
  }

  /** Puts every window where the state says it should be. Safe to call any time. */
  function apply() {
    for (const canvas of canvases.values()) {
      const { window } = canvas;
      if (!alive(window)) continue;
      const isActive = drawing && canvas.displayId === activeDisplay;
      window.setIgnoreMouseEvents(!isActive);
      window.setFocusable(isActive);
      // Nothing to show is not shown — not even transparent: an empty window
      // is still one the compositor has to blend over the whole monitor.
      const show = visible && (isActive || canvas.marks > 0);
      if (show) {
        if (isActive) {
          if (!window.isVisible()) window.show();
          window.focus();
        } else if (!window.isVisible()) {
          window.showInactive();
        }
      } else if (window.isVisible()) {
        window.hide();
      }
      if (!window.webContents.isLoading()) window.webContents.send(IPC.screenPenUpdate, stateFor(canvas));
    }

    const wantToolbar = drawing || Boolean(notice);
    if (wantToolbar && !alive(toolbar)) toolbar = createToolbar();
    if (alive(toolbar)) {
      // Only the bar takes clicks; a notice is something to read, not a
      // strip of the screen that stops answering the mouse.
      toolbar.setIgnoreMouseEvents(!drawing);
      if (wantToolbar) {
        // Placed as it appears, and then left where the person dragged it.
        if (!toolbar.isVisible()) {
          placeToolbar(toolbar);
          toolbar.showInactive();
        }
      } else if (toolbar.isVisible()) {
        toolbar.hide();
      }
      if (!toolbar.webContents.isLoading()) toolbar.webContents.send(IPC.screenPenUpdate, stateFor(null));
    }
  }

  function say(text: string | undefined) {
    if (noticeTimer) clearTimeout(noticeTimer);
    notice = text ?? null;
    noticeTimer = notice
      ? setTimeout(() => {
          notice = null;
          noticeTimer = null;
          apply();
        }, NOTICE_MS)
      : null;
  }

  function startDrawing() {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    activeDisplay = display.id;
    if (!canvases.has(display.id)) createCanvas(display);
    drawing = true;
    visible = true;
    drawingSince = Date.now();
    say(undefined);
    options.onEvent("screen_pen_draw_start");
  }

  function stopDrawing() {
    if (!drawing) return;
    drawing = false;
    options.onEvent("screen_pen_draw_stop", (Date.now() - drawingSince) / 1000);
    // Giving the mouse back means giving the keyboard back too.
    const canvas = activeCanvas();
    if (canvas && alive(canvas.window)) canvas.window.blur();
  }

  function setHiddenFromViewers(on: boolean) {
    if (!options.canHideFromViewers) return;
    hiddenFromViewers = on;
    for (const canvas of canvases.values()) {
      if (alive(canvas.window)) canvas.window.setContentProtection(on);
    }
    options.onEvent(on ? "screen_pen_viewers_hide" : "screen_pen_viewers_show");
  }

  function handleAction(action: ScreenPenAction) {
    if (!enabled) return;
    if (action === "screenPenDraw") {
      if (drawing) stopDrawing();
      else startDrawing();
    } else if (action === "screenPenShow") {
      if (visible) {
        stopDrawing();
        visible = false;
        say(labels.noticeHidden);
        options.onEvent("screen_pen_hide");
      } else {
        visible = true;
        say(labels.noticeShown);
        options.onEvent("screen_pen_show");
      }
    } else if (action === "screenPenViewers") {
      if (!options.canHideFromViewers) {
        say(labels.noticeCannotHide);
      } else {
        setHiddenFromViewers(!hiddenFromViewers);
        if (!drawing) say(hiddenFromViewers ? labels.noticeViewersHidden : labels.noticeViewersShown);
      }
    }
    apply();
  }

  function destroyAll() {
    drawing = false;
    activeDisplay = null;
    say(undefined);
    for (const canvas of canvases.values()) if (alive(canvas.window)) canvas.window.destroy();
    canvases.clear();
    if (alive(toolbar)) toolbar.destroy();
    toolbar = null;
  }

  function isPenWindow(sender: WebContents): Canvas | "toolbar" | null {
    if (alive(toolbar) && sender === toolbar.webContents) return "toolbar";
    for (const canvas of canvases.values()) if (alive(canvas.window) && sender === canvas.window.webContents) return canvas;
    return null;
  }

  function readLabels(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (/^[a-zA-Z]{1,40}$/.test(key) && typeof value === "string") out[key] = value.slice(0, 200);
    }
    return out;
  }

  /** Registered once, from main's ready handler. `fromApp` checks the sender is our own page. */
  function registerIpc(fromApp: (sender: WebContents) => boolean) {
    ipcMain.on(IPC.screenPenConfigure, (event, raw: unknown) => {
      if (!fromApp(event.sender)) return;
      const config = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const next = config.enabled === true;
      labels = readLabels(config.labels);
      if (enabled && !next) destroyAll();
      enabled = next;
      apply();
    });

    ipcMain.on(IPC.screenPenAction, (event, action: unknown) => {
      if (!fromApp(event.sender)) return;
      if (action === "screenPenDraw" || action === "screenPenShow" || action === "screenPenViewers") handleAction(action);
    });

    ipcMain.handle(IPC.screenPenState, (event) => {
      const who = isPenWindow(event.sender);
      if (!who) return null;
      return stateFor(who === "toolbar" ? null : who);
    });

    ipcMain.on(IPC.screenPenCanvasInfo, (event, raw: unknown) => {
      const who = isPenWindow(event.sender);
      if (!who || who === "toolbar" || !raw || typeof raw !== "object") return;
      const info = raw as Partial<ScreenPenCanvasInfo> & { added?: unknown };
      const marks = typeof info.marks === "number" && info.marks >= 0 ? Math.floor(info.marks) : 0;
      if (info.added === true) options.onEvent("screen_pen_mark");
      who.marks = marks;
      who.canUndo = info.canUndo === true;
      who.canRedo = info.canRedo === true;
      apply();
    });

    ipcMain.on(IPC.screenPenCommand, (event, raw: unknown) => {
      const who = isPenWindow(event.sender);
      if (!who || !raw || typeof raw !== "object") return;
      const command = raw as Record<string, unknown>;
      switch (command.type) {
        case "tool":
          if (SCREEN_PEN_TOOLS.includes(command.tool as ScreenPenTool)) tool = command.tool as ScreenPenTool;
          break;
        case "color":
          if (typeof command.color === "string" && /^#[0-9a-f]{6}$/i.test(command.color)) color = command.color;
          break;
        case "size":
          if (typeof command.size === "number" && SCREEN_PEN_SIZES.includes(command.size)) size = command.size;
          break;
        case "undo":
        case "redo":
        case "clear": {
          const canvas = who === "toolbar" ? activeCanvas() : who;
          if (canvas && alive(canvas.window)) canvas.window.webContents.send(IPC.screenPenCanvasCommand, command.type);
          if (command.type === "clear") options.onEvent("screen_pen_clear");
          break;
        }
        case "stop":
          stopDrawing();
          break;
        case "toggleViewers":
          setHiddenFromViewers(!hiddenFromViewers);
          break;
        default:
          return;
      }
      apply();
    });

    screen.on("display-removed", (_event, display) => {
      const canvas = canvases.get(display.id);
      if (canvas && alive(canvas.window)) canvas.window.destroy();
      canvases.delete(display.id);
      if (activeDisplay === display.id) {
        stopDrawing();
        activeDisplay = null;
      }
      apply();
    });
    screen.on("display-metrics-changed", (_event, display) => {
      const canvas = canvases.get(display.id);
      if (canvas && alive(canvas.window)) canvas.window.setBounds(display.bounds);
    });
  }

  return { registerIpc, destroy: destroyAll };
}
