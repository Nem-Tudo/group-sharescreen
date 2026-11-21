"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/useI18n";

// The click that opens the page: browsers only let a page make sound after the
// person has done something, so the broadcast starts from a button — with the
// music, or without. The intro's countdown waits for it (see IntroSection's
// `started`), and the page does not scroll until then.

const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

export function StartGate({ onStart }: { onStart: (sound: boolean) => void }) {
  const t = useT();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    button.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black" role="dialog" aria-modal="true" aria-labelledby="anniv-gate-title">
      {/* The test card */}
      <div className="flex flex-[3]" aria-hidden="true">
        {BARS.map((c) => (
          <div key={c} className="flex-1" style={{ background: c }} />
        ))}
      </div>
      <div className="flex flex-1 bg-[#111215]" aria-hidden="true">
        {["#0000c0", "#111215", "#c000c0", "#111215", "#00c0c0", "#111215", "#c0c0c0"].map((c, i) => (
          <div key={i} className="flex-1" style={{ background: c }} />
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111215] p-7 text-center shadow-[0_30px_80px_rgba(0,0,0,0.6)] sm:p-9">
          <p className="anniv-mono flex items-center justify-center gap-2 text-[11px] uppercase text-[var(--a-tally)]">
            <span className="anniv-live-dot h-2 w-2 rounded-full bg-[var(--a-tally)]" aria-hidden="true" />
            {t("anniversary.gate.kicker")}
          </p>
          <h1 id="anniv-gate-title" className="anniv-display mt-4 text-5xl sm:text-6xl">
            {t("anniversary.gate.title")}
          </h1>
          <p className="mt-3 text-[15px] text-[var(--a-mute)]">{t("anniversary.gate.text")}</p>
          <button
            ref={button}
            type="button"
            onClick={() => onStart(true)}
            className="anniv-mono mt-7 flex w-full items-center justify-center gap-2.5 bg-[var(--a-tally)] px-6 py-4 text-sm font-semibold uppercase text-white transition hover:brightness-110"
          >
            <span aria-hidden="true">▶</span>
            {t("anniversary.gate.start")}
          </button>
          <button
            type="button"
            onClick={() => onStart(false)}
            className="anniv-mono mt-3 text-xs uppercase text-[var(--a-mute)] underline-offset-4 transition hover:text-[var(--a-ink)] hover:underline"
          >
            {t("anniversary.gate.silent")}
          </button>
        </div>
      </div>
    </div>
  );
}
