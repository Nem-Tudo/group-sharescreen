import type { Stroke } from "@/lib/roomTools";

// Drawing and hit-testing the room's strokes (see lib/roomTools.ts). Points are
// 0..1 of the surface, and a stroke's width is in "board pixels" — pixels of a
// board 1000 wide — so the same stroke is equally thick on a phone and on a
// 4K monitor.

export type Rect = { x: number; y: number; w: number; h: number };

export const BOARD_WIDTH = 1000;

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Omit<Stroke, "id" | "by">, rect: Rect) {
  const { points } = stroke;
  if (points.length < 2) return;
  const px = (i: number) => rect.x + points[i] * rect.w;
  const py = (i: number) => rect.y + points[i + 1] * rect.h;
  const scale = rect.w / BOARD_WIDTH;
  const width = Math.max(1, stroke.width * scale);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.shape === "highlighter" ? width * 4 : width;
  if (stroke.shape === "highlighter") ctx.globalAlpha = 0.35;
  const last = points.length - 2;
  switch (stroke.shape) {
    case "pen":
    case "highlighter": {
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      if (points.length === 2) ctx.lineTo(px(0) + 0.01, py(0));
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(px(i), py(i));
      ctx.stroke();
      break;
    }
    case "line":
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(px(last), py(last));
      ctx.stroke();
      if (stroke.shape === "arrow") {
        const angle = Math.atan2(py(last) - py(0), px(last) - px(0));
        const head = Math.max(10, width * 3.5);
        ctx.beginPath();
        ctx.moveTo(px(last), py(last));
        ctx.lineTo(px(last) - head * Math.cos(angle - Math.PI / 7), py(last) - head * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(px(last) - head * Math.cos(angle + Math.PI / 7), py(last) - head * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "rect": {
      ctx.strokeRect(px(0), py(0), px(last) - px(0), py(last) - py(0));
      break;
    }
    case "ellipse": {
      const cx = (px(0) + px(last)) / 2;
      const cy = (py(0) + py(last)) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(px(last) - px(0)) / 2, Math.abs(py(last) - py(0)) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "text": {
      const size = Math.max(10, (14 + stroke.width * 3) * scale);
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const lines = (stroke.text ?? "").split("\n");
      lines.forEach((line, i) => ctx.fillText(line, px(0), py(0) + i * size * 1.2));
      break;
    }
  }
  ctx.restore();
}

function distToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Whether a point (0..1 of the surface) is on `stroke`, within `tolerance` (also 0..1). */
export function hitsStroke(stroke: Stroke, x: number, y: number, tolerance: number, aspect: number): boolean {
  const p = stroke.points;
  // Measured in a space where one unit across equals one unit down, or a
  // wide board would make horizontal strokes much easier to hit.
  const sx = (v: number) => v * aspect;
  const last = p.length - 2;
  const tol = tolerance + (stroke.width / BOARD_WIDTH) * aspect;
  switch (stroke.shape) {
    case "rect": {
      const [x1, y1, x2, y2] = [p[0], p[1], p[last], p[last + 1]];
      const edges: [number, number, number, number][] = [
        [x1, y1, x2, y1],
        [x2, y1, x2, y2],
        [x2, y2, x1, y2],
        [x1, y2, x1, y1],
      ];
      return edges.some(([a, b, c, d]) => distToSegment(sx(x), y, sx(a), b, sx(c), d) <= tol);
    }
    case "ellipse": {
      const cx = (p[0] + p[last]) / 2;
      const cy = (p[1] + p[last + 1]) / 2;
      const rx = Math.abs(p[last] - p[0]) / 2 || 1e-6;
      const ry = Math.abs(p[last + 1] - p[1]) / 2 || 1e-6;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      return Math.abs(d - 1) * Math.min(rx * aspect, ry) <= tol;
    }
    case "text": {
      const lines = (stroke.text ?? "").split("\n");
      const size = (14 + stroke.width * 3) / BOARD_WIDTH;
      const width = Math.max(...lines.map((l) => l.length)) * size * 0.6;
      const height = lines.length * size * 1.2 * aspect;
      return x >= p[0] - tolerance && x <= p[0] + width + tolerance && y >= p[1] - tolerance && y <= p[1] + height + tolerance;
    }
    case "line":
    case "arrow":
      return distToSegment(sx(x), y, sx(p[0]), p[1], sx(p[last]), p[last + 1]) <= tol;
    default: {
      if (p.length === 2) return Math.hypot(sx(x) - sx(p[0]), y - p[1]) <= tol;
      for (let i = 0; i < last; i += 2) {
        if (distToSegment(sx(x), y, sx(p[i]), p[i + 1], sx(p[i + 2]), p[i + 3]) <= tol) return true;
      }
      return false;
    }
  }
}

/** Fewer points for a long freehand stroke: drops any closer than `min` to the last kept. */
export function thinPoints(points: number[], min = 0.0015): number[] {
  if (points.length <= 4) return points;
  const out = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    const lx = out[out.length - 2];
    const ly = out[out.length - 1];
    if (Math.hypot(points[i] - lx, points[i + 1] - ly) >= min) out.push(points[i], points[i + 1]);
  }
  out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}
