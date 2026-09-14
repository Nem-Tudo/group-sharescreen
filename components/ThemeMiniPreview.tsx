"use client";

import { gradientCss, type RoomTheme } from "@/lib/roomThemes";

// A theme drawn as a room in miniature: the header, a video tile, the chat
// column with its three steps of text, and the box you type into — each in the
// palette slot that paints it for real (see roomThemes' token map). Four
// stripes of colour said which colours a theme has; this says what it looks
// like, which is the question somebody choosing one is actually asking.
//
// Pure markup and inline colours, no theme applied to anything: dozens of these
// sit side by side in a grid, each in its own palette.

export function ThemeMiniPreview({ theme, className = "" }: { theme: RoomTheme; className?: string }) {
  const { palette, accent, accentText, background } = theme.spec;
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded-lg border ${className}`}
      style={{ background: gradientCss(theme.spec) ?? palette.page, borderColor: palette.border }}
    >
      {background && (
        <>
          {/* The real picture, at the blur and dim it is worn with. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={background.url}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full scale-110 object-cover"
            style={{ filter: `blur(${Math.min(background.blur, 8)}px)` }}
          />
          <span className="absolute inset-0" style={{ background: palette.page, opacity: background.dim }} />
        </>
      )}
      <div className="relative flex h-full flex-col gap-[6%] p-[5%]">
        {/* The header: a mark in the accent, then the controls as quiet pills. */}
        <div
          className="flex h-[16%] shrink-0 items-center gap-[4%] rounded px-[4%]"
          style={{ background: palette.surface, border: `1px solid ${palette.border}` }}
        >
          <span className="aspect-square h-[45%] rounded-full" style={{ background: accent }} />
          <span className="h-[28%] w-[22%] rounded-full" style={{ background: palette.text, opacity: 0.85 }} />
          <span className="ml-auto h-[40%] w-[14%] rounded" style={{ background: palette.raised }} />
          <span
            className="flex h-[48%] w-[16%] items-center justify-center rounded"
            style={{ background: accent }}
          >
            <span className="h-[30%] w-[50%] rounded-full" style={{ background: accentText, opacity: 0.9 }} />
          </span>
        </div>

        <div className="flex min-h-0 flex-1 gap-[4%]">
          {/* A video tile. */}
          <div
            className="relative flex-[1.35] rounded"
            style={{ background: palette.raised, border: `1px solid ${palette.border}` }}
          >
            <span
              className="absolute bottom-[10%] left-[8%] h-[12%] w-[38%] rounded-full"
              style={{ background: palette.surface }}
            />
          </div>
          {/* The chat: a name, a message, a timestamp, and the input. */}
          <div
            className="flex flex-1 flex-col gap-[7%] rounded p-[6%]"
            style={{ background: palette.surface, border: `1px solid ${palette.border}` }}
          >
            <span className="h-[9%] w-[45%] rounded-full" style={{ background: palette.textSoft }} />
            <span className="h-[9%] w-[85%] rounded-full" style={{ background: palette.text }} />
            <span className="h-[9%] w-[30%] rounded-full" style={{ background: palette.muted }} />
            <span className="h-[9%] w-[60%] rounded-full" style={{ background: palette.text }} />
            <span
              className="mt-auto h-[20%] w-full rounded"
              style={{ background: palette.input, border: `1px solid ${palette.border}` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "Sem tema": half the site's light look and half its dark one, since with no
 * theme each person sees whichever of the two — or whichever theme of their
 * own — they picked. Fixed colours rather than the zinc classes, which a theme
 * on the room behind would repaint.
 */
export function NoThemeMiniPreview({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded-lg border border-dashed ${className}`}
      style={{
        borderColor: "#a1a1aa",
        background: "linear-gradient(135deg, #f4f4f5 0 50%, #18181b 50% 100%)",
      }}
    >
      <div className="relative flex h-full flex-col gap-[6%] p-[5%]">
        <div className="h-[16%] shrink-0 rounded" style={{ background: "rgba(161,161,170,0.35)" }} />
        <div className="flex min-h-0 flex-1 gap-[4%]">
          <div className="flex-[1.35] rounded" style={{ background: "rgba(161,161,170,0.3)" }} />
          <div className="flex-1 rounded" style={{ background: "rgba(161,161,170,0.25)" }} />
        </div>
      </div>
    </div>
  );
}
