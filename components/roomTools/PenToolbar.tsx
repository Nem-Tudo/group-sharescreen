"use client";

import type { ReactNode } from "react";
import {
  MdBrush,
  MdCropSquare,
  MdHorizontalRule,
  MdNorthEast,
  MdOutlineCircle,
  MdTextFields,
  MdHighlight,
} from "react-icons/md";
import { LuEraser } from "react-icons/lu";
import { roomTools, useRoomTools, type StrokeShape } from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#111827", "#ffffff"];
const WIDTHS = [2, 4, 8, 14];

const TOOLS: { tool: StrokeShape | "eraser"; icon: ReactNode; label: string }[] = [
  { tool: "pen", icon: <MdBrush />, label: "roomTools.pen.pen" },
  { tool: "highlighter", icon: <MdHighlight />, label: "roomTools.pen.highlighter" },
  { tool: "line", icon: <MdHorizontalRule />, label: "roomTools.pen.line" },
  { tool: "arrow", icon: <MdNorthEast />, label: "roomTools.pen.arrow" },
  { tool: "rect", icon: <MdCropSquare />, label: "roomTools.pen.rect" },
  { tool: "ellipse", icon: <MdOutlineCircle />, label: "roomTools.pen.ellipse" },
  { tool: "text", icon: <MdTextFields />, label: "roomTools.pen.text" },
  { tool: "eraser", icon: <LuEraser />, label: "roomTools.pen.eraser" },
];

/** Shape, colour and thickness — one choice for the whiteboard and the screen notes alike. */
export function PenToolbar({ trailing }: { trailing?: ReactNode }) {
  const t = useT();
  const { pen } = useRoomTools();
  return (
    // One scrolling row on a phone, where wrapping would eat the board.
    <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
      {TOOLS.map(({ tool, icon, label }) => (
        <button
          key={tool}
          type="button"
          title={t(label)}
          aria-label={t(label)}
          aria-pressed={pen.tool === tool}
          onClick={() => roomTools.setPen({ tool })}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg transition ${
            pen.tool === tool
              ? "bg-emerald-600 text-white"
              : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {icon}
        </button>
      ))}
      <span className="mx-1 h-6 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700" />
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={pen.color === color}
          onClick={() => roomTools.setPen({ color, ...(pen.tool === "eraser" ? { tool: "pen" } : {}) })}
          className={`h-6 w-6 shrink-0 rounded-full border border-zinc-300 transition dark:border-zinc-600 ${
            pen.color === color ? "ring-2 ring-emerald-500 ring-offset-1 dark:ring-offset-zinc-900" : ""
          }`}
          style={{ background: color }}
        />
      ))}
      <span className="mx-1 h-6 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700" />
      {WIDTHS.map((width) => (
        <button
          key={width}
          type="button"
          title={`${width}px`}
          aria-label={`${width}px`}
          aria-pressed={pen.width === width}
          onClick={() => roomTools.setPen({ width })}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition ${
            pen.width === width ? "bg-zinc-200 dark:bg-zinc-700" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"
          }`}
        >
          <span className="rounded-full bg-zinc-700 dark:bg-zinc-200" style={{ width: width + 2, height: width + 2 }} />
        </button>
      ))}
      {trailing}
    </div>
  );
}
