"use client";

import { useEffect, useMemo, useState } from "react";

// The viewer's own name, tiled faintly across protected content.
//
// Capture protection (lib/captureProtection.ts) keeps software out; nothing
// keeps out a phone pointed at the screen. What this does instead is make any
// such photo say who took it — which, for somebody deciding whether to leak
// something, is usually the part that matters. It drifts slowly so it cannot
// be cropped out of the same spot every time, and never takes a click.
//
// Drawn as a repeating background rather than a grid of elements: a tile of
// SVG repeats to fill whatever box it is given, however big, so the name
// reaches every corner of a room on an ultrawide monitor as well as a phone.
// (A fixed number of rotated elements covered half the room and no more.)

const TILE_WIDTH = 320;
const TILE_HEIGHT = 160;

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function ViewerWatermark({ label, className = "" }: { label: string; className?: string }) {
  const [time, setTime] = useState(() => stamp());
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTime(stamp());
      setShift((current) => (current + 1) % 4);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const background = useMemo(() => {
    const text = escapeXml(label ? `${label} · ${time}` : time);
    // Two lines per tile, offset, so neighbouring tiles read as a brick
    // pattern rather than columns with gaps between them.
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_WIDTH}" height="${TILE_HEIGHT}">` +
      `<g transform="rotate(-24 ${TILE_WIDTH / 2} ${TILE_HEIGHT / 2})" font-family="system-ui,sans-serif" font-size="15" font-weight="600" fill="rgba(255,255,255,0.17)" stroke="rgba(0,0,0,0.18)" stroke-width="0.6" paint-order="stroke">` +
      `<text x="10" y="${TILE_HEIGHT * 0.35}">${text}</text>` +
      `<text x="${TILE_WIDTH / 2}" y="${TILE_HEIGHT * 0.85}">${text}</text>` +
      `</g></svg>`;
    return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }, [label, time]);

  const offsets = ["0px 0px", "-90px 40px", "70px -50px", "-40px -30px"];

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-20 select-none transition-[background-position] duration-[3000ms] ease-in-out ${className}`}
      style={{
        backgroundImage: background,
        backgroundRepeat: "repeat",
        backgroundSize: `${TILE_WIDTH}px ${TILE_HEIGHT}px`,
        backgroundPosition: offsets[shift],
      }}
    />
  );
}

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
