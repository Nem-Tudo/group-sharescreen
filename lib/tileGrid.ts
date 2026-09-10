// How the video pane arranges the tiles it has to show, from lg up — where
// the pane is a fixed box rather than a page that grows, so the arrangement
// has to be chosen for the space instead of assumed.
//
// What this replaces, and why
// ---------------------------
// The column count used to be a lookup on the tile count alone (2 tiles ->
// 2 columns, 3-4 -> 2, 5-9 -> 3, ...), with rows split evenly by `1fr`. Two
// things went wrong with that, and they are the same thing seen from two
// sides: the pane's shape was never consulted.
//
//   - Tiles are 16:9 boxes sized by their column's width, but the rows they
//     sat in took an equal share of the pane's *height*. In a pane taller
//     than the tiles needed, every row was left with dead space under its
//     tiles — a band of empty pane between one row and the next, which is
//     what it looked like: a hole.
//
//   - Two tiles side by side in a pane narrower than 16:9 are smaller than
//     the same two stacked. A 660x520 pane gives 327px-wide tiles side by
//     side and 455px-wide ones stacked: the layout that looks like it uses
//     the width was throwing away a third of the picture.
//
// So this measures the pane and picks the arrangement that makes the tiles
// biggest, which answers both. Stacking wins for two tiles in any pane
// narrower than 16:9 — the ordinary case, and every case with a sidebar
// open — and side by side only wins in a pane wide enough that stacking
// would genuinely shrink them.

// Tiles are 16:9 boxes (see VideoTile's `aspect-video`), so a cell's usable
// tile width is capped by its height as well as its own width.
export const TILE_ASPECT = 16 / 9;

// Below this the tiles stop shrinking and the pane scrolls instead. Past a
// point a smaller tile shows nothing usable, and a room with a dozen
// transmissions is better as a few readable ones plus a scroll than as
// twelve thumbnails that are all equally impossible to watch.
export const MIN_TILE_WIDTH = 200;

export type TileGridPlan = {
  cols: number;
  rows: number;
  // The exact width each tile gets, in px. Fixed rather than `1fr` so the
  // grid is only ever as wide and as tall as the tiles actually need, which
  // is what lets it be centred in the pane instead of stretched across it
  // with the slack falling between the rows.
  tileWidth: number;
};

/**
 * Picks the arrangement that makes the tiles as large as they can be in a
 * pane of `paneWidth` x `paneHeight`, with `gap` px between them.
 *
 * Returns null when the pane hasn't been measured yet (first render, before
 * the ResizeObserver has reported) — the caller falls back to its static
 * classes rather than rendering a layout computed from zero.
 */
export function planTileGrid(
  tileCount: number,
  paneWidth: number,
  paneHeight: number,
  gap: number
): TileGridPlan | null {
  if (tileCount <= 0 || paneWidth <= 0 || paneHeight <= 0) return null;

  let best: TileGridPlan | null = null;
  for (let cols = 1; cols <= tileCount; cols += 1) {
    const rows = Math.ceil(tileCount / cols);
    const cellWidth = (paneWidth - gap * (cols - 1)) / cols;
    const cellHeight = (paneHeight - gap * (rows - 1)) / rows;
    // A column count so high that the gaps alone overflow the pane isn't a
    // candidate — and would produce a negative width if left to the min
    // below.
    if (cellWidth <= 0 || cellHeight <= 0) continue;
    // Floored, so the plan is always a hair *inside* the pane rather than a
    // sub-pixel outside it. A grid that overflows by a fraction of a pixel
    // still raises a scrollbar, which takes ~15px off the width, which
    // changes the plan, which removes the scrollbar: a flicker with nothing
    // in the pane actually changing size.
    const tileWidth = Math.floor(Math.min(cellWidth, cellHeight * TILE_ASPECT));
    // Strictly greater, so a tie goes to the arrangement with fewer columns
    // — the one that stacks. Two tiles in a pane of exactly 16:9 fit equally
    // well either way, and "one above the other" is the answer that stays
    // put as the pane is resized past that point rather than flipping.
    if (!best || tileWidth > best.tileWidth) {
      best = { cols, rows, tileWidth };
    }
  }

  if (!best) {
    // Every candidate overflowed: a pane too small for even one tile plus
    // its gaps. One column at the floor, and let it scroll.
    return { cols: 1, rows: tileCount, tileWidth: MIN_TILE_WIDTH };
  }

  return { ...best, tileWidth: Math.max(MIN_TILE_WIDTH, best.tileWidth) };
}
