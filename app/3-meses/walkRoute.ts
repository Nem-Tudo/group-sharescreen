// Where Livinho walks while the page scrolls. His position is a function of
// the scroll alone: each stop is a spot beside something on the page (a text,
// the terminal, the browser window, the curve of the chart), and between two
// stops he walks from one spot to the other as the scroll goes from the first
// one's moment to the second's. Scroll back and he walks back.
//
// A stop's moment is, by default, when that spot crosses the middle of the
// screen. Inside a pinned scene the page stands still, so its stops are timed
// by how far through the pin the scroll is (`through`); the chart's curve is
// timed like the line drawing itself (`span`), so he rides its tip.

export type WalkSide =
  /** In the space left or right of the anchor; `at` runs top→bottom along it. */
  | "left"
  | "right"
  /** Standing on the anchor's top edge; `at` runs left→right. */
  | "above"
  /** Standing on the anchor's bottom edge, inside it (the bar chart's floor); `at` runs left→right. */
  | "floor"
  /** Standing on an SVG path (the anchor), `at` of the way along it. */
  | "path"
  /** Just outside the screen, level with the anchor; for walking in and out. */
  | "off-left"
  | "off-right";

export interface WalkStop {
  /** Selector of the anchor, inside the page. */
  el: string;
  /** Which match, when the selector finds several; negative counts from the end. */
  nth?: number;
  side: WalkSide;
  /** Where along that side, 0..1 (see WalkSide). Default 0.5. */
  at?: number;
  /** Nudge sideways, in CSS pixels, after placing. */
  dx?: number;
  /** In a pinned scene: how far through the pin (0..1) the scroll is when he gets here. */
  through?: number;
  /**
   * Timed by a scroll range of another element instead, as ScrollTrigger's
   * start/end pairs of [fraction of the element, fraction of the screen]:
   * the stop's moment is `at` of the way from `from` to `to`.
   */
  span?: { el: string; from: [number, number]; to: [number, number] };
  /** How he gets here from the stop before: eased (default) or steady (along the curve). */
  steady?: boolean;
}

/** The line of the screen a stop's spot is on at its moment (0 = top, 1 = bottom). */
export const FOCUS = 0.5;
/** Space between him and what he stands beside. */
export const GAP = 12;
/** His feet, as a fraction of the drawing's height (the SVG has room below them). */
export const FEET = 0.8;
/** Clear of the page's top bar. */
export const TOP_CLEAR = 64;
export const BOTTOM_CLEAR = 12;
/** At a screen edge he may hang this much of himself off it (phones have no margins). */
export const EDGE_PEEK = 0.3;

const CHART_STEPS = 12;
const chartRide: WalkStop[] = Array.from({ length: CHART_STEPS }, (_, k) => ({
  el: '[data-scene="numbers"] .sc-line',
  side: "path" as const,
  at: k / (CHART_STEPS - 1),
  // The same range the line is drawn over (Numbers' SignupChart): he is at its tip.
  span: { el: '[data-scene="numbers"] .sc-plot', from: [0, 0.85] as [number, number], to: [0.5, 0.5] as [number, number] },
  steady: k > 0,
}));

