"use client";

import { MdDesktopWindows, MdSmartphone } from "react-icons/md";
import { presenceLabel } from "@/lib/presence";
import type { PresenceInfo, PresenceState } from "@/lib/signalingClient";

// The indicator beside a person's face. Two things at once:
//
//   colour — green while they are looking, blue for a browser tab they are not
//            looking at, yellow for the installed app left running behind
//            something. Nothing at all for offline: an absence rather than a
//            grey dot, because a grey dot is a thing on the screen that says
//            nothing, and the list it appears in is long.
//   shape  — a monitor for the GoLive app on a PC, a phone for anything on a
//            phone, a plain dot for an ordinary desktop browser.
//
// The two are one mark, not a badge on a badge: with a device known, the dot
// *becomes* the glyph, drawn in the state's colour. That keeps the indicator
// the size of a dot instead of the size of a button, which matters because it
// is mostly seen hanging off the corner of a 22-pixel avatar.
//
// Both wear an outline in the colour of whatever is behind them (see
// SURFACES): a ring around the dot, a stroke around the glyph. The indicator
// hangs off the corner of a photograph, and without it a yellow monitor over a
// yellow avatar is not an indicator.
//
// Both halves are also written out in the title and the accessible name (see
// presenceLabel): an indicator that differs from its neighbour only by hue, or
// only by silhouette, is the same indicator to somebody who cannot tell the two
// apart.

// One colour per state, as a fill for the plain dot and as ink for the glyph
// that replaces it. Two class names rather than one custom property so the
// palette stays greppable and Tailwind can see every class it has to emit.
const COLORS: Record<Exclude<PresenceState, "offline">, { dot: string; glyph: string }> = {
  online: { dot: "bg-emerald-500", glyph: "text-emerald-500" },
  away: { dot: "bg-sky-500", glyph: "text-sky-500" },
  background: { dot: "bg-amber-400", glyph: "text-amber-400" },
};

const GLYPHS = {
  app: MdDesktopWindows,
  mobile: MdSmartphone,
};

// What the indicator is sitting on, so it can be outlined in that colour: a
// ring around the dot, and a stroke around the glyph's own silhouette. Both
// exist for one reason — the indicator hangs off the corner of a photograph,
// and a coloured shape straight on top of a photograph is a shape that
// sometimes disappears.
//
// Named surfaces rather than a class name passed in by the caller, because
// Tailwind only emits classes it can *see*: a string assembled at runtime
// ("ring-" + something, or ringClassName with the prefix swapped) produces
// exactly the CSS that does not exist. Every literal a caller can ask for is
// therefore written out here.
const SURFACES = {
  /** The page, and any card sitting flat on it. */
  page: { ring: "ring-white dark:ring-zinc-950", stroke: "stroke-white dark:stroke-zinc-950" },
  /** A row tinted to stand out from its list — the participant list's own row. */
  raised: {
    ring: "ring-zinc-100 dark:ring-zinc-900",
    stroke: "stroke-zinc-100 dark:stroke-zinc-900",
  },
  /** A modal or popover, which sits a step lighter than the page in the dark. */
  dialog: { ring: "ring-white dark:ring-zinc-900", stroke: "stroke-white dark:stroke-zinc-900" },
};

export type PresenceSurface = keyof typeof SURFACES;

export function PresenceDot({
  presence,
  size = 10,
  /** What is behind the indicator, so its outline can match. */
  surface = "page",
  className = "",
}: {
  presence: PresenceInfo | null;
  /** The plain dot's diameter. A glyph is drawn slightly larger, since the same
   *  number of pixels carries a filled circle further than a monitor. */
  size?: number;
  surface?: PresenceSurface;
  className?: string;
}) {
  if (!presence || presence.state === "offline") return null;
  const label = presenceLabel(presence);
  const color = COLORS[presence.state];
  const ground = SURFACES[surface];
  const Glyph = presence.device ? GLYPHS[presence.device] : null;

  if (Glyph) {
    const box = Math.max(11, Math.round(size * 1.2));
    return (
      <Glyph
        role="img"
        aria-label={label}
        title={label}
        // paint-order puts the stroke *under* the fill, so the outline grows
        // outwards into the background instead of eating the icon it is
        // supposed to be protecting. The width is in the icon's own 24-unit
        // viewBox, so it scales with the glyph rather than needing a value per
        // call site.
        style={{ width: box, height: box, paintOrder: "stroke" }}
        strokeWidth={2.5}
        className={`shrink-0 ${color.glyph} ${ground.stroke} ${className}`}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-full ring-2 ${color.dot} ${ground.ring} ${className}`}
    />
  );
}
