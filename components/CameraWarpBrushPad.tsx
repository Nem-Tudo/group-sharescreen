"use client";

import { useEffect, useRef, useState } from "react";
import { MdDelete, MdUndo } from "react-icons/md";
import { FaceGuide } from "@/components/CameraDrawingPad";
import { CAMERA_CUSTOM_EVENTS, readCustomWarp, setCustomWarp, trackCustomEffect } from "@/lib/cameraCustomEffects";
import {
  applyWarpDab,
  createWarpGrid,
  decodeWarpGrid,
  encodeWarpGrid,
  isWarpGridEmpty,
  WARP_GRID,
  type WarpMode,
} from "@/lib/cameraWarpBrush";
import { useT } from "@/lib/useI18n";

// The distortion brush of "Criar efeito" (see lib/cameraWarpBrush): painted on the
// face's outline, seen in the camera above as it is painted. The purple on the
// pad is how much each spot has been moved.

const MODES: { mode: WarpMode; label: string }[] = [
  { mode: "out", label: "watch.watchRoom.cameraCustomWarpOut" },
  { mode: "in", label: "watch.watchRoom.cameraCustomWarpIn" },
  { mode: "push", label: "watch.watchRoom.cameraCustomWarpPush" },
  { mode: "cw", label: "watch.watchRoom.cameraCustomWarpCw" },
  { mode: "ccw", label: "watch.watchRoom.cameraCustomWarpCcw" },
  { mode: "restore", label: "watch.watchRoom.cameraCustomWarpRestore" },
];
const MAX_UNDO = 12;
// How often the camera is told, mid-stroke: each time is a texture upload.
const LIVE_MS = 80;

