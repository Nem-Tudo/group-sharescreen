"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Stroke, StrokeShape } from "@/lib/roomTools";
import { drawStroke, hitsStroke, onImageLoaded, thinPoints, type Rect } from "./strokes";

// A canvas everybody's strokes are drawn on, and — for whoever may — drawn
// into. The shared whiteboard is one of these on a white board; the notes over
// a shared screen are one laid transparently over the video (see
// AnnotationLayer), with `contentRect` saying where the picture actually is
// inside the tile, so a circle drawn around a button lands on that button on
// every screen whatever its letterboxing.

export type NewStroke = Omit<Stroke, "id" | "by" | "target">;

export function DrawingSurface({
  strokes,
  canDraw,
  pen,
  onStroke,
  onLive,
  liveStrokes,
  onErase,
  contentRect,
  board = false,
  className = "",
}: {
  strokes: Stroke[];
  canDraw: boolean;
  pen: { color: string; width: number; tool: StrokeShape | "eraser" };
  onStroke: (stroke: NewStroke) => void;
  // The stroke as it is being drawn, for the rest of the room to watch — and
  // null when the pen came up without one.
  onLive?: (stroke: NewStroke | null) => void;
  // Other people's strokes while they draw them.
  liveStrokes?: Omit<Stroke, "id" | "by">[];
  onErase: (ids: string[]) => void;
  // Where, inside this box, the surface is (in CSS pixels). The whole box by default.
  contentRect?: (width: number, height: number) => Rect;
  // A white board with a frame, rather than a transparent sheet.
  board?: boolean;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drawing = useRef<{ points: number[]; pointerId: number } | null>(null);
  const [erasing, setErasing] = useState<Set<string>>(() => new Set());
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [, setTick] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setSize({ w: box.clientWidth, h: box.clientHeight }));
    observer.observe(box);
    setSize({ w: box.clientWidth, h: box.clientHeight });
    return () => observer.disconnect();
  }, []);

  const rectOf = useCallback(
    (): Rect => (contentRect ? contentRect(size.w, size.h) : { x: 0, y: 0, w: size.w, h: size.h }),
    [contentRect, size]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const rect = rectOf();
    for (const stroke of strokes) {
      if (!erasing.has(stroke.id)) drawStroke(ctx, stroke, rect);
    }
    for (const stroke of liveStrokes ?? []) drawStroke(ctx, stroke, rect);
    const live = drawing.current;
    if (live && pen.tool !== "eraser" && pen.tool !== "text") {
      drawStroke(ctx, { shape: pen.tool, color: pen.color, width: pen.width, points: live.points }, rect);
    }
  }, [size, strokes, liveStrokes, erasing, pen, rectOf]);

  useEffect(() => {
    redraw();
  });
  // A pasted picture that finished decoding after the board was drawn.
  useEffect(() => onImageLoaded(() => setTick((t) => t + 1)), []);

  function toPoint(event: React.PointerEvent): [number, number] {
    const box = boxRef.current!.getBoundingClientRect();
    const rect = rectOf();
    return [
      (event.clientX - box.left - rect.x) / Math.max(1, rect.w),
      (event.clientY - box.top - rect.y) / Math.max(1, rect.h),
    ];
  }

  function eraseAt(x: number, y: number) {
    const rect = rectOf();
    const aspect = rect.w / Math.max(1, rect.h);
    const hit = strokes.filter((s) => !erasing.has(s.id) && hitsStroke(s, x, y, 0.012, aspect));
    if (hit.length > 0) setErasing((prev) => new Set([...prev, ...hit.map((s) => s.id)]));
  }

  function onPointerDown(event: React.PointerEvent) {
    if (!canDraw || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = toPoint(event);
    if (pen.tool === "text") {
      setTextDraft({ x, y, value: "" });
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (pen.tool === "eraser") {
      drawing.current = { points: [x, y], pointerId: event.pointerId };
      eraseAt(x, y);
      return;
    }
    drawing.current = { points: [x, y], pointerId: event.pointerId };
    setTick((t) => t + 1);
  }

  function onPointerMove(event: React.PointerEvent) {
    const live = drawing.current;
    if (!live || live.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const [x, y] = toPoint(event);
    if (pen.tool === "eraser") {
      eraseAt(x, y);
      return;
    }
    if (pen.tool === "pen" || pen.tool === "highlighter") live.points.push(x, y);
    else live.points = [live.points[0], live.points[1], x, y];
    if (pen.tool !== "text") {
      onLive?.({ shape: pen.tool, color: pen.color, width: pen.width, points: live.points.slice(0, 3000) });
    }
    redraw();
  }

  function onPointerUp(event: React.PointerEvent) {
    const live = drawing.current;
    if (!live || live.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drawing.current = null;
    if (pen.tool === "eraser") {
      if (erasing.size > 0) onErase([...erasing]);
      // Kept hidden until the server's answer takes them off for real.
      window.setTimeout(() => setErasing(new Set()), 1500);
      return;
    }
    if (pen.tool === "text") return;
    const points = pen.tool === "pen" || pen.tool === "highlighter" ? thinPoints(live.points) : live.points;
    // A shape needs two corners; a tap with the line tool is nothing.
    if (pen.tool !== "pen" && pen.tool !== "highlighter" && points.length < 4) {
      onLive?.(null);
      return;
    }
    onStroke({ shape: pen.tool, color: pen.color, width: pen.width, points: points.slice(0, 3000) });
    setTick((t) => t + 1);
  }

  function commitText() {
    const draft = textDraft;
    setTextDraft(null);
    if (!draft || !draft.value.trim()) return;
    onStroke({ shape: "text", color: pen.color, width: pen.width, points: [draft.x, draft.y], text: draft.value.trim() });
  }

  const rect = rectOf();
  return (
    <div
      ref={boxRef}
      className={`relative h-full w-full ${board ? "rounded-lg bg-white shadow-inner ring-1 ring-zinc-200 dark:ring-zinc-700" : ""} ${className}`}
      style={{ touchAction: canDraw ? "none" : undefined }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`absolute inset-0 h-full w-full ${canDraw ? (pen.tool === "text" ? "cursor-text" : "cursor-crosshair") : "pointer-events-none"}`}
      />
      {textDraft && (
        <textarea
          autoFocus
          rows={1}
          value={textDraft.value}
          onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value.slice(0, 500) })}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commitText();
            } else if (e.key === "Escape") {
              setTextDraft(null);
            }
          }}
          style={{
            left: rect.x + textDraft.x * rect.w,
            top: rect.y + textDraft.y * rect.h,
            color: pen.color,
            fontSize: Math.max(10, ((14 + pen.width * 3) * rect.w) / 1000),
          }}
          className="absolute z-10 min-w-[8rem] resize-none rounded border border-dashed border-zinc-400 bg-white/80 px-1 font-semibold outline-none"
        />
      )}
    </div>
  );
}
