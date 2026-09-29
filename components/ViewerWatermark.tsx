"use client";

import { useEffect, useState } from "react";

// The viewer's own name, tiled faintly across protected content.
//
// Capture protection (lib/captureProtection.ts) keeps software out; nothing
// keeps out a phone pointed at the screen. What this does instead is make any
// such photo say who took it — which, for somebody deciding whether to leak
// something, is usually the part that matters. It drifts slowly so it cannot
// be cropped out of the same spot every time, and never takes a click.

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

  const text = `${label} · ${time}`;
  const offsets = ["0%, 0%", "-6%, 4%", "4%, -5%", "-3%, -3%"];

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-20 select-none overflow-hidden ${className}`}
    >
      <div
        className="absolute -inset-1/4 flex flex-wrap content-start gap-x-24 gap-y-20 transition-transform duration-[3000ms] ease-in-out"
        style={{ transform: `translate(${offsets[shift]}) rotate(-24deg)` }}
      >
        {Array.from({ length: 60 }, (_, i) => (
          <span
            key={i}
            className="whitespace-nowrap text-sm font-semibold text-white/[0.16] [text-shadow:0_0_2px_rgba(0,0,0,0.35)]"
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
