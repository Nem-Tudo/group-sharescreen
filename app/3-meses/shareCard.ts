"use client";

import { avatarDecorationOf, avatarImageOf } from "@/lib/avatarShape";

// The pictures the "3 meses" page hands out for sharing: a 1080×1920 story
// (Instagram/WhatsApp Stories size) drawn on a canvas, in the page's own look —
// colour bars, the on-air slate, condensed headlines, mono labels. Three of
// them: the personal recap, the gift (your face in the frame you won), and the
// page itself for whoever is not signed in.
//
// Every word on them comes in already translated (the component that asks
// knows the locale); this file only lays them out.

export const CARD_W = 1080;
export const CARD_H = 1920;

const BG = "#111215";
const INK = "#ece9e2";
const MUTE = "#8b8d94";
const TALLY = "#ff3b2f";
const AMBER = "#f2b705";
const BLUE = "#4c86ff";
const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

export interface CardFrame {
  /** "AO VIVO" */
  live: string;
  /** "GO LIVE · 3 MESES" */
  brand: string;
  hashtag: string;
  /** Shown at the foot, without the scheme. */
  url: string;
}

export interface RecapCardData {
  kicker: string;
  name: string;
  handle: string;
  /** The published avatar URL (its decoration is drawn too). */
  face: string | null;
  bigLabel: string;
  bigValue: string;
  comparison: string | null;
  stats: { value: string; label: string }[];
  styleLead: string;
  style: string;
  footnote: string;
}

export interface GiftCardData {
  kicker: string;
  name: string;
  face: string | null;
  /** The frame won (its picture's path). */
  decoration: string;
  title: string;
  text: string;
}

export interface PageCardData {
  kicker: string;
  title: string[];
  stats: { value: string; label: string }[];
  text: string;
}

type Fonts = { display: string; mono: string; body: string };

function fontsOf(): Fonts {
  const el = document.querySelector(".anniv") ?? document.documentElement;
  const css = getComputedStyle(el);
  const display = css.getPropertyValue("--font-anniv-display").trim();
  const mono = css.getPropertyValue("--font-anniv-mono").trim();
  return {
    display: display ? `${display}, "Arial Black", sans-serif` : `"Arial Black", sans-serif`,
    mono: mono ? `${mono}, ui-monospace, monospace` : "ui-monospace, monospace",
    body: `system-ui, -apple-system, "Segoe UI", sans-serif`,
  };
}

async function ready(fonts: Fonts) {
  try {
    await Promise.all([
      document.fonts.load(`800 100px ${fonts.display}`),
      document.fonts.load(`600 30px ${fonts.mono}`),
    ]);
  } catch {
    // Drawn with the fallbacks.
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // A picture from another host can only go on a canvas that is still
    // exportable if that host allows it; without that, the initial stands in.
    if (/^https?:/.test(src) && !src.startsWith(window.location.origin)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function setFont(ctx: CanvasRenderingContext2D, font: string, condensed = false) {
  ctx.font = font;
  try {
    (ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = condensed ? "condensed" : "normal";
  } catch {
    // Older canvases: full width.
  }
}

/** Splits text into lines no wider than `max`. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Writes wrapped text; returns the y under the last line. */
function paragraph(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lineHeight: number): number {
  for (const line of wrap(ctx, text, max)) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** Shrinks a font until the text fits `max`. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, family: string, max: number, condensed = false): number {
  let s = size;
  setFont(ctx, `${weight} ${s}px ${family}`, condensed);
  while (s > 20 && ctx.measureText(text).width > max) {
    s -= 4;
    setFont(ctx, `${weight} ${s}px ${family}`, condensed);
  }
  return s;
}

function bars(ctx: CanvasRenderingContext2D, y: number, h: number) {
  const w = CARD_W / BARS.length;
  BARS.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.floor(i * w), y, Math.ceil(w), h);
  });
}

function frame(ctx: CanvasRenderingContext2D, f: CardFrame, fonts: Fonts) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // Scanlines, barely there.
  ctx.fillStyle = "rgba(255,255,255,0.018)";
  for (let y = 0; y < CARD_H; y += 6) ctx.fillRect(0, y, CARD_W, 2);
  bars(ctx, 0, 18);

  // On-air slate + brand.
  setFont(ctx, `600 30px ${fonts.mono}`);
  const liveW = ctx.measureText(f.live.toUpperCase()).width + 88;
  ctx.fillStyle = TALLY;
  ctx.fillRect(72, 86, liveW, 58);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(104, 115, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.fillText(f.live.toUpperCase(), 128, 116);
  ctx.fillStyle = MUTE;
  ctx.textAlign = "right";
  ctx.fillText(f.brand.toUpperCase(), CARD_W - 72, 116);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Foot: the hashtag, the address, the bars again.
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(72, CARD_H - 210, CARD_W - 144, 2);
  setFont(ctx, `800 64px ${fonts.display}`, true);
  ctx.fillStyle = AMBER;
  ctx.fillText(f.hashtag.toUpperCase(), 72, CARD_H - 120);
  setFont(ctx, `500 30px ${fonts.mono}`);
  ctx.fillStyle = INK;
  ctx.textAlign = "right";
  ctx.fillText(f.url, CARD_W - 72, CARD_H - 128);
  ctx.textAlign = "left";
  bars(ctx, CARD_H - 18, 18);
}

/** A face in a circle, with its decoration around it when it wears one. */
async function face(ctx: CanvasRenderingContext2D, url: string | null, decoration: string | null, name: string, cx: number, cy: number, size: number, fonts: Fonts) {
  const src = avatarImageOf(url) || "/assets/default_avatars/01.png";
  const [img, deco] = await Promise.all([loadImage(src), decoration ? loadImage(decoration) : Promise.resolve(null)]);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    // Cover, like object-fit.
    const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = BLUE;
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.fillStyle = "#fff";
    setFont(ctx, `800 ${Math.round(size * 0.45)}px ${fonts.display}`, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(([...name.trim()][0] ?? "?").toUpperCase(), cx, cy + size * 0.03);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
  if (deco) {
    const d = size * 1.2;
    ctx.drawImage(deco, cx - d / 2, cy - d / 2, d, d);
  } else {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function newCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  return [canvas, ctx];
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null);
    }
  });
}

