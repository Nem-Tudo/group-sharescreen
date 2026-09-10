// node --experimental-strip-types lib/tileGrid.test.mts
//
// Pins how the video pane arranges its tiles. The whole point of planTileGrid
// is that the answer depends on the pane's shape and not just on how many
// tiles there are, so these are written as "this pane, this many tiles".

import assert from "node:assert/strict";
import { planTileGrid, MIN_TILE_WIDTH, TILE_ASPECT } from "./tileGrid";

const GAP = 12;

function plan(count: number, width: number, height: number) {
  const result = planTileGrid(count, width, height, GAP);
  assert.ok(result, "esperava um plano para um painel medido");
  return result;
}

// --- the shape of the pane decides, not the count -------------------------

// The complaint this was written for: a pane narrower than 16:9 (which is
// every pane with a sidebar open) stacks two tiles instead of putting them
// side by side, because stacked is where they are bigger.
{
  const stacked = plan(2, 660, 520);
  assert.equal(stacked.cols, 1);
  assert.equal(stacked.rows, 2);
  // Height-bound: (520 - 12) / 2 = 254 tall, so 254 * 16/9 wide, floored.
  assert.equal(stacked.tileWidth, Math.floor(254 * TILE_ASPECT));
  // And it is genuinely the bigger of the two, not merely the preferred one.
  const sideBySideWidth = (660 - GAP) / 2;
  assert.ok(stacked.tileWidth > sideBySideWidth);
}

// A pane wide enough that stacking would shrink them keeps them side by
// side: the rule is "as large as possible", not "always stacked".
{
  const wide = plan(2, 2000, 500);
  assert.equal(wide.cols, 2);
  assert.equal(wide.rows, 1);
}

// Three tiles in that same narrow pane stay 2x2 — one column of three would
// leave each of them 308px against 327px, so the hole-free 2x2 wins.
{
  const three = plan(3, 660, 520);
  assert.equal(three.cols, 2);
  assert.equal(three.rows, 2);
}

// A single tile is one cell however the pane is shaped.
{
  assert.equal(plan(1, 660, 520).cols, 1);
  assert.equal(plan(1, 2000, 500).cols, 1);
}

// Many tiles settle on a middle column count rather than one long row or one
// long column — both extremes waste one axis entirely.
{
  const twelve = plan(12, 660, 520);
  assert.equal(twelve.cols, 3);
  assert.equal(twelve.rows, 4);
}

// --- the floor ------------------------------------------------------------

// Past the floor the tiles stop shrinking and the pane is left to scroll.
{
  const crowded = plan(30, 660, 520);
  assert.equal(crowded.tileWidth, MIN_TILE_WIDTH);
}

// A pane too small for even one tile still returns something renderable
// rather than a negative width.
{
  const tiny = plan(4, 40, 30);
  assert.ok(tiny.tileWidth >= MIN_TILE_WIDTH);
  assert.ok(tiny.cols >= 1);
}

// --- not measured yet -----------------------------------------------------

// Before the ResizeObserver has reported anything there is no plan to make,
// and the caller falls back to its static classes instead of a layout
// computed from a zero-sized pane.
assert.equal(planTileGrid(2, 0, 0, GAP), null);
assert.equal(planTileGrid(0, 660, 520, GAP), null);

console.log("tileGrid ok");
