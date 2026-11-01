"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MdAutoFixNormal, MdBrush, MdCreate, MdDelete, MdEdit, MdGrain, MdUndo } from "react-icons/md";
import {
  CAMERA_CUSTOM_EVENTS,
  removeCustomSticker,
  saveDrawingSticker,
  stickerImage,
  trackCustomEffect,
  type CustomSticker,
} from "@/lib/cameraCustomEffects";
import { useT } from "@/lib/useI18n";

// The drawing of "Criar efeito": a square that stands for the face, two face
// widths across with the nose in the middle (the outline is only a guide, it
// does not go out). After each stroke it is stored as a sticker on the nose, so
// it reaches the camera the same way an image does, and follows the face.
//
// The pad is seen as a mirror, like the camera in the editor. So the picture is
// flipped when stored, which puts each line where it was drawn on the face, but
// leaves writing backwards for whoever watches: "readable" stores it as is.

type Tool = "pencil" | "pen" | "marker" | "spray" | "eraser";
type Stroke = { tool: Tool; color: string; width: number; points: { x: number; y: number }[] };

const SIDE = 512;
const TOOLS: { tool: Tool; label: string; icon: typeof MdCreate }[] = [
  { tool: "pencil", label: "watch.watchRoom.cameraCustomToolPencil", icon: MdCreate },
  { tool: "pen", label: "watch.watchRoom.cameraCustomToolPen", icon: MdEdit },
  { tool: "marker", label: "watch.watchRoom.cameraCustomToolMarker", icon: MdBrush },
  { tool: "spray", label: "watch.watchRoom.cameraCustomToolSpray", icon: MdGrain },
  { tool: "eraser", label: "watch.watchRoom.cameraCustomToolEraser", icon: MdAutoFixNormal },
];
const COLORS = ["#111111", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

function tracePath(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.beginPath();
  stroke.points.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
  // A tap is a dot.
  if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y);
  ctx.stroke();
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = stroke.width;
  if (stroke.tool === "spray") {
    // Each point's dots are the same on every redraw: the pad redraws it all
    // on each move, and random ones would shimmer.
    stroke.points.forEach((point, i) => {
      for (let n = 0; n < 14; n += 1) {
        const a = Math.abs(Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1;
        const b = Math.abs(Math.sin(i * 39.346 + n * 11.135) * 24634.6345) % 1;
        const r = Math.sqrt(a) * stroke.width * 1.6;
        ctx.fillRect(point.x + Math.cos(b * Math.PI * 2) * r, point.y + Math.sin(b * Math.PI * 2) * r, 2, 2);
      }
    });
  } else if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = stroke.width * 2;
    tracePath(ctx, stroke);
  } else if (stroke.tool === "marker") {
    // See-through as one stroke: crossing itself does not get any darker.
    const layer = document.createElement("canvas");
    layer.width = SIDE;
    layer.height = SIDE;
    const layerCtx = layer.getContext("2d");
    if (layerCtx) {
      layerCtx.strokeStyle = stroke.color;
      layerCtx.lineJoin = "round";
      layerCtx.lineCap = "butt";
      layerCtx.lineWidth = stroke.width * 3;
      tracePath(layerCtx, stroke);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(layer, 0, 0);
    }
  } else if (stroke.tool === "pencil") {
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = Math.max(1.5, stroke.width * 0.5);
    tracePath(ctx, stroke);
  } else {
    tracePath(ctx, stroke);
  }
  ctx.restore();
}

