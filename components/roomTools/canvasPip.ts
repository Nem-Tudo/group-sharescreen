"use client";

import { useSyncExternalStore } from "react";
import { getRoomToolsState, type DrawTool, type Stroke, type TextTool } from "@/lib/roomTools";
import { highlightCode, type CodeTokenType } from "@/lib/codeHighlight";
import { drawStroke, type Rect } from "./strokes";

// The browser's own picture-in-picture for what is not a <video>: a tool
// (whiteboard, notepad, code editor) or a screen with the room's notes over
// it. That picture-in-picture only takes a video, so the thing is drawn on a
// canvas, a few times a second, and the canvas's stream is what the video
// plays. Only to watch — everything is used in the room itself.

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

// How often the canvas is redrawn. A hidden tab slows timers down, so in the
// background this is as fast as the browser allows, not as fast as asked.
const FRAME_MS = 100;

/** The size everything is drawn at; shown scaled to wherever it goes. */
export const PIP_WIDTH = 1280;
export const PIP_HEIGHT = 720;

let current: { video: HTMLVideoElement; stop: () => void } | null = null;

const noSubscribe = () => () => {};
const supportedNow = () => typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);

/** Whether the browser has video picture-in-picture — false while rendering on the server. */
export function useCanvasPipSupported(): boolean {
  return useSyncExternalStore(noSubscribe, supportedNow, () => false);
}

/**
 * Opens `draw` in the browser's picture-in-picture. Must be called from a
 * click. Resolves to a function that closes it, or null when the browser said
 * no; `onClose` runs when it goes away, by that function or by its own ×.
 */
export async function openCanvasPip(
  draw: Draw,
  { width = PIP_WIDTH, height = PIP_HEIGHT, onClose }: { width?: number; height?: number; onClose?: () => void } = {}
): Promise<(() => void) | null> {
  if (!supportedNow()) return null;
  current?.stop();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  draw(ctx, width, height);

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // In the page, but not seen: some browsers only float a video that is.
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
  });
  video.srcObject = canvas.captureStream();
  document.body.appendChild(video);

  const timer = window.setInterval(() => draw(ctx, width, height), FRAME_MS);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    video.removeEventListener("leavepictureinpicture", stop);
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    (video.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    video.remove();
    if (current?.video === video) current = null;
    onClose?.();
  };
  video.addEventListener("leavepictureinpicture", stop);

  try {
    await video.play();
    await video.requestPictureInPicture();
  } catch {
    stop();
    return null;
  }
  current = { video, stop };
  return stop;
}

// --- What is drawn --------------------------------------------------------

// The same colors as the tools in the room (ToolViews), in either theme.
type Palette = { background: string; text: string; tokens: Record<CodeTokenType, string> };

const LIGHT: Palette = {
  background: "#ffffff",
  text: "#27272a",
  tokens: {
    comment: "#71717a",
    string: "#047857",
    number: "#c2410c",
    keyword: "#6d28d9",
    literal: "#c2410c",
    func: "#1d4ed8",
    tag: "#be123c",
    attr: "#b45309",
    added: "#047857",
    removed: "#b91c1c",
  },
};

const DARK: Palette = {
  // Read from the page when it can be: the dark theme repaints zinc-950
  // (see app/globals.css).
  background: "#1a1a1f",
  text: "#e4e4e7",
  tokens: {
    comment: "#71717a",
    string: "#34d399",
    number: "#fdba74",
    keyword: "#a78bfa",
    literal: "#fdba74",
    func: "#38bdf8",
    tag: "#fb7185",
    attr: "#fcd34d",
    added: "#34d399",
    removed: "#f87171",
  },
};

/** The theme the page is in now (see lib/theme.ts — `data-theme` on <html>). */
function palette(): Palette {
  if (document.documentElement.dataset.theme !== "dark") return LIGHT;
  const background = getComputedStyle(document.documentElement).getPropertyValue("--color-zinc-950").trim();
  return background ? { ...DARK, background } : DARK;
}

