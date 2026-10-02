"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MdDeleteSweep, MdGesture, MdPowerSettingsNew, MdUndo } from "react-icons/md";
import { LG_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { canUseTool, roomTools, useRoomTools, useRoomToolsSelector, type DrawTool, type RoomToolsState } from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";
import { PenToolbar } from "./PenToolbar";
import { DrawingSurface } from "./DrawingSurface";
import type { Rect } from "./strokes";

/** Who is looking — provided by the room, read by the layers inside its tiles. */
export const RoomToolsViewer = createContext<{
  selfUserId: string | null;
  isManager: boolean;
  // Opening and closing tools: the managers, and everybody when the room's
  // "tools" switch is on (see the room permissions).
  canOpenTools: boolean;
}>({
  selfUserId: null,
  isManager: false,
  canOpenTools: false,
});

// Where a video's picture actually is inside its element (object-contain), so
// a note lands on the same spot of the shared screen for everybody, whatever
// shape their tile is.
function containRect(video: HTMLVideoElement | null, width: number, height: number): Rect {
  const vw = video?.videoWidth ?? 0;
  const vh = video?.videoHeight ?? 0;
  if (!vw || !vh || !width || !height) return { x: 0, y: 0, w: width, h: height };
  const scale = Math.min(width / vw, height / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/**
 * The notes drawn over one tile (see the "annotate" tool). `annotationKey` is
 * the same for everybody — "screen:<connection id of whoever shares it>" and
 * the like — so a stroke drawn over somebody's screen shows over that screen
 * on every screen in the room.
 */
export function AnnotationLayer({
  annotationKey,
  videoRef,
  focused = false,
}: {
  annotationKey: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  // Whether this media is in focus, hyperfocus or fullscreen — on a phone the
  // pen only works there; a grid cell is too small to draw in.
  focused?: boolean;
}) {
  const wide = useMediaQuery(LG_BREAKPOINT_QUERY);
  const { tools, annotateOff, pen, optimistic } = useRoomTools();
  const { selfUserId, isManager } = useContext(RoomToolsViewer);
  const tool = tools.find((t): t is DrawTool => t.kind === "annotate");
  const [, setVideoSize] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const bump = () => setVideoSize((n) => n + 1);
    video.addEventListener("resize", bump);
    video.addEventListener("loadedmetadata", bump);
    return () => {
      video.removeEventListener("resize", bump);
      video.removeEventListener("loadedmetadata", bump);
    };
  }, [videoRef]);

  const strokes = useMemo(() => {
    if (!tool) return [];
    const own = Object.values(optimistic).filter((s) => s.toolId === tool.id && s.target === annotationKey);
    return [...tool.strokes.filter((s) => s.target === annotationKey), ...own];
  }, [tool, optimistic, annotationKey]);

  const contentRect = useCallback((w: number, h: number) => containRect(videoRef.current, w, h), [videoRef]);

  if (!tool) return null;
  // The pen is down on every media while the tool is open, unless this
  // viewer lifted it here (see AnnotateButton).
  const canDraw =
    (wide || focused) && !annotateOff.includes(annotationKey) && canUseTool(tool, selfUserId, isManager);
  if (!canDraw && strokes.length === 0) return null;
  return (
    <div
      className={`absolute inset-0 z-[15] ${canDraw ? "" : "pointer-events-none"}`}
      // A tap that draws is not a tap that pauses or focuses the tile.
      onClick={canDraw ? (e) => e.stopPropagation() : undefined}
      onDoubleClick={canDraw ? (e) => e.stopPropagation() : undefined}
    >
      {canDraw && <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-emerald-500/70" />}
      <DrawingSurface
        strokes={strokes}
        canDraw={canDraw}
        pen={pen}
        contentRect={contentRect}
        onStroke={(stroke) => roomTools.addStroke(tool.id, { ...stroke, target: annotationKey }, selfUserId)}
        onErase={(ids) => roomTools.removeStrokes(tool.id, ids)}
      />
    </div>
  );
}

const selectAnnotateTool = (s: RoomToolsState) =>
  s.tools.find((t): t is DrawTool => t.kind === "annotate") ?? null;
const selectAnnotateOff = (s: RoomToolsState) => s.annotateOff;
const selectStageFocused = (s: RoomToolsState) => s.stageFocused;

/**
 * The pen on a media tile: drawing on this one screen, on or off. On by
 * default while the room's screen notes are open — this is how a viewer gets
 * this screen's taps back. Sits above the drawing layer (z-20), so it can
 * always be reached.
 */
export function AnnotateButton({ mediaKey, focused = false }: { mediaKey: string; focused?: boolean }) {
  const t = useT();
  const wide = useMediaQuery(LG_BREAKPOINT_QUERY);
  const tool = useRoomToolsSelector(selectAnnotateTool);
  const annotateOff = useRoomToolsSelector(selectAnnotateOff);
  const { selfUserId, isManager } = useContext(RoomToolsViewer);
  if (!tool || !canUseTool(tool, selfUserId, isManager) || (!wide && !focused)) return null;
  const on = !annotateOff.includes(mediaKey);
  const label = on ? t("roomTools.annotate.stopHere") : t("roomTools.annotate.drawHere");
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        roomTools.setAnnotating(mediaKey, !on);
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`rounded-full p-1.5 text-white transition ${on ? "bg-emerald-600 hover:bg-emerald-700" : "bg-black/50 hover:bg-black/70"}`}
    >
      <MdGesture className="h-4 w-4" />
    </button>
  );
}

