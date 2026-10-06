"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  MdFileDownload,
  MdFormatAlignCenter,
  MdFormatAlignLeft,
  MdFormatAlignRight,
  MdFormatBold,
  MdFormatColorFill,
  MdFormatColorText,
  MdFormatItalic,
  MdRedo,
  MdUndo,
} from "react-icons/md";
import { ROOM_TOOLS_EVENTS, roomTools, trackRoomToolsEvent, type SheetTool } from "@/lib/roomTools";
import {
  DEFAULT_COL_WIDTH,
  cellKey,
  cellName,
  colName,
  displayValue,
  evaluateSheet,
  isFormulaError,
  parsePastedGrid,
  sheetToCsv,
  sheetToExcel,
  type CellAlign,
  type CellStyle,
  type SheetChange,
} from "@/lib/sheet";
import { useT } from "@/lib/useI18n";

// The room's spreadsheet (see lib/sheet.ts): a grid everybody with access
// edits at once, a cell at a time, with formulas worked out here. Arrow keys,
// Enter and Tab move; typing replaces a cell, F2 or a double click edits it;
// Ctrl+C / Ctrl+V copy and paste blocks to and from Excel or Sheets.

const ROW_HEIGHT = 26;
const HEADER_WIDTH = 44;
// Rows drawn beyond what is on screen, so a quick scroll does not show blanks.
const OVERSCAN = 8;

const FILL_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "#fed7aa", "#e4e4e7"];
const TEXT_COLORS = ["#dc2626", "#16a34a", "#2563eb", "#9333ea", "#ea580c", "#71717a"];

type Pos = { r: number; c: number };