export async function drawRecapCard(data: RecapCardData, f: CardFrame): Promise<Blob | null> {
  const fonts = fontsOf();
  await ready(fonts);
  const [canvas, ctx] = newCanvas();
  frame(ctx, f, fonts);
  const center = CARD_W / 2;

  setFont(ctx, `600 30px ${fonts.mono}`);
  ctx.fillStyle = AMBER;
  ctx.textAlign = "center";
  ctx.fillText(data.kicker.toUpperCase(), center, 232);
  ctx.textAlign = "left";

  await face(ctx, data.face, avatarDecorationOf(data.face), data.name, center, 400, 220, fonts);

  ctx.textAlign = "center";
  fit(ctx, data.name.toUpperCase(), "800", 96, fonts.display, CARD_W - 160, true);
  ctx.fillStyle = INK;
  ctx.fillText(data.name.toUpperCase(), center, 620);
  setFont(ctx, `500 32px ${fonts.mono}`);
  ctx.fillStyle = MUTE;
  ctx.fillText(data.handle, center, 668);

  // The headline figure.
  setFont(ctx, `600 32px ${fonts.mono}`);
  ctx.fillStyle = TALLY;
  ctx.fillText(data.bigLabel.toUpperCase(), center, 760);
  fit(ctx, data.bigValue, "800", 230, fonts.display, CARD_W - 160, true);
  ctx.fillStyle = INK;
  ctx.fillText(data.bigValue, center, 960);
  let y = 975;
  if (data.comparison) {
    setFont(ctx, `700 40px ${fonts.body}`);
    ctx.fillStyle = INK;
    y = paragraph(ctx, data.comparison, center, 1030, CARD_W - 220, 50);
  }
  ctx.textAlign = "left";

  // The rest, three to a row.
  const top = Math.max(y + 20, 1080);
  const cols = 3;
  const gap = 18;
  const cellW = (CARD_W - 144 - gap * (cols - 1)) / cols;
  const cellH = 140;
  data.stats.slice(0, 6).forEach((s, i) => {
    const x = 72 + (i % cols) * (cellW + gap);
    const cy = top + Math.floor(i / cols) * (cellH + gap);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, cy, cellW, cellH);
    ctx.fillStyle = INK;
    fit(ctx, s.value, "800", 72, fonts.display, cellW - 40, true);
    ctx.fillText(s.value, x + 22, cy + 78);
    setFont(ctx, `500 24px ${fonts.mono}`);
    ctx.fillStyle = MUTE;
    ctx.fillText(s.label.toUpperCase(), x + 22, cy + 116);
  });
  const rows = Math.ceil(Math.min(6, data.stats.length) / cols);
  const styleTop = top + rows * (cellH + gap) + 12;

  // The style, in a lower third.
  setFont(ctx, `600 28px ${fonts.mono}`);
  const leadW = ctx.measureText(data.styleLead.toUpperCase()).width + 40;
  ctx.fillStyle = BLUE;
  ctx.fillRect(72, styleTop, leadW, 50);
  ctx.fillStyle = "#fff";
  ctx.fillText(data.styleLead.toUpperCase(), 92, styleTop + 35);
  const styleSize = fit(ctx, data.style.toUpperCase(), "800", 96, fonts.display, CARD_W - 184, true);
  ctx.fillStyle = INK;
  ctx.fillRect(72, styleTop + 50, ctx.measureText(data.style.toUpperCase()).width + 40, styleSize + 24);
  ctx.fillStyle = BG;
  ctx.fillText(data.style.toUpperCase(), 92, styleTop + 50 + styleSize * 0.92);

  setFont(ctx, `500 30px ${fonts.body}`);
  ctx.fillStyle = MUTE;
  // Under the style's box (its top label, then the name with its padding).
  paragraph(ctx, data.footnote, 72, styleTop + 50 + styleSize + 24 + 50, CARD_W - 144, 40);

  return toBlob(canvas);
}

