import type { CSSProperties } from "react";

// How a cosmetics-store name color is drawn.
//
// The equipped value travels everywhere as one string (PeerInfo.nameColor,
// Account.equippedNameColor, every chat message's nameColor...), and it was
// always a plain CSS color. The store now also sells names that a color alone
// cannot draw, and rather than add a second field to every one of those
// payloads the string carries the style itself:
//
//   "#22c55e"                          a color, as before
//   "linear-gradient(90deg, #a, #b)"   gradient text
//   "glow:#22d3ee"                     the color, with a neon glow around it
//   "shimmer:linear-gradient(...)"     gradient text that slides (animated)
//
// A client from before this reads the new ones as an invalid color and falls
// back to the default one, which is the right way to fail. Everything that
// paints a name goes through here (DisplayUserName, and the few spots that
// draw the account's own name by hand), so a new style is one more branch.

export type NameStyle = { style?: CSSProperties; className?: string };

const GRADIENT_TEXT: CSSProperties = {
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
};

export function nameStyleOf(value: string | null | undefined): NameStyle {
  if (!value) return {};
  if (value.startsWith("glow:")) {
    const color = value.slice(5);
    return { style: { color, textShadow: `0 0 6px ${color}, 0 0 14px ${color}99` } };
  }
  if (value.startsWith("shimmer:")) {
    return {
      style: { ...GRADIENT_TEXT, backgroundImage: value.slice(8), backgroundSize: "200% 100%" },
      className: "name-fx-shimmer",
    };
  }
  if (value.startsWith("linear-gradient(")) {
    return { style: { ...GRADIENT_TEXT, backgroundImage: value } };
  }
  return { style: { color: value } };
}