export function CameraWarpBrushPad({
  effectId,
  mirrored,
  onClose,
}: {
  effectId: string;
  mirrored: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const pad = useRef<HTMLDivElement>(null);
  const heat = useRef<HTMLCanvasElement>(null);
  const [grid] = useState(() => {
    const stored = readCustomWarp(effectId);
    return stored ? decodeWarpGrid(stored) : createWarpGrid();
  });
  const undoStack = useRef<Float32Array[]>([]);
  const stroke = useRef<{ x: number; y: number; frame: number; lastLive: number } | null>(null);
  const counted = useRef(false);
  const [mode, setMode] = useState<WarpMode>("out");
  const [size, setSize] = useState(25);
  const [strength, setStrength] = useState(50);
  const [undoCount, setUndoCount] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const paintHeat = () => {
    const ctx = heat.current?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(WARP_GRID, WARP_GRID);
    for (let i = 0; i < WARP_GRID * WARP_GRID; i += 1) {
      const amount = Math.hypot(grid[i * 2], grid[i * 2 + 1]);
      image.data[i * 4] = 139;
      image.data[i * 4 + 1] = 92;
      image.data[i * 4 + 2] = 246;
      image.data[i * 4 + 3] = Math.min(190, amount * 2400);
    }
    ctx.putImageData(image, 0, 0);
  };

  const send = (persist: boolean) => {
    setCustomWarp(effectId, isWarpGridEmpty(grid) ? null : encodeWarpGrid(grid), persist);
  };

  // Where the pointer is in the grid, which is as the frame has it.
  const gridPoint = (e: React.PointerEvent) => {
    const box = pad.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    const x = (e.clientX - box.left) / box.width;
    return { x: mirrored ? 1 - x : x, y: (e.clientY - box.top) / box.height };
  };

  const dabMode = (): WarpMode => {
    if (!mirrored) return mode;
    return mode === "cw" ? "ccw" : mode === "ccw" ? "cw" : mode;
  };

  // Held still it keeps working, as a brush does; "push" only moves with the hand.
  useEffect(() => {
    const running = stroke;
    return () => {
      if (running.current) cancelAnimationFrame(running.current.frame);
    };
  }, []);

  const tick = (now: number) => {
    const current = stroke.current;
    if (!current) return;
    if (mode !== "push") {
      applyWarpDab(grid, { x: current.x, y: current.y, radius: size / 100, strength: strength / 100, mode: dabMode() });
    }
    paintHeat();
    if (now - current.lastLive > LIVE_MS) {
      current.lastLive = now;
      send(false);
    }
    current.frame = requestAnimationFrame(tick);
  };

  const finish = () => {
    if (!stroke.current) return;
    cancelAnimationFrame(stroke.current.frame);
    stroke.current = null;
    paintHeat();
    send(true);
    if (!counted.current) {
      counted.current = true;
      trackCustomEffect(CAMERA_CUSTOM_EVENTS.warp);
    }
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    grid.set(previous);
    setUndoCount(undoStack.current.length);
    paintHeat();
    send(true);
  };

  const clear = () => {
    undoStack.current.push(grid.slice());
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
    grid.fill(0);
    paintHeat();
    send(true);
  };

  useEffect(() => {
    const ctx = heat.current?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(WARP_GRID, WARP_GRID);
    for (let i = 0; i < WARP_GRID * WARP_GRID; i += 1) {
      image.data[i * 4] = 139;
      image.data[i * 4 + 1] = 92;
      image.data[i * 4 + 2] = 246;
      image.data[i * 4 + 3] = Math.min(190, Math.hypot(grid[i * 2], grid[i * 2 + 1]) * 2400);
    }
    ctx.putImageData(image, 0, 0);
  }, [grid]);

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-2 dark:bg-zinc-900">
      <div
        ref={pad}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          undoStack.current.push(grid.slice());
          if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
          setUndoCount(undoStack.current.length);
          const point = gridPoint(e);
          stroke.current = { ...point, frame: 0, lastLive: 0 };
          stroke.current.frame = requestAnimationFrame(tick);
        }}
        onPointerMove={(e) => {
          const box = pad.current?.getBoundingClientRect();
          if (box) setCursor({ x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 });
          const current = stroke.current;
          if (!current) return;
          const point = gridPoint(e);
          if (mode === "push") {
            applyWarpDab(grid, {
              x: current.x,
              y: current.y,
              radius: size / 100,
              strength: strength / 100,
              mode: "push",
              dx: point.x - current.x,
              dy: point.y - current.y,
            });
          }
          current.x = point.x;
          current.y = point.y;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => setCursor(null)}
        aria-label={t("watch.watchRoom.cameraCustomWarp")}
        className="relative mx-auto aspect-square w-full max-w-[17rem] cursor-crosshair touch-none overflow-hidden rounded-lg border border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-700"
      >
        <canvas
          ref={heat}
          width={WARP_GRID}
          height={WARP_GRID}
          className={`absolute inset-0 h-full w-full ${mirrored ? "-scale-x-100" : ""}`}
        />
        <FaceGuide />
        {cursor && (
          <span
            style={{
              left: `${cursor.x}%`,
              top: `${cursor.y}%`,
              width: `${size * 2}%`,
              height: `${size * 2}%`,
            }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {MODES.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={mode === item.mode}
            onClick={() => setMode(item.mode)}
            className={`rounded-md px-2 py-1 text-xs font-medium ${mode === item.mode ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="w-24 shrink-0 truncate">{t("watch.watchRoom.cameraCustomSize")}</span>
        <input type="range" min={5} max={50} value={size} onChange={(e) => setSize(Number(e.target.value))} className="min-w-0 flex-1 accent-emerald-600" />
      </label>
      <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
        <span className="w-24 shrink-0 truncate">{t("watch.watchRoom.cameraCustomWarpStrength")}</span>
        <input type="range" min={5} max={100} value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="min-w-0 flex-1 accent-emerald-600" />
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={undoCount === 0}
          aria-label={t("watch.watchRoom.cameraCustomUndo")}
          title={t("watch.watchRoom.cameraCustomUndo")}
          onClick={undo}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300"
        >
          <MdUndo className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={t("watch.watchRoom.cameraCustomWarpClear")}
          title={t("watch.watchRoom.cameraCustomWarpClear")}
          onClick={clear}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-red-600 dark:bg-zinc-800 dark:text-red-400"
        >
          <MdDelete className="h-4 w-4" />
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          {t("watch.watchRoom.cameraCustomDrawDone")}
        </button>
      </div>
    </div>
  );
}
