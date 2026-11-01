// The distortion brush of "Criar efeito": a grid of displacements over the face,
// painted like a liquify tool. The grid is the drawing pad's square (two face
// widths across, the nose in the middle, as the frame has it, not mirrored), in
// that square's own units, 0 to 1. Whoever draws reads each pixel from where
// the grid says, in public/workers/camera-effects.js (drawBrushWarp).

export type WarpMode = "out" | "in" | "push" | "cw" | "ccw" | "restore";

export const WARP_GRID = 128;
// A quarter of the square, half a face width: past that a picture only tears.
const MAX_SHIFT = 0.25;

export type WarpDab = {
  x: number;
  y: number;
  radius: number;
  strength: number; // 0 to 1
  mode: WarpMode;
  // How far the pointer moved, for "push".
  dx?: number;
  dy?: number;
};

export function createWarpGrid(): Float32Array {
  return new Float32Array(WARP_GRID * WARP_GRID * 2);
}

/** One touch of the brush. A pixel at q shows what is at q + the grid's value. */
export function applyWarpDab(grid: Float32Array, dab: WarpDab) {
  const { x, y, radius, strength, mode, dx = 0, dy = 0 } = dab;
  const x0 = Math.max(0, Math.floor((x - radius) * WARP_GRID));
  const x1 = Math.min(WARP_GRID - 1, Math.ceil((x + radius) * WARP_GRID));
  const y0 = Math.max(0, Math.floor((y - radius) * WARP_GRID));
  const y1 = Math.min(WARP_GRID - 1, Math.ceil((y + radius) * WARP_GRID));
  for (let row = y0; row <= y1; row += 1) {
    for (let col = x0; col <= x1; col += 1) {
      const ox = (col + 0.5) / WARP_GRID - x;
      const oy = (row + 0.5) / WARP_GRID - y;
      const e = (ox * ox + oy * oy) / (radius * radius);
      if (e >= 1) continue;
      const w = (1 - e) * (1 - e) * strength;
      const i = (row * WARP_GRID + col) * 2;
      let a = grid[i];
      let b = grid[i + 1];
      if (mode === "out") {
        // What is at the centre comes to fill more: read closer to it.
        a -= ox * w * 0.15;
        b -= oy * w * 0.15;
      } else if (mode === "in") {
        a += ox * w * 0.15;
        b += oy * w * 0.15;
      } else if (mode === "push") {
        a -= dx * w;
        b -= dy * w;
      } else if (mode === "cw") {
        a += oy * w * 0.12;
        b -= ox * w * 0.12;
      } else if (mode === "ccw") {
        a -= oy * w * 0.12;
        b += ox * w * 0.12;
      } else {
        const keep = 1 - w * 0.3;
        a *= keep;
        b *= keep;
      }
      grid[i] = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, a));
      grid[i + 1] = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, b));
    }
  }
}

export function isWarpGridEmpty(grid: Float32Array): boolean {
  return grid.every((value) => Math.abs(value) < MAX_SHIFT / 127);
}

// Two bytes a cell, 128 being no shift, which is what the worker's texture holds
// and what is stored.
export function encodeWarpGrid(grid: Float32Array): Uint8Array {
  const bytes = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i += 1) bytes[i] = Math.round(128 + (grid[i] / MAX_SHIFT) * 127);
  return bytes;
}

export function decodeWarpGrid(bytes: Uint8Array): Float32Array {
  const grid = createWarpGrid();
  for (let i = 0; i < grid.length && i < bytes.length; i += 1) grid[i] = ((bytes[i] - 128) / 127) * MAX_SHIFT;
  return grid;
}

export function warpBytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

export function warpBytesFromBase64(text: string): Uint8Array | null {
  try {
    const raw = atob(text);
    if (raw.length !== WARP_GRID * WARP_GRID * 2) return null;
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
