"use client";

import { planTierOf } from "@/lib/entitlements";

// The printed gift card (1/8 of an A4, portrait), with a code filled in.
//
// The artwork lives in public/gift-cards/<plan>.svg — the same files as
// web/print, plus a <!--CODE--> marker inside the code box — so the card an
// admin downloads here is the card that was designed, not a second drawing
// of it. This only writes the code into that box and turns it into a PNG.

/** 74.25 × 105 mm at 300 dpi. */
const WIDTH = 877;
const HEIGHT = 1240;

function templateFor(planId: string): string {
  const tier = planTierOf(planId);
  if (tier === "pro_ultra") return "/gift-cards/pro-ultra.svg";
  if (tier === "premium_max") return "/gift-cards/pro-max.svg";
  return "/gift-cards/pro.svg";
}

/** ABCD EFGH IJKL… — four at a time, which is how people read a code aloud. */
export function groupGiftCode(code: string): string {
  return code.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") ?? "";
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The code, laid into the box (x 60–682.5, y 680–810 in the card's units).
 * A full 24-character code is six groups, which only fit at a legible size
 * as two lines of three.
 */
function codeMarkup(code: string): string {
  const groups = groupGiftCode(code).split(" ");
  const lines = groups.length > 3
    ? [groups.slice(0, Math.ceil(groups.length / 2)), groups.slice(Math.ceil(groups.length / 2))]
    : [groups];
  const size = lines.length > 1 ? 34 : 44;
  const firstY = lines.length > 1 ? 755 : 778;
  return lines
    .map(
      (line, i) =>
        `<text x="371.25" y="${firstY + i * 40}" font-family="Consolas, 'Courier New', monospace" font-size="${size}" font-weight="700" letter-spacing="2" fill="#18181b">${escapeXml(line.join(" "))}</text>`
    )
    .join("\n    ");
}

export async function giftCardSvg(planId: string, code: string): Promise<string> {
  const res = await fetch(templateFor(planId));
  if (!res.ok) throw new Error(`gift card template ${res.status}`);
  return (await res.text()).replace("<!--CODE-->", codeMarkup(code));
}

/** The card drawn onto a canvas at print size. */
export async function giftCardCanvas(planId: string, code: string): Promise<HTMLCanvasElement> {
  const svg = await giftCardSvg(planId, code);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), type, quality)
  );
}

export async function giftCardPng(planId: string, code: string): Promise<Blob> {
  return canvasBlob(await giftCardCanvas(planId, code), "image/png");
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadGiftCard(planId: string, code: string): Promise<void> {
  saveBlob(await giftCardPng(planId, code), `golive-gift-${planId}-${code.slice(0, 4)}.png`);
}

// ─── A4 sheet ─────────────────────────────────────────────────────────────
//
// A card is exactly 1/8 of an A4, so a landscape sheet holds 4 × 2 of them
// edge to edge and one straight cut along each line separates them. Written
// as a bare PDF by hand — JPEG pages need nothing a library would add, and
// the admin page is not worth a dependency for it.

const MM = 72 / 25.4;
const SHEET_W = 297 * MM;
const SHEET_H = 210 * MM;
const COLS = 4;
const ROWS = 2;
const CARD_W = SHEET_W / COLS;
const CARD_H = SHEET_H / ROWS;

type PdfCard = { width: number; height: number; jpeg: Uint8Array };

function buildPdf(pages: PdfCard[][]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const f = (n: number) => n.toFixed(2);

  // Object numbers: 1 catalog, 2 page tree, then per page: the page, its
  // content stream, and one per image on it.
  let next = 3;
  const layout = pages.map((cards) => {
    const page = next++;
    const content = next++;
    const images = cards.map(() => next++);
    return { page, content, images, cards };
  });
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  const stream = (dict: string, data: Uint8Array) => {
    push(`<< ${dict} /Length ${data.length} >>\nstream\n`);
    push(data);
    push("\nendstream");
  };

  push("%PDF-1.4\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () =>
    push(`<< /Type /Pages /Count ${layout.length} /Kids [${layout.map((p) => `${p.page} 0 R`).join(" ")}] >>`)
  );
  for (const p of layout) {
    const xobjects = p.images.map((id, i) => `/Im${i} ${id} 0 R`).join(" ");
    object(p.page, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(SHEET_W)} ${f(SHEET_H)}] ` +
          `/Resources << /XObject << ${xobjects} >> >> /Contents ${p.content} 0 R >>`
      )
    );
    let ops = "";
    p.cards.forEach((_, i) => {
      const x = (i % COLS) * CARD_W;
      const y = SHEET_H - (Math.floor(i / COLS) + 1) * CARD_H;
      ops += `q ${f(CARD_W)} 0 0 ${f(CARD_H)} ${f(x)} ${f(y)} cm /Im${i} Do Q\n`;
    });
    // Cut guides: grey hairlines on the borders between cards.
    ops += "0.75 G 0.25 w\n";
    for (let c = 1; c < COLS; c++) ops += `${f(c * CARD_W)} 0 m ${f(c * CARD_W)} ${f(SHEET_H)} l S\n`;
    for (let r = 1; r < ROWS; r++) ops += `0 ${f(r * CARD_H)} m ${f(SHEET_W)} ${f(r * CARD_H)} l S\n`;
    object(p.content, () => stream("", enc.encode(ops)));
    p.cards.forEach((card, i) =>
      object(p.images[i], () =>
        stream(
          `/Type /XObject /Subtype /Image /Width ${card.width} /Height ${card.height} ` +
            "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode",
          card.jpeg
        )
      )
    );
  }
  const xref = length;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

/** Every card, 8 to a landscape A4, ready to print at 100% and cut. */
export async function downloadGiftCardsPdf(gifts: { planId: string; code: string }[]): Promise<void> {
  const cards: PdfCard[] = [];
  for (const gift of gifts) {
    const canvas = await giftCardCanvas(gift.planId, gift.code);
    const blob = await canvasBlob(canvas, "image/jpeg", 0.95);
    cards.push({ width: canvas.width, height: canvas.height, jpeg: new Uint8Array(await blob.arrayBuffer()) });
  }
  const pages: PdfCard[][] = [];
  for (let i = 0; i < cards.length; i += COLS * ROWS) pages.push(cards.slice(i, i + COLS * ROWS));
  saveBlob(buildPdf(pages), `golive-gifts-${cards.length}.pdf`);
}
