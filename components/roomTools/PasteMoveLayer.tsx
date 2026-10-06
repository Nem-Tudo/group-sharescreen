"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { Stroke } from "@/lib/roomTools";
import { BOARD_WIDTH } from "./strokes";

// Moving and resizing what was pasted on a whiteboard — pictures, and text
// (moved only). Laid over the board while the "mover" mode is on: a box round
// each one, dragged by its middle, resized by its corner in its own
// proportions. Moved in place (see the API's moveStroke): it keeps its order
// among the strokes, so a line drawn over a picture stays over it.

const BOARD_ASPECT = 16 / 9;
const MIN_SIZE = 0.03;

/** Where a pasted thing is, in 0..1 of the board: left, top, width, height. */
export function pastedBox(stroke: Stroke): [number, number, number, number] | null {
  const p = stroke.points;
  if (stroke.shape === "image" && p.length >= 4) {
    return [Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1])];
  }
  if (stroke.shape === "text" && p.length >= 2) {
    const lines = (stroke.text ?? "").split("\n");
    const size = (14 + stroke.width * 3) / BOARD_WIDTH;
    return [p[0], p[1], Math.max(...lines.map((l) => l.length)) * size * 0.6, lines.length * size * 1.2 * BOARD_ASPECT];
  }
  return null;
}

/** The stroke's points for a box — what a moved or resized copy is drawn at. */
export function pointsForBox(stroke: Stroke, [x, y, w, h]: [number, number, number, number]): number[] {
  return stroke.shape === "image" ? [x, y, x + w, y + h] : [x, y];
}

type Drag = {
  id: string;
  pointerId: number;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  start: [number, number, number, number];
  box: [number, number, number, number];
};

export function PasteMoveLayer({
  strokes,
  onPreview,
  onMove,
}: {
  strokes: Stroke[];
  /** The box a stroke is being dragged to, for the board to draw it there meanwhile — null when let go. */
  onPreview: (preview: { id: string; points: number[] } | null) => void;
  onMove: (stroke: Stroke, points: number[]) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Only what the server has: one still on its way has no id there to move.
  const pasted = strokes.filter((s) => (s.shape === "image" || s.shape === "text") && !("toolId" in s));

  function begin(e: PointerEvent<HTMLElement>, stroke: Stroke, mode: Drag["mode"]) {
    const box = pastedBox(stroke);
    if (!box || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
    setDrag({ id: stroke.id, pointerId: e.pointerId, mode, startX: e.clientX, startY: e.clientY, start: box, box });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const layer = layerRef.current?.getBoundingClientRect();
    const stroke = pasted.find((s) => s.id === drag.id);
    if (!layer || !stroke) return;
    const dx = (e.clientX - drag.startX) / layer.width;
    const dy = (e.clientY - drag.startY) / layer.height;
    const [x, y, w, h] = drag.start;
    let box: [number, number, number, number];
    if (drag.mode === "move") {
      // Kept at least partly on the board.
      box = [Math.min(1 - MIN_SIZE, Math.max(MIN_SIZE - w, x + dx)), Math.min(1 - MIN_SIZE, Math.max(MIN_SIZE - h, y + dy)), w, h];
    } else {
      // From the bottom-right corner, in its own proportions.
      // Whichever way the pointer went further, as a change of width.
      const grow = Math.max(dx, (dy * w) / Math.max(h, 1e-6));
      const scale = Math.max(MIN_SIZE / w, (w + grow) / w);
      const nw = Math.min(1.5, w * scale);
      box = [x, y, nw, (nw / w) * h];
    }
    setDrag({ ...drag, box });
    onPreview({ id: stroke.id, points: pointsForBox(stroke, box) });
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const stroke = pasted.find((s) => s.id === drag.id);
    const moved = drag.box.some((v, i) => Math.abs(v - drag.start[i]) > 0.002);
    setDrag(null);
    if (stroke && moved) onMove(stroke, pointsForBox(stroke, drag.box));
    else onPreview(null);
  }

  return (
    <div
      ref={layerRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="absolute inset-0 z-10 overflow-hidden rounded-lg"
      style={{ touchAction: "none" }}
    >
      {pasted.map((stroke) => {
        const box = drag?.id === stroke.id ? drag.box : pastedBox(stroke);
        if (!box) return null;
        const [x, y, w, h] = box;
        return (
          <div
            key={stroke.id}
            onPointerDown={(e) => begin(e, stroke, "move")}
            className={`absolute cursor-move rounded-sm outline-2 outline-dashed ${
              drag?.id === stroke.id ? "outline-emerald-500" : "outline-emerald-500/60 hover:outline-emerald-500"
            }`}
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          >
            {stroke.shape === "image" && (
              <span
                onPointerDown={(e) => begin(e, stroke, "resize")}
                className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-emerald-600 shadow"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