export const ROUTE: WalkStop[] = [
  // Day 0: walks in from the left, beside the story, then into the empty
  // column under it, next to the terminal.
  { el: '[data-scene="day0"] header', side: "off-left", at: 0.7 },
  { el: '[data-walk="d0-text"]', side: "left", at: 0.5 },
  { el: '[data-walk="d0-term"]', side: "left", at: 0.85 },

  // ShareScreen (pinned): down the side of the browser window and back up.
  { el: '[data-walk="ou-window"]', side: "left", at: 0.2, through: 0 },
  { el: '[data-walk="ou-window"]', side: "left", at: 0.85, through: 0.55 },
  { el: '[data-walk="ou-window"]', side: "left", at: 0.45, through: 1 },

  // The first 72 hours: onto the scene's title, then down the side of the chat.
  { el: '[data-scene="first72"] header', side: "above", at: 0.4 },
  { el: '[data-walk="f72-chat"]', side: "right", at: 0.15 },
  { el: '[data-walk="f72-chat"]', side: "right", at: 0.85, dx: 70 },

  // The outage: next to the dead screen, then the night's commits.
  { el: '[data-walk="out-crt"]', side: "right", at: 0.35 },
  { el: '[data-walk="out-logs"]', side: "right", at: 0.6, dx: 50 },

  // The numbers: down the side of the scoreboard, then up the curve.
  { el: '[data-walk="num-board"]', side: "left", at: 0.1 },
  { el: '[data-walk="num-board"]', side: "left", at: 0.55 },
  ...chartRide,

  // The recap: beside the card, or the stories while they play (pinned).
  { el: '[data-walk="recap"]', side: "right", at: 0.3, through: 0 },
  { el: '[data-walk="recap"]', side: "right", at: 0.8, through: 1 },

  // The timeline: pacing back and forth beside the entries.
  { el: '[data-scene="timeline"] .tl-item p', nth: 0, side: "right" },
  { el: '[data-scene="timeline"] .tl-item p', nth: 8, side: "right", dx: 220 },
  { el: '[data-scene="timeline"] .tl-item p', nth: 16, side: "right" },
  { el: '[data-scene="timeline"] .tl-item p', nth: -1, side: "right", dx: 220 },

  // The night: dozing by the clock, then among the quiet weeks of the bar chart.
  { el: '[data-scene="night"] .bs-clock svg', side: "left", at: 0.6 },
  { el: '[data-scene="night"] .bs-bars', side: "floor", at: 0.54 },

  // The bugs: down the side of the board.
  { el: '[data-walk="bugs"]', side: "left", at: 0.1 },
  { el: '[data-walk="bugs"]', side: "left", at: 0.85 },

  // Off to the right before the curtain: the finale has its own Livinho.
  { el: '[data-scene="finale"]', side: "off-right", at: 0 },
];

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * His top-left corner for a stop, on screen, given the anchor's box (or, for
 * a path, the point on it). Not yet kept on screen: see keepOnScreen.
 */
export function placeAt(stop: WalkStop, box: Box, size: { w: number; h: number }, screen: { w: number; h: number }, onPath?: Point): Point {
  const at = stop.at ?? 0.5;
  const dx = stop.dx ?? 0;
  const besideY = box.top + at * box.height - size.h / 2;
  switch (stop.side) {
    case "left":
      return { x: box.left - size.w - GAP + dx, y: besideY };
    case "right":
      return { x: box.right + GAP + dx, y: besideY };
    case "off-left":
      return { x: -size.w - 40, y: besideY };
    case "off-right":
      return { x: screen.w + 40, y: besideY };
    case "above":
      return { x: box.left + at * box.width - size.w / 2 + dx, y: box.top - size.h * FEET };
    case "floor":
      return { x: box.left + at * box.width - size.w / 2 + dx, y: box.bottom - size.h * FEET };
    case "path": {
      const p = onPath ?? { x: box.left, y: box.bottom };
      return { x: p.x - size.w / 2 + dx, y: p.y - size.h * FEET };
    }
  }
}

/** Keeps him on screen (except when he is walking in or out of it). */
export function keepOnScreen(p: Point, side: WalkSide, size: { w: number; h: number }, screen: { w: number; h: number }): Point {
  const offScreen = side === "off-left" || side === "off-right";
  const x = offScreen ? p.x : clamp(p.x, -size.w * EDGE_PEEK, screen.w - size.w * (1 - EDGE_PEEK));
  const y = clamp(p.y, TOP_CLEAR, Math.max(TOP_CLEAR, screen.h - size.h - BOTTOM_CLEAR));
  return { x, y };
}

/**
 * Which two stops the scroll is between, and how far (0..1) from the first
 * to the second. Before the first stop, or past the last, he stays there.
 */
export function segmentAt(times: readonly number[], scroll: number): { from: number; to: number; t: number } {
  const last = times.length - 1;
  if (last < 0) return { from: 0, to: 0, t: 0 };
  if (scroll <= times[0]) return { from: 0, to: 0, t: 0 };
  if (scroll >= times[last]) return { from: last, to: last, t: 0 };
  let i = 0;
  while (i < last - 1 && scroll >= times[i + 1]) i++;
  const span = times[i + 1] - times[i];
  return { from: i, to: i + 1, t: span > 0 ? (scroll - times[i]) / span : 1 };
}

/** Moments must go forward: a stop timed at or before the previous one is moved just after it. */
export function forwardTimes(times: readonly number[]): number[] {
  const out: number[] = [];
  for (const t of times) out.push(out.length && t <= out[out.length - 1] ? out[out.length - 1] + 1 : t);
  return out;
}

/** Ease in and out (sine), for the walk between two stops. */
export function easeWalk(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