const toolbarButton =
  "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SheetView({ tool, canUse }: { tool: SheetTool; canUse: boolean }) {
  const t = useT();
  const values = useMemo(() => evaluateSheet(tool), [tool]);
  const [anchorState, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focusState, setFocus] = useState<Pos>({ r: 0, c: 0 });
  // Kept inside the grid, which may shrink under the selection (a row
  // somebody else deleted).
  const clampPos = (p: Pos): Pos => ({ r: Math.min(p.r, tool.rows - 1), c: Math.min(p.c, tool.cols - 1) });
  const anchor = clampPos(anchorState);
  const focus = clampPos(focusState);
  // The cell being typed in, and what is typed so far.
  const [editing, setEditing] = useState<{ pos: Pos; value: string } | null>(null);
  const [palette, setPalette] = useState<"bg" | "color" | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selecting = useRef(false);
  const [scroll, setScroll] = useState({ top: 0, height: 400 });
  // A column being made wider or narrower, shown before it is sent.
  const [resizing, setResizing] = useState<{ col: number; startX: number; startWidth: number; width: number } | null>(null);

  const top = Math.min(anchor.r, focus.r);
  const bottom = Math.max(anchor.r, focus.r);
  const left = Math.min(anchor.c, focus.c);
  const right = Math.max(anchor.c, focus.c);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => setScroll({ top: grid.scrollTop, height: grid.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const widthOf = (c: number) => (resizing?.col === c ? resizing.width : (tool.colWidths[c] ?? DEFAULT_COL_WIDTH));
  const colLefts = useMemo(() => {
    const lefts = [HEADER_WIDTH];
    for (let c = 0; c < tool.cols; c++) lefts.push(lefts[c] + widthOf(c));
    return lefts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.cols, tool.colWidths, resizing]);
  const totalWidth = colLefts[tool.cols];

  const firstRow = Math.max(0, Math.floor(scroll.top / ROW_HEIGHT) - 1 - OVERSCAN);
  const lastRow = Math.min(tool.rows - 1, Math.ceil((scroll.top + scroll.height) / ROW_HEIGHT) + OVERSCAN);

  function change(c: SheetChange) {
    if (canUse) roomTools.editSheet(tool.id, c);
  }

  // Ctrl+Z / Ctrl+Y for what this person typed, pasted, cut or cleared. Each
  // step remembers the block's raw values before and after, so undoing is just
  // writing the old block back.
  type Step = { r: number; c: number; before: string[][]; after: string[][] };
  const undoStack = useRef<Step[]>([]);
  const redoStack = useRef<Step[]>([]);
  // The stacks are refs; this re-renders the undo/redo buttons when they change.
  const [, setHistoryTick] = useState(0);

  function rawBlock(r0: number, c0: number, rows: number, cols: number): string[][] {
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => tool.cells[cellKey(r0 + r, c0 + c)]?.v ?? ""));
  }

  function writeBlock(r0: number, c0: number, after: string[][]) {
    if (!canUse || !after.length) return;
    const before = rawBlock(r0, c0, after.length, Math.max(...after.map((l) => l.length)));
    if (after.every((line, r) => line.every((v, c) => v === before[r][c]))) return;
    undoStack.current.push({ r: r0, c: c0, before, after });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistoryTick((n) => n + 1);
    change({ op: "fill", cell: cellKey(r0, c0), values: after });
  }

  function replay(from: typeof undoStack, to: typeof undoStack, undo: boolean) {
    const step = from.current.pop();
    if (!step) return;
    to.current.push(step);
    setHistoryTick((n) => n + 1);
    const block = undo ? step.before : step.after;
    change({ op: "fill", cell: cellKey(step.r, step.c), values: block });
    setAnchor({ r: step.r, c: step.c });
    setFocus({ r: Math.min(tool.rows - 1, step.r + block.length - 1), c: Math.min(tool.cols - 1, step.c + block[0].length - 1) });
  }

  function select(pos: Pos, extend = false) {
    const clamped = { r: Math.max(0, Math.min(tool.rows - 1, pos.r)), c: Math.max(0, Math.min(tool.cols - 1, pos.c)) };
    setFocus(clamped);
    if (!extend) setAnchor(clamped);
    // Keep the cell in view.
    const grid = gridRef.current;
    if (!grid) return;
    const y = (clamped.r + 1) * ROW_HEIGHT;
    if (y - ROW_HEIGHT < grid.scrollTop + ROW_HEIGHT) grid.scrollTop = Math.max(0, y - 2 * ROW_HEIGHT);
    else if (y > grid.scrollTop + grid.clientHeight) grid.scrollTop = y - grid.clientHeight;
    const x = colLefts[clamped.c];
    const x2 = colLefts[clamped.c + 1];
    if (x - HEADER_WIDTH < grid.scrollLeft) grid.scrollLeft = x - HEADER_WIDTH;
    else if (x2 > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = x2 - grid.clientWidth;
  }

  function startEdit(value?: string) {
    if (!canUse) return;
    setEditing({ pos: focus, value: value ?? tool.cells[cellKey(focus.r, focus.c)]?.v ?? "" });
    window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  }

  const committed = useRef<object | null>(null);
  function commitEdit(move: Pos | null) {
    if (!editing || committed.current === editing) return;
    committed.current = editing;
    writeBlock(editing.pos.r, editing.pos.c, [[editing.value]]);
    setEditing(null);
    if (move) select({ r: editing.pos.r + move.r, c: editing.pos.c + move.c });
    gridRef.current?.focus({ preventScroll: true });
  }

  function selectedKeys(): string[] {
    const keys: string[] = [];
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) keys.push(cellKey(r, c));
    return keys;
  }

  function style(s: CellStyle) {
    change({ op: "style", cells: selectedKeys(), style: s });
  }

  const focusCell = tool.cells[cellKey(focus.r, focus.c)];

  function clearSelection() {
    writeBlock(top, left, Array.from({ length: bottom - top + 1 }, () => Array.from({ length: right - left + 1 }, () => "")));
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (editing) return;
    e.stopPropagation();
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      select({ r: focus.r + dr, c: focus.c + dc }, e.shiftKey);
    };
    const mod = e.ctrlKey || e.metaKey;
    const letter = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    switch (e.key) {
      case "ArrowUp":
        return move(-1, 0);
      case "ArrowDown":
        return move(1, 0);
      case "ArrowLeft":
        return move(0, -1);
      case "ArrowRight":
        return move(0, 1);
      case "Tab":
        e.preventDefault();
        return select({ r: focus.r, c: focus.c + (e.shiftKey ? -1 : 1) });
      case "Enter":
        e.preventDefault();
        return canUse ? startEdit() : select({ r: focus.r + 1, c: focus.c });
      case "F2":
        e.preventDefault();
        return startEdit();
      case "Delete":
      case "Backspace":
        e.preventDefault();
        return clearSelection();
    }
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      return style({ b: !focusCell?.b });
    }
    if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      return style({ i: !focusCell?.i });
    }
    if (mod && letter === "z" && !e.shiftKey) {
      e.preventDefault();
      return replay(undoStack, redoStack, true);
    }
    if (mod && (letter === "y" || (letter === "z" && e.shiftKey))) {
      e.preventDefault();
      return replay(redoStack, undoStack, false);
    }
    if (mod && letter === "x") {
      e.preventDefault();
      void navigator.clipboard?.writeText(selectionText()).catch(() => {});
      if (canUse) clearSelection();
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: tool.rows - 1, c: tool.cols - 1 });
      return;
    }
    // Typing a character starts a fresh value in the cell, as in Excel.
    if (!mod && !e.altKey && e.key.length === 1 && canUse) {
      e.preventDefault();
      startEdit(e.key);
    }
  }

  function selectionText(): string {
    const lines: string[] = [];
    for (let r = top; r <= bottom; r++) {
      const fields: string[] = [];
      for (let c = left; c <= right; c++) fields.push(displayValue(values.get(cellKey(r, c))));
      lines.push(fields.join("\t"));
    }
    return lines.join("\n");
  }

  function onCopy(e: ClipboardEvent) {
    if (!e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", selectionText());
  }

  function onPaste(e: ClipboardEvent) {
    if (!canUse || !e.clipboardData) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const grid = parsePastedGrid(text)
      .slice(0, tool.rows - top)
      .map((line) => line.slice(0, tool.cols - left));
    // A single value pasted on a selection fills all of it.
    if (grid.length === 1 && grid[0].length === 1 && (bottom > top || right > left)) {
      const value = grid[0][0];
      writeBlock(top, left, Array.from({ length: bottom - top + 1 }, () => Array.from({ length: right - left + 1 }, () => value)));
      return;
    }
    const width = Math.max(...grid.map((l) => l.length));
    writeBlock(top, left, grid.map((line) => [...line, ...Array<string>(width - line.length).fill("")]));
    setAnchor({ r: top, c: left });
    setFocus({ r: Math.min(tool.rows - 1, top + grid.length - 1), c: Math.min(tool.cols - 1, left + Math.max(...grid.map((l) => l.length)) - 1) });
  }

  // A focused div that is not editable never receives copy/cut/paste: with no
  // text selected the browser fires them on <body>. So they are caught on the
  // document and handled only while the grid itself has the focus.
  // (The grid's own document: it may be in a picture-in-picture window.)
  const clipboardHandlers = useRef({ onCopy, onPaste });
  clipboardHandlers.current = { onCopy, onPaste };
  useEffect(() => {
    const doc = gridRef.current?.ownerDocument;
    if (!doc) return;
    const on = (kind: "onCopy" | "onPaste") => (e: ClipboardEvent) => {
      if (doc.activeElement !== gridRef.current) return;
      clipboardHandlers.current[kind](e);
    };
    const copy = on("onCopy");
    const paste = on("onPaste");
    doc.addEventListener("copy", copy);
    doc.addEventListener("paste", paste);
    return () => {
      doc.removeEventListener("copy", copy);
      doc.removeEventListener("paste", paste);
    };
  }, []);

  function cellAt(e: PointerEvent<HTMLDivElement>): Pos | null {
    const grid = gridRef.current;
    if (!grid) return null;
    const box = grid.getBoundingClientRect();
    const x = e.clientX - box.left + grid.scrollLeft;
    const y = e.clientY - box.top + grid.scrollTop - ROW_HEIGHT;
    if (y < 0 || x < HEADER_WIDTH) return null;
    let c = colLefts.findIndex((l, i) => i < tool.cols && x >= l && x < colLefts[i + 1]);
    if (c < 0) c = tool.cols - 1;
    return { r: Math.min(tool.rows - 1, Math.floor(y / ROW_HEIGHT)), c };
  }

  function exportFile(kind: "csv" | "xls") {
    const name = tool.title || "planilha";
    if (kind === "csv") download(`${name}.csv`, new Blob([sheetToCsv(tool)], { type: "text/csv;charset=utf-8" }));
    else download(`${name}.xls`, new Blob([sheetToExcel(tool, name)], { type: "application/vnd.ms-excel" }));
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.export);
    trackRoomToolsEvent(`${ROOM_TOOLS_EVENTS.export}.sheet`);
  }

  const align = (a: CellAlign) => style({ align: focusCell?.align === a ? null : a });
  const selectionLabel = top === bottom && left === right ? cellName(top, left) : `${cellName(top, left)}:${cellName(bottom, right)}`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {canUse && (
        <div className="flex shrink-0 flex-wrap items-center gap-0.5">
          <button type="button" className={toolbarButton} onClick={() => replay(undoStack, redoStack, true)} disabled={!undoStack.current.length} title={`${t("roomTools.undo")} (Ctrl+Z)`}>
            <MdUndo className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => replay(redoStack, undoStack, false)} disabled={!redoStack.current.length} title={`${t("roomTools.doc.redo")} (Ctrl+Y)`}>
            <MdRedo className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
          <button type="button" className={`${toolbarButton} ${focusCell?.b ? "bg-zinc-200 dark:bg-zinc-800" : ""}`} onClick={() => style({ b: !focusCell?.b })} title={t("roomTools.sheet.bold")}>
            <MdFormatBold className="h-4 w-4" />
          </button>
          <button type="button" className={`${toolbarButton} ${focusCell?.i ? "bg-zinc-200 dark:bg-zinc-800" : ""}`} onClick={() => style({ i: !focusCell?.i })} title={t("roomTools.sheet.italic")}>
            <MdFormatItalic className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => align("left")} title={t("roomTools.sheet.alignLeft")}>
            <MdFormatAlignLeft className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => align("center")} title={t("roomTools.sheet.alignCenter")}>
            <MdFormatAlignCenter className="h-4 w-4" />
          </button>
          <button type="button" className={toolbarButton} onClick={() => align("right")} title={t("roomTools.sheet.alignRight")}>
            <MdFormatAlignRight className="h-4 w-4" />
          </button>
          <span className="relative">
            <button type="button" className={toolbarButton} onClick={() => setPalette(palette === "bg" ? null : "bg")} title={t("roomTools.sheet.fill")}>
              <MdFormatColorFill className="h-4 w-4" />
            </button>
            <button type="button" className={toolbarButton} onClick={() => setPalette(palette === "color" ? null : "color")} title={t("roomTools.sheet.textColor")}>
              <MdFormatColorText className="h-4 w-4" />
            </button>
            {palette && (
              <span className="absolute left-0 top-full z-30 mt-1 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {(palette === "bg" ? FILL_COLORS : TEXT_COLORS).map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => {
                      style(palette === "bg" ? { bg: color } : { color });
                      setPalette(null);
                    }}
                    className="h-5 w-5 rounded border border-zinc-300 dark:border-zinc-600"
                    style={{ background: color }}
                    aria-label={color}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => {
                    style(palette === "bg" ? { bg: null } : { color: null });
                    setPalette(null);
                  }}
                  className="rounded border border-zinc-300 px-1 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                >
                  {t("roomTools.sheet.noColor")}
                </button>
              </span>
            )}
          </span>
          <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
          <button type="button" className={toolbarButton} onClick={() => change({ op: "insert", axis: "row", at: top })}>
            {t("roomTools.sheet.insertRow")}
          </button>
          <button type="button" className={toolbarButton} onClick={() => change({ op: "insert", axis: "col", at: left })}>
            {t("roomTools.sheet.insertCol")}
          </button>
          <button type="button" className={toolbarButton} onClick={() => change({ op: "delete", axis: "row", at: top })} disabled={tool.rows <= 1}>
            {t("roomTools.sheet.deleteRow")}
          </button>
          <button type="button" className={toolbarButton} onClick={() => change({ op: "delete", axis: "col", at: left })} disabled={tool.cols <= 1}>
            {t("roomTools.sheet.deleteCol")}
          </button>
          <span className="ml-auto flex items-center gap-0.5">
            <button type="button" className={toolbarButton} onClick={() => exportFile("xls")} title={t("roomTools.sheet.exportExcel")}>
              <MdFileDownload className="h-4 w-4" />
              Excel
            </button>
            <button type="button" className={toolbarButton} onClick={() => exportFile("csv")} title={t("roomTools.sheet.exportCsv")}>
              CSV
            </button>
          </span>
        </div>
      )}
      {/* The formula bar: which cell, and what is really typed in it. */}
      <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 bg-white text-xs dark:border-zinc-700 dark:bg-zinc-950">
        <span className="w-20 shrink-0 truncate border-r border-zinc-300 px-2 py-1 font-mono text-zinc-500 dark:border-zinc-700">{selectionLabel}</span>
        <span className="text-zinc-400">ƒx</span>
        <input
          value={editing ? editing.value : (focusCell?.v ?? "")}
          readOnly={!canUse}
          onFocus={() => {
            if (!editing && canUse) setEditing({ pos: focus, value: focusCell?.v ?? "" });
          }}
          onChange={(e) => setEditing({ pos: editing?.pos ?? focus, value: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitEdit({ r: 1, c: 0 });
            else if (e.key === "Escape") {
              setEditing(null);
              gridRef.current?.focus({ preventScroll: true });
            }
          }}
          onBlur={() => {
            if (editing && document.activeElement !== inputRef.current) commitEdit(null);
          }}
          className="min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-zinc-800 outline-none dark:text-zinc-100"
        />
      </div>
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("[data-col-resize], input")) return;
          const pos = cellAt(e);
          if (!pos) return;
          if (editing) commitEdit(null);
          select(pos, e.shiftKey);
          selecting.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          gridRef.current?.focus({ preventScroll: true });
        }}
        onPointerMove={(e) => {
          if (!selecting.current) return;
          const pos = cellAt(e);
          if (pos) setFocus(pos);
        }}
        onPointerUp={() => {
          selecting.current = false;
        }}
        onDoubleClick={() => startEdit()}
        className="relative min-h-0 flex-1 select-none overflow-auto rounded-md border border-zinc-300 bg-white text-[13px] outline-none dark:border-zinc-700 dark:bg-zinc-950"
      >
        <div style={{ width: totalWidth, height: (tool.rows + 1) * ROW_HEIGHT }} className="relative">
          {/* Column headers, stuck to the top. */}
          <div className="sticky top-0 z-20 flex" style={{ height: ROW_HEIGHT, width: totalWidth }}>
            <div className="sticky left-0 z-10 shrink-0 border-b border-r border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900" style={{ width: HEADER_WIDTH }} />
            {Array.from({ length: tool.cols }, (_, c) => (
              <div
                key={c}
                className={`relative flex shrink-0 items-center justify-center border-b border-r border-zinc-300 text-[11px] font-semibold dark:border-zinc-700 ${
                  c >= left && c <= right ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"
                }`}
                style={{ width: widthOf(c) }}
              >
                {colName(c)}
                {canUse && (
                  <div
                    data-col-resize
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setResizing({ col: c, startX: e.clientX, startWidth: widthOf(c), width: widthOf(c) });
                    }}
                    onPointerMove={(e) => {
                      if (resizing?.col !== c) return;
                      setResizing({ ...resizing, width: Math.round(Math.max(30, Math.min(800, resizing.startWidth + e.clientX - resizing.startX))) });
                    }}
                    onPointerUp={() => {
                      if (resizing?.col === c && resizing.width !== resizing.startWidth) change({ op: "width", col: c, width: resizing.width });
                      setResizing(null);
                    }}
                    className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize"
                  />
                )}
              </div>
            ))}
          </div>
          {Array.from({ length: Math.max(0, lastRow - firstRow + 1) }, (_, i) => {
            const r = firstRow + i;
            return (
              <div key={r} className="absolute left-0 flex" style={{ top: (r + 1) * ROW_HEIGHT, height: ROW_HEIGHT, width: totalWidth }}>
                <div
                  className={`sticky left-0 z-10 flex shrink-0 items-center justify-center border-b border-r border-zinc-300 text-[11px] font-semibold dark:border-zinc-700 ${
                    r >= top && r <= bottom ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"
                  }`}
                  style={{ width: HEADER_WIDTH }}
                >
                  {r + 1}
                </div>
                {Array.from({ length: tool.cols }, (_, c) => {
                  const key = cellKey(r, c);
                  const cell = tool.cells[key];
                  const value = values.get(key);
                  const selected = r >= top && r <= bottom && c >= left && c <= right;
                  const isFocus = r === focus.r && c === focus.c;
                  const isEditing = editing && editing.pos.r === r && editing.pos.c === c;
                  const cellAlign = cell?.align ?? (typeof value === "number" ? "right" : "left");
                  return (
                    <div
                      key={c}
                      className={`relative shrink-0 overflow-hidden whitespace-nowrap border-b border-r border-zinc-200 px-1.5 leading-[26px] dark:border-zinc-600 ${
                        isFormulaError(value) ? "text-red-600" : "text-zinc-800 dark:text-zinc-100"
                      }`}
                      style={{
                        width: widthOf(c),
                        background: cell?.bg,
                        color: cell?.color,
                        fontWeight: cell?.b ? 700 : undefined,
                        fontStyle: cell?.i ? "italic" : undefined,
                        textAlign: cellAlign,
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editing.value}
                          onChange={(e) => setEditing({ pos: editing.pos, value: e.target.value })}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit({ r: e.shiftKey ? -1 : 1, c: 0 });
                            } else if (e.key === "Tab") {
                              e.preventDefault();
                              commitEdit({ r: 0, c: e.shiftKey ? -1 : 1 });
                            } else if (e.key === "Escape") {
                              setEditing(null);
                              gridRef.current?.focus({ preventScroll: true });
                            }
                          }}
                          onBlur={() => commitEdit(null)}
                          className="absolute inset-0 z-10 w-full bg-white px-1.5 text-left font-normal text-zinc-900 outline-2 outline-emerald-600 dark:bg-zinc-900 dark:text-zinc-100"
                          style={{ fontStyle: "normal" }}
                        />
                      ) : (
                        displayValue(value)
                      )}
                      {selected && !isEditing && (
                        <span className={`pointer-events-none absolute inset-0 ${isFocus ? "ring-2 ring-inset ring-emerald-600" : "bg-emerald-500/10"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {!canUse && <span className="shrink-0 text-xs text-zinc-500">{t("roomTools.viewOnly")}</span>}
    </div>
  );
}
