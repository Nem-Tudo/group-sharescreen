
import { translate } from "@/lib/i18n";// The gradient behind a profile, and every colour derived from it.
//
// The point of deriving rather than storing: somebody picks two colours and a
// direction, and the border, the muted text and the text itself all have to
// follow, or the result is a background with the old card sitting on top of
// it. So this file is the one place that answers "given these two colours,
// what does everything else become".
//
// The vocabulary matches the API's server/profileTheme.ts, which validates
// what may be stored; this side decides what it looks like.

export interface ProfileTheme {
  from: string;
  to: string;
  angle: number;
}

/** The directions the picker offers, with a name for each. */
export const GRADIENT_DIRECTIONS: { angle: number; label: string }[] = [
  { angle: 180, get label() { return translate("common.downwards"); } },
  { angle: 0, get label() { return translate("common.upwards"); } },
  { angle: 90, get label() { return translate("common.toTheRight"); } },
  { angle: 270, get label() { return translate("common.toTheLeft"); } },
  { angle: 135, get label() { return translate("common.diagonal"); } },
  { angle: 225, get label() { return translate("common.diagonal2"); } },
  { angle: 45, get label() { return translate("common.diagonal3"); } },
  { angle: 315, get label() { return translate("common.diagonal4"); } },
];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/** #abc and #aabbcc both to {r,g,b}, 0-255. */
function toRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (full.length !== 6) return null;
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/**
 * Relative luminance, the WCAG definition.
 *
 * Not the average of the channels, and the difference is the whole reason to
 * use it: the eye is far more sensitive to green than to blue, so a plain
 * average calls pure blue (#0000ff) a mid-tone and puts dark text on it. This
 * weights the channels the way sight does, and applies the sRGB transfer
 * curve first so the numbers describe light rather than byte values.
 */
export function luminance(hex: string): number {
  const rgb = toRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * Everything the card needs, derived from the two colours.
 *
 * The light/dark decision is made once, from the *mean* luminance of the two
 * ends, and applies to the whole surface. Deciding per-end would be more
 * accurate at the corners and unusable in between: text cannot change colour
 * halfway across a word, so one answer has to serve the whole gradient.
 *
 * The threshold is 0.5 rather than something tuned, because it is the point
 * where white and black text have equal contrast against the background.
 */
export function profileThemeStyle(theme: ProfileTheme | null | undefined) {
  if (!theme || !isHexColor(theme.from) || !isHexColor(theme.to)) return null;

  const mean = (luminance(theme.from) + luminance(theme.to)) / 2;
  const dark = mean < 0.5;
  // The band where neither black nor white text is comfortable. A mid-tone
  // background gives the winning colour a contrast ratio around 4-5:1 — legal
  // for large text, thin for the small print — and no choice of text colour
  // fixes that, because the problem is the background, not the letters.
  //
  // So the letters get a shadow instead: the opposite colour at low opacity,
  // which darkens the pixels immediately behind the glyph and lifts it off
  // whatever is there. Only in this band; on a properly light or dark
  // background it would be visible fuzz solving nothing.
  const midTone = mean >= 0.28 && mean <= 0.68;

  // Text is the extreme, not a softened one: the whole point of choosing it
  // from the background is maximum contrast, and a "softer" white here would
  // give some of that back for nothing.
  const text = dark ? "#ffffff" : "#18181b";
  // Borders and muted text are the same colour at low alpha rather than a
  // separate hue, so they sit *in* the palette instead of beside it — this is
  // what keeps the card from looking like the old one with a background
  // shoved behind it.
  const alpha = (value: number) =>
    dark ? `rgba(255,255,255,${value})` : `rgba(24,24,27,${value})`;

  return {
    dark,
    background: `linear-gradient(${theme.angle}deg, ${theme.from} 0%, ${theme.to} 100%)`,
    text,
    /**
     * Applied to every piece of text on the gradient. Empty unless the
     * background sits in the awkward middle — see `midTone`.
     */
    textShadow: midTone
      ? dark
        ? "0 1px 2px rgba(0,0,0,0.55)"
        : "0 1px 2px rgba(255,255,255,0.65)"
      : undefined,
    /**
     * Secondary text. Raised from 0.72: against a gradient rather than a flat
     * card, the same alpha reads noticeably weaker, and this is the tier most
     * of the profile's prose sits in.
     */
    muted: alpha(0.86),
    /**
     * The quietest line on the card — the "member since" footnote. It used to
     * be zinc-400, a fixed grey that lands somewhere between invisible and
     * illegible depending on the colours behind it.
     */
    faint: alpha(0.68),
    /** Hairlines and dividers. */
    border: alpha(0.22),
    /** Panels sitting on the gradient: a wash of the text colour. */
    surface: alpha(0.1),
    /** The ring around the avatar, which overlaps the gradient. */
    ring: alpha(0.35),
  };
}

export type ProfileThemeStyle = NonNullable<ReturnType<typeof profileThemeStyle>>;