function strokesOf(toolId: string, target?: string): Omit<Stroke, "id" | "by">[] {
  const { tools, optimistic, live } = getRoomToolsState();
  const tool = tools.find((t) => t.id === toolId) as DrawTool | undefined;
  const matches = (s: { toolId: string; target?: string }) => s.toolId === toolId && (target === undefined || s.target === target);
  return [
    ...(tool?.strokes ?? []).filter((s) => target === undefined || s.target === target),
    ...Object.values(optimistic).filter(matches),
    ...Object.values(live).filter(matches),
  ];
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, width: number, height: number, colors: Palette) {
  const pad = 28;
  const size = 26;
  const lineHeight = size * 1.4;
  ctx.font = `${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = colors.text;
  ctx.textBaseline = "top";
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      if (line && ctx.measureText(line + word).width > width - 2 * pad) {
        lines.push(line);
        line = word.trimStart();
      } else {
        line += word;
      }
    }
    lines.push(line);
  }
  // The end of the text, which is where people are writing, when it does not fit.
  const fit = Math.floor((height - 2 * pad) / lineHeight);
  lines.slice(Math.max(0, lines.length - fit)).forEach((line, i) => ctx.fillText(line, pad, pad + i * lineHeight));
}

function drawCode(ctx: CanvasRenderingContext2D, text: string, language: string, width: number, height: number, colors: Palette) {
  const pad = 24;
  const size = 22;
  const lineHeight = size * 1.45;
  ctx.font = `${size}px ui-monospace, "Cascadia Code", Consolas, monospace`;
  ctx.textBaseline = "top";
  const charWidth = ctx.measureText("M").width;
  const columns = Math.max(1, Math.floor((width - 2 * pad) / charWidth));
  // Lines of [color, text] runs, wrapped at the edge.
  const lines: [string, string][][] = [[]];
  let column = 0;
  for (const token of highlightCode(text, language)) {
    const color = token.type ? colors.tokens[token.type] : colors.text;
    for (const part of token.value.split(/(\n)/)) {
      if (part === "\n") {
        lines.push([]);
        column = 0;
        continue;
      }
      let rest = part;
      while (rest) {
        const room = columns - column;
        if (room <= 0) {
          lines.push([]);
          column = 0;
          continue;
        }
        const piece = rest.slice(0, room);
        lines[lines.length - 1].push([color, piece]);
        column += piece.length;
        rest = rest.slice(room);
      }
    }
  }
  const fit = Math.floor((height - 2 * pad) / lineHeight);
  lines.slice(Math.max(0, lines.length - fit)).forEach((runs, i) => {
    let x = pad;
    for (const [color, piece] of runs) {
      ctx.fillStyle = color;
      ctx.fillText(piece, x, pad + i * lineHeight);
      x += piece.length * charWidth;
    }
  });
}

/** Draws a room tool (whiteboard, notepad, code editor) as it is now. */
export function toolDrawer(toolId: string): Draw {
  return (ctx, width, height) => {
    const tool = getRoomToolsState().tools.find((t) => t.id === toolId);
    // The whiteboard is a white board in either theme, as in the room; the
    // notepad and the code editor follow the theme.
    const colors = tool && tool.kind !== "whiteboard" ? palette() : LIGHT;
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    if (!tool) return;
    if (tool.kind === "notepad") drawWrappedText(ctx, (tool as TextTool).text, width, height, colors);
    else if (tool.kind === "code") drawCode(ctx, (tool as TextTool).text, (tool as TextTool).language, width, height, colors);
    else for (const stroke of strokesOf(toolId)) drawStroke(ctx, stroke, { x: 0, y: 0, w: width, h: height });
  };
}

/**
 * Draws what `video` is showing, with the room's screen notes for
 * `annotationKey` over it, where they land on the picture.
 */
export function annotatedVideoDrawer(video: HTMLVideoElement, annotationKey: string): Draw {
  return (ctx, width, height) => {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let rect: Rect = { x: 0, y: 0, w: width, h: height };
    if (vw && vh) {
      const scale = Math.min(width / vw, height / vh);
      rect = { x: (width - vw * scale) / 2, y: (height - vh * scale) / 2, w: vw * scale, h: vh * scale };
      ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);
    }
    const annotate = getRoomToolsState().tools.find((t) => t.kind === "annotate");
    if (!annotate) return;
    for (const stroke of strokesOf(annotate.id, annotationKey)) drawStroke(ctx, stroke, rect);
  };
}
