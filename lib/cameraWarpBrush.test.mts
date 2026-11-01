import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWarpDab,
  createWarpGrid,
  decodeWarpGrid,
  encodeWarpGrid,
  isWarpGridEmpty,
  warpBytesFromBase64,
  warpBytesToBase64,
  WARP_GRID,
} from "./cameraWarpBrush";

const at = (x: number, y: number) => (Math.floor(y * WARP_GRID) * WARP_GRID + Math.floor(x * WARP_GRID)) * 2;
const dab = { x: 0.5, y: 0.5, radius: 0.2, strength: 1 };

test("outward reads closer to the centre, inward further from it", () => {
  const out = createWarpGrid();
  applyWarpDab(out, { ...dab, mode: "out" });
  assert.ok(out[at(0.6, 0.5)] < 0);
  const inward = createWarpGrid();
  applyWarpDab(inward, { ...dab, mode: "in" });
  assert.ok(inward[at(0.6, 0.5)] > 0);
});

test("push reads from behind the pointer, so the picture follows it", () => {
  const grid = createWarpGrid();
  applyWarpDab(grid, { ...dab, mode: "push", dx: 0.02, dy: 0 });
  assert.ok(grid[at(0.5, 0.5)] < 0);
});

test("the two swirls are opposites", () => {
  const cw = createWarpGrid();
  const ccw = createWarpGrid();
  applyWarpDab(cw, { ...dab, mode: "cw" });
  applyWarpDab(ccw, { ...dab, mode: "ccw" });
  assert.ok(Math.abs(cw[at(0.6, 0.5) + 1] + ccw[at(0.6, 0.5) + 1]) < 1e-6);
  assert.notEqual(cw[at(0.6, 0.5) + 1], 0);
});

test("nothing moves outside the brush, and restore brings a touched spot back", () => {
  const grid = createWarpGrid();
  applyWarpDab(grid, { ...dab, mode: "in" });
  assert.equal(grid[at(0.9, 0.9)], 0);
  for (let i = 0; i < 200; i += 1) applyWarpDab(grid, { ...dab, radius: 0.4, mode: "restore" });
  assert.equal(isWarpGridEmpty(grid), true);
});

test("shifts are held to the limit however long it is painted", () => {
  const grid = createWarpGrid();
  for (let i = 0; i < 500; i += 1) applyWarpDab(grid, { ...dab, mode: "push", dx: 0.1, dy: 0 });
  assert.ok(Math.abs(grid[at(0.5, 0.5)]) <= 0.25);
});

test("no shift is the byte the worker reads as none, and it survives storage", () => {
  assert.ok(encodeWarpGrid(createWarpGrid()).every((value) => value === 128));
  const grid = createWarpGrid();
  applyWarpDab(grid, { ...dab, mode: "out" });
  const bytes = encodeWarpGrid(grid);
  assert.deepEqual(warpBytesFromBase64(warpBytesToBase64(bytes)), bytes);
  assert.ok(Math.abs(decodeWarpGrid(bytes)[at(0.6, 0.5)] - grid[at(0.6, 0.5)]) < 0.003);
  assert.equal(warpBytesFromBase64("AAAA"), null);
});
