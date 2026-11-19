"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/lib/useI18n";
import { LOCALE_TAGS } from "@/lib/i18n";

/**
 * The slate that opens every scene: a timecode-style label (the colour is the
 * scene's tally), a condensed uppercase headline, and an optional line under it.
 * Left-aligned like a lower third; `center` only for the few scenes built
 * around a centred object.
 */
export function SceneTitle({
  kicker,
  title,
  sub,
  color = "var(--a-amber)",
  center = false,
  glitch = false,
  compact = false,
}: {
  kicker: string;
  title: string;
  sub?: ReactNode;
  color?: string;
  center?: boolean;
  glitch?: boolean;
  /** A smaller headline, for pinned scenes that must fit one screen. */
  compact?: boolean;
}) {
  return (
    <header className={`relative z-10 mx-auto w-full max-w-6xl ${center ? "text-center" : ""}`}>
      <p
        data-reveal
        className={`anniv-mono flex items-center gap-2.5 text-[11px] font-medium uppercase sm:text-xs ${center ? "justify-center" : ""}`}
        style={{ color }}
      >
        <span className="h-2 w-2 shrink-0" style={{ background: color }} aria-hidden="true" />
        {kicker}
      </p>
      <h2 data-reveal className={`anniv-display mt-4 max-w-5xl ${compact ? "text-4xl sm:text-5xl" : "text-[2.9rem] sm:text-7xl lg:text-[5.5rem]"} ${center ? "mx-auto" : ""}`}>
        {glitch ? (
          <span className="anniv-glitch" data-text={title}>
            {title}
          </span>
        ) : (
          title
        )}
      </h2>
      {sub && (
        <p data-reveal className={`mt-5 max-w-2xl text-base leading-relaxed text-[var(--a-mute)] sm:text-lg ${center ? "mx-auto" : ""}`}>
          {sub}
        </p>
      )}
    </header>
  );
}

/**
 * A fixed-size design (`width`×`height`) scaled down to whatever width it is
 * given — the old and new screens are drawn once, at desktop size, and shrink
 * on a phone like a screenshot would.
 */
export function ScaledStage({
  width,
  height,
  children,
  className = "",
}: {
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div ref={outer} className={`relative w-full overflow-hidden ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ["#f43f5e", "#fbbf24", "#34d399", "#38bdf8", "#a78bfa", "#fb7185", "#ffffff"];

/**
 * A burst of confetti over the whole screen each time `burst` changes (0 = none).
 * Reuses .golive-confetti-piece from globals.css; portalled to <body> so no
 * transformed ancestor (the pinned scenes) can trap the fixed layer.
 */
export function Confetti({ burst, pieces = 90 }: { burst: number; pieces?: number }) {
  const [shown, setShown] = useState<{ id: number; items: { style: CSSProperties; shape: string }[] } | null>(null);
  useEffect(() => {
    if (!burst) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = Array.from({ length: pieces }, () => {
      const direction = Math.random() < 0.5 ? -1 : 1;
      const size = 6 + Math.random() * 8;
      return {
        shape: Math.random() < 0.3 ? "9999px" : "2px",
        style: {
          left: `${Math.random() * 100}%`,
          width: size,
          height: size * (0.5 + Math.random()),
          background: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          "--confetti-duration": `${(2.6 + Math.random() * 2).toFixed(2)}s`,
          "--confetti-delay": `${(Math.random() * 0.8).toFixed(2)}s`,
          "--confetti-drift": `${Math.round((Math.random() - 0.5) * 260)}px`,
          "--confetti-spin": `${direction * (240 + Math.round(Math.random() * 480))}deg`,
          "--confetti-sway": `${8 + Math.round(Math.random() * 18)}px`,
          "--confetti-sway-duration": `${(0.8 + Math.random() * 0.8).toFixed(2)}s`,
        } as CSSProperties,
      };
    });
    // Rendering a fresh burst is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown({ id: burst, items });
    const timer = setTimeout(() => setShown((s) => (s?.id === burst ? null : s)), 6000);
    return () => clearTimeout(timer);
  }, [burst, pieces]);
  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      {shown.items.map((item, i) => (
        <span key={`${shown.id}-${i}`} className="golive-confetti-piece" style={{ ...item.style, borderRadius: item.shape }} />
      ))}
    </div>,
    document.body
  );
}

/** Numbers in the page's language (1.234 in Portuguese, 1,234 in English), the same on server and client. */
export function useNumberFormat(): (n: number, digits?: number) => string {
  const locale = useLocale();
  return (n, digits = 0) =>
    n.toLocaleString(LOCALE_TAGS[locale], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
