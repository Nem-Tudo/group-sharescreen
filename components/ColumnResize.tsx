"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

// A column whose width is dragged from its inner edge, the way a room's chat
// column is (see WatchRoom's chatWidth) — the same grip in the gap beside it,
// the same double-click back to the default — and remembered per browser.
//
// `side` is which side of the page the column sits on, and so which of its
// edges stays put: a left-hand column grows rightwards, a right-hand one
// leftwards, and the pointer is always the edge that moves.
//
// Never wider than `maxShare` of the row it sits in: the middle of the page is
// what the columns are around, and a column dragged over it is not a state
// anyone means to be in. The same share is the column's CSS max-width too (see
// `style`), so a window narrowed afterwards takes the width back as well.

export interface ColumnWidthSpec {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  maxShare: number;
  side: "left" | "right";
}

// Two presses on the grip this close together are a double-click.
const DOUBLE_CLICK_MS = 400;

// What each column was left at, read from storage once per page load. A store
// rather than state read in an effect, so the server's render (the default)
// and the browser's first one agree, and the saved width follows straight on.
const savedWidths = new Map<string, number | null>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readSaved(key: string): number | null {
  if (!savedWidths.has(key)) {
    let width: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw === null ? NaN : Number(raw);
      if (Number.isFinite(parsed)) width = parsed;
    } catch {}
    savedWidths.set(key, width);
  }
  return savedWidths.get(key) ?? null;
}

function writeSaved(key: string, width: number) {
  savedWidths.set(key, width);
  try {
    localStorage.setItem(key, String(width));
  } catch {}
  listeners.forEach((l) => l());
}

/** Forgets a saved size, handing the element back to the layout around it. */
function clearSaved(key: string) {
  savedWidths.set(key, null);
  try {
    localStorage.removeItem(key);
  } catch {}
  listeners.forEach((l) => l());
}

function clamp(width: number, min: number, max: number) {
  return Math.min(Math.max(width, min), max);
}

// The same idea turned on its side: a row whose *height* is dragged from its
// bottom edge — the call inside a conversation, which shares its column with
// the messages under it (see components/DirectMessagesModal).
//
// One difference, and it is the point: there is no default height. Until
// somebody drags it the row is left to the layout that holds it, which is what
// keeps it a share of the window rather than a number of pixels that is too
// tall on a laptop and too short on a monitor. A drag pins it; a double-click
// on the grip hands it back to the layout.

export interface RowHeightSpec {
  storageKey: string;
  min: number;
  /** Never taller than this share of the box it sits in. */
  maxShare: number;
}

export function useRowHeight({ storageKey, min, maxShare }: RowHeightSpec) {
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved(storageKey),
    () => null
  );
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragging = dragHeight !== null;
  const height = dragHeight ?? saved;
  const [row, setRow] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!dragging || !row) return;
    let latest: number | null = null;
    const onMove = (e: PointerEvent) => {
      // Measured every move, so the edge follows the pointer exactly whatever
      // padding sits around the row. The top stays put and the bottom is what
      // the pointer is holding.
      const box = row.getBoundingClientRect();
      const parent = row.parentElement;
      let boxHeight = window.innerHeight;
      if (parent) {
        const parentStyle = getComputedStyle(parent);
        boxHeight =
          parent.clientHeight -
          parseFloat(parentStyle.paddingTop) -
          parseFloat(parentStyle.paddingBottom);
      }
      const ceiling = Math.max(min, boxHeight * maxShare);
      latest = Math.round(Math.min(Math.max(e.clientY - box.top, min), ceiling));
      setDragHeight(latest);
    };
    const onUp = () => {
      if (latest !== null) writeSaved(storageKey, latest);
      setDragHeight(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, row, storageKey, min, maxShare]);

  // A double-click gives the row back to the layout — see the header. Told
  // apart here rather than with onDoubleClick, for the reason the columns give.
  const lastDownRef = useRef(-Infinity);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.timeStamp - lastDownRef.current < DOUBLE_CLICK_MS) {
        lastDownRef.current = -Infinity;
        clearSaved(storageKey);
        return;
      }
      lastDownRef.current = e.timeStamp;
      // From whatever the layout had settled on, so the first pixel of the
      // drag does not jump.
      setDragHeight(height ?? row?.getBoundingClientRect().height ?? min);
    },
    [height, row, min, storageKey]
  );

  const style: CSSProperties | undefined =
    height === null ? undefined : { height: `${height}px`, maxHeight: `${maxShare * 100}%` };
  return { setElement: setRow, style, handle: { dragging, onPointerDown } };
}