/**
 * At the bottom of the screen while the room's screen notes are open: the
 * tool's name, which opens the pen — shape, colour, thickness — and the undo
 * and clear that go with it.
 */
export function AnnotateDock() {
  const t = useT();
  const wide = useMediaQuery(LG_BREAKPOINT_QUERY);
  const stageFocused = useRoomToolsSelector(selectStageFocused);
  const [confirmOff, setConfirmOff] = useState(false);
  const tool = useRoomToolsSelector(selectAnnotateTool);
  const { selfUserId, isManager } = useContext(RoomToolsViewer);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // On a phone, only while something is in focus — the only place the pen works there.
  if (!tool || !canUseTool(tool, selfUserId, isManager) || (!wide && !stageFocused)) return null;
  const mine = tool.strokes.filter((s) => s.by === selfUserId);
  const small =
    "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800";
  return (
    <div
      ref={boxRef}
      // Higher on a phone: the bottom bar and the ad strip live under it.
      className="fixed bottom-40 left-1/2 z-[58] flex -translate-x-1/2 flex-col items-center gap-2 lg:bottom-4"
      onKeyDown={(e) => e.stopPropagation()}
    >
      {open && (
        <div className="flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
          <PenToolbar />
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={small}
              disabled={mine.length === 0}
              onClick={() => roomTools.removeStrokes(tool.id, [mine[mine.length - 1].id])}
            >
              <MdUndo className="h-4 w-4" />
              {t("roomTools.undo")}
            </button>
            <button type="button" className={small} onClick={() => roomTools.clearStrokes(tool.id)}>
              <MdDeleteSweep className="h-4 w-4" />
              {isManager ? t("roomTools.clearAll") : t("roomTools.clearMine")}
            </button>
            {isManager &&
              (confirmOff ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
                    onClick={() => {
                      setConfirmOff(false);
                      setOpen(false);
                      roomTools.close(tool.id);
                    }}
                  >
                    {t("roomTools.confirmClose")}
                  </button>
                  <button type="button" className={small} onClick={() => setConfirmOff(false)}>
                    {t("roomTools.cancel")}
                  </button>
                </span>
              ) : (
                <button type="button" className={small + " text-red-600 dark:text-red-400"} onClick={() => setConfirmOff(true)}>
                  <MdPowerSettingsNew className="h-4 w-4" />
                  {t("roomTools.annotate.turnOff")}
                </button>
              ))}
            <span className="flex-1" />
            <span className="text-[11px] text-zinc-500">
              {t("roomTools.annotate.offHint")}
            </span>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition ${
          open ? "bg-emerald-700 text-white" : "bg-emerald-600 text-white hover:bg-emerald-700"
        }`}
      >
        <MdGesture className="h-4 w-4" />
        {t("roomTools.kind.annotate")}
      </button>
    </div>
  );
}