export function CameraDrawingPad({
  effectId,
  sticker,
  onSticker,
  onClose,
}: {
  effectId: string;
  // The drawing being continued, or null for a new one.
  sticker: CustomSticker | null;
  onSticker: (id: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const stickerId = useRef(sticker?.id ?? null);
  const counted = useRef(false);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(COLORS[2]);
  const [width, setWidth] = useState(10);
  const [readable, setReadable] = useState(sticker?.drawing === "plain");
  const [strokeCount, setStrokeCount] = useState(0);
  const [failed, setFailed] = useState(false);

  const redraw = useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIDE, SIDE);
    if (base.current) ctx.drawImage(base.current, 0, 0);
    for (const stroke of strokes.current) drawStroke(ctx, stroke);
    if (current.current) drawStroke(ctx, current.current);
  }, []);

  // A drawing being continued starts from its stored picture, turned back to
  // how it looked on the pad.
  const storedImageId = useRef(sticker?.imageId);
  const storedPlain = useRef(sticker?.drawing === "plain");
  useEffect(() => {
    const dataUrl = storedImageId.current ? stickerImage(storedImageId.current) : null;
    if (!dataUrl) return;
    let gone = false;
    const image = new Image();
    image.onload = () => {
      if (gone) return;
      const layer = document.createElement("canvas");
      layer.width = SIDE;
      layer.height = SIDE;
      const ctx = layer.getContext("2d");
      if (!ctx) return;
      if (!storedPlain.current) {
        ctx.translate(SIDE, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(image, 0, 0, SIDE, SIDE);
      base.current = layer;
      redraw();
    };
    image.src = dataUrl;
    return () => {
      gone = true;
    };
  }, [redraw]);

  const store = useCallback(
    (plain: boolean) => {
      const source = canvas.current;
      if (!source) return;
      const out = document.createElement("canvas");
      out.width = SIDE;
      out.height = SIDE;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      if (!plain) {
        ctx.translate(SIDE, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(source, 0, 0);
      try {
        stickerId.current = saveDrawingSticker(effectId, stickerId.current, out.toDataURL("image/png"), plain ? "plain" : "mirror");
        onSticker(stickerId.current);
        setFailed(false);
      } catch {
        // Over the browser's storage: the pad keeps it, the camera has the last one.
        setFailed(true);
        trackCustomEffect(CAMERA_CUSTOM_EVENTS.imageError);
      }
    },
    [effectId, onSticker]
  );

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * SIDE, y: ((e.clientY - box.top) / box.height) * SIDE };
  };

  const finish = () => {
    if (!current.current) return;
    strokes.current.push(current.current);
    current.current = null;
    setStrokeCount(strokes.current.length);
    store(readable);
    if (!counted.current) {
      counted.current = true;
      trackCustomEffect(CAMERA_CUSTOM_EVENTS.draw);
    }
  };

  const undo = () => {
    strokes.current.pop();
    setStrokeCount(strokes.current.length);
    redraw();
    if (strokes.current.length > 0 || base.current || stickerId.current) store(readable);
  };

  const clear = () => {
    strokes.current = [];
    base.current = null;
    setStrokeCount(0);
    redraw();
    if (stickerId.current) removeCustomSticker(effectId, stickerId.current);
    stickerId.current = null;
    onSticker(null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
      <div className="relative mx-auto aspect-square w-full max-w-[17rem] overflow-hidden rounded-lg border border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-700">
        <span className="pointer-events-none absolute top-[18%] left-1/4 h-[64%] w-1/2 rounded-[50%] border-2 border-dashed border-zinc-400" />
        <canvas
          ref={canvas}
          width={SIDE}
          height={SIDE}
          aria-label={t("watch.watchRoom.cameraCustomDraw")}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            current.current = { tool, color, width, points: [pointAt(e)] };
            redraw();
          }}
          onPointerMove={(e) => {
            if (!current.current) return;
            current.current.points.push(pointAt(e));
            redraw();
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.tool}
              type="button"
              aria-pressed={tool === item.tool}
              aria-label={t(item.label)}
              title={t(item.label)}
              onClick={() => setTool(item.tool)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${tool === item.tool ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        <span className="flex-1" />
        <button
          type="button"
          disabled={strokeCount === 0}
          aria-label={t("watch.watchRoom.cameraCustomUndo")}
          title={t("watch.watchRoom.cameraCustomUndo")}
          onClick={undo}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <MdUndo className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t("watch.watchRoom.cameraCustomClear")}
          title={t("watch.watchRoom.cameraCustomClear")}
          onClick={clear}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-red-600 dark:bg-zinc-800 dark:text-red-400"
        >
          <MdDelete className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={color === item}
            aria-label={item}
            onClick={() => setColor(item)}
            style={{ backgroundColor: item }}
            className={`h-6 w-6 rounded-full border border-zinc-300 dark:border-zinc-600 ${color === item ? "ring-2 ring-emerald-500 ring-offset-1 dark:ring-offset-zinc-900" : ""}`}
          />
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="w-24 shrink-0 truncate">{t("watch.watchRoom.cameraCustomThickness")}</span>
        <input
          type="range"
          min={2}
          max={40}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="min-w-0 flex-1 accent-emerald-600"
        />
      </label>
      <label className="flex items-start gap-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={readable}
          onChange={(e) => {
            setReadable(e.target.checked);
            if (stickerId.current) store(e.target.checked);
          }}
          className="mt-0.5 accent-emerald-600"
        />
        {t("watch.watchRoom.cameraCustomReadable")}
      </label>
      {failed && <span className="text-[11px] text-red-600 dark:text-red-400">{t("watch.watchRoom.cameraCustomImageError")}</span>}
      <button type="button" onClick={onClose} className="self-end text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        {t("watch.watchRoom.cameraCustomDrawDone")}
      </button>
    </div>
  );
}