/**
 * The grip for a row that is `relative`: lying along its bottom edge, showing
 * itself on hover. While a drag is under way a sheet covers the page, so the
 * pointer is not lost to a <video> or an iframe it passes over.
 */
export function RowResizeHandle({
  dragging,
  onPointerDown,
  label,
}: ReturnType<typeof useRowHeight>["handle"] & { label: string }) {
  return (
    <>
      <div
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="horizontal"
        title={label}
        className="group absolute inset-x-0 bottom-0 z-30 flex h-2.5 cursor-ns-resize items-center justify-center"
      >
        <div
          className={`h-1 w-12 rounded-full bg-zinc-300 transition-opacity group-hover:opacity-100 dark:bg-zinc-600 ${
            dragging ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      {dragging && <div className="fixed inset-0 z-[100] cursor-ns-resize" />}
    </>
  );
}

export function useColumnWidth({ storageKey, defaultWidth, min, max, maxShare, side }: ColumnWidthSpec) {
  const saved = useSyncExternalStore(
    subscribe,
    () => clamp(readSaved(storageKey) ?? defaultWidth, min, max),
    () => defaultWidth
  );
  // The width while a drag is under way — only written back once it ends.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = dragWidth !== null;
  const width = dragWidth ?? saved;
  // The column itself — setElement is what it is given as its `ref`.
  const [column, setColumn] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!dragging || !column) return;
    let latest: number | null = null;
    const onMove = (e: PointerEvent) => {
      // Measured on every move, so the edge follows the pointer exactly
      // whatever padding and gaps sit around the column.
      const box = column.getBoundingClientRect();
      const wanted = side === "left" ? e.clientX - box.left : box.right - e.clientX;
      // Against the row's content box, which is what the CSS max-width's
      // percentage is taken of.
      const row = column.parentElement;
      let rowWidth = window.innerWidth;
      if (row) {
        const rowStyle = getComputedStyle(row);
        rowWidth = row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight);
      }
      const ceiling = Math.max(min, Math.min(max, rowWidth * maxShare));
      latest = Math.round(clamp(wanted, min, ceiling));
      setDragWidth(latest);
    };
    const onUp = () => {
      if (latest !== null) writeSaved(storageKey, latest);
      setDragWidth(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, column, storageKey, min, max, maxShare, side]);

  // A double-click puts the default back — a width dragged to something
  // unusable is otherwise fiddly to undo by hand. Told apart here rather than
  // with onDoubleClick: the sheet a drag puts over the page (see
  // ColumnResizeHandle) is where the first click ends, and a double-click
  // split between two elements is never delivered to either.
  const lastDownRef = useRef(-Infinity);
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      // No text selected on the way across the page.
      e.preventDefault();
      if (e.timeStamp - lastDownRef.current < DOUBLE_CLICK_MS) {
        lastDownRef.current = -Infinity;
        writeSaved(storageKey, defaultWidth);
        return;
      }
      lastDownRef.current = e.timeStamp;
      setDragWidth(width);
    },
    [width, storageKey, defaultWidth]
  );

  const style: CSSProperties = { width: `${width}px`, maxWidth: `${maxShare * 100}%` };
  return { setElement: setColumn, style, handle: { side, dragging, onPointerDown } };
}

/**
 * The grip, for a column that is `relative`: in the gap beside it rather than
 * on the column's own edge, so reaching for it is never a click on what the
 * column holds, and showing itself on hover instead of as a bare hairline.
 * While a drag is under way a sheet covers the page, so the pointer is not lost
 * to an iframe (an ad, an embed) it passes over, and keeps its resize cursor.
 */
export function ColumnResizeHandle({
  side,
  dragging,
  onPointerDown,
  label,
}: ReturnType<typeof useColumnWidth>["handle"] & { label: string }) {
  return (
    <>
      <div
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation="vertical"
        title={label}
        className={`group absolute inset-y-0 z-30 flex w-3 cursor-ew-resize items-center justify-center ${
          side === "left" ? "-right-3" : "-left-3"
        }`}
      >
        <div
          className={`h-12 w-1 rounded-full bg-zinc-300 transition-opacity group-hover:opacity-100 dark:bg-zinc-600 ${
            dragging ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      {dragging && <div className="fixed inset-0 z-[100] cursor-ew-resize" />}
    </>
  );
}
