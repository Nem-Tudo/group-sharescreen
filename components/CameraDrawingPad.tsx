"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MdAutoFixNormal,
  MdBrush,
  MdCheck,
  MdClose,
  MdContentPaste,
  MdCreate,
  MdDelete,
  MdEdit,
  MdFlip,
  MdGrain,
  MdImage,
  MdRotateRight,
  MdUndo,
} from "react-icons/md";
import {
  addImageSticker,
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
// The pad is seen the way the editor's camera is. Where that is a mirror (a
// phone's front camera; a computer's webcam is not) the picture is flipped when
// stored, which puts each line where it was drawn on the face, but leaves writing
// backwards for whoever watches: "readable" stores it as is.
//
// An image (pasted, or from a file) floats over the drawing, to be moved, resized,
// turned and flipped, until the next stroke or "apply" lays it down. It is stored
// after each change, floating or not, so the camera shows it and closing loses
// nothing. A GIF cannot go flat into the picture and keep moving, so it leaves
// the pad as a sticker of its own, adjusted with the stickers' sliders.

type Tool = "pencil" | "pen" | "marker" | "spray" | "eraser";
type Stroke = { tool: Tool; color: string; width: number; points: { x: number; y: number }[] };

type Placed = {
  tool: "image";
  image: HTMLCanvasElement;
  x: number; // centre
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  flipped: boolean;
};
type Point = { x: number; y: number };

const SIDE = 512;
const MIN_PLACED = 24;
const MAX_PLACED = SIDE * 2;
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

function drawPlaced(ctx: CanvasRenderingContext2D, placed: Placed) {
  ctx.save();
  ctx.translate(placed.x, placed.y);
  ctx.rotate((placed.rotation * Math.PI) / 180);
  if (placed.flipped) ctx.scale(-1, 1);
  ctx.drawImage(placed.image, -placed.width / 2, -placed.height / 2, placed.width, placed.height);
  ctx.restore();
}

// A file or a pasted picture, down to a size worth keeping, transparency included.
async function loadPlaced(blob: Blob): Promise<Placed> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const image = document.createElement("canvas");
  image.width = Math.max(1, Math.round(bitmap.width * scale));
  image.height = Math.max(1, Math.round(bitmap.height * scale));
  image.getContext("2d")?.drawImage(bitmap, 0, 0, image.width, image.height);
  bitmap.close();
  const fit = (SIDE * 0.6) / Math.max(image.width, image.height);
  return {
    tool: "image",
    image,
    x: SIDE / 2,
    y: SIDE / 2,
    width: image.width * fit,
    height: image.height * fit,
    rotation: 0,
    flipped: false,
  };
}

function resized(from: Placed, width: number): Placed {
  const clamped = Math.min(MAX_PLACED, Math.max(MIN_PLACED, width));
  return { ...from, width: clamped, height: (from.height * clamped) / from.width };
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

// The guide, to scale: the pad is two face widths with the nose's tip at its centre.
export function FaceGuide() {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      className="pointer-events-none absolute inset-0 h-full w-full stroke-zinc-400"
    >
      <ellipse cx="50" cy="50" rx="25" ry="32" strokeWidth="0.8" strokeDasharray="2.5 2" />
      <ellipse cx="39" cy="41" rx="4.5" ry="2.2" strokeWidth="0.8" />
      <ellipse cx="61" cy="41" rx="4.5" ry="2.2" strokeWidth="0.8" />
      <path d="M50 42 L47.5 50 Q50 52 52.5 50" strokeWidth="0.8" />
      <path d="M41 61 Q50 67 59 61" strokeWidth="0.8" />
    </svg>
  );
}

