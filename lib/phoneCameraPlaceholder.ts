"use client";

// "Celular como câmera": what the room's camera shows while the phone it
// should come from is not there — closed, disconnected, or never answered.
// The camera stays on with this instead of turning off, so the person sees
// why and how to bring the phone back, and the phone's video takes its place
// (a swap, see lib/useRoomMedia) the moment it connects.

export interface PhoneCameraPlaceholderText {
  title: string;
  description: string;
  stepsTitle: string;
  steps: string[];
}

const WIDTH = 1280;
const HEIGHT = 720;
const REDRAW_MS = 500;

const placeholders = new WeakSet<MediaStreamTrack>();

/** Whether this track is the placeholder, not a phone's (or any camera's) video. */
export function isPhoneCameraPlaceholder(track: MediaStreamTrack | null | undefined): boolean {
  return Boolean(track && placeholders.has(track));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function draw(ctx: CanvasRenderingContext2D, text: PhoneCameraPlaceholderText) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const left = 140;
  const maxWidth = WIDTH - left * 2;
  const font = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "top";

  // Laid out first, so the whole block can be centred vertically.
  type Line = { text: string; font: string; color: string; x: number; height: number; gap: number };
  const blocks: Line[] = [];
  const add = (value: string, size: number, weight: string, color: string, gap: number, x = left, indent = 0) => {
    ctx.font = `${weight} ${size}px ${font}`;
    const wrapped = wrap(ctx, value, maxWidth - (x - left) - indent);
    wrapped.forEach((part, i) =>
      blocks.push({
        text: part,
        font: ctx.font,
        color,
        x: i === 0 ? x : x + indent,
        height: Math.round(size * 1.3),
        gap: i === wrapped.length - 1 ? gap : 0,
      })
    );
  };
  add(text.title, 46, "700", "#fff", 18);
  add(text.description, 26, "400", "#a1a1aa", 40);
  add(text.stepsTitle, 26, "600", "#fff", 14);
  ctx.font = `400 24px ${font}`;
  text.steps.forEach((step, i) => {
    const number = `${i + 1}. `;
    add(`${number}${step}`, 24, "400", "#d4d4d8", 12, left, ctx.measureText(number).width);
    ctx.font = `400 24px ${font}`;
  });

  const total = blocks.reduce((sum, line) => sum + line.height + line.gap, 0);
  let y = Math.max(40, Math.round((HEIGHT - total) / 2));
  for (const line of blocks) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, line.x, y);
    y += line.height + line.gap;
  }
}

/**
 * A black video with the message and the steps to bring the phone back.
 * Redrawn on a timer (a canvas that never changes gives an encoder no frames
 * to send a newcomer); stopping the track stops the timer.
 */
export function createPhoneCameraPlaceholder(text: PhoneCameraPlaceholderText): MediaStreamTrack {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  draw(ctx, text);
  const track = canvas.captureStream(5).getVideoTracks()[0];
  if (!track) throw new Error("no canvas track");
  const timer = setInterval(() => draw(ctx, text), REDRAW_MS);
  const stop = track.stop.bind(track);
  track.stop = () => {
    clearInterval(timer);
    stop();
  };
  placeholders.add(track);
  return track;
}