export async function drawGiftCard(data: GiftCardData, f: CardFrame): Promise<Blob | null> {
  const fonts = fontsOf();
  await ready(fonts);
  const [canvas, ctx] = newCanvas();
  frame(ctx, f, fonts);
  const center = CARD_W / 2;
  ctx.textAlign = "center";
  setFont(ctx, `600 34px ${fonts.mono}`);
  ctx.fillStyle = AMBER;
  ctx.fillText(data.kicker.toUpperCase(), center, 300);
  fit(ctx, data.name.toUpperCase(), "800", 110, fonts.display, CARD_W - 160, true);
  ctx.fillStyle = INK;
  ctx.fillText(data.name.toUpperCase(), center, 420);

  // A spotlight behind the face.
  const glow = ctx.createRadialGradient(center, 860, 40, center, 860, 520);
  glow.addColorStop(0, "rgba(242,183,5,0.28)");
  glow.addColorStop(1, "rgba(242,183,5,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 300, CARD_W, 1100);
  await face(ctx, data.face, data.decoration, data.name, center, 860, 460, fonts);

  ctx.textAlign = "center";
  fit(ctx, data.title.toUpperCase(), "800", 120, fonts.display, CARD_W - 160, true);
  ctx.fillStyle = INK;
  ctx.fillText(data.title.toUpperCase(), center, 1300);
  setFont(ctx, `600 40px ${fonts.body}`);
  ctx.fillStyle = MUTE;
  paragraph(ctx, data.text, center, 1380, CARD_W - 220, 52);
  ctx.textAlign = "left";
  return toBlob(canvas);
}

export async function drawPageCard(data: PageCardData, f: CardFrame): Promise<Blob | null> {
  const fonts = fontsOf();
  await ready(fonts);
  const [canvas, ctx] = newCanvas();
  frame(ctx, f, fonts);
  // Measured first, so the block sits in the middle of the card.
  const titleSizes = data.title.map((line) => fit(ctx, line.toUpperCase(), "800", 230, fonts.display, CARD_W - 144, true));
  setFont(ctx, `600 40px ${fonts.body}`);
  const textLines = wrap(ctx, data.text, CARD_W - 144).length;
  const stats = data.stats.slice(0, 4);
  const blockH = 40 + titleSizes.reduce((a, b) => a + b * 0.95, 0) + 90 + stats.length * 175 + 60 + textLines * 52;
  const startY = Math.max(260, (CARD_H - blockH) / 2 - 20);
  setFont(ctx, `600 32px ${fonts.mono}`);
  ctx.fillStyle = AMBER;
  ctx.fillText(data.kicker.toUpperCase(), 72, startY);
  let y = startY;
  data.title.forEach((line, i) => {
    const size = fit(ctx, line.toUpperCase(), "800", 230, fonts.display, CARD_W - 144, true);
    y += size * 0.95;
    ctx.fillStyle = i === data.title.length - 1 ? BLUE : INK;
    ctx.fillText(line.toUpperCase(), 72, y);
  });
  y += 90;
  for (const s of stats) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(72, y, CARD_W - 144, 2);
    fit(ctx, s.value, "800", 120, fonts.display, 560, true);
    ctx.fillStyle = INK;
    ctx.fillText(s.value, 72, y + 130);
    setFont(ctx, `500 28px ${fonts.mono}`);
    ctx.fillStyle = MUTE;
    paragraph(ctx, s.label.toUpperCase(), 660, y + 90, CARD_W - 732, 36);
    y += 175;
  }
  setFont(ctx, `600 40px ${fonts.body}`);
  ctx.fillStyle = INK;
  paragraph(ctx, data.text, 72, y + 60, CARD_W - 144, 52);
  return toBlob(canvas);
}