export function CameraDrawingPad({
  effectId,
  sticker,
  mirrored,
  onSticker,
  onClose,
}: {
  effectId: string;
  // The drawing being continued, or null for a new one.
  sticker: CustomSticker | null;
  // Whether the editor's camera is shown mirrored.
  mirrored: boolean;
  onSticker: (id: string | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const pad = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const strokes = useRef<(Stroke | Placed)[]>([]);
  const placedRef = useRef<Placed | null>(null);
  const gesture = useRef<{ kind: "move" | "resize" | "rotate"; start: Point; from: Placed } | null>(null);
  const current = useRef<Stroke | null>(null);
  const stickerId = useRef(sticker?.id ?? null);
  const counted = useRef(false);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(COLORS[2]);
  const [width, setWidth] = useState(10);
  const [readable, setReadable] = useState(sticker?.drawing === "plain");
  const [strokeCount, setStrokeCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [placed, setPlacedState] = useState<Placed | null>(null);

  const redraw = useCallback(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIDE, SIDE);
    if (base.current) ctx.drawImage(base.current, 0, 0);
    for (const item of strokes.current) {
      if (item.tool === "image") drawPlaced(ctx, item);
      else drawStroke(ctx, item);
    }
    if (placedRef.current) drawPlaced(ctx, placedRef.current);
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
      const flip = mirrored && !plain;
      if (flip) {
        ctx.translate(SIDE, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(source, 0, 0);
      try {
        stickerId.current = saveDrawingSticker(effectId, stickerId.current, out.toDataURL("image/png"), flip ? "mirror" : "plain");
        onSticker(stickerId.current);
        setFailed(false);
      } catch {
        // Over the browser's storage: the pad keeps it, the camera has the last one.
        setFailed(true);
        trackCustomEffect(CAMERA_CUSTOM_EVENTS.imageError);
      }
    },
    [effectId, mirrored, onSticker]
  );

  const setPlaced = useCallback(
    (next: Placed | null) => {
      placedRef.current = next;
      setPlacedState(next);
      redraw();
    },
    [redraw]
  );

  const readableRef = useRef(readable);
  useEffect(() => {
    readableRef.current = readable;
  }, [readable]);

  const place = useCallback(
    async (blob: Blob) => {
      try {
        if (!blob.type.startsWith("image/")) throw new Error("not an image");
        if (blob.type === "image/gif") {
          onSticker(await addImageSticker(effectId, new File([blob], "sticker.gif", { type: blob.type })));
          onClose();
          return;
        }
        const next = await loadPlaced(blob);
        // One floats at a time: whatever was floating stays where it was.
        if (placedRef.current) strokes.current.push(placedRef.current);
        setPlaced(next);
        setStrokeCount(strokes.current.length);
        store(readableRef.current);
        trackCustomEffect(CAMERA_CUSTOM_EVENTS.drawImage);
      } catch {
        setFailed(true);
        trackCustomEffect(CAMERA_CUSTOM_EVENTS.imageError);
      }
    },
    [effectId, onClose, onSticker, setPlaced, store]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void place(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [place]);

  // For a phone, with no Ctrl+V. The browser may refuse, or have nothing to give.
  const pasteFromClipboard = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((name) => name.startsWith("image/"));
        if (type) {
          setPasteFailed(false);
          await place(await item.getType(type));
          return;
        }
      }
      setPasteFailed(true);
    } catch {
      setPasteFailed(true);
    }
  };

  const layDown = () => {
    if (!placedRef.current) return;
    strokes.current.push(placedRef.current);
    setPlaced(null);
    setStrokeCount(strokes.current.length);
  };

  const dropPlaced = () => {
    setPlaced(null);
    if (strokes.current.length > 0 || base.current || stickerId.current) store(readable);
  };

  const pointAt = (e: React.PointerEvent) => {
    const box = pad.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: ((e.clientX - box.left) / box.width) * SIDE, y: ((e.clientY - box.top) / box.height) * SIDE };
  };

  const startGesture = (kind: "move" | "resize" | "rotate", e: React.PointerEvent) => {
    if (!placedRef.current) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, start: pointAt(e), from: placedRef.current };
  };

  const moveGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    e.stopPropagation();
    const p = pointAt(e);
    const { from } = g;
    if (g.kind === "move") {
      setPlaced({ ...from, x: from.x + p.x - g.start.x, y: from.y + p.y - g.start.y });
    } else if (g.kind === "resize") {
      const ratio = Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, Math.hypot(g.start.x - from.x, g.start.y - from.y));
      setPlaced(resized(from, from.width * ratio));
    } else {
      setPlaced({ ...from, rotation: Math.round((Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI + 90) });
    }
  };

  const endGesture = (e: React.PointerEvent) => {
    if (!gesture.current) return;
    e.stopPropagation();
    gesture.current = null;
    store(readable);
  };

  const changePlaced = (next: Placed) => {
    setPlaced(next);
    store(readable);
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
    if (placedRef.current) {
      dropPlaced();
      return;
    }
    strokes.current.pop();
    setStrokeCount(strokes.current.length);
    redraw();
    if (strokes.current.length > 0 || base.current || stickerId.current) store(readable);
  };

  const clear = () => {
    strokes.current = [];
    base.current = null;
    placedRef.current = null;
    setPlacedState(null);
    setStrokeCount(0);
    redraw();
    if (stickerId.current) removeCustomSticker(effectId, stickerId.current);
    stickerId.current = null;
    onSticker(null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
      <div ref={pad} className="relative mx-auto aspect-square w-full max-w-[17rem] overflow-hidden rounded-lg border border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-700">
        <FaceGuide />
        <canvas
          ref={canvas}
          width={SIDE}
          height={SIDE}
          aria-label={t("watch.watchRoom.cameraCustomDraw")}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={(e) => {
            layDown();
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
        {placed && (
          <div
            onPointerDown={(e) => startGesture("move", e)}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            style={{
              left: `${((placed.x - placed.width / 2) / SIDE) * 100}%`,
              top: `${((placed.y - placed.height / 2) / SIDE) * 100}%`,
              width: `${(placed.width / SIDE) * 100}%`,
              height: `${(placed.height / SIDE) * 100}%`,
              transform: `rotate(${placed.rotation}deg)`,
            }}
            className="absolute cursor-move touch-none border-2 border-emerald-500"
          >
            <span
              onPointerDown={(e) => startGesture("rotate", e)}
              onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
              className="absolute -top-6 left-1/2 flex h-5 w-5 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-full bg-emerald-600 text-white"
            >
              <MdRotateRight className="h-3.5 w-3.5" />
            </span>
            <span
              onPointerDown={(e) => startGesture("resize", e)}
              onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
              className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-emerald-600"
            />
          </div>
        )}
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
          disabled={strokeCount === 0 && !placed}
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
      <div className="flex flex-wrap gap-1">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void place(file);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => void pasteFromClipboard()} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <MdContentPaste className="h-3.5 w-3.5" />
          {t("watch.watchRoom.cameraCustomPaste")}
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <MdImage className="h-3.5 w-3.5" />
          {t("watch.watchRoom.cameraCustomInsertImage")}
        </button>
      </div>
      {pasteFailed && <span className="text-[11px] text-red-600 dark:text-red-400">{t("watch.watchRoom.cameraCustomPasteError")}</span>}
      {placed && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-500/40 p-2">
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span className="w-24 shrink-0 truncate">{t("watch.watchRoom.cameraCustomSize")}</span>
            <input
              type="range"
              min={MIN_PLACED}
              max={MAX_PLACED}
              value={placed.width}
              onChange={(e) => setPlaced(resized(placed, Number(e.target.value)))}
              onPointerUp={() => store(readable)}
              onKeyUp={() => store(readable)}
              className="min-w-0 flex-1 accent-emerald-600"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span className="w-24 shrink-0 truncate">{t("watch.watchRoom.cameraCustomRotate")}</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={((((placed.rotation + 180) % 360) + 360) % 360) - 180}
              onChange={(e) => setPlaced({ ...placed, rotation: Number(e.target.value) })}
              onPointerUp={() => store(readable)}
              onKeyUp={() => store(readable)}
              className="min-w-0 flex-1 accent-emerald-600"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => changePlaced({ ...placed, rotation: placed.rotation + 90 })} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <MdRotateRight className="h-3.5 w-3.5" />
              90°
            </button>
            <button type="button" onClick={() => changePlaced({ ...placed, flipped: !placed.flipped })} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <MdFlip className="h-3.5 w-3.5" />
              {t("watch.watchRoom.cameraCustomFlip")}
            </button>
            <span className="flex-1" />
            <button type="button" onClick={dropPlaced} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <MdClose className="h-3.5 w-3.5" />
              {t("watch.watchRoom.cameraCustomImageRemove")}
            </button>
            <button
              type="button"
              onClick={layDown}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white"
            >
              <MdCheck className="h-3.5 w-3.5" />
              {t("watch.watchRoom.cameraCustomImageApply")}
            </button>
          </div>
        </div>
      )}
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
      {mirrored && (
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
      )}
      {failed && <span className="text-[11px] text-red-600 dark:text-red-400">{t("watch.watchRoom.cameraCustomImageError")}</span>}
      <button type="button" onClick={onClose} className="self-end text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        {t("watch.watchRoom.cameraCustomDrawDone")}
      </button>
    </div>
  );
}
