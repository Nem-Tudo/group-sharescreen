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

export async function giftCardPng(planId: string, code: string): Promise<Blob> {
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
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadGiftCard(planId: string, code: string): Promise<void> {
  const blob = await giftCardPng(planId, code);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `golive-gift-${planId}-${code.slice(0, 4)}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
